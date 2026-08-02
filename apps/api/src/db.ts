import type { CompiledPolicy, Decision, EvidenceRecord, LedgerEvent, PolicyRecord, RunRecord, Subscription } from "@warden/shared";
import { config } from "./config.js";
import { healthScore, now } from "./domain.js";

type DbRow = Record<string, unknown>;

// Determine which backend to use: PostgreSQL if DATABASE_URL is set, else SQLite
const usePg = !!(config.databaseUrl && config.databaseUrl.startsWith("postgresql"));

// ─── PostgreSQL backend ──────────────────────────────────────────────────────

let pgPool: any = null;

async function getPool() {
  if (!pgPool) {
    const { Pool } = await import("pg");
    let connectionString = config.databaseUrl;
    // Try to construct from Supabase URL + database password
    if (!connectionString && config.supabaseUrl && config.supabaseDbPassword) {
      const projectRef = config.supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
      if (projectRef) {
        connectionString = `postgresql://postgres:${config.supabaseDbPassword}@aws-0-${projectRef}.pooler.supabase.com:6543/postgres`;
      }
    }
    if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL mode. Set DATABASE_URL in .env or Vercel environment variables.");
    pgPool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 5 });
  }
  return pgPool;
}

function pgQuery(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** Convert PostgreSQL $1, $2, ... back to ? for SQLite */
function sqliteQuery(sql: string): string {
  return sql.replace(/\$\d+/g, "?");
}

// ─── SQLite backend ──────────────────────────────────────────────────────────

let sqliteDb: any = null;

async function ensureSqlite() {
  if (sqliteDb) return sqliteDb;
  const { mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  mkdirSync(dirname(config.databasePath), { recursive: true });
  sqliteDb = new DatabaseSync(config.databasePath);
  sqliteDb.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return sqliteDb;
}

// ─── Unified interface ───────────────────────────────────────────────────────

let initialized = false;

async function ensureInit() {
  if (initialized) return;
  initialized = true;
  if (usePg) await pgMigrate();
  else sqliteMigrate();
}

export class WardenDb {
  private initialized = false;

  private async init() {
    if (this.initialized) return;
    this.initialized = true;
    if (usePg) {
      await pgMigrate();
      await pgSeed();
    } else {
      sqliteMigrate();
      sqliteSeed();
    }
  }

  async run(sql: string, ...params: unknown[]) {
    await this.init();
    if (usePg) {
      const pool = await getPool();
      const result = await pool.query(pgQuery(sql), params);
      return { changes: result.rowCount ?? 0, lastInsertRowid: result.rows[0]?.id ?? null };
    } else {
      const db = await ensureSqlite();
      return db.prepare(sqliteQuery(sql)).run(...params);
    }
  }

  async get<T extends DbRow>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    await this.init();
    if (usePg) {
      const pool = await getPool();
      const result = await pool.query(pgQuery(sql), params);
      return result.rows[0] as T | undefined;
    } else {
      const db = await ensureSqlite();
      return db.prepare(sqliteQuery(sql)).get(...params) as T | undefined;
    }
  }

  async all<T extends DbRow>(sql: string, ...params: unknown[]): Promise<T[]> {
    await this.init();
    if (usePg) {
      const pool = await getPool();
      const result = await pool.query(pgQuery(sql), params);
      return result.rows as T[];
    } else {
      const db = await ensureSqlite();
      return db.prepare(sqliteQuery(sql)).all(...params) as T[];
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.init();
    if (usePg) {
      const pool = await getPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn();
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } else {
      const db = await ensureSqlite();
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  async close() {
    if (usePg && pgPool) {
      await pgPool.end();
      pgPool = null;
    }
    if (!usePg && sqliteDb) {
      sqliteDb.close();
      sqliteDb = null;
    }
  }

  // ─── Domain queries ──────────────────────────────────────────────────────

  async subscriptions(userId: string): Promise<Subscription[]> {
    const rows = await this.all<DbRow>("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY current_monthly_cost_minor DESC", userId);
    return rows.map((row) => {
      const base = {
        id: String(row.subscription_id),
        merchant_id: String(row.merchant_id),
        merchant_name: String(row.merchant_name),
        plan_id: String(row.plan_id),
        current_monthly_cost_minor: Number(row.current_monthly_cost_minor),
        currency: String(row.currency),
        billing_cycle: String(row.billing_cycle),
        next_charge_at: String(row.next_charge_at),
        last_used_days_ago: row.last_used_days_ago === null ? null : Number(row.last_used_days_ago),
        usage_frequency_score: row.usage_frequency_score === null ? null : Number(row.usage_frequency_score),
        explicit_priority_score: Number(row.explicit_priority_score),
        version: Number(row.version),
        capability: String(row.capability) as Subscription["capability"],
        alt_plans: JSON.parse(String(row.alt_plans_json)) as Subscription["alt_plans"],
      };
      const health = healthScore(base);
      return { ...base, health_score: health.score, health_data_status: health.dataStatus };
    });
  }

  async activePolicy(userId: string): Promise<PolicyRecord> {
    const row = await this.get<DbRow>("SELECT * FROM policies WHERE user_id = ? AND status = 'ACTIVE'", userId);
    if (!row) throw new Error("No active policy");
    return {
      policy_id: String(row.policy_id),
      version: Number(row.version),
      status: "ACTIVE",
      policy_text: String(row.policy_text),
      compiled_rules: JSON.parse(String(row.compiled_json)) as CompiledPolicy,
    };
  }

  async runRecord(runId: string, userId: string): Promise<RunRecord | undefined> {
    const row = await this.get<DbRow>("SELECT * FROM runs WHERE run_id = ? AND user_id = ?", runId, userId);
    if (!row) return undefined;
    const evidenceByDecision = new Map<string, string[]>();
    const evidenceRows = await this.all<DbRow>(
      "SELECT a.decision_id, e.evidence_id FROM execution_evidence e JOIN execution_attempts a ON a.execution_attempt_id = e.execution_attempt_id JOIN decisions d ON d.decision_id = a.decision_id WHERE d.run_id = ?",
      runId,
    );
    for (const evidence of evidenceRows) {
      const decisionId = String(evidence.decision_id);
      evidenceByDecision.set(decisionId, [...(evidenceByDecision.get(decisionId) ?? []), String(evidence.evidence_id)]);
    }
    const decisions = (await this.all<DbRow>(
      "SELECT d.*, s.merchant_name FROM decisions d JOIN subscriptions s ON s.subscription_id = d.subscription_id WHERE d.run_id = ? ORDER BY d.plan_order",
      runId,
    )).map((decision): Decision => ({
      decision_id: String(decision.decision_id),
      run_id: String(decision.run_id),
      subscription_id: String(decision.subscription_id),
      merchant_name: String(decision.merchant_name),
      action: String(decision.action) as Decision["action"],
      target_plan_id: decision.target_plan_id === null ? null : String(decision.target_plan_id),
      policy_rule_reference: String(decision.policy_rule_reference),
      reasoning: String(decision.reasoning),
      execution_status: String(decision.execution_status) as Decision["execution_status"],
      outcome_type: decision.outcome_type === null ? null : String(decision.outcome_type) as Decision["outcome_type"],
      authorized_amount_minor: Number(decision.authorized_amount_minor),
      effective_monthly_cost_minor: Number(decision.effective_monthly_cost_minor),
      recurring_monthly_savings_minor: Number(decision.recurring_monthly_savings_minor),
      one_time_avoided_minor: Number(decision.one_time_avoided_minor),
      currency: String(decision.currency),
      failure_code: decision.failure_code === null ? null : String(decision.failure_code),
      evidence_ids: evidenceByDecision.get(String(decision.decision_id)) ?? [],
    }));
    return {
      run_id: String(row.run_id),
      run_status: String(row.run_status) as RunRecord["run_status"],
      policy_version: Number(row.policy_version),
      portfolio_snapshot_id: String(row.portfolio_snapshot_id),
      portfolio_version: Number(row.portfolio_version),
      created_at: String(row.created_at),
      decisions,
    };
  }

  async events(runId: string, afterSequence = 0): Promise<LedgerEvent[]> {
    return (await this.all<DbRow>("SELECT * FROM ledger_events WHERE run_id = ? AND sequence > ? ORDER BY sequence", runId, afterSequence)).map((row) => ({
      event_id: String(row.event_id),
      correlation_id: String(row.correlation_id),
      run_id: String(row.run_id),
      decision_id: row.decision_id === null ? null : String(row.decision_id),
      sequence: Number(row.sequence),
      event_type: String(row.event_type),
      occurred_at: String(row.occurred_at),
      payload: JSON.parse(String(row.payload_json)),
      previous_event_hash: row.previous_event_hash === null ? null : String(row.previous_event_hash),
      payload_hash: String(row.payload_hash),
    }));
  }

  async evidence(evidenceId: string, userId: string): Promise<EvidenceRecord | undefined> {
    const row = await this.get<DbRow>(
      "SELECT e.* FROM execution_evidence e JOIN execution_attempts a ON a.execution_attempt_id=e.execution_attempt_id JOIN decisions d ON d.decision_id=a.decision_id JOIN runs r ON r.run_id=d.run_id WHERE e.evidence_id=? AND r.user_id=?",
      evidenceId,
      userId,
    );
    if (!row) return undefined;
    return {
      evidence_id: String(row.evidence_id),
      execution_attempt_id: String(row.execution_attempt_id),
      evidence_type: String(row.evidence_type) as EvidenceRecord["evidence_type"],
      provider: String(row.provider),
      provider_reference: String(row.provider_reference),
      merchant_id: String(row.merchant_id),
      authorized_amount_minor: Number(row.authorized_amount_minor),
      currency: String(row.currency),
      provider_status: "confirmed",
      recurrence_stopped: Boolean(row.recurrence_stopped),
      occurred_at: String(row.occurred_at),
      verified_at: String(row.verified_at),
      payload_hash: String(row.payload_hash),
    };
  }
}

// ─── Schema (shared SQL — works on both SQLite and PostgreSQL) ───────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS system_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS policies (
    policy_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('DRAFT','ACTIVE')),
    policy_text TEXT NOT NULL,
    compiled_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(policy_id, version)
  );
  CREATE TABLE IF NOT EXISTS portfolio_meta (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id),
    version INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    merchant_id TEXT NOT NULL,
    merchant_name TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    current_monthly_cost_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    billing_cycle TEXT NOT NULL,
    next_charge_at TEXT NOT NULL,
    last_used_days_ago INTEGER,
    usage_frequency_score INTEGER,
    explicit_priority_score INTEGER NOT NULL,
    version INTEGER NOT NULL,
    capability TEXT NOT NULL,
    alt_plans_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    portfolio_version INTEGER NOT NULL,
    policy_version INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    run_status TEXT NOT NULL,
    policy_version INTEGER NOT NULL,
    portfolio_snapshot_id TEXT NOT NULL,
    portfolio_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, idempotency_key)
  );
  CREATE TABLE IF NOT EXISTS decisions (
    decision_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id),
    subscription_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_plan_id TEXT,
    policy_rule_reference TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    execution_status TEXT NOT NULL,
    outcome_type TEXT,
    authorized_amount_minor INTEGER NOT NULL,
    effective_monthly_cost_minor INTEGER NOT NULL,
    recurring_monthly_savings_minor INTEGER NOT NULL,
    one_time_avoided_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    failure_code TEXT,
    plan_order INTEGER NOT NULL,
    depends_on_decision_id TEXT
  );
  CREATE TABLE IF NOT EXISTS execution_attempts (
    execution_attempt_id TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL REFERENCES decisions(decision_id),
    provider TEXT NOT NULL,
    provider_idempotency_key TEXT NOT NULL UNIQUE,
    execution_status TEXT NOT NULL,
    approval_expires_at TEXT NOT NULL,
    reconciliation_deadline_at TEXT,
    failure_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS execution_evidence (
    evidence_id TEXT PRIMARY KEY,
    execution_attempt_id TEXT NOT NULL REFERENCES execution_attempts(execution_attempt_id),
    evidence_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_reference TEXT NOT NULL UNIQUE,
    merchant_id TEXT NOT NULL,
    authorized_amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    provider_status TEXT NOT NULL,
    recurrence_stopped INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    payload_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledger_events (
    event_id TEXT PRIMARY KEY,
    correlation_id TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES runs(run_id),
    decision_id TEXT,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    previous_event_hash TEXT,
    payload_hash TEXT NOT NULL,
    UNIQUE(run_id, sequence)
  );
  CREATE TABLE IF NOT EXISTS idempotency_keys (
    user_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(user_id, scope, key)
  );
`;

async function sqliteMigrate() {
  const db = await ensureSqlite();
  db.exec(SCHEMA_SQL);
  // Add indexes that SQLite supports
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_active_policy ON policies(user_id) WHERE status = 'ACTIVE'"); } catch {}
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_active_attempt ON execution_attempts(decision_id) WHERE execution_status IN ('AWAITING_APPROVAL','AUTHORIZED','EXECUTING','RECONCILING','UNKNOWN')"); } catch {}
}

async function pgMigrate() {
  const pool = await getPool();
  await pool.query(SCHEMA_SQL);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS one_active_policy ON policies(user_id) WHERE status = 'ACTIVE'");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS one_active_attempt ON execution_attempts(decision_id) WHERE execution_status IN ('AWAITING_APPROVAL','AUTHORIZED','EXECUTING','RECONCILING','UNKNOWN')");
}

// ─── Seed data ───────────────────────────────────────────────────────────────

const SEED_USER = "user_demo";
const SEED_POLICY_TEXT = "Never let total subscriptions exceed $150/month. Cancel or downgrade anything unused 30+ days. Always take annual billing if it saves more than 15%.";
const SEED_POLICY: CompiledPolicy = {
  currency: "USD",
  rules: [
    { rule_id: "monthly_cap", type: "MONTHLY_CAP", amount_minor: 15000 },
    { rule_id: "unused_threshold", type: "MAX_INACTIVE_DAYS", days: 30 },
    { rule_id: "annual_threshold", type: "MIN_ANNUAL_SAVINGS_BPS", basis_points: 1500 },
  ],
  unsupported_clauses: [],
};
const SEED_SUBS = [
  ["sub_notion", "merchant_notion", "Notion", "monthly", 1000, "monthly", 2, 82, 85, "payment", "[]"],
  ["sub_figma", "merchant_figma", "Figma", "professional", 1500, "monthly", 1, 90, 92, "payment", JSON.stringify([{ plan_id: "annual", authorized_amount_minor: 14400, effective_monthly_cost_minor: 1200, currency: "USD" }])],
  ["sub_gym", "merchant_gym", "Equinox Gym", "standard", 2500, "monthly", 42, 12, 30, "unverified", JSON.stringify([{ plan_id: "basic", authorized_amount_minor: 1000, effective_monthly_cost_minor: 1000, currency: "USD" }])],
  ["sub_spotify", "merchant_spotify", "Spotify", "family", 1700, "monthly", 3, 85, 88, "payment", JSON.stringify([{ plan_id: "individual", authorized_amount_minor: 1100, effective_monthly_cost_minor: 1100, currency: "USD" }])],
  ["sub_coursera", "merchant_coursera", "Coursera Plus", "trial", 800, "trial", null, null, 20, "prevention", "[]"],
  ["sub_adobe", "merchant_adobe", "Adobe Creative Cloud", "monthly", 5500, "monthly", 35, 15, 40, "unverified", JSON.stringify([{ plan_id: "annual", authorized_amount_minor: 59900, effective_monthly_cost_minor: 4992, currency: "USD" }])],
] as const;

async function sqliteSeed() {
  const db = await ensureSqlite();
  const mode = db.prepare("SELECT value FROM system_meta WHERE key='execution_mode'").get();
  if (mode && mode.value !== config.environment) throw new Error(`Database mode mismatch: ${mode.value} vs ${config.environment}`);
  if (!mode) db.prepare("INSERT INTO system_meta VALUES ('execution_mode', ?)").run(config.environment);
  const count = db.prepare("SELECT COUNT(*) AS count FROM users").get();
  if (count?.count > 0) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO users VALUES (?, ?, ?)").run(SEED_USER, "Demo operator", now());
    db.prepare("INSERT INTO policies VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)").run("policy_demo", SEED_USER, 1, SEED_POLICY_TEXT, JSON.stringify(SEED_POLICY), now());
    db.prepare("INSERT INTO portfolio_meta VALUES (?, ?)").run(SEED_USER, 1);
    for (const [sid, mid, name, plan, cost, cycle, lastUsed, freq, prio, cap, alt] of SEED_SUBS) {
      db.prepare("INSERT INTO subscriptions VALUES (?, 'user_demo', ?, ?, ?, ?, 'USD', ?, '2026-08-03T18:00:00Z', ?, ?, ?, 1, ?, ?)").run(sid, mid, name, plan, cost, cycle, lastUsed, freq, prio, cap, alt);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function pgSeed() {
  const pool = await getPool();
  const modeRow = await pool.query("SELECT value FROM system_meta WHERE key='execution_mode'");
  const storedMode = modeRow.rows[0]?.value;
  if (storedMode && storedMode !== config.environment) throw new Error(`Database mode mismatch: ${storedMode} vs ${config.environment}`);
  if (!storedMode) await pool.query("INSERT INTO system_meta VALUES ($1, $2)", ["execution_mode", config.environment]);
  const countRow = await pool.query("SELECT COUNT(*) AS count FROM users");
  if (Number(countRow.rows[0]?.count ?? 0) > 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users VALUES ($1, $2, $3)", [SEED_USER, "Demo operator", now()]);
    await client.query("INSERT INTO policies VALUES ($1, $2, $3, 'ACTIVE', $4, $5, $6)", ["policy_demo", SEED_USER, 1, SEED_POLICY_TEXT, JSON.stringify(SEED_POLICY), now()]);
    await client.query("INSERT INTO portfolio_meta VALUES ($1, $2)", [SEED_USER, 1]);
    for (const [sid, mid, name, plan, cost, cycle, lastUsed, freq, prio, cap, alt] of SEED_SUBS) {
      await client.query(
        "INSERT INTO subscriptions VALUES ($1, 'user_demo', $2, $3, $4, $5, 'USD', $6, '2026-08-03T18:00:00Z', $7, $8, $9, 1, $10, $11)",
        [sid, mid, name, plan, cost, cycle, lastUsed, freq, prio, cap, alt],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
