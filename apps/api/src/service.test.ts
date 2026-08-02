import assert from "node:assert/strict";
import test from "node:test";
import { WardenDb } from "./db.js";
import { FakeExecutionProvider, type ProviderExecutionResult } from "./provider.js";
import { FakeReasoner, type CandidateDecision, type Reasoner } from "./reasoner.js";
import { WardenService } from "./service.js";
import type { CompiledPolicy, Subscription } from "@warden/shared";

function serviceFixture() {
  return new WardenService(new WardenDb(":memory:"), new FakeReasoner(), new FakeExecutionProvider());
}

test("run creation is idempotent and produces honest initial states", async () => {
  const service = serviceFixture();
  const first = await service.createRun("user_demo", "run-key-0001", 1, 1);
  const replay = await service.createRun("user_demo", "run-key-0001", 1, 1);
  assert.equal(replay.run_id, first.run_id);
  assert.equal(first.decisions.find((item) => item.subscription_id === "sub_ai_service")?.execution_status, "AWAITING_APPROVAL");
  assert.equal(first.decisions.find((item) => item.subscription_id === "sub_gym")?.execution_status, "RECOMMENDED");
  assert.equal(first.decisions.find((item) => item.subscription_id === "sub_free_trial")?.execution_status, "AWAITING_APPROVAL");
  assert.equal(first.decisions.find((item) => item.subscription_id === "sub_notion")?.execution_status, "NO_ACTION_REQUIRED");
  service.db.close();
});

test("simulated annual switch stores entitlement evidence and suppresses duplicate execution", async () => {
  const service = serviceFixture();
  const run = await service.createRun("user_demo", "run-key-0002", 1, 1);
  const decision = run.decisions.find((item) => item.subscription_id === "sub_ai_service")!;
  const approval = await service.createApprovalSession("user_demo", decision.decision_id, "approval-key-0002");
  const completed = await service.executeAttempt("user_demo", decision.decision_id, approval.execution_attempt_id, "attempt-key-0002");
  const completedDecision = completed.decisions.find((item) => item.decision_id === decision.decision_id)!;
  assert.equal(completedDecision.execution_status, "COMPLETED");
  assert.equal(completedDecision.outcome_type, "transaction_completed");
  assert.equal(completedDecision.evidence_ids.length, 2);
  assert.equal(service.savings("user_demo").recurring_monthly_saved_minor, 625);

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
  for (const subscriptionId of ["sub_ai_service", "sub_free_trial"]) {
    const decision = run.decisions.find((item) => item.subscription_id === subscriptionId)!;
    const approval = await service.createApprovalSession("user_demo", decision.decision_id, `approval-${subscriptionId}`);
    run = await service.executeAttempt("user_demo", decision.decision_id, approval.execution_attempt_id, `attempt-${subscriptionId}`);
  }
  assert.equal(run.run_status, "COMPLETED");
  assert.equal(run.decisions.find((item) => item.subscription_id === "sub_gym")?.outcome_type, "decision_only");
  assert.deepEqual(service.savings("user_demo"), {
    currency: "USD",
    recurring_monthly_saved_minor: 1_825,
    one_time_avoided_minor: 0,
  });
  const secondRun = await service.createRun("user_demo", "run-key-0004-repeat", 1, 3);
  assert.equal(secondRun.decisions.find((item) => item.subscription_id === "sub_ai_service")?.execution_status, "NO_ACTION_REQUIRED");
  assert.equal(secondRun.decisions.find((item) => item.subscription_id === "sub_free_trial")?.execution_status, "NO_ACTION_REQUIRED");
  assert.equal(service.savings("user_demo").recurring_monthly_saved_minor, 1_825);
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
  const base = new FakeReasoner();
  const malicious: Reasoner = {
    compilePolicy: (text) => base.compilePolicy(text),
    decide: async () => ({ subscription_id: "sub_gym", action: "RENEW", target_plan: null, policy_rule_reference: "monthly_cap", reasoning: "Attempt to reuse one subscription for every decision." }),
  };
  const service = new WardenService(new WardenDb(":memory:"), malicious, new FakeExecutionProvider());
  await assert.rejects(() => service.createRun("user_demo", "identity-key", 1, 1), /mismatched|duplicate/);
  service.db.close();
});

test("planner rejects candidate sets that cannot satisfy the monthly cap", async () => {
  const base = new FakeReasoner();
  const renewEverything: Reasoner = {
    compilePolicy: (text) => base.compilePolicy(text),
    decide: async (subscription: Subscription): Promise<CandidateDecision> => ({
      subscription_id: subscription.id,
      action: "RENEW",
      target_plan: null,
      policy_rule_reference: "monthly_cap",
      reasoning: "Keep the current plan despite the portfolio cap.",
    }),
  };
  const service = new WardenService(new WardenDb(":memory:"), renewEverything, new FakeExecutionProvider());
  await assert.rejects(() => service.createRun("user_demo", "cap-key-0001", 1, 1), /No candidate action plan satisfies/);
  service.db.close();
});

test("concurrent approval requests reserve only one active attempt", async () => {
  const service = serviceFixture();
  const run = await service.createRun("user_demo", "concurrent-run", 1, 1);
  const decision = run.decisions.find((item) => item.subscription_id === "sub_ai_service")!;
  const results = await Promise.allSettled([
    service.createApprovalSession("user_demo", decision.decision_id, "concurrent-approval-a"),
    service.createApprovalSession("user_demo", decision.decision_id, "concurrent-approval-b"),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const count = service.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM execution_attempts WHERE decision_id=?", decision.decision_id)?.count;
  assert.equal(count, 1);
  service.db.close();
});

test("failed prerequisites stale dependent decisions instead of leaving the run active", async () => {
  const service = serviceFixture();
  const run = await service.createRun("user_demo", "dependency-run", 1, 1);
  const prerequisite = run.decisions.find((item) => item.subscription_id === "sub_ai_service")!;
  const dependent = run.decisions.find((item) => item.subscription_id === "sub_free_trial")!;
  service.db.run("UPDATE decisions SET depends_on_decision_id=? WHERE decision_id=?", prerequisite.decision_id, dependent.decision_id);
  const final = service.declineApproval("user_demo", prerequisite.decision_id, "decline-dependency");
  assert.equal(final.decisions.find((item) => item.decision_id === dependent.decision_id)?.execution_status, "STALE");
  assert.equal(final.run_status, "FAILED");
  service.db.close();
});

test("expired approvals terminalize both decision and attempt", async () => {
  const service = serviceFixture();
  const run = await service.createRun("user_demo", "expiry-run", 1, 1);
  const decision = run.decisions.find((item) => item.subscription_id === "sub_ai_service")!;
  const approval = await service.createApprovalSession("user_demo", decision.decision_id, "expiry-approval");
  service.db.run("UPDATE execution_attempts SET approval_expires_at='2000-01-01T00:00:00Z' WHERE execution_attempt_id=?", approval.execution_attempt_id);
  await assert.rejects(() => service.executeAttempt("user_demo", decision.decision_id, approval.execution_attempt_id, "expiry-attempt"), /expired/);
  assert.equal(service.run(run.run_id, "user_demo").decisions.find((item) => item.decision_id === decision.decision_id)?.execution_status, "EXPIRED");
  assert.equal(service.db.get<{ execution_status: string }>("SELECT execution_status FROM execution_attempts WHERE execution_attempt_id=?", approval.execution_attempt_id)?.execution_status, "EXPIRED");
  service.db.close();
});

test("an avoided switch never mutates the local plan as if activation succeeded", async () => {
  class AvoidingProvider extends FakeExecutionProvider {
    override async execute(decision: Parameters<FakeExecutionProvider["execute"]>[0], subscription: Subscription, attemptId: string): Promise<ProviderExecutionResult> {
      const result = await super.execute({ ...decision, action: "DECLINE" }, subscription, attemptId);
      return result;
    }
  }
  const service = new WardenService(new WardenDb(":memory:"), new FakeReasoner(), new AvoidingProvider());
  const run = await service.createRun("user_demo", "avoided-switch-run", 1, 1);
  const decision = run.decisions.find((item) => item.subscription_id === "sub_ai_service")!;
  const approval = await service.createApprovalSession("user_demo", decision.decision_id, "avoided-switch-approval");
  await service.executeAttempt("user_demo", decision.decision_id, approval.execution_attempt_id, "avoided-switch-attempt");
  const subscription = service.subscriptions("user_demo").find((item) => item.id === "sub_ai_service")!;
  assert.equal(subscription.plan_id, "monthly");
  assert.equal(subscription.current_monthly_cost_minor, 2_000);
  service.db.close();
});
