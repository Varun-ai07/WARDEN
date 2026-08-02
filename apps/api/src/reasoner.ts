import OpenAI from "openai";
import { actionSchema, compiledPolicySchema, type Action, type CompiledPolicy, type Subscription } from "@warden/shared";
import { z } from "zod";
import { config } from "./config.js";
import { annualSavingsBps, compilePolicyDeterministically, getRule } from "./domain.js";

export interface CandidateDecision {
  subscription_id: string;
  action: Action;
  target_plan: string | null;
  policy_rule_reference: string;
  reasoning: string;
}

export interface Reasoner {
  compilePolicy(text: string): Promise<CompiledPolicy>;
  decide(subscription: Subscription, policy: CompiledPolicy, portfolioMonthlyMinor: number): Promise<CandidateDecision>;
}

const candidateSchema = z.object({
  subscription_id: z.string(),
  action: actionSchema,
  target_plan: z.string().nullable(),
  policy_rule_reference: z.string(),
  reasoning: z.string().min(10).max(1_000),
});

export class FakeReasoner implements Reasoner {
  async compilePolicy(text: string) {
    return compilePolicyDeterministically(text);
  }

  async decide(subscription: Subscription, policy: CompiledPolicy, portfolioMonthlyMinor: number): Promise<CandidateDecision> {
    const annualRule = getRule(policy, "MIN_ANNUAL_SAVINGS_BPS");
    const unusedRule = getRule(policy, "MAX_INACTIVE_DAYS");
    const capRule = getRule(policy, "MONTHLY_CAP");
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
      policy_rule_reference: capRule?.rule_id ?? policy.rules[0]?.rule_id ?? "policy_default",
      reasoning: `${subscription.merchant_name} remains within the projected portfolio policy and has no validated lower-cost action. Current portfolio cost is ${portfolioMonthlyMinor} minor units.`,
    };
  }
}

export class OpenAIReasoner implements Reasoner {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly isResponsesEndpoint: boolean;

  constructor() {
    if (!config.openaiApiKey && !config.openrouterApiKey) {
      throw new Error("OPENAI_API_KEY or OPENROUTER_API_KEY is required for API reasoning");
    }
    if (config.openrouterApiKey) {
      this.client = new OpenAI({
        apiKey: config.openrouterApiKey,
        baseURL: config.openrouterBaseUrl,
        defaultHeaders: {
          "Content-Type": "application/json",
          ...(config.openrouterReferer ? { "HTTP-Referer": config.openrouterReferer } : {}),
          ...(config.openrouterTitle ? { "X-OpenRouter-Title": config.openrouterTitle } : {}),
        },
      });
      this.model = config.openrouterModel;
      this.isResponsesEndpoint = true;
    } else {
      this.client = new OpenAI({ apiKey: config.openaiApiKey ?? undefined, baseURL: config.openaiBaseUrl ?? undefined });
      this.model = config.openaiModel;
      this.isResponsesEndpoint = true;
    }
  }

  async compilePolicy(text: string): Promise<CompiledPolicy> {
    const tool = {
      type: "function",
      name: "compile_policy",
      description: "Compile user-written spending rules into structured policy constraints. Extract only the three supported rule types. Any rules that cannot be expressed as these types go into unsupported_clauses.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          currency: { type: "string", enum: ["USD"] },
          rules: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                rule_id: { type: "string" },
                type: { type: "string", enum: ["MONTHLY_CAP", "MAX_INACTIVE_DAYS", "MIN_ANNUAL_SAVINGS_BPS"] },
                amount_minor: { type: ["integer", "null"] },
                days: { type: ["integer", "null"] },
                basis_points: { type: ["integer", "null"] },
              },
              required: ["rule_id", "type", "amount_minor", "days", "basis_points"],
            },
          },
          unsupported_clauses: { type: "array", items: { type: "string" } },
        },
        required: ["currency", "rules", "unsupported_clauses"],
      },
    };
    const args = await this.callFunction(
      "compile_policy",
      tool,
      `You are a policy compiler for WARDEN, an AI subscription management agent.

Your job: Convert the user's natural-language spending rules into structured constraints.

## Supported Rule Types

1. **MONTHLY_CAP** — Maximum total monthly spend across all subscriptions.
   - Extract the dollar amount and convert to cents (minor units).
   - Example: "$60/month" → amount_minor: 6000

2. **MAX_INACTIVE_DAYS** — Number of days a subscription can be unused before action is taken.
   - Extract the number of days.
   - Example: "unused for 30 days" → days: 30

3. **MIN_ANNUAL_SAVINGS_BPS** — Minimum percentage savings required to justify switching to annual billing.
   - Convert percentage to basis points (1% = 100 bps).
   - Example: "saves more than 15%" → basis_points: 1500

## Rules
- Each rule needs a unique, descriptive rule_id (snake_case).
- Only extract rules that match the three types above.
- If the user mentions something that cannot be expressed (e.g., "cancel if reviews drop below 4 stars"), put it in unsupported_clauses.
- Always use currency "USD".
- Do not invent values — only use what the user explicitly stated.

## User Policy
${text}`,
    );
    const raw = z.object({
      currency: z.literal("USD"),
      rules: z.array(z.object({
        rule_id: z.string(),
        type: z.enum(["MONTHLY_CAP", "MAX_INACTIVE_DAYS", "MIN_ANNUAL_SAVINGS_BPS"]),
        amount_minor: z.number().int().nullable(),
        days: z.number().int().nullable(),
        basis_points: z.number().int().nullable(),
      })),
      unsupported_clauses: z.array(z.string()),
    }).parse(args);
    const rules = raw.rules.map((rule) => {
      if (rule.type === "MONTHLY_CAP" && rule.amount_minor !== null) return { rule_id: rule.rule_id, type: rule.type, amount_minor: rule.amount_minor };
      if (rule.type === "MAX_INACTIVE_DAYS" && rule.days !== null) return { rule_id: rule.rule_id, type: rule.type, days: rule.days };
      if (rule.type === "MIN_ANNUAL_SAVINGS_BPS" && rule.basis_points !== null) return { rule_id: rule.rule_id, type: rule.type, basis_points: rule.basis_points };
      throw new Error(`Incomplete compiled rule: ${rule.rule_id}`);
    });
    return compiledPolicySchema.parse({ currency: raw.currency, rules, unsupported_clauses: raw.unsupported_clauses });
  }

  async decide(subscription: Subscription, policy: CompiledPolicy, portfolioMonthlyMinor: number): Promise<CandidateDecision> {
    const availablePlans = subscription.alt_plans.map((p) => p.plan_id);
    const tool = {
      type: "function",
      name: "decide_subscription_action",
      description: "Decide what action to take for a subscription based on the user's spending policy. Choose RENEW, SWITCH, or DECLINE with clear reasoning.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          subscription_id: { type: "string" },
          action: { type: "string", enum: ["RENEW", "SWITCH", "DECLINE"] },
          target_plan: { type: ["string", "null"] },
          policy_rule_reference: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["subscription_id", "action", "target_plan", "policy_rule_reference", "reasoning"],
      },
    };
    const args = await this.callFunction(
      "decide_subscription_action",
      tool,
      `You are WARDEN's decision engine — an AI agent that manages recurring subscriptions on behalf of the user.

Your job: Analyze one subscription against the user's spending policy and decide what action to take.

## Context

**User's Spending Policy:**
${JSON.stringify(policy.rules, null, 2)}

**Current Portfolio:** $${(portfolioMonthlyMinor / 100).toFixed(2)}/month total

## Subscription to Evaluate

| Field | Value |
|-------|-------|
| Name | ${subscription.merchant_name} |
| Current Plan | ${subscription.plan_id} |
| Monthly Cost | $${(subscription.current_monthly_cost_minor / 100).toFixed(2)} |
| Billing Cycle | ${subscription.billing_cycle} |
| Last Used | ${subscription.last_used_days_ago !== null ? `${subscription.last_used_days_ago} days ago` : "No data"} |
| Available Plans | ${availablePlans.length > 0 ? availablePlans.join(", ") : "None"} |

## Decision Framework

Evaluate each policy rule against this subscription:

1. **MONTHLY_CAP rule**: Is the total portfolio (including this subscription) within the cap?
   - If over cap: prefer SWITCH to a cheaper plan, or DECLINE if no cheaper option.

2. **MAX_INACTIVE_DAYS rule**: Has the subscription been unused longer than the threshold?
   - If yes and cheaper plan exists → SWITCH to cheapest available plan.
   - If yes and no cheaper plan → DECLINE (cancel).

3. **MIN_ANNUAL_SAVINGS_BPS rule**: Is there an annual plan that saves more than the threshold?
   - If yes → SWITCH to annual plan.
   - Note: Annual savings = (monthly_cost × 12 - annual_cost) / (monthly_cost × 12) × 10000 basis points.

4. **Trial subscriptions**: If billing_cycle is "trial" and no usage data exists → DECLINE (prevent paid conversion).

5. **Default**: If no rule triggers an action → RENEW (keep current plan).

## Output

- **action**: RENEW, SWITCH, or DECLINE
- **target_plan**: For SWITCH, must be one of: ${availablePlans.length > 0 ? availablePlans.join(", ") : "N/A (use RENEW or DECLINE)"}
- **policy_rule_reference**: The rule_id that triggered this decision
- **reasoning**: Explain which rule triggered the action and why, in plain English. Be specific about numbers.

## Critical Rules
- target_plan MUST be from the available plans list. Never invent plan names.
- If no alt plans exist and the subscription should change, use DECLINE instead of SWITCH.
- policy_rule_reference MUST match a rule_id from the policy rules array.
- Be decisive — every subscription needs a clear recommendation.`,
    );
    return candidateSchema.parse(args);
  }

  private async callFunction(name: string, tool: object, input: string): Promise<unknown> {
    try {
      const response = await this.client.responses.create({
        model: this.model,
        reasoning: { effort: "none" },
        input,
        tools: [tool as never],
        tool_choice: { type: "function", name },
        parallel_tool_calls: false,
      } as any);
      const call = response.output.find((item) => item.type === "function_call" && item.name === name);
      if (call && call.type === "function_call") return JSON.parse(call.arguments) as unknown;
    } catch { /* tool calling failed, fall back to structured output */ }

    const schema = (tool as { parameters?: unknown }).parameters;
    const fallbackResponse = await (this.client as any).responses.create({
      model: this.model,
      reasoning: { effort: "none" },
      input: `${input}\n\nReturn ONLY valid JSON matching this schema. Do not wrap in markdown. Do not add commentary.\nSchema: ${JSON.stringify(schema)}`,
      max_output_tokens: 500,
    });
    const text = fallbackResponse.output_text ?? fallbackResponse.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error(`No response from ${name}`);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`No JSON in response from ${name}: ${text.slice(0, 200)}`);
    return JSON.parse(jsonMatch[0]) as unknown;
  }
}

export function createReasoner(): Reasoner {
  return config.reasonerMode === "openai" ? new OpenAIReasoner() : new FakeReasoner();
}
