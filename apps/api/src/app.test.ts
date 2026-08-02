import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { WardenDb } from "./db.js";
import { LocalExecutionProvider } from "./provider.js";
import { WardenService } from "./service.js";
import type { CandidateDecision, CompiledPolicy, Reasoner, Subscription } from "./reasoner.js";

class DeterministicReasoner implements Reasoner {
  async compilePolicy(text: string): Promise<CompiledPolicy> {
    const normalized = text.toLowerCase();
    const cap = normalized.match(/(?:exceed|over|under|cap(?:ped)? at)\s*\$?(\d+(?:\.\d{1,2})?)/);
    const inactive = normalized.match(/unused\s+(\d+)\+?\s*days|inactive\s+(?:for\s+)?(\d+)\+?\s*days/);
    const annual = normalized.match(/(?:saves?|saving)\s+(?:more than|over|at least)\s*(\d+(?:\.\d+)?)%/);
    const rules = [];
    const supportedClauses: string[] = [];

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

    const unsupported: string[] = [];
    if (rules.length === 0) unsupported.push(text);
    if (!supportedClauses.includes("cap")) unsupported.push("No supported monthly spending cap was found.");

    return { currency: "USD", rules: rules as any, unsupported_clauses: unsupported };
  }

  async decide(subscription: Subscription, policy: CompiledPolicy, portfolioMonthlyMinor: number): Promise<CandidateDecision> {
    const annualRule = policy.rules.find((rule) => rule.type === "MIN_ANNUAL_SAVINGS_BPS");
    const unusedRule = policy.rules.find((rule) => rule.type === "MAX_INACTIVE_DAYS");
    const annual = subscription.alt_plans.find((plan) => plan.plan_id === "annual");

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

test("API requires a signed session and CSRF token", async () => {
  const service = new WardenService(new WardenDb(":memory:"), new DeterministicReasoner(), new LocalExecutionProvider());
  const { app } = createApp(service);
  await request(app).get("/api/v1/subscriptions").expect(401);

  const agent = request.agent(app);
  const session = await agent.get("/api/v1/session").expect(200);
  assert.equal(session.body.environment, config.environment);
  assert.equal(session.body.prava_environment, config.paymentProviderMode === "prava" ? "sandbox" : "demo");
  assert.equal(session.body.prava_publishable_key ?? null, config.pravaPublishableKey ?? null);
  const run = await agent
    .post("/api/v1/runs")
    .set("Idempotency-Key", "api-run-key")
    .set("X-CSRF-Token", session.body.csrf_token)
    .send({ policy_version: 1, expected_portfolio_version: 1 })
    .expect(202);
  assert.match(run.body.run_id, /^run_/);
  service.db.close();
});
