# WARDEN — Outcome Integrity Guide

> **Status: supporting trust guide.** [FINAL_WARDEN.md](FINAL_WARDEN.md) is the single source of truth. This guide explains how to apply its outcome rules in the UI, demo, and tests.

## The rule

Do not present a model decision, a payment session, or a mandate request as a completed transaction. A terminal claim must be backed by the evidence required for its outcome type.

| Outcome | Required evidence | Allowed wording | Counter |
|---|---|---|---|
| `transaction_completed` | Confirmed checkout plus entitlement/plan-change evidence for plan claims | “Completed”, “Switched”, “Paid” | Recurring saving only when the new plan is confirmed |
| `decision_only` | None; no execution occurred | “Recommended” for unsupported execution, or “No action required” for a valid keep-current-plan decision | Never |
| `action_avoided` | Cancellation, revocation, or prevention reference | “Avoided next charge” | One-time avoided amount; recurring only with recurring-cancellation evidence |

Execution state is separate from this table. `VALIDATION_FAILED`, `STALE`, `APPROVAL_DECLINED`, `EXPIRED`, and `FAILED` have `outcome_type: null`; they must be shown as stopped or failed work, not converted into recommendations.

Evidence must be a server-verified object containing provider, evidence type, unique provider reference, merchant, amount, currency, provider status, timestamps, and payload hash. A free-form string or client-supplied reference is insufficient.

## Applied to the three acts

### Annual plan switch

The $20/month → $165/year fixture is a `SWITCH`. Show a switch completion only after both the $165 checkout and annual-plan activation are evidenced. Display $13.75 as the effective monthly cost, $6.25 as the recurring monthly saving, and $75 as the annual saving.

### Active-plan switch

If the selected merchant supports an active-plan change, the completed state needs returned execution evidence and the relevant passkey approval. If it does not, show:

> Recommended: switch to the basic plan — potential $15/month saving.

Do not show a checkmark, a provider-completed badge, or a counter increment for that recommendation.

### Trial decline

“No mandate requested” does not establish that a merchant cannot charge a different stored payment method. A trial is `action_avoided` only after a verified merchant cancellation, mandate revocation, or equivalent prevention result. Otherwise show:

> Recommended: cancel before the $12/month conversion.

## UI and spoken-demo test

Render terminal cards from `outcome_type` and evidence fields—not from action names or the absence of an error. Before submission, ask an observer which actions actually completed and which merely were recommended. If they cannot answer from the screen and narration, the presentation is not sufficiently honest.

Also replay the same ledger event twice and reconnect the SSE client mid-run. The UI must remain identical and the backend must not repeat an external action.
