import { createHash, randomUUID } from "node:crypto";
import type {
  CompiledPolicy,
  ExecutionStatus,
  PolicyRule,
  Subscription,
} from "@warden/shared";

export const now = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}_${randomUUID()}`;

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex")}`;
}

export function conservativeMonthlyCost(periodAmountMinor: number, months: number): number {
  if (!Number.isInteger(periodAmountMinor) || periodAmountMinor < 0 || !Number.isInteger(months) || months <= 0) {
    throw new Error("Invalid period normalization input");
  }
  return Math.ceil(periodAmountMinor / months);
}

export function annualSavingsBps(currentMonthlyMinor: number, annualMinor: number): number {
  const annualized = currentMonthlyMinor * 12;
  if (annualized <= 0) return 0;
  return Math.floor(((annualized - annualMinor) * 10_000) / annualized);
}

export function healthScore(subscription: Pick<Subscription, "last_used_days_ago" | "usage_frequency_score" | "explicit_priority_score" | "current_monthly_cost_minor">): {
  score: number;
  dataStatus: "complete" | "insufficient_data";
} {
  const missing = subscription.last_used_days_ago === null || subscription.usage_frequency_score === null;
  const recency = subscription.last_used_days_ago === null ? 25 : Math.max(0, 100 - subscription.last_used_days_ago * 2.4);
  const frequency = subscription.usage_frequency_score ?? 25;
  const costEfficiency = subscription.current_monthly_cost_minor <= 1_500 ? 90 : subscription.current_monthly_cost_minor <= 2_500 ? 65 : 45;
  const score = Math.round(recency * 0.4 + frequency * 0.25 + costEfficiency * 0.2 + subscription.explicit_priority_score * 0.15);
  return { score: Math.max(0, Math.min(100, score)), dataStatus: missing ? "insufficient_data" : "complete" };
}

export function getRule<T extends PolicyRule["type"]>(policy: CompiledPolicy, type: T): Extract<PolicyRule, { type: T }> | undefined {
  return policy.rules.find((rule): rule is Extract<PolicyRule, { type: T }> => rule.type === type);
}

const allowedTransitions: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  DISCOVERED: ["DECIDED"],
  DECIDED: ["VALIDATION_FAILED", "STALE", "VALIDATED"],
  VALIDATION_FAILED: [],
  STALE: [],
  VALIDATED: ["NO_ACTION_REQUIRED", "RECOMMENDED", "AWAITING_APPROVAL"],
  NO_ACTION_REQUIRED: [],
  RECOMMENDED: [],
  AWAITING_APPROVAL: ["STALE", "APPROVAL_DECLINED", "EXPIRED", "AUTHORIZED", "RECONCILING"],
  APPROVAL_DECLINED: [],
  EXPIRED: [],
  AUTHORIZED: ["EXECUTING"],
  EXECUTING: ["COMPLETED", "AVOIDED", "FAILED", "RECONCILING"],
  RECONCILING: ["COMPLETED", "AVOIDED", "FAILED", "UNKNOWN"],
  UNKNOWN: ["COMPLETED", "AVOIDED", "FAILED"],
  COMPLETED: [],
  AVOIDED: [],
  FAILED: [],
};

export function assertTransition(from: ExecutionStatus, to: ExecutionStatus): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`Invalid execution transition: ${from} -> ${to}`);
  }
}

export function compilePolicyDeterministically(text: string): CompiledPolicy {
  const normalized = text.toLowerCase();
  const cap = normalized.match(/(?:exceed|over|under|cap(?:ped)? at)\s*\$?(\d+(?:\.\d{1,2})?)/);
  const inactive = normalized.match(/unused\s+(\d+)\+?\s*days|inactive\s+(?:for\s+)?(\d+)\+?\s*days/);
  const annual = normalized.match(/(?:saves?|saving)\s+(?:more than|over|at least)\s*(\d+(?:\.\d+)?)%/);
  const rules: PolicyRule[] = [];
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

  return { currency: "USD", rules, unsupported_clauses: unsupported };
}
