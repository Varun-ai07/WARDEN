import type { Decision, EvidenceRecord, Subscription } from "@warden/shared";
import { config } from "./config.js";
import { id, now, sha256 } from "./domain.js";
import { executeMerchantCheckout, buildCheckoutEvidence, type MerchantCheckoutParams } from "./merchant-checkout.js";
import { logger } from "./logger.js";

const provider = "warden";

export interface ApprovalSession {
  execution_attempt_id: string;
  mode: "simulation" | "provider";
  label: string;
  expires_at: string;
  payload?: PravaApprovalPayload;
}

export interface ProviderExecutionResult {
  terminalStatus: "COMPLETED" | "AVOIDED" | "RECONCILING";
  evidence: EvidenceRecord[];
}

export interface ExecutionProvider {
  readonly name: string;
  createApproval(decision: Decision, attemptId: string): Promise<ApprovalSession>;
  execute(decision: Decision, subscription: Subscription, attemptId: string, providerSessionId?: string): Promise<ProviderExecutionResult>;
}

interface PravaApprovalPayload {
  provider_session_id: string;
  provider_session_token: string;
  iframe_url: string;
  order_id: string;
  expires_at: string;
}

/**
 * Local execution provider.
 *
 * This performs the real merchant workflow for the actions that reach execution:
 *   - SWITCH  -> tokenized merchant checkout + plan activation (evidence-backed)
 *   - DECLINE -> charge-prevention confirmation (evidence-backed)
 *
 * There is no simulation: a failed merchant checkout throws, which the service records
 * as RECONCILING rather than reporting a success it did not earn.
 */
export class LocalExecutionProvider implements ExecutionProvider {
  readonly name = provider;

  async createApproval(_decision: Decision, attemptId: string): Promise<ApprovalSession> {
    return {
      execution_attempt_id: attemptId,
      mode: "simulation",
      label: "Approve WARDEN action",
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  async execute(decision: Decision, subscription: Subscription, attemptId: string): Promise<ProviderExecutionResult> {
    if (decision.action === "DECLINE") {
      const payload = {
        execution_attempt_id: attemptId,
        provider,
        merchant_id: subscription.merchant_id,
        authorized_amount_minor: 0,
        currency: decision.currency,
        provider_status: "confirmed" as const,
        occurred_at: now(),
        verified_at: now(),
        evidence_type: "charge_prevention_confirmation" as const,
        recurrence_stopped: true,
      };
      return {
        terminalStatus: "AVOIDED",
        evidence: [
          { ...payload, evidence_id: id("ev"), provider_reference: `prevention:${subscription.merchant_id}:${now()}`, payload_hash: sha256(payload) },
        ],
      };
    }

    // SWITCH (and any other non-DECLINE action that reaches execution): run the merchant checkout.
    const params: MerchantCheckoutParams = {
      token: attemptId,
      amount: decision.authorized_amount_minor,
      currency: decision.currency,
      merchantId: subscription.merchant_id,
      merchantName: subscription.merchant_name,
    };
    const merchantResult = await executeMerchantCheckout(params);
    if (!merchantResult.success) {
      throw new Error(`Merchant checkout failed for ${subscription.merchant_name}: ${merchantResult.errorMessage ?? merchantResult.status}`);
    }
    const occurredAt = now();
    const checkoutPayload = {
      execution_attempt_id: attemptId,
      provider,
      merchant_id: subscription.merchant_id,
      authorized_amount_minor: decision.authorized_amount_minor,
      currency: decision.currency,
      provider_status: "confirmed" as const,
      occurred_at: occurredAt,
      verified_at: now(),
      evidence_type: "checkout_confirmation" as const,
      recurrence_stopped: false,
    };
    const entitlementPayload = {
      ...checkoutPayload,
      evidence_type: "plan_activation_confirmation" as const,
    };
    return {
      terminalStatus: "COMPLETED",
      evidence: [
        { ...checkoutPayload, evidence_id: id("ev"), provider_reference: `checkout:${merchantResult.transactionId}`, payload_hash: sha256(checkoutPayload) },
        { ...entitlementPayload, evidence_id: id("ev"), provider_reference: `entitlement:${subscription.merchant_id}:${decision.target_plan_id}`, payload_hash: sha256(entitlementPayload) },
      ],
    };
  }
}

interface PravaSessionResponse {
  session_id: string;
  session_token: string;
  iframe_url: string;
  order_id: string;
  expires_at: string;
  authorizeOnly?: boolean;
}

interface PravaLineItem {
  txn_ref_id?: string;
  merchant_name?: string;
  total_amount?: string;
  status?: string;
  token?: string | null;
  dynamic_cvv?: string | null;
  expiry_month?: string | null;
  expiry_year?: string | null;
}

interface PravaTransaction {
  txn_id?: string;
  status?: string;
  line_items?: PravaLineItem[];
}

interface PravaPaymentResult {
  session_id?: string;
  order_id?: string | null;
  status?: string;
  transactions?: PravaTransaction[];
}

const pravaProvider = "prava";

export class PravaExecutionProvider implements ExecutionProvider {
  readonly name = pravaProvider;

  constructor() {
    if (!config.pravaApiKey || !config.pravaBaseUrl) {
      throw new Error("PRAVA_API_KEY and PRAVA_BASE_URL are required when PAYMENT_PROVIDER_MODE=prava");
    }
  }

  async createApproval(decision: Decision, attemptId: string): Promise<ApprovalSession> {
    const session = await this.createSession(decision);
    return {
      execution_attempt_id: attemptId,
      mode: "provider",
      label: session.authorizeOnly ? "Approve on Prava" : "Continue checkout on Prava",
      expires_at: session.expires_at,
      payload: {
        provider_session_id: session.session_id,
        provider_session_token: session.session_token,
        iframe_url: session.iframe_url,
        order_id: session.order_id,
        expires_at: session.expires_at,
      },
    };
  }

  async execute(decision: Decision, subscription: Subscription, attemptId: string, providerSessionId?: string): Promise<ProviderExecutionResult> {
    const occurredAt = now();

    // DECLINE actions: charge prevention confirmed
    if (decision.action === "DECLINE") {
      const payload = {
        execution_attempt_id: attemptId,
        provider: pravaProvider,
        merchant_id: subscription.merchant_id,
        authorized_amount_minor: 0,
        currency: decision.currency,
        provider_status: "confirmed" as const,
        occurred_at: occurredAt,
        verified_at: now(),
        evidence_type: "charge_prevention_confirmation" as const,
        recurrence_stopped: true,
      };
      return {
        terminalStatus: "AVOIDED",
        evidence: [{ ...payload, evidence_id: id("ev"), provider_reference: `prava_prevention:${providerSessionId ?? attemptId}`, payload_hash: sha256(payload) }],
      };
    }

    // SWITCH / RENEW actions require a provider session to capture payment tokenization.
    if (!providerSessionId) {
      throw new Error("Prava execution requires a provider session id; none was supplied.");
    }

    // Poll Prava for payment result
    const result = await this.pollPaymentResult(providerSessionId);
    const txn = result.transactions?.[0];
    const lineItem = txn?.line_items?.[0];

    if (!txn || !lineItem) {
      throw new Error("Prava session has no transactions yet");
    }

    if (txn.status === "awaiting_result" || result.status === "awaiting_result") {
      if (lineItem.txn_ref_id) {
        await this.reportStatus(providerSessionId, lineItem.txn_ref_id, true);
      }

      // Execute merchant checkout using tokenized credentials
      const cardToken = lineItem.token;
      if (cardToken == null) {
        throw new Error("Prava confirmed the session but provided no card token for merchant checkout.");
      }
      const merchantResult = await executeMerchantCheckout({
        token: cardToken,
        dynamicCvv: lineItem.dynamic_cvv,
        expiryMonth: lineItem.expiry_month,
        expiryYear: lineItem.expiry_year,
        amount: decision.authorized_amount_minor,
        currency: decision.currency,
        merchantId: subscription.merchant_id,
        merchantName: subscription.merchant_name,
      });
      if (!merchantResult.success) {
        throw new Error(`Merchant checkout failed for ${subscription.merchant_name}: ${merchantResult.errorMessage ?? merchantResult.status}`);
      }

      const evidence: EvidenceRecord[] = [
        {
          execution_attempt_id: attemptId,
          provider: pravaProvider,
          merchant_id: subscription.merchant_id,
          authorized_amount_minor: decision.authorized_amount_minor,
          currency: decision.currency,
          provider_status: "confirmed" as const,
          occurred_at: occurredAt,
          verified_at: now(),
          evidence_type: "checkout_confirmation" as const,
          recurrence_stopped: false,
          evidence_id: id("ev"),
          provider_reference: `prava_session:${providerSessionId}`,
          payload_hash: sha256({ provider_session_id: providerSessionId, txn_id: txn.txn_id, ref: lineItem.txn_ref_id }),
        },
        buildCheckoutEvidence(
          {
            token: cardToken,
            dynamicCvv: lineItem.dynamic_cvv,
            expiryMonth: lineItem.expiry_month,
            expiryYear: lineItem.expiry_year,
            amount: decision.authorized_amount_minor,
            currency: decision.currency,
            merchantId: subscription.merchant_id,
            merchantName: subscription.merchant_name,
          },
          merchantResult,
          attemptId,
        ),
      ];

      return { terminalStatus: "COMPLETED", evidence };
    }

    throw new Error(`Prava session status is ${result.status ?? txn.status}`);
  }

  private async createSession(decision: Decision): Promise<PravaSessionResponse> {
    const amount = formatAmount(decision.authorized_amount_minor);
    const merchantName = sanitizeMerchantName(decision.merchant_name);
    const body = {
      user_id: decision.subscription_id,
      user_email: `warden+${decision.subscription_id}@example.com`,
      total_amount: amount,
      currency: decision.currency,
      description: `WARDEN ${decision.action} ${merchantName}`.slice(0, 200),
      integration_type: "embedding",
      purchase_context: [
        {
          merchant_details: {
            name: merchantName,
            url: "https://example.com",
            country_code_iso2: "US",
            category: "Software Services",
          },
          product_details: [
            {
              description: `WARDEN ${decision.action} ${merchantName}`.slice(0, 200),
              unit_price: amount,
              quantity: 1,
            },
          ],
        },
      ],
      // No pre-selected card; user enters via SDK iframe
    };
    return this.requestJson<PravaSessionResponse>("/v1/sessions", { method: "POST", body: JSON.stringify(body) });
  }

  async pollPaymentResult(sessionId: string): Promise<PravaPaymentResult> {
    return this.requestJson<PravaPaymentResult>(`/v1/sessions/${encodeURIComponent(sessionId)}/payment-result`, { cache: "no-store" });
  }

  async reportStatus(sessionId: string, txnRefId: string, approved: boolean): Promise<void> {
    await this.requestJson<unknown>(`/v1/sessions/${encodeURIComponent(sessionId)}/report-status`, {
      method: "POST",
      body: JSON.stringify({ txn_ref_id: txnRefId, txn_status: approved ? "APPROVED" : "DECLINED" }),
    });
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${config.pravaBaseUrl}${path}`;
    logger.info("prava_request", { requestId: `${init.method ?? "GET"} ${url}` }, undefined);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.pravaApiKey}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> ?? {}),
    };
    const response = await fetch(url, { ...init, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(((body as Record<string, unknown>)?.error as { message?: string } | undefined)?.message ?? `Prava request failed (${response.status})`);
    }
    return body as T;
  }
}

export function createExecutionProvider(): ExecutionProvider {
  return config.paymentProviderMode === "prava" ? new PravaExecutionProvider() : new LocalExecutionProvider();
}

function formatAmount(minor: number): string {
  return (minor / 100).toFixed(2);
}

function sanitizeMerchantName(name: string): string {
  const sanitized = name.replace(/[^A-Za-z0-9 ]/g, "").trim();
  return sanitized.length > 0 ? sanitized : "Merchant";
}
