# WARDEN — Solo Delivery Architecture

> **Status: supporting implementation guide.** [FINAL_WARDEN.md](FINAL_WARDEN.md) is the single source of truth for WARDEN's behavior and contracts. This document explains how one builder delivers that specification; it does not define a different product architecture.

## Delivery principle

One builder should preserve a clear frontend/backend boundary connected by the canonical REST and SSE contract. They may run as separate processes or within one development server; the requirement is independent backend testing and a stable contract, not extra deployment complexity.

```text
React dashboard ── REST + SSE ── backend
                                  ├─ SQLite + append-only ledger
                                  ├─ policy compiler + OpenAI candidates
                                  ├─ portfolio planner
                                  ├─ validator + execution state machine
                                  ├─ capability registry
                                  └─ Prava SDK/API integration
```

The backend owns all secrets, policy validation, capability checks, accounting, and provider calls. The frontend renders the explicit state returned by the backend; it never infers a completed transaction from a successful-looking request.

## Non-negotiable implementation rules

- Start from the exact fixtures, actions, outcome types, and event fields in `FINAL_WARDEN.md`.
- Ask OpenAI only for a structured decision. Use the canonical strict function schema, then run deterministic validation before any effect.
- Compile policy prose into the supported rule schema and require explicit activation of the normalized interpretation.
- Plan candidate decisions atomically against one immutable portfolio snapshot and policy version.
- Use `RENEW` only for an unchanged plan and `SWITCH` for every plan change, including annual billing.
- Store money as integer minor units with a currency; keep authorized amount, effective monthly cost, recurring monthly savings, and one-time avoided charges separate.
- Treat an unverified merchant path, active-plan change, or trial cancellation as `decision_only`.
- Require an evidence reference for every `transaction_completed` or `action_avoided` ledger entry.
- Persist every state transition, attempt, evidence object, and event sequence in SQLite.
- Use local and provider idempotency keys; reconcile ambiguous timeouts before retrying.
- Authenticate all routes and streams, enforce ownership server-side, and isolate untrusted metadata from model instructions.
- Require visible user passkey approval for a real payment. Evaluation inside a manually started run is automated; payment authorization is not. Continuous scheduling is future work.

## Build sequence

1. **Verify first.** Record the primary and backup merchant path, one real checkout flow, passkey rendering model, active-plan capability, and trial-prevention mechanism.
2. **Prove one payment.** Run one scoped mandate and checkout from the backend before dashboard polish.
3. **Implement the durable contract.** Add SQLite migrations, the canonical state machine, run/decision/attempt IDs, authenticated REST, ledger events, and replayable per-run SSE.
4. **Add reasoning safely.** Wire the strict policy compiler and OpenAI decision tool to the atomic portfolio planner and validator. Test unsupported clauses, malformed arguments, stale snapshots, unavailable plans, over-cap outcomes, prompt injection, and arithmetic mismatches.
5. **Implement outcomes and failures.** Add provider idempotency, verified structured evidence, safe retry reconciliation, payment, recommendation, prevention, decline, expiry, and failure paths.
6. **Connect the dashboard.** Render state and outcome from ledger events. Separate evidenced recurring monthly savings from one-time avoided charges; show declined, expired, stale, unknown, and failed states explicitly.
7. **Verify recovery.** Test double-clicks, duplicate callbacks, SSE reconnects, and a process restart during an active run.
8. **Add operational visibility.** Wire correlation IDs, redacted structured logs, provider request IDs, failure metrics, stuck-attempt/lock alerts, and replay-lag monitoring.
9. **Rehearse as built.** The spoken script must reflect whichever merchant capabilities are actually verified on demo day.

## Human checkpoints

The builder must personally observe the first passkey prompt and checkout confirmation, inspect actual model reasoning, verify the ledger math, and run the final rehearsal. An agent report or fixture response is not evidence that a payment or cancellation worked.

## Handoff checklist

- API/SSE contract copied unchanged from `FINAL_WARDEN.md`.
- The capability registry identifies the evidence required for each demo path.
- No credentials are exposed to the browser or checked into the workspace.
- Duplicate run/approval/provider requests cannot create duplicate effects.
- Portfolio and policy version conflicts stop and replan rather than continuing stale work.
- Every terminal UI state can be traced to a ledger entry and its evidence.
- The backup video and README use the same qualified claims as the live demo.
