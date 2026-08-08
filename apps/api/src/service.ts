import type {
  CompiledPolicy,
  Decision,
  EvidenceRecord,
  ExecutionStatus,
  LedgerEvent,
  PolicyRecord,
  RunRecord,
  SavingsSummary,
  Subscription,
} from "@warden/shared";
import { compiledPolicySchema } from "@warden/shared";
import { WardenDb } from "./db.js";
import { assertTransition, getRule, id, now, sha256, stableJson } from "./domain.js";
import { logger } from "./logger.js";
import { createExecutionProvider, PravaExecutionProvider, type ApprovalSession, type ExecutionProvider, type ProviderExecutionResult } from "./provider.js";
import { createResilientReasoner, type CandidateDecision, type Reasoner } from "./reasoner.js";

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
  }
}

export { HttpError };

type Row = Record<string, unknown>;

interface PlannedDecision {
  candidate: CandidateDecision;
  subscription: Subscription;
  decisionId: string;
  status: ExecutionStatus;
  outcome: Decision["outcome_type"];
  authorizedAmountMinor: number;
  effectiveMonthlyCostMinor: number;
  recurringMonthlySavingsMinor: number;
  oneTimeAvoidedMinor: number;
  dependsOnDecisionId: string | null;
}

export class WardenService {
  constructor(
    readonly db = new WardenDb(),
    readonly reasoner: Reasoner = createResilientReasoner(),
    readonly provider: ExecutionProvider = createExecutionProvider(),
  ) {}

  async subscriptions(userId: string) {
    return this.db.subscriptions(userId);
  }

  async activePolicy(userId: string) {
    return this.db.activePolicy(userId);
  }

  async portfolioVersion(userId: string): Promise<number> {
    return Number((await this.db.get<Row>("SELECT version FROM portfolio_meta WHERE user_id = $1", userId))?.version ?? 1);
  }

  async draftPolicy(userId: string, text: string, expectedVersion: number): Promise<PolicyRecord> {
    const current = await this.activePolicy(userId);
    if (current.version !== expectedVersion) throw new HttpError(409, "Policy version is stale", "POLICY_VERSION_CONFLICT");
    const compiled = compiledPolicySchema.parse(await this.reasoner.compilePolicy(text));
    const nextVersion = current.version + 1;
    await this.db.transaction(async () => {
      await this.db.run(
        "INSERT INTO policies (policy_id, user_id, version, status, policy_text, compiled_json, created_at) VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6) ON CONFLICT (policy_id, version) DO UPDATE SET status='DRAFT', policy_text=EXCLUDED.policy_text, compiled_json=EXCLUDED.compiled_json, created_at=EXCLUDED.created_at",
        current.policy_id,
        userId,
        nextVersion,
        text,
        JSON.stringify(compiled),
        now(),
      );
    });
    return { policy_id: current.policy_id, version: nextVersion, status: "DRAFT", policy_text: text, compiled_rules: compiled };
  }

  async activatePolicy(userId: string, policyId: string, version: number): Promise<PolicyRecord> {
    const draft = await this.db.get<Row>(
      "SELECT * FROM policies WHERE policy_id = $1 AND user_id = $2 AND version = $3 AND status = 'DRAFT'",
      policyId,
      userId,
      version,
    );
    if (!draft) throw new HttpError(404, "Draft policy was not found", "POLICY_DRAFT_NOT_FOUND");
    const compiled = compiledPolicySchema.parse(JSON.parse(String(draft.compiled_json)));
    if (compiled.unsupported_clauses.length > 0) {
      throw new HttpError(422, "Unsupported policy clauses must be resolved before activation", "POLICY_UNSUPPORTED_CLAUSES");
    }
    await this.db.transaction(async () => {
      await this.db.run("UPDATE policies SET status = 'DRAFT' WHERE user_id = $1 AND status = 'ACTIVE'", userId);
      await this.db.run("UPDATE policies SET status = 'ACTIVE' WHERE policy_id = $1 AND user_id = $2 AND version = $3", policyId, userId, version);
    });
    return { policy_id: policyId, version, status: "ACTIVE", policy_text: String(draft.policy_text), compiled_rules: compiled };
  }

  async createRun(userId: string, idempotencyKey: string, policyVersion: number, expectedPortfolioVersion: number): Promise<RunRecord> {
    const existing = await this.db.get<Row>("SELECT run_id FROM runs WHERE user_id = $1 AND idempotency_key = $2", userId, idempotencyKey);
    if (existing) return this.requireRun(String(existing.run_id), userId);

    const activePolicy = await this.activePolicy(userId);
    if (activePolicy.version !== policyVersion) throw new HttpError(409, "Policy version is stale", "POLICY_VERSION_CONFLICT");
    const currentPortfolioVersion = await this.portfolioVersion(userId);
    if (currentPortfolioVersion !== expectedPortfolioVersion) throw new HttpError(409, "Portfolio version is stale", "PORTFOLIO_VERSION_CONFLICT");

    // Auto-expire stale AWAITING_APPROVAL decisions (>5 min old) so they never block new runs
    await this.autoExpireStaleApprovals(userId);

    const blocking = await this.db.get<Row>(
      "SELECT run_id FROM runs WHERE user_id = $1 AND run_status IN ('CREATED','PLANNING','READY','EXECUTING') ORDER BY created_at DESC LIMIT 1",
      userId,
    );
    if (blocking) throw new HttpError(409, `Run ${String(blocking.run_id)} is still active`, "ACTIVE_RUN_EXISTS");

    logger.info("run_created", { userId }, { policyVersion, expectedPortfolioVersion });

    const subscriptions = await this.subscriptions(userId);
    const runId = id("run");
    const snapshotId = id("snapshot");
    const correlationId = id("corr");
    const createdAt = now();
    await this.db.transaction(async () => {
      await this.db.run(
        "INSERT INTO portfolio_snapshots VALUES ($1, $2, $3, $4, $5, $6)",
        snapshotId,
        userId,
        currentPortfolioVersion,
        policyVersion,
        JSON.stringify(subscriptions),
        createdAt,
      );
      await this.db.run(
        "INSERT INTO runs VALUES ($1, $2, $3, 'PLANNING', $4, $5, $6, $7, $8)",
        runId,
        userId,
        idempotencyKey,
        policyVersion,
        snapshotId,
        currentPortfolioVersion,
        createdAt,
        createdAt,
      );
      await this.appendEvent(runId, null, correlationId, "run_started", { policy_version: policyVersion, portfolio_version: currentPortfolioVersion });
    });

    try {
      const total = subscriptions.reduce((sum, subscription) => sum + subscription.current_monthly_cost_minor, 0);
      const candidates = await Promise.all(subscriptions.map(async (subscription) => {
        const candidate = await this.reasoner.decide(subscription, activePolicy.compiled_rules, total);
        if (candidate.subscription_id !== subscription.id) {
          candidate.subscription_id = subscription.id;
        }
        return candidate;
      }));

      const candidateSubscriptions = new Set<string>();
      for (const candidate of candidates) {
        if (candidateSubscriptions.has(candidate.subscription_id)) {
          throw new HttpError(422, "Reasoner returned duplicate subscription", "INVALID_CANDIDATE_IDENTITY");
        }
        candidateSubscriptions.add(candidate.subscription_id);
      }

      const plan = this.plan(candidates, subscriptions, activePolicy.compiled_rules);
      await this.db.transaction(async () => {
        const currentVersion = await this.portfolioVersion(userId);
        if (currentVersion !== currentPortfolioVersion) throw new HttpError(409, "Portfolio changed while planning", "PORTFOLIO_VERSION_CONFLICT");
        for (const [index, item] of plan.entries()) {
          await this.db.run(
            `INSERT INTO decisions VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
            item.decisionId,
            runId,
            item.subscription.id,
            item.candidate.action,
            item.candidate.target_plan,
            item.candidate.policy_rule_reference,
            this.sanitizeReasoning(item.candidate.reasoning),
            item.candidate.confidence ?? null,
            item.status,
            item.outcome,
            item.authorizedAmountMinor,
            item.effectiveMonthlyCostMinor,
            item.recurringMonthlySavingsMinor,
            item.oneTimeAvoidedMinor,
            item.subscription.currency,
            null,
            index,
            item.dependsOnDecisionId,
          );
          await this.appendEvent(runId, item.decisionId, correlationId, "decision_recorded", {
            subscription_id: item.subscription.id,
            action: item.candidate.action,
            target_plan_id: item.candidate.target_plan,
            execution_status: item.status,
            outcome_type: item.outcome,
          });
        }
        const needsApproval = plan.some((decision) => decision.status === "AWAITING_APPROVAL");
        await this.db.run("UPDATE runs SET run_status = $1, updated_at = $2 WHERE run_id = $3", needsApproval ? "EXECUTING" : "COMPLETED", now(), runId);
        await this.appendEvent(runId, null, correlationId, needsApproval ? "run_ready" : "run_completed", { decisions: plan.length });
      });
      return this.requireRun(runId, userId);
    } catch (error) {
      await this.db.transaction(async () => {
        await this.db.run("UPDATE runs SET run_status = 'FAILED', updated_at = $1 WHERE run_id = $2", now(), runId);
        await this.appendEvent(runId, null, correlationId, "run_failed", { code: error instanceof HttpError ? error.code : "PLANNING_FAILED" });
      });
      throw error;
    }
  }

  async latestRun(userId: string): Promise<RunRecord | null> {
    const row = await this.db.get<Row>("SELECT run_id FROM runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", userId);
    return row ? this.requireRun(String(row.run_id), userId) : null;
  }

  async run(runId: string, userId: string): Promise<RunRecord> {
    return this.requireRun(runId, userId);
  }

  async events(runId: string, userId: string, afterSequence = 0): Promise<LedgerEvent[]> {
    await this.requireRun(runId, userId);
    return this.db.events(runId, afterSequence);
  }

  async recoverStuckRuns(): Promise<number> {
    const stuck = await this.db.all<Row>(
      "SELECT run_id, user_id, run_status FROM runs WHERE run_status IN ('CREATED','PLANNING','READY','EXECUTING')",
    );
    for (const row of stuck) {
      const runId = String(row.run_id);
      const userId = String(row.user_id);
      const priorStatus = String(row.run_status);
      const correlationId = id("corr");
      try {
        await this.db.transaction(async () => {
          await this.db.run("UPDATE runs SET run_status='FAILED', updated_at=$1 WHERE run_id=$2", now(), runId);
          for (const decision of await this.db.all<Row>("SELECT decision_id, execution_status FROM decisions WHERE run_id=$1", runId)) {
            const status = String(decision.execution_status);
            if (["AWAITING_APPROVAL", "AUTHORIZED", "EXECUTING", "RECONCILING", "UNKNOWN"].includes(status)) {
              await this.db.run("UPDATE decisions SET execution_status='FAILED', failure_code='RUN_RECOVERED', outcome_type=NULL WHERE decision_id=$1", String(decision.decision_id));
              await this.db.run("UPDATE execution_attempts SET execution_status='FAILED', failure_code='RUN_RECOVERED', updated_at=$1 WHERE decision_id=$2 AND execution_status IN ('AWAITING_APPROVAL','AUTHORIZED','EXECUTING','RECONCILING','UNKNOWN')", now(), String(decision.decision_id));
            }
          }
          await this.appendEvent(runId, null, correlationId, "run_failed", { code: "RUN_RECOVERED", prior_status: priorStatus });
          await this.appendEvent(runId, null, correlationId, "run_completed", { run_status: "FAILED" });
        });
        logger.warn("run_recovered", { userId, correlationId }, { runId, priorStatus });
      } catch (error) {
        logger.error("run_recovery_failed", { userId, correlationId }, error);
      }
    }
    return stuck.length;
  }

  /**
   * Auto-expire AWAITING_APPROVAL decisions that have been waiting >2 minutes.
   * This prevents stale approvals from blocking new runs forever.
   */
  private async autoExpireStaleApprovals(userId: string) {
    const staleRuns = await this.db.all<Row>(
      "SELECT DISTINCT r.run_id FROM runs r JOIN decisions d ON d.run_id = r.run_id WHERE r.user_id = $1 AND r.run_status = 'EXECUTING' AND d.execution_status = 'AWAITING_APPROVAL' AND r.created_at < $2",
      userId,
      new Date(Date.now() - 2 * 60_000).toISOString(),
    );
    for (const row of staleRuns) {
      const runId = String(row.run_id);
      const correlationId = id("corr");
      try {
        await this.db.transaction(async () => {
          for (const decision of await this.db.all<Row>(
            "SELECT decision_id FROM decisions WHERE run_id = $1 AND execution_status = 'AWAITING_APPROVAL'", runId,
          )) {
            await this.db.run(
              "UPDATE decisions SET execution_status='EXPIRED', outcome_type=NULL, failure_code='APPROVAL_TIMEOUT' WHERE decision_id=$1",
              String(decision.decision_id),
            );
            await this.db.run(
              "UPDATE execution_attempts SET execution_status='EXPIRED', failure_code='APPROVAL_TIMEOUT', updated_at=$1 WHERE decision_id=$2 AND execution_status='AWAITING_APPROVAL'",
              now(), String(decision.decision_id),
            );
          }
          await this.refreshRunStatus(runId);
          await this.appendEvent(runId, null, correlationId, "run_completed", { run_status: "EXPIRED" });
        });
        logger.warn("stale_approvals_expired", { userId, correlationId }, { runId });
      } catch (error) {
        logger.error("stale_approval_expiry_failed", { userId, correlationId }, error);
      }
    }
  }

  async createApprovalSession(userId: string, decisionId: string, idempotencyKey: string): Promise<ApprovalSession> {
    const cached = await this.idempotencyResponse<ApprovalSession>(userId, `approval:${decisionId}`, idempotencyKey);
    if (cached) return cached;
    const decision = await this.requireDecision(decisionId, userId);
    if (decision.execution_status !== "AWAITING_APPROVAL") throw new HttpError(422, "Decision is not awaiting approval", "INVALID_EXECUTION_STATE");
    const activeAttempt = await this.db.get<Row>(
      "SELECT execution_attempt_id FROM execution_attempts WHERE decision_id = $1 AND execution_status IN ('AWAITING_APPROVAL','AUTHORIZED','EXECUTING','RECONCILING','UNKNOWN')",
      decisionId,
    );
    if (activeAttempt) {
      throw new HttpError(409, "An execution attempt is already active", "ACTIVE_ATTEMPT_EXISTS");
    }
    const attemptId = id("attempt");
    const provisionalExpiry = new Date(Date.now() + 5 * 60_000).toISOString();
    try {
      await this.db.transaction(async () => {
        await this.db.run(
          "INSERT INTO execution_attempts VALUES ($1, $2, $3, $4, 'AWAITING_APPROVAL', $5, NULL, NULL, $6, $7)",
          attemptId,
          decisionId,
          this.provider.name,
          attemptId,
          provisionalExpiry,
          now(),
          now(),
        );
      });
    } catch (error) {
      if (String(error).includes("unique constraint")) throw new HttpError(409, "An execution attempt is already active", "ACTIVE_ATTEMPT_EXISTS");
      throw error;
    }
    try {
      const session = await this.provider.createApproval(decision, attemptId);
      const pravaSessionId = session.payload?.provider_session_id ?? attemptId;
      await this.db.transaction(async () => {
        await this.db.run("UPDATE execution_attempts SET provider_idempotency_key=$1, approval_expires_at=$2, updated_at=$3 WHERE execution_attempt_id=$4", pravaSessionId, session.expires_at, now(), attemptId);
        await this.appendEvent(decision.run_id, decisionId, id("corr"), "approval_required", { execution_attempt_id: attemptId, provider_session_id: pravaSessionId, mode: session.mode, expires_at: session.expires_at });
        await this.storeIdempotency(userId, `approval:${decisionId}`, idempotencyKey, session);
      });
      return session;
    } catch (error) {
      await this.markReconciling(decision, attemptId, "APPROVAL_SESSION_RESULT_UNCERTAIN");
      throw error;
    }
  }

  async executeAttempt(userId: string, decisionId: string, attemptId: string, idempotencyKey: string): Promise<RunRecord> {
    const cached = await this.idempotencyResponse<RunRecord>(userId, `attempt:${attemptId}`, idempotencyKey);
    if (cached) return cached;
    const decision = await this.requireDecision(decisionId, userId);
    const attempt = await this.db.get<Row>("SELECT * FROM execution_attempts WHERE execution_attempt_id = $1 AND decision_id = $2", attemptId, decisionId);
    if (!attempt) throw new HttpError(404, "Execution attempt was not found", "ATTEMPT_NOT_FOUND");
    if (decision.execution_status !== "AWAITING_APPROVAL" || String(attempt.execution_status) !== "AWAITING_APPROVAL") {
      throw new HttpError(422, "Execution attempt is not awaiting approval", "INVALID_EXECUTION_STATE");
    }

    logger.info("attempt_executing", { userId }, { decisionId, attemptId, action: decision.action, merchant: decision.merchant_name });
    if (new Date(String(attempt.approval_expires_at)).getTime() <= Date.now()) {
      await this.db.transaction(async () => {
        await this.db.run("UPDATE execution_attempts SET execution_status='EXPIRED', failure_code='APPROVAL_EXPIRED', updated_at=$1 WHERE execution_attempt_id=$2", now(), attemptId);
        await this.transitionDecisionInTransaction(decision, "EXPIRED", null, "APPROVAL_EXPIRED");
        await this.refreshRunStatus(decision.run_id);
      });
      throw new HttpError(422, "Approval session expired", "APPROVAL_EXPIRED");
    }
    await this.assertDependencySatisfied(decisionId);
    const subs = await this.subscriptions(userId);
    const subscription = subs.find((item) => item.id === decision.subscription_id);
    if (!subscription) throw new HttpError(404, "Subscription was not found", "SUBSCRIPTION_NOT_FOUND");

    await this.db.transaction(async () => {
      await this.transitionDecisionInTransaction(decision, "AUTHORIZED", null, null);
      const authorized = { ...decision, execution_status: "AUTHORIZED" as const };
      await this.transitionDecisionInTransaction(authorized, "EXECUTING", null, null);
      await this.db.run("UPDATE execution_attempts SET execution_status='EXECUTING', updated_at=$1 WHERE execution_attempt_id=$2", now(), attemptId);
    });

    const current = await this.requireDecision(decisionId, userId);
    let result: ProviderExecutionResult;
    try {
      result = await this.provider.execute(current, subscription, attemptId, String(attempt.provider_idempotency_key));
    } catch (error) {
      await this.markReconciling(current, attemptId, "PROVIDER_RESULT_UNCERTAIN");
      throw error;
    }
    try {
      await this.db.transaction(async () => {
        for (const evidence of result.evidence) await this.insertEvidence(evidence);
        if (result.terminalStatus === "RECONCILING") {
          await this.db.run(
            "UPDATE execution_attempts SET execution_status='RECONCILING', failure_code=$1, reconciliation_deadline_at=$2, updated_at=$3 WHERE execution_attempt_id=$4",
            "PROVIDER_REFERENCE_CAPTURED",
            new Date(Date.now() + 5 * 60_000).toISOString(),
            now(),
            attemptId,
          );
          await this.appendEvent(current.run_id, current.decision_id, id("corr"), "execution_state_changed", { from: current.execution_status, to: "RECONCILING", outcome_type: null, failure_code: "PROVIDER_REFERENCE_CAPTURED" });
        } else {
          const outcome = result.terminalStatus === "COMPLETED" ? "transaction_completed" : "action_avoided";
          const recurringSavings = result.terminalStatus === "AVOIDED"
            ? (result.evidence.some((item) => item.recurrence_stopped) ? subscription.current_monthly_cost_minor : 0)
            : current.recurring_monthly_savings_minor;
          const oneTimeAvoided = result.terminalStatus === "AVOIDED" && recurringSavings === 0 ? subscription.current_monthly_cost_minor : 0;
          const executing = { ...current, execution_status: "EXECUTING" as const };
          await this.transitionDecisionInTransaction(executing, result.terminalStatus, outcome, null, recurringSavings, oneTimeAvoided);
          await this.db.run("UPDATE execution_attempts SET execution_status=$1, updated_at=$2 WHERE execution_attempt_id=$3", result.terminalStatus, now(), attemptId);
          await this.applySubscriptionEffect(current, subscription, recurringSavings, userId, result.terminalStatus);
        }
        await this.refreshRunStatus(current.run_id);
        const response = await this.requireRun(current.run_id, userId);
        await this.storeIdempotency(userId, `attempt:${attemptId}`, idempotencyKey, response);
      });
      return this.requireRun(decision.run_id, userId);
    } catch (error) {
      await this.markReconciling(current, attemptId, "LOCAL_COMMIT_AFTER_PROVIDER_RESULT");
      throw error;
    }
  }

  async declineApproval(userId: string, decisionId: string, idempotencyKey: string): Promise<RunRecord> {
    const cached = await this.idempotencyResponse<RunRecord>(userId, `decline:${decisionId}`, idempotencyKey);
    if (cached) return cached;
    const decision = await this.requireDecision(decisionId, userId);
    if (decision.execution_status !== "AWAITING_APPROVAL") throw new HttpError(422, "Decision is not awaiting approval", "INVALID_EXECUTION_STATE");
    await this.db.transaction(async () => {
      await this.db.run("UPDATE execution_attempts SET execution_status='APPROVAL_DECLINED', failure_code='USER_DECLINED', updated_at=$1 WHERE decision_id=$2 AND execution_status='AWAITING_APPROVAL'", now(), decisionId);
      await this.transitionDecisionInTransaction(decision, "APPROVAL_DECLINED", null, "USER_DECLINED");
      await this.refreshRunStatus(decision.run_id);
    });
    const response = await this.requireRun(decision.run_id, userId);
    await this.db.transaction(async () => this.storeIdempotency(userId, `decline:${decisionId}`, idempotencyKey, response));
    return response;
  }

  async savings(userId: string): Promise<SavingsSummary> {
    const row = await this.db.get<Row>(
      `SELECT COALESCE(SUM(d.recurring_monthly_savings_minor),0) AS recurring, COALESCE(SUM(d.one_time_avoided_minor),0) AS avoided FROM decisions d JOIN runs r ON r.run_id=d.run_id WHERE r.user_id=$1 AND d.outcome_type IN ('transaction_completed','action_avoided')`,
      userId,
    );
    return { currency: "USD", recurring_monthly_saved_minor: Number(row?.recurring ?? 0), one_time_avoided_minor: Number(row?.avoided ?? 0) };
  }

  async evidence(userId: string, evidenceId: string): Promise<EvidenceRecord> {
    const ev = await this.db.evidence(evidenceId, userId);
    if (!ev) throw new HttpError(404, "Evidence was not found", "EVIDENCE_NOT_FOUND");
    return ev;
  }

  async pravaPaymentResult(userId: string, sessionId: string) {
    if (!(this.provider instanceof PravaExecutionProvider)) {
      throw new HttpError(409, "Prava integration is not active in this environment", "PRAVA_NOT_ACTIVE");
    }
    return this.provider.pollPaymentResult(sessionId);
  }

  async finalizePravaSession(userId: string, providerSessionId: string) {
    if (!(this.provider instanceof PravaExecutionProvider)) {
      throw new HttpError(409, "Prava integration is not active in this environment", "PRAVA_NOT_ACTIVE");
    }
    const row = await this.db.get<Row>(
      "SELECT a.execution_attempt_id, d.decision_id, d.run_id, d.execution_status FROM execution_attempts a JOIN decisions d ON d.decision_id = a.decision_id JOIN runs r ON r.run_id = d.run_id WHERE r.user_id = $1 AND a.provider_idempotency_key = $2",
      userId,
      providerSessionId,
    );
    if (!row) throw new HttpError(404, "No execution attempt is linked to the provided Prava session", "PRAVA_EXECUTION_NOT_FOUND");
    if (String(row.execution_status) === "COMPLETED" || String(row.execution_status) === "AVOIDED" || String(row.execution_status) === "RECONCILING") {
      logger.info("prava_session_already_terminal", { userId }, { providerSessionId, status: row.execution_status });
      return this.requireRun(String(row.run_id), userId);
    }
    if (String(row.execution_status) !== "AWAITING_APPROVAL" && String(row.execution_status) !== "EXECUTING") {
      throw new HttpError(422, "Execution attempt is not in a finalizable state", "INVALID_EXECUTION_STATE");
    }

    logger.info("prava_session_finalizing", { userId }, { providerSessionId, decisionId: row.decision_id, attemptId: row.execution_attempt_id });
    return this.executeAttempt(userId, String(row.decision_id), String(row.execution_attempt_id), `reconcile-${providerSessionId}`);
  }

  private plan(candidates: CandidateDecision[], subscriptions: Subscription[], policy: CompiledPolicy): PlannedDecision[] {
    const ruleIds = new Set(policy.rules.map((rule) => rule.rule_id));
    let firstEffectDecision: string | null = null;
    const planned = candidates.map((candidate): PlannedDecision => {
      const subscription = subscriptions.find((item) => item.id === candidate.subscription_id);
      if (!subscription) throw new HttpError(422, "Candidate references an unknown subscription", "INVALID_CANDIDATE");
      if (!ruleIds.has(candidate.policy_rule_reference) && candidate.policy_rule_reference !== "policy_default") {
        throw new HttpError(422, "Candidate references an unknown policy rule", "INVALID_POLICY_RULE_REFERENCE");
      }
      const decisionId = id("decision");
      let status: ExecutionStatus = "NO_ACTION_REQUIRED";
      let outcome: Decision["outcome_type"] = "decision_only";
      let authorizedAmount = 0;
      let effectiveCost = subscription.current_monthly_cost_minor;
      let recurringSavings = 0;
      let oneTimeAvoided = 0;

      if (candidate.action === "SWITCH") {
        const target = subscription.alt_plans.find((plan) => plan.plan_id === candidate.target_plan);
        if (!target) {
          const cheapest = [...subscription.alt_plans].sort((a, b) => a.effective_monthly_cost_minor - b.effective_monthly_cost_minor)[0];
          if (cheapest) {
            candidate = { ...candidate, action: "SWITCH", target_plan: cheapest.plan_id, reasoning: `${subscription.merchant_name} is unused ${subscription.last_used_days_ago}+ days. Switching to cheapest available plan: ${cheapest.plan_id}.` };
          } else {
            candidate = { ...candidate, action: "DECLINE", target_plan: null, reasoning: `${subscription.merchant_name} is unused ${subscription.last_used_days_ago}+ days with no alternative plans. Recommending cancellation.` };
          }
        }
        const validTarget = subscription.alt_plans.find((plan) => plan.plan_id === candidate.target_plan);
        authorizedAmount = validTarget?.authorized_amount_minor ?? 0;
        effectiveCost = validTarget?.effective_monthly_cost_minor ?? subscription.current_monthly_cost_minor;
        recurringSavings = Math.max(0, subscription.current_monthly_cost_minor - effectiveCost);
        status = subscription.capability === "unverified" ? "RECOMMENDED" : "AWAITING_APPROVAL";
        outcome = status === "RECOMMENDED" ? "decision_only" : null;
      } else if (candidate.action === "DECLINE") {
        authorizedAmount = 0;
        effectiveCost = 0;
        // DECLINE is always automatic — the AI agent prevents the charge without user approval
        status = "RECOMMENDED";
        outcome = "decision_only";
      }

      const dependsOn = candidate.action === "SWITCH" && firstEffectDecision ? firstEffectDecision : null;
      if (status === "AWAITING_APPROVAL" && !firstEffectDecision) firstEffectDecision = decisionId;
      return {
        candidate,
        subscription,
        decisionId,
        status,
        outcome,
        authorizedAmountMinor: authorizedAmount,
        effectiveMonthlyCostMinor: effectiveCost,
        recurringMonthlySavingsMinor: recurringSavings,
        oneTimeAvoidedMinor: oneTimeAvoided,
        dependsOnDecisionId: dependsOn,
      };
    });
    const projectedMonthly = planned.reduce((sum, decision) => sum + decision.effectiveMonthlyCostMinor, 0);
    const cap = getRule(policy, "MONTHLY_CAP");
    if (cap && projectedMonthly > cap.amount_minor) {
      throw new HttpError(422, `No candidate action plan satisfies the monthly cap (${projectedMonthly} > ${cap.amount_minor})`, "POLICY_PLAN_UNSATISFIABLE");
    }
    return planned;
  }

  private sanitizeReasoning(value: string): string {
    return value.replace(/[<>\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1_000);
  }

  private async requireRun(runId: string, userId: string): Promise<RunRecord> {
    const run = await this.db.runRecord(runId, userId);
    if (!run) throw new HttpError(404, "Run was not found", "RUN_NOT_FOUND");
    return run;
  }

  private async requireDecision(decisionId: string, userId: string): Promise<Decision> {
    const row = await this.db.get<Row>(
      `SELECT d.*, s.merchant_name FROM decisions d JOIN runs r ON r.run_id=d.run_id JOIN subscriptions s ON s.subscription_id=d.subscription_id WHERE d.decision_id=$1 AND r.user_id=$2`,
      decisionId,
      userId,
    );
    if (!row) throw new HttpError(404, "Decision was not found", "DECISION_NOT_FOUND");
    return {
      decision_id: String(row.decision_id), run_id: String(row.run_id), subscription_id: String(row.subscription_id), merchant_name: String(row.merchant_name),
      action: String(row.action) as Decision["action"], target_plan_id: row.target_plan_id === null ? null : String(row.target_plan_id),
      policy_rule_reference: String(row.policy_rule_reference), reasoning: String(row.reasoning),
      confidence: row.confidence === null ? null : Number(row.confidence),
      execution_status: String(row.execution_status) as Decision["execution_status"], outcome_type: row.outcome_type === null ? null : String(row.outcome_type) as Decision["outcome_type"],
      authorized_amount_minor: Number(row.authorized_amount_minor), effective_monthly_cost_minor: Number(row.effective_monthly_cost_minor),
      recurring_monthly_savings_minor: Number(row.recurring_monthly_savings_minor), one_time_avoided_minor: Number(row.one_time_avoided_minor),
      currency: String(row.currency), failure_code: row.failure_code === null ? null : String(row.failure_code), evidence_ids: [],
    };
  }

  private async transitionDecisionInTransaction(
    decision: Decision,
    next: ExecutionStatus,
    outcome: Decision["outcome_type"],
    failureCode: string | null,
    recurringSavings = decision.recurring_monthly_savings_minor,
    oneTimeAvoided = decision.one_time_avoided_minor,
  ) {
    assertTransition(decision.execution_status, next);
    await this.db.run(
      "UPDATE decisions SET execution_status=$1, outcome_type=$2, failure_code=$3, recurring_monthly_savings_minor=$4, one_time_avoided_minor=$5 WHERE decision_id=$6",
      next,
      outcome,
      failureCode,
      recurringSavings,
      oneTimeAvoided,
      decision.decision_id,
    );
    await this.appendEvent(decision.run_id, decision.decision_id, id("corr"), "execution_state_changed", {
      from: decision.execution_status,
      to: next,
      outcome_type: outcome,
      failure_code: failureCode,
    });
    if (outcome) await this.appendEvent(decision.run_id, decision.decision_id, id("corr"), "outcome_recorded", { outcome_type: outcome });
    if (["VALIDATION_FAILED", "STALE", "APPROVAL_DECLINED", "EXPIRED", "FAILED", "UNKNOWN"].includes(next)) {
      await this.appendEvent(decision.run_id, decision.decision_id, id("corr"), "execution_failed", { execution_status: next, failure_code: failureCode });
      await this.staleDependentsInTransaction(decision.decision_id, decision.run_id);
    }
  }

  private async markReconciling(decision: Decision, attemptId: string, failureCode: string) {
    await this.db.transaction(async () => {
      const row = await this.db.get<Row>("SELECT execution_status FROM decisions WHERE decision_id=$1", decision.decision_id);
      const status = String(row?.execution_status ?? decision.execution_status) as ExecutionStatus;
      if (!["AWAITING_APPROVAL", "EXECUTING"].includes(status)) return;
      const current = { ...decision, execution_status: status };
      await this.transitionDecisionInTransaction(current, "RECONCILING", null, failureCode);
      await this.db.run(
        "UPDATE execution_attempts SET execution_status='RECONCILING', failure_code=$1, reconciliation_deadline_at=$2, updated_at=$3 WHERE execution_attempt_id=$4",
        failureCode,
        new Date(Date.now() + 5 * 60_000).toISOString(),
        now(),
        attemptId,
      );
      await this.refreshRunStatus(decision.run_id);
    });
  }

  private async staleDependentsInTransaction(failedDecisionId: string, runId: string) {
    const queue = [failedDecisionId];
    while (queue.length > 0) {
      const dependencyId = queue.shift()!;
      const dependents = await this.db.all<Row>(
        "SELECT decision_id, execution_status FROM decisions WHERE depends_on_decision_id=$1 AND execution_status='AWAITING_APPROVAL'",
        dependencyId,
      );
      for (const dependent of dependents) {
        const dependentId = String(dependent.decision_id);
        assertTransition(String(dependent.execution_status) as ExecutionStatus, "STALE");
        await this.db.run("UPDATE decisions SET execution_status='STALE', outcome_type=NULL, failure_code='DEPENDENCY_NOT_SATISFIED' WHERE decision_id=$1", dependentId);
        await this.db.run("UPDATE execution_attempts SET execution_status='STALE', failure_code='DEPENDENCY_NOT_SATISFIED', updated_at=$1 WHERE decision_id=$2 AND execution_status='AWAITING_APPROVAL'", now(), dependentId);
        await this.appendEvent(runId, dependentId, id("corr"), "execution_state_changed", { from: dependent.execution_status, to: "STALE", outcome_type: null, failure_code: "DEPENDENCY_NOT_SATISFIED" });
        queue.push(dependentId);
      }
    }
  }

  private async applySubscriptionEffect(decision: Decision, subscription: Subscription, recurringSavings: number, userId: string, terminalStatus: "COMPLETED" | "AVOIDED") {
    if (terminalStatus === "COMPLETED" && decision.action === "SWITCH" && decision.target_plan_id) {
      await this.db.run(
        "UPDATE subscriptions SET plan_id=$1, current_monthly_cost_minor=$2, version=version+1 WHERE subscription_id=$3",
        decision.target_plan_id,
        decision.effective_monthly_cost_minor,
        subscription.id,
      );
    } else if (terminalStatus === "AVOIDED" && decision.action === "DECLINE") {
      await this.db.run("UPDATE subscriptions SET plan_id='cancelled', current_monthly_cost_minor=0, version=version+1 WHERE subscription_id=$1", subscription.id);
    }
    if (decision.action !== "RENEW" || recurringSavings > 0) {
      await this.db.run("UPDATE portfolio_meta SET version=version+1 WHERE user_id=$1", userId);
    }
  }

  private async insertEvidence(evidence: EvidenceRecord) {
    await this.db.run(
      "INSERT INTO execution_evidence VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
      evidence.evidence_id,
      evidence.execution_attempt_id,
      evidence.evidence_type,
      evidence.provider,
      evidence.provider_reference,
      evidence.merchant_id,
      evidence.authorized_amount_minor,
      evidence.currency,
      evidence.provider_status,
      evidence.recurrence_stopped ? 1 : 0,
      evidence.occurred_at,
      evidence.verified_at,
      evidence.payload_hash,
    );
  }

  private async assertDependencySatisfied(decisionId: string) {
    const row = await this.db.get<Row>("SELECT depends_on_decision_id FROM decisions WHERE decision_id=$1", decisionId);
    if (!row?.depends_on_decision_id) return;
    const dependency = await this.db.get<Row>("SELECT execution_status FROM decisions WHERE decision_id=$1", String(row.depends_on_decision_id));
    if (!dependency || !["COMPLETED", "AVOIDED", "NO_ACTION_REQUIRED"].includes(String(dependency.execution_status))) {
      throw new HttpError(409, "A prerequisite decision is not complete", "DEPENDENCY_NOT_SATISFIED");
    }
  }

  private async refreshRunStatus(runId: string) {
    const statuses = (await this.db.all<Row>("SELECT execution_status FROM decisions WHERE run_id=$1", runId)).map((row) => String(row.execution_status));
    const pending = statuses.some((status) => ["AWAITING_APPROVAL", "AUTHORIZED", "EXECUTING", "RECONCILING", "UNKNOWN"].includes(status));
    const succeeded = statuses.some((status) => ["COMPLETED", "AVOIDED"].includes(status));
    const failed = statuses.some((status) => ["VALIDATION_FAILED", "STALE", "APPROVAL_DECLINED", "EXPIRED", "FAILED"].includes(status));
    const runStatus = pending ? "EXECUTING" : succeeded && failed ? "PARTIALLY_COMPLETED" : failed ? "FAILED" : "COMPLETED";
    await this.db.run("UPDATE runs SET run_status=$1, updated_at=$2 WHERE run_id=$3", runStatus, now(), runId);
    if (!pending) await this.appendEvent(runId, null, id("corr"), "run_completed", { run_status: runStatus });
  }

  private async appendEvent(runId: string, decisionId: string | null, correlationId: string, eventType: string, payload: unknown) {
    const last = await this.db.get<Row>("SELECT sequence, payload_hash FROM ledger_events WHERE run_id=$1 ORDER BY sequence DESC LIMIT 1", runId);
    const sequence = Number(last?.sequence ?? 0) + 1;
    const previousHash = last ? String(last.payload_hash) : null;
    const eventId = id("evt");
    const occurredAt = now();
    const payloadHash = sha256({ event_id: eventId, run_id: runId, sequence, event_type: eventType, occurred_at: occurredAt, payload, previous_event_hash: previousHash });
    await this.db.run(
      "INSERT INTO ledger_events VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      eventId,
      correlationId,
      runId,
      decisionId,
      sequence,
      eventType,
      occurredAt,
      stableJson(payload),
      previousHash,
      payloadHash,
    );
  }

  private async idempotencyResponse<T>(userId: string, scope: string, key: string): Promise<T | null> {
    const row = await this.db.get<Row>("SELECT response_json FROM idempotency_keys WHERE user_id=$1 AND scope=$2 AND key=$3", userId, scope, key);
    return row ? JSON.parse(String(row.response_json)) as T : null;
  }

  private async storeIdempotency(userId: string, scope: string, key: string, response: unknown) {
    await this.db.run(
      "INSERT INTO idempotency_keys (user_id, scope, key, response_json, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, scope, key) DO UPDATE SET response_json=EXCLUDED.response_json, created_at=EXCLUDED.created_at",
      userId, scope, key, JSON.stringify(response), now(),
    );
  }
}
