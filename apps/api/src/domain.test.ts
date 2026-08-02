import assert from "node:assert/strict";
import test from "node:test";
import { annualSavingsBps, assertTransition, compilePolicyDeterministically, conservativeMonthlyCost, healthScore } from "./domain.js";

test("canonical annual-plan arithmetic stays exact", () => {
  assert.equal(conservativeMonthlyCost(16_500, 12), 1_375);
  assert.equal(annualSavingsBps(2_000, 16_500), 3_125);
});

test("normalization uses conservative ceiling division", () => {
  assert.equal(conservativeMonthlyCost(10_001, 12), 834);
});

test("execution transitions reject skips", () => {
  assert.doesNotThrow(() => assertTransition("AWAITING_APPROVAL", "AUTHORIZED"));
  assert.throws(() => assertTransition("AWAITING_APPROVAL", "COMPLETED"), /Invalid execution transition/);
  assert.doesNotThrow(() => assertTransition("UNKNOWN", "COMPLETED"));
});

test("policy prose compiles into supported deterministic rules", () => {
  const policy = compilePolicyDeterministically("Never exceed $60/month. Cancel anything unused 30+ days. Take annual billing if it saves more than 15%.");
  assert.deepEqual(policy.rules.map((rule) => rule.type), ["MONTHLY_CAP", "MAX_INACTIVE_DAYS", "MIN_ANNUAL_SAVINGS_BPS"]);
  assert.equal(policy.unsupported_clauses.length, 0);
});

test("missing health inputs are explicitly conservative", () => {
  const result = healthScore({ last_used_days_ago: null, usage_frequency_score: null, explicit_priority_score: 20, current_monthly_cost_minor: 1_200 });
  assert.equal(result.dataStatus, "insufficient_data");
  assert.ok(result.score < 60);
});
