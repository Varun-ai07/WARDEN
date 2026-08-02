import type {
  ApprovalSessionResponse,
  EvidenceRecord,
  LedgerEvent,
  PolicyRecord,
  PravaPaymentResult,
  RunRecord,
  SavingsSummary,
  SessionResponse,
  Subscription,
} from "@warden/shared";

let csrfToken = "";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(csrfToken && init.method && init.method !== "GET" ? { "x-csrf-token": csrfToken } : {}),
        ...init.headers,
      },
    });
  } catch (cause) {
    if (cause instanceof TypeError && cause.message.includes("fetch")) {
      throw new NetworkError("Network unavailable. Check your connection and try again.");
    }
    throw cause;
  }
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error?.message ?? `Request failed (${response.status})`, response.status);
  return body as T;
}

export class NetworkError extends Error {
  readonly code = "NETWORK_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = `HTTP_${status}`;
  }
}

export const api = {
  async session() {
    const session = await request<SessionResponse>("/api/v1/session");
    csrfToken = session.csrf_token;
    return session;
  },
  subscriptions: () => request<{ subscriptions: Subscription[]; portfolio_version: number }>("/api/v1/subscriptions"),
  policy: () => request<PolicyRecord>("/api/v1/policies/current"),
  savings: () => request<SavingsSummary>("/api/v1/savings"),
  latestRun: () => request<{ run: RunRecord | null }>("/api/v1/runs/latest"),
  run: (runId: string) => request<RunRecord>(`/api/v1/runs/${runId}`),
  events: (runId: string) => request<{ events: LedgerEvent[] }>(`/api/v1/runs/${runId}/events`),
  evidence: (evidenceId: string) => request<EvidenceRecord>(`/api/v1/evidence/${evidenceId}`),
  createRun: (policyVersion: number, portfolioVersion: number) => request<RunRecord>("/api/v1/runs", {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ policy_version: policyVersion, expected_portfolio_version: portfolioVersion }),
  }),
  draftPolicy: (policyText: string, policyVersion: number) => request<PolicyRecord>("/api/v1/policies/current", {
    method: "PUT",
    headers: { "if-match": String(policyVersion) },
    body: JSON.stringify({ policy_text: policyText }),
  }),
  activatePolicy: (policyId: string, version: number) => request<PolicyRecord>(`/api/v1/policies/${policyId}/activate`, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ version }),
  }),
  approvalSession: (decisionId: string) => request<ApprovalSessionResponse>(`/api/v1/decisions/${decisionId}/approval-session`, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: "{}",
  }),
  pravaPaymentResult: (sessionId: string) => request<PravaPaymentResult>(`/api/v1/prava/sessions/${sessionId}/payment-result`),
  finalizePrava: (sessionId: string) => request<RunRecord>(`/api/v1/prava/sessions/${sessionId}/finalize`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: "{}" }),
  executeAttempt: (decisionId: string, attemptId: string) => request<RunRecord>(`/api/v1/decisions/${decisionId}/attempts`, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ execution_attempt_id: attemptId }),
  }),
  decline: (decisionId: string) => request<RunRecord>(`/api/v1/decisions/${decisionId}/cancel`, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: "{}",
  }),
};
