import { id, now, sha256 } from "./domain.js";

export interface MerchantCheckoutParams {
  token: string;
  dynamicCvv?: string | null;
  expiryMonth?: string | null;
  expiryYear?: string | null;
  amount: number;
  currency: string;
  merchantId: string;
  merchantName: string;
}

export interface MerchantCheckoutResult {
  success: boolean;
  transactionId: string;
  status: "completed" | "failed" | "pending";
  merchantReference: string;
  receipt?: string;
  errorMessage?: string;
}

export interface MerchantCheckoutAdapter {
  readonly merchantId: string;
  readonly merchantName: string;
  checkout(params: MerchantCheckoutParams): Promise<MerchantCheckoutResult>;
}

class NotionCheckoutAdapter implements MerchantCheckoutAdapter {
  readonly merchantId = "merchant_notion";
  readonly merchantName = "Notion";

  async checkout(params: MerchantCheckoutParams): Promise<MerchantCheckoutResult> {
    // In production, this would call Notion's payment API
    // using the tokenized credentials from Prava.
    //
    // Example flow:
    // 1. POST https://api.notion.so/v1/payments
    //    Headers: { Authorization: "Bearer <merchant_api_key>" }
    //    Body: {
    //      token: params.token,
    //      amount: params.amount,
    //      currency: params.currency,
    //      cvv: params.dynamicCvv,
    //      description: "WARDEN subscription renewal"
    //    }
    // 2. Notion processes the payment using the tokenized card
    // 3. Returns transaction ID and receipt

    console.log(`[merchant:notation] Processing checkout for ${params.amount} ${params.currency}`);

    // Simulate merchant API call delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    const transactionId = `notion_${id("txn")}`;
    const merchantReference = `ref_${Date.now()}`;

    return {
      success: true,
      transactionId,
      status: "completed",
      merchantReference,
      receipt: `Notion payment confirmed: ${params.amount} ${params.currency} for ${params.merchantName}`,
    };
  }
}

class GenericMerchantCheckoutAdapter implements MerchantCheckoutAdapter {
  readonly merchantId: string;
  readonly merchantName: string;

  constructor(merchantId: string, merchantName: string) {
    this.merchantId = merchantId;
    this.merchantName = merchantName;
  }

  async checkout(params: MerchantCheckoutParams): Promise<MerchantCheckoutResult> {
    console.log(`[merchant:generic] Processing checkout for ${params.merchantName}: ${params.amount} ${params.currency}`);

    // Simulate merchant API call
    await new Promise((resolve) => setTimeout(resolve, 100));

    const transactionId = `generic_${id("txn")}`;
    const merchantReference = `ref_${Date.now()}`;

    return {
      success: true,
      transactionId,
      status: "completed",
      merchantReference,
      receipt: `Payment confirmed: ${params.amount} ${params.currency} at ${params.merchantName}`,
    };
  }
}

const adapters = new Map<string, MerchantCheckoutAdapter>();

function getAdapter(merchantId: string, merchantName: string): MerchantCheckoutAdapter {
  if (adapters.has(merchantId)) return adapters.get(merchantId)!;

  let adapter: MerchantCheckoutAdapter;
  switch (merchantId) {
    case "merchant_notion":
      adapter = new NotionCheckoutAdapter();
      break;
    default:
      adapter = new GenericMerchantCheckoutAdapter(merchantId, merchantName);
      break;
  }

  adapters.set(merchantId, adapter);
  return adapter;
}

export async function executeMerchantCheckout(params: MerchantCheckoutParams): Promise<MerchantCheckoutResult> {
  const adapter = getAdapter(params.merchantId, params.merchantName);
  return adapter.checkout(params);
}

export function buildCheckoutEvidence(params: MerchantCheckoutParams, result: MerchantCheckoutResult, attemptId: string) {
  const occurredAt = now();
  const payload = {
    execution_attempt_id: attemptId,
    provider: "prava+merchant",
    merchant_id: params.merchantId,
    authorized_amount_minor: params.amount,
    currency: params.currency,
    provider_status: result.status === "completed" ? ("confirmed" as const) : ("failed" as const),
    occurred_at: occurredAt,
    verified_at: now(),
    evidence_type: "merchant_checkout_confirmation" as const,
    recurrence_stopped: false,
    evidence_id: id("ev"),
    provider_reference: `merchant:${result.transactionId}`,
    payload_hash: sha256({ ...params, transaction_id: result.transactionId, merchant_reference: result.merchantReference }),
  };
  return payload;
}
