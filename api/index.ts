import { createHmac } from "node:crypto";

const environment = process.env.PAYMENT_PROVIDER_MODE === "prava" ? "sandbox" : "demo";
const sessionSecret = process.env.SESSION_SECRET || "warden-local-dev";
const pravaKey = process.env.PRAVA_PUBLISHABLE_KEY || null;

function sign(v: string) { return createHmac("sha256", sessionSecret).update(v).digest("base64url"); }
function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`; }
function now() { return new Date().toISOString(); }
function json(res: any, status: number, data: any) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); }

const SUBS = [
  { id: "sub_adobe", merchant_id: "merchant_adobe", merchant_name: "Adobe Creative Cloud", plan_id: "monthly", current_monthly_cost_minor: 5500, currency: "USD", billing_cycle: "monthly", next_charge_at: "2026-08-03T18:00:00Z", last_used_days_ago: 35, usage_frequency_score: 15, explicit_priority_score: 40, version: 1, capability: "unverified" as const, alt_plans: [{ plan_id: "annual", authorized_amount_minor: 59900, effective_monthly_cost_minor: 4992, currency: "USD" }], health_score: 25, health_data_status: "complete" },
  { id: "sub_gym", merchant_id: "merchant_gym", merchant_name: "Equinox Gym", plan_id: "standard", current_monthly_cost_minor: 2500, currency: "USD", billing_cycle: "monthly", next_charge_at: "2026-08-03T18:00:00Z", last_used_days_ago: 42, usage_frequency_score: 12, explicit_priority_score: 30, version: 1, capability: "unverified" as const, alt_plans: [{ plan_id: "basic", authorized_amount_minor: 1000, effective_monthly_cost_minor: 1000, currency: "USD" }], health_score: 21, health_data_status: "complete" },
  { id: "sub_spotify", merchant_id: "merchant_spotify", merchant_name: "Spotify", plan_id: "family", current_monthly_cost_minor: 1700, currency: "USD", billing_cycle: "monthly", next_charge_at: "2026-08-03T18:00:00Z", last_used_days_ago: 3, usage_frequency_score: 85, explicit_priority_score: 88, version: 1, capability: "payment" as const, alt_plans: [{ plan_id: "individual", authorized_amount_minor: 1100, effective_monthly_cost_minor: 1100, currency: "USD" }], health_score: 85, health_data_status: "complete" },
  { id: "sub_figma", merchant_id: "merchant_figma", merchant_name: "Figma", plan_id: "professional", current_monthly_cost_minor: 1500, currency: "USD", billing_cycle: "monthly", next_charge_at: "2026-08-03T18:00:00Z", last_used_days_ago: 1, usage_frequency_score: 90, explicit_priority_score: 92, version: 1, capability: "payment" as const, alt_plans: [{ plan_id: "annual", authorized_amount_minor: 14400, effective_monthly_cost_minor: 1200, currency: "USD" }], health_score: 93, health_data_status: "complete" },
  { id: "sub_notion", merchant_id: "merchant_notion", merchant_name: "Notion", plan_id: "monthly", current_monthly_cost_minor: 1000, currency: "USD", billing_cycle: "monthly", next_charge_at: "2026-08-03T18:00:00Z", last_used_days_ago: 2, usage_frequency_score: 82, explicit_priority_score: 85, version: 1, capability: "payment" as const, alt_plans: [], health_score: 89, health_data_status: "complete" },
  { id: "sub_coursera", merchant_id: "merchant_coursera", merchant_name: "Coursera Plus", plan_id: "trial", current_monthly_cost_minor: 800, currency: "USD", billing_cycle: "trial", next_charge_at: "2026-08-03T18:00:00Z", last_used_days_ago: null, usage_frequency_score: null, explicit_priority_score: 20, version: 1, capability: "prevention" as const, alt_plans: [], health_score: 37, health_data_status: "insufficient_data" },
];

const POLICY = { policy_id: "policy_demo", version: 1, status: "ACTIVE" as const, policy_text: "Never let total subscriptions exceed $150/month. Cancel or downgrade anything unused 30+ days. Always take annual billing if it saves more than 15%.", compiled_rules: { currency: "USD", rules: [{ rule_id: "monthly_cap", type: "MONTHLY_CAP" as const, amount_minor: 15000 }, { rule_id: "unused_threshold", type: "MAX_INACTIVE_DAYS" as const, days: 30 }, { rule_id: "annual_threshold", type: "MIN_ANNUAL_SAVINGS_BPS" as const, basis_points: 1500 }], unsupported_clauses: [] } };

let runCounter = 0;
const runs: Record<string, any> = {};

function decideRun() {
  const decisions = SUBS.map((sub, i) => {
    let action = "RENEW", target = null, status = "NO_ACTION_REQUIRED", outcome = "decision_only", reasoning = "", authorized = 0, effective = sub.current_monthly_cost_minor, savings = 0;
    if (sub.plan_id === "cancelled") { action = "RENEW"; reasoning = `${sub.merchant_name} has no active recurring charge.`; }
    else if (sub.plan_id === "trial" && sub.last_used_days_ago === null) { action = "DECLINE"; status = "RECOMMENDED"; outcome = "decision_only"; reasoning = `${sub.merchant_name} has no recorded use and is approaching a paid conversion.`; }
    else if (sub.last_used_days_ago !== null && sub.last_used_days_ago >= 30) {
      const cheapest = sub.alt_plans.sort((a, b) => a.effective_monthly_cost_minor - b.effective_monthly_cost_minor)[0];
      if (cheapest) { action = "SWITCH"; target = cheapest.plan_id; effective = cheapest.effective_monthly_cost_minor; savings = sub.current_monthly_cost_minor - effective; authorized = cheapest.authorized_amount_minor; status = sub.capability === "unverified" ? "RECOMMENDED" : "AWAITING_APPROVAL"; reasoning = `${sub.merchant_name} unused ${sub.last_used_days_ago} days. Switch to ${cheapest.plan_id}.`; }
      else { action = "DECLINE"; status = "RECOMMENDED"; effective = 0; reasoning = `${sub.merchant_name} unused ${sub.last_used_days_ago} days, no alternatives.`; }
    } else if (sub.alt_plans.length > 0 && sub.alt_plans[0].effective_monthly_cost_minor < sub.current_monthly_cost_minor) {
      const best = sub.alt_plans[0]; const savingsPct = ((sub.current_monthly_cost_minor - best.effective_monthly_cost_minor) / sub.current_monthly_cost_minor) * 100;
      if (savingsPct > 15) { action = "SWITCH"; target = best.plan_id; effective = best.effective_monthly_cost_minor; savings = sub.current_monthly_cost_minor - effective; authorized = best.authorized_amount_minor; status = sub.capability === "unverified" ? "RECOMMENDED" : "AWAITING_APPROVAL"; reasoning = `Annual plan saves ${savingsPct.toFixed(0)}%, exceeding 15% threshold.`; }
    }
    if (status !== "AWAITING_APPROVAL") outcome = "decision_only";
    const id_val = id("decision");
    return { decision_id: id_val, run_id: "", subscription_id: sub.id, merchant_name: sub.merchant_name, action, target_plan_id: target, policy_rule_reference: "monthly_cap", reasoning, execution_status: status, outcome_type: outcome, authorized_amount_minor: authorized, effective_monthly_cost_minor: effective, recurring_monthly_savings_minor: savings, one_time_avoided_minor: 0, currency: "USD", failure_code: null, evidence_ids: [], plan_order: i, depends_on_decision_id: null };
  });
  return decisions;
}

export default async function handler(req: any, res: any) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") { res.writeHead(204); return res.end(); }

  // Parse cookies
  const cookies: Record<string, string> = {};
  (req.headers.cookie || "").split(";").forEach((c: string) => { const [k, ...v] = c.trim().split("="); if (k) cookies[k] = v.join("="); });

  // Parse body for POST/PUT
  let body: any = {};
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    body = await new Promise((resolve) => { let d = ""; req.on("data", (c: any) => d += c); req.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); });
  }

  // Routes
  if (path === "/api/v1/health") return json(res, 200, { status: "ok", mode: environment });
  if (path === "/api/v1/session") {
    const payload = `user_demo.${Date.now()}`; const value = `${payload}.${sign(payload)}`; const csrf = sign(`${value}.csrf`);
    res.setHeader("Set-Cookie", `warden_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${12*60*60*1000}`);
    return json(res, 200, { user_id: "user_demo", csrf_token: csrf, environment, prava_environment: environment, prava_publishable_key: pravaKey, prava_publishable_key_error: null });
  }
  if (path === "/api/v1/subscriptions") return json(res, 200, { subscriptions: SUBS, portfolio_version: 1 });
  if (path === "/api/v1/policies/current" && method === "GET") return json(res, 200, POLICY);
  if (path === "/api/v1/policies/current" && method === "PUT") {
    const text = body.policy_text || POLICY.policy_text;
    return json(res, 200, { ...POLICY, policy_text: text, version: POLICY.version + 1, status: "DRAFT" });
  }
  if (path.match(/^\/api\/v1\/policies\/[^/]+\/activate$/) && method === "POST") return json(res, 200, POLICY);
  if (path === "/api/v1/runs" && method === "POST") {
    const runId = id("run"); const decisions = decideRun();
    const needsApproval = decisions.some((d: any) => d.execution_status === "AWAITING_APPROVAL");
    runs[runId] = { run_id: runId, run_status: needsApproval ? "EXECUTING" : "COMPLETED", policy_version: 1, portfolio_snapshot_id: id("snapshot"), portfolio_version: 1, created_at: now(), decisions };
    return json(res, 202, { run_id: runId, run_status: needsApproval ? "EXECUTING" : "COMPLETED", policy_version: 1, portfolio_snapshot_id: id("snapshot"), portfolio_version: 1, created_at: now(), decisions });
  }
  if (path === "/api/v1/runs/latest" && method === "GET") {
    const lastRun = Object.values(runs).pop();
    return json(res, 200, { run: lastRun || null });
  }
  if (path.match(/^\/api\/v1\/runs\/[^/]+$/) && (method === "GET" || method === "PATCH")) {
    const runId = path.split("/").pop()!;
    return json(res, 200, runs[runId] || { error: "Not found" });
  }
  if (path.match(/^\/api\/v1\/runs\/[^/]+\/events$/)) return json(res, 200, { events: [] });
  if (path.match(/^\/api\/v1\/runs\/[^/]+\/stream$/)) { res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" }); res.write(": heartbeat\n\n"); res.end(); return; }
  if (path.match(/^\/api\/v1\/decisions\/[^/]+\/cancel$/) && method === "POST") {
    const run = Object.values(runs).pop();
    if (run) { for (const d of run.decisions) { if (d.execution_status === "AWAITING_APPROVAL") { d.execution_status = "APPROVAL_DECLINED"; d.outcome_type = null; } } run.run_status = "COMPLETED"; }
    return json(res, 200, run || {});
  }
  if (path === "/api/v1/savings") return json(res, 200, { currency: "USD", recurring_monthly_saved_minor: 0, one_time_avoided_minor: 0 });
  if (path.match(/^\/api\/v1\/prava\//)) return json(res, 200, { status: "pending", transactions: [] });

  json(res, 404, { error: { code: "NOT_FOUND", message: "Route not found" } });
}
