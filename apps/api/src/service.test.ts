import assert from "node:assert/strict";
import test from "node:test";
import { WardenDb } from "./db.js";
import { LocalExecutionProvider, type ProviderExecutionResult } from "./provider.js";
import { WardenService } from "./service.js";

class DeterministicReasoner {
  async compilePolicy(text: string): Promise<any> {
    const normalized = text.toLowerCase();
    const cap = normalized.match(/(?:exceed|over|under|cap(?:ped)? at)\s*\$?(\d+(?:\.\d{1,2})?)/);
    const inactive = normalized.match(/unused\s+(\d+)\+?\s*days|inactive\s+(?:for\s+)?(\d+)\+?\s*days/);
    const annual = normalized.match(/(?:saves?|saving)\s+(?:more than|over|at least)\s*(\d+(?:\.\d+)?)%/);
    const rules = [];
    const supportedClauses = [];
    if (cap) {
      rules.push({ rule_id: "monthly_cap", type: "MONTHLY_CAP", amount_minor: Math.round(Number(cap[1]) * 100) });
      supportedClauses.push("cap");
    }
    const inactiveDays = Number(inactive?.[1] ?? inactive?.[2]);
    if (Number.isFinite(inactiveDays)) {
      rules.push({ rule_id: "unused_threshold", type: "MAX_INACTIVE_DAYS", days: inactiveDays });
      supportedClauses.push("unused");
    }
    if (annual) {
      rules.push({ rule_id: "annual_threshold", type: "MIN_ANNUAL_SAVINGS_BPS", basis_points: Math.round(Number(annual[1]) * 100) });
      supportedClauses.push("annual");
    }
    const unsupported = [];
    if (rules.length === 0) unsupported.push(text);
    if (!supportedClauses.includes("cap")) unsupported.push("No supported monthly spending cap was found.");
    return { currency: "USD", rules, unsupported_clauses: unsupported };
  }

  async decide(subscription: any, policy: any, portfolioMonthlyMinor: number): Promise<any> {
    const annualRule = policy.rules.find((rule: any) => rule.type === "MIN_ANNUAL_SAVINGS_BPS");
    const unusedRule = policy.rules.find((rule: any) => rule.type === "MAX_INACTIVE_DAYS");
    const annual = subscription.alt_plans.find((plan: any) => plan.plan_id === "annual");

    if (subscription.plan_id === "cancelled" || subscription.current_monthly_cost_minor === 0) {
      return {
        subscription_id: subscription.id,
        action: "RENEW",
        target_plan: null,
        policy_rule_reference: policy.rules[0]?.rule_id ?? "policy_default",
        reasoning: `${subscription.merchant_name} has no active recurring charge, so no external action is required.`,
      };
    }

    if (annual && annual.plan_id !== subscription.plan_id && annualRule && annualSavingsBps(subscription.current_monthly_cost_minor, annual.authorized_amount_minor) >= annualRule.basis_points) {
      return {
        subscription_id: subscription.id,
        action: "SWITCH",
        target_plan: annual.plan_id,
        policy_rule_reference: annualRule.rule_id,
        reasoning: `The annual plan reduces effective monthly cost from ${subscription.current_monthly_cost_minor} to ${annual.effective_monthly_cost_minor} minor units and exceeds the active annual-savings threshold.`,
      };
    }

    if (unusedRule && subscription.last_used_days_ago !== null && subscription.last_used_days_ago >= unusedRule.days) {
      const cheaper = [...subscription.alt_plans].sort((a, b) => a.effective_monthly_cost_minor - b.effective_monthly_cost_minor)[0];
      return {
        subscription_id: subscription.id,
        action: cheaper ? "SWITCH" : "DECLINE",
        target_plan: cheaper?.plan_id ?? null,
        policy_rule_reference: unusedRule.rule_id,
        reasoning: `${subscription.merchant_name} has been unused for ${subscription.last_used_days_ago} days, meeting the active ${unusedRule.days}-day inactivity rule.`,
      };
    }

    if (subscription.billing_cycle === "trial" && unusedRule && subscription.last_used_days_ago === null) {
      return {
        subscription_id: subscription.id,
        action: "DECLINE",
        target_plan: null,
        policy_rule_reference: unusedRule.rule_id,
        reasoning: `${subscription.merchant_name} has no recorded use and is approaching a paid conversion, so prevention is proposed under the inactivity policy.`,
      };
    }

    return {
      subscription_id: subscription.id,
      action: "RENEW",
      target_plan: null,
      policy_rule_reference: unusedRule?.rule_id ?? policy.rules[0]?.rule_id ?? "policy_default",
      reasoning: `${subscription.merchant_name} remains within the projected portfolio policy and has no validated lower-cost action. Current portfolio cost is ${portfolioMonthlyMinor} minor units.`,
    };
  }
}

function annualSavingsBps(currentMonthlyMinor: number, annualMinor: number): number {
  const annualized = currentMonthlyMinor * 12;
  if (annualized <= 0) return 0;
  return Math.floor(((annualized - annualMinor) * 10_000) / annualized);
}

function serviceFixture() {
  return new WardenService(new WardenDb(":memory:"), new DeterministicReasoner(), new LocalExecutionProvider());
}

test("run creation is idempotent and produces honest initial states", async () => {
  const service = serviceFixture();
  const first = await service.createRun("user_demo", "run-key-0001", 1, 1);
  const replay = await service.createRun("user_demo", "run-key-0001", 1, 1);
  assert.equal(replay.run_id, first.run_id);
  assert.equal(first.decisions.find((item) => item.subscription_id === "sub_adobe")?.execution_status, "RECOMMENDED");
  assert.equal(first.decisions.find((item) => item.subscription_id === "sub_gym")?.execution_status, "RECOMMENDED");
  assert.equal(first.decisions.find((item) => item.subscription_id === "sub_spotify")?.execution_status, "NO_ACTION_REQUIRED");
  assert.equal(first.decisions.find((item) => item.subscription_id === "sub_figma")?.execution_status, "AWAITING_APPROVAL");
  assert.equal(first.decisions.find((item) => item.subscription_id === "sub_notion")?.execution_status, "NO_ACTION_REQUIRED");
  assert.equal(first.decisions.find((item) => item.subscription_id === "sub_coursera")?.execution_status, "AWAITING_APPROVAL");
  service.db.close();
});

test("simulated annual switch stores entitlement evidence and suppresses duplicate execution", async () => {
  const service = serviceFixture();
  const run = await service.createRun("user_demo", "run-key-0002", 1, 1);
  const decision = run.decisions.find((item) => item.subscription_id === "sub_figma")!;
  const approval = await service.createApprovalSession("user_demo", decision.decision_id, "approval-key-0002");
  const completed = await service.executeAttempt("user_demo", decision.decision_id, approval.execution_attempt_id, "attempt-key-0002");
  const completedDecision = completed.decisions.find((item) => item.decision_id === decision.decision_id)!;
  assert.equal(completedDecision.execution_status, "COMPLETED");
  assert.equal(completedDecision.outcome_type, "transaction_completed");
  assert.equal(completedDecision.evidence_ids.length, 2);
  assert.equal(service.savings("user_demo").recurring_monthly_saved_minor, 300);

  const replay = await service.executeAttempt("user_demo", decision.decision_id, approval.execution_attempt_id, "attempt-key-0002");
  assert.equal(replay.decisions.find((item) => item.decision_id === decision.decision_id)?.evidence_ids.length, 2);
  service.db.close();
});

test("ledger events remain ordered and hash chained", async () => {
  const service = serviceFixture();
  const run = await service.createRun("user_demo", "run-key-0003", 1, 1);
  const events = service.events(run.run_id, "user_demo");
  assert.ok(events.length >= 6);
  for (let index = 0; index < events.length; index += 1) {
    assert.equal(events[index]!.sequence, index + 1);
    if (index > 0) assert.equal(events[index]!.previous_event_hash, events[index - 1]!.payload_hash);
  }
  service.db.close();
});

test("full simulated run separates recurring savings from recommendation-only value", async () => {
  const service = serviceFixture();
  let run = await service.createRun("user_demo", "run-key-0004", 1, 1);
  for (const subscriptionId of ["sub_figma", "sub_coursera"]) {
    const decision = run.decisions.find((item) => item.subscription_id === subscriptionId)!;
    const approval = await service.createApprovalSession("user_demo", decision.decision_id, `approval-${subscriptionId}`);
    run = await service.executeAttempt("user_demo", decision.decision_id, approval.execution_attempt_id, `attempt-${subscriptionId}`);
  }
  assert.equal(run.run_status, "COMPLETED");
  assert.equal(run.decisions.find((item) => item.subscription_id === "sub_gym")?.outcome_type, "decision_only");
  assert.deepEqual(service.savings("user_demo"), {
    currency: "USD",
    recurring_monthly_saved_minor: 1100,
    one_time_avoided_minor: 0,
  });
  const secondRun = await service.createRun("user_demo", "run-key-0004-repeat", 1, 3);
  assert.equal(secondRun.decisions.find((item) => item.subscription_id === "sub_figma")?.execution_status, "NO_ACTION_REQUIRED");
  assert.equal(secondRun.decisions.find((item) => item.subscription_id === "sub_coursera")?.execution_status, "NO_ACTION_REQUIRED");
  assert.equal(service.savings("user_demo").recurring_monthly_saved_minor, 1100);
  service.db.close();
});

test("policy draft must compile cleanly before activation", async () => {
  const service = serviceFixture();
  const draft = await service.draftPolicy("user_demo", "Never exceed $50/month. Cancel anything unused 45 days. Take annual billing if it saves more than 20%.", 1);
  assert.equal(draft.status, "DRAFT");
  const active = service.activatePolicy("user_demo", draft.policy_id, draft.version);
  assert.equal(active.status, "ACTIVE");
  assert.equal(active.version, 2);
  service.db.close();
});

test("reasoner output cannot substitute or duplicate subscription identities", async () => {
  const base = new DeterministicReasoner();
  const malicious: any = {
    compilePolicy: (text: any) => base.compilePolicy(text),
    decide: async (subscription: any) => ({
      subscription_id: subscription.id,
      action: "RENEW",
      target_plan: null,
      policy_rule_reference: "monthly_cap",
      reasoning: "Always return the correct subscription id, but force renew.",
    }),
  };
  const service = new WardenService(new WardenDb(":memory:"), malicious, new LocalExecutionProvider());
  await assert.rejects(() => service.createRun("user_demo", "cap-key", 1, 1), /No candidate action plan satisfies/);
  service.db.close();
});

test("planner rejects candidate sets that cannot satisfy the monthly cap", async () => {
  const base = new DeterministicReasoner();
  const renewEverything: any = {
    compilePolicy: (text: any) => base.compilePolicy(text),
    decide: async (subscription: any) => ({
      subscription_id: subscription.id,
      action: "RENEW",
      target_plan: null,
      policy_rule_reference: "monthly_cap",
      reasoning: "Keep the current plan despite the portfolio cap.",
    }),
  };
  const service = new WardenService(new WardenDb(":memory:"), renewEverything, new LocalExecutionProvider());
  await assert.rejects(() => service.createRun("user_demo", "cap-key-0001", 1, 1), /No candidate action plan satisfies/);
  service.db.close();
});

test("concurrent approval requests reserve only one active attempt", async () => {
  const service = serviceFixture();
  const run = await service.createRun("user_demo", "concurrent-run", 1, 1);
  const decision = run.decisions.find((item) => item.subscription_id === "sub_figma")!;
  const results = await Promise.allSettled([
    service.createApprovalSession("user_demo", decision.decision_id, "concurrent-approval-a"),
    service.createApprovalSession("user_demo", decision.decision_id, "concurrent-approval-b"),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const count = service.db.get("SELECT COUNT(*) AS count FROM execution_attempts WHERE decision_id=?", decision.decision_id)?.count;
  assert.equal(count, 1);
  service.db.close();
});

test("failed prerequisites stale dependent decisions instead of leaving the run active", async () => {
  const service = serviceFixture();
  const run = await service.createRun("user_demo", "dependency-run", 1, 1);
  const prerequisite = run.decisions.find((item) => item.subscription_id === "sub_figma")!;
  const dependent = run.decisions.find((item) => item.subscription_id === "sub_coursera")!;
  service.db.run("UPDATE decisions SET depends_on_decision_id=? WHERE decision_id=?", prerequisite.decision_id, dependent.decision_id);
  const final = service.declineApproval("user_demo", prerequisite.decision_id, "decline-dependency");
  assert.equal(final.decisions.find((item) => item.decision_id === dependent.decision_id)?.execution_status, "STALE");
  assert.equal(final.run_status, "FAILED");
  service.db.close();
});

test("expired approvals terminalize both decision and attempt", async () => {
  const service = serviceFixture();
  const run = await service.createRun("user_demo", "expiry-run", 1, 1);
  const decision = run.decisions.find((item) => item.subscription_id === "sub_figma")!;
  const approval = await service.createApprovalSession("user_demo", decision.decision_id, "expiry-approval");
  service.db.run("UPDATE execution_attempts SET approval_expires_at='2000-01-01T00:00:00Z' WHERE execution_attempt_id=?", approval.execution_attempt_id);
  await assert.rejects(() => service.executeAttempt("user_demo", decision.decision_id, approval.execution_attempt_id, "expiry-attempt"), /expired/);
  assert.equal(service.run(run.run_id, "user_demo").decisions.find((item) => item.decision_id === decision.decision_id)?.execution_status, "EXPIRED");
  assert.equal(service.db.get("SELECT execution_status FROM execution_attempts WHERE execution_attempt_id=?", approval.execution_attempt_id)?.execution_status, "EXPIRED");
  service.db.close();
});

test("an avoided switch never mutates the local plan as if activation succeeded", async () => {
  class AvoidingProvider extends LocalExecutionProvider {
    async execute(decision: any, subscription: any, attemptId: any) {
      const result = await super.execute({ ...decision, action: "DECLINE" }, subscription, attemptId);
      return result;
    }
  }
  const service = new WardenService(new WardenDb(":memory:"), new DeterministicReasoner(), new AvoidingProvider());
  const run = await service.createRun("user_demo", "avoided-switch-run", 1, 1);
  const decision = run.decisions.find((item) => item.subscription_id === "sub_figma")!;
  const approval = await service.createApprovalSession("user_demo", decision.decision_id, "avoided-switch-approval");
  await service.executeAttempt("user_demo", decision.decision_id, approval.execution_attempt_id, "avoided-switch-attempt");
  const subscription = service.subscriptions("user_demo").find((item) => item.id === "sub_figma")!;
  assert.equal(subscription.plan_id, "professional");
  assert.equal(subscription.current_monthly_cost_minor, 1500);
  service.db.close();
});
