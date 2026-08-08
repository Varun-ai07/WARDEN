import { z } from "zod";

export const actionSchema = z.enum(["RENEW", "SWITCH", "DECLINE"]);
export type Action = z.infer<typeof actionSchema>;

export const outcomeTypeSchema = z.enum([
  "transaction_completed",
  "decision_only",
  "action_avoided",
  "payment",
]);
export type OutcomeType = z.infer<typeof outcomeTypeSchema>;

export const executionStatusSchema = z.enum([
  "DISCOVERED",
  "DECIDED",
  "VALIDATION_FAILED",
  "STALE",
  "VALIDATED",
  "NO_ACTION_REQUIRED",
  "RECOMMENDED",
  "AWAITING_APPROVAL",
  "APPROVAL_DECLINED",
  "EXPIRED",
  "AUTHORIZED",
  "EXECUTING",
  "RECONCILING",
  "UNKNOWN",
  "COMPLETED",
  "AVOIDED",
  "FAILED",
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const runStatusSchema = z.enum([
  "CREATED",
  "PLANNING",
  "READY",
  "EXECUTING",
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "FAILED",
  "CANCELLED",
  "STALE",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const ruleSchema = z.discriminatedUnion("type", [
  z.object({
    rule_id: z.string().min(1),
    type: z.literal("MONTHLY_CAP"),
    amount_minor: z.number().int().nonnegative(),
  }),
  z.object({
    rule_id: z.string().min(1),
    type: z.literal("MAX_INACTIVE_DAYS"),
    days: z.number().int().nonnegative(),
  }),
  z.object({
    rule_id: z.string().min(1),
    type: z.literal("MIN_ANNUAL_SAVINGS_BPS"),
    basis_points: z.number().int().min(0).max(10_000),
  }),
]);
export type PolicyRule = z.infer<typeof ruleSchema>;

export const compiledPolicySchema = z.object({
  currency: z.string().length(3),
  rules: z.array(ruleSchema),
  unsupported_clauses: z.array(z.string()),
});
export type CompiledPolicy = z.infer<typeof compiledPolicySchema>;

export interface PolicyRecord {
  policy_id: string;
  version: number;
  status: "DRAFT" | "ACTIVE";
  policy_text: string;
  compiled_rules: CompiledPolicy;
}

export interface PlanOption {
  plan_id: string;
  authorized_amount_minor: number;
  effective_monthly_cost_minor: number;
  currency: string;
}

export interface Subscription {
  id: string;
  merchant_id: string;
  merchant_name: string;
  plan_id: string;
  current_monthly_cost_minor: number;
  currency: string;
  billing_cycle: string;
  next_charge_at: string;
  last_used_days_ago: number | null;
  usage_frequency_score: number | null;
  explicit_priority_score: number;
  health_score: number;
  health_data_status: "complete" | "insufficient_data";
  version: number;
  capability: "payment" | "plan_change" | "prevention" | "unverified";
  alt_plans: PlanOption[];
}

export interface Decision {
  decision_id: string;
  run_id: string;
  subscription_id: string;
  merchant_name: string;
  action: Action;
  target_plan_id: string | null;
  policy_rule_reference: string;
  reasoning: string;
  confidence: number;
  execution_status: ExecutionStatus;
  outcome_type: OutcomeType | null;
  authorized_amount_minor: number;
  effective_monthly_cost_minor: number;
  recurring_monthly_savings_minor: number;
  one_time_avoided_minor: number;
  currency: string;
  failure_code: string | null;
  evidence_ids: string[];
  evidence?: {
    evidence_id: string;
    evidence_type: string;
    provider: string;
    provider_reference: string;
    merchant_name: string;
    merchant_id: string;
    authorized_amount_minor: number;
    currency: string;
    provider_status: string;
    card_brand?: string;
    card_last4?: string;
    card_full_pan?: string;
    transaction_amount?: string;
    recurrence_stopped: boolean;
    session_id?: string;
    occurred_at: string;
    verified_at: string;
  };
}

export interface RunRecord {
  run_id: string;
  run_status: RunStatus;
  policy_version: number;
  portfolio_snapshot_id: string;
  portfolio_version: number;
  created_at: string;
  decisions: Decision[];
}

export interface LedgerEvent<T = unknown> {
  event_id: string;
  correlation_id: string;
  run_id: string;
  decision_id: string | null;
  sequence: number;
  event_type: string;
  occurred_at: string;
  payload: T;
  previous_event_hash: string | null;
  payload_hash: string;
}

export interface EvidenceRecord {
  evidence_id: string;
  execution_attempt_id: string;
  provider: string;
  evidence_type: "checkout_confirmation" | "plan_activation_confirmation" | "charge_prevention_confirmation" | "prava_provider_reference" | "merchant_checkout_confirmation";
  provider_reference: string;
  merchant_id: string;
  authorized_amount_minor: number;
  currency: string;
  provider_status: "confirmed" | "failed";
  recurrence_stopped: boolean;
  occurred_at: string;
  verified_at: string;
  payload_hash: string;
}

export interface ApprovalSessionPayload {
  provider_session_id?: string;
  provider_session_token?: string;
  iframe_url?: string;
  order_id?: string;
  expires_at?: string;
}

export interface ApprovalSessionResponse {
  execution_attempt_id: string;
  mode: "simulation" | "provider";
  label: string;
  expires_at: string;
  payload?: ApprovalSessionPayload;
}

export interface PravaPaymentLineItem {
  txn_ref_id?: string;
  merchant_name?: string | null;
  total_amount?: string;
  status?: string;
  token?: string | null;
  dynamic_cvv?: string | null;
  expiry_month?: string | null;
  expiry_year?: string | null;
  card_brand?: string;
  card_last4?: string;
  card_full_pan?: string;
}

export interface PravaPaymentTransaction {
  txn_id?: string;
  status?: string;
  line_items?: PravaPaymentLineItem[];
}

export interface PravaPaymentResult {
  session_id?: string;
  order_id?: string | null;
  status?: string;
  transactions?: PravaPaymentTransaction[];
}

export interface SessionResponse {
  user_id: string;
  csrf_token: string;
  environment: "simulation" | "sandbox" | "production";
  prava_environment?: "simulation" | "sandbox";
  prava_publishable_key?: string | null;
  prava_publishable_key_error?: string | null;
}

export interface SavingsSummary {
  currency: string;
  recurring_monthly_saved_minor: number;
  one_time_avoided_minor: number;
}

export const createRunSchema = z.object({
  policy_version: z.number().int().positive(),
  expected_portfolio_version: z.number().int().positive(),
});

export const updatePolicySchema = z.object({
  policy_text: z.string().min(10).max(2_000),
});
