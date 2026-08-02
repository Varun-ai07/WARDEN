# WARDEN — Optional Two-Person Delivery Addendum

> **Status: supporting delivery guide.** [FINAL_WARDEN.md](FINAL_WARDEN.md) is WARDEN's single source of truth for product behavior, data, API, action semantics, and demo claims. If this document differs from it, the final architecture controls.

This addendum is only relevant when two people are building the canonical WARDEN MVP. It does not create a second product architecture or change the authority model.

## Shared contract before work begins

Both contributors must copy the canonical REST and SSE contract from `FINAL_WARDEN.md` verbatim. In particular:

- decisions use exactly one action: `RENEW`, `SWITCH`, or `DECLINE`;
- every SSE event uses the canonical envelope with `event_id`, `run_id`, `decision_id`, `sequence`, `event_type`, and timestamp;
- `outcome_type` is nullable and, when present, is exactly `transaction_completed`, `decision_only`, or `action_avoided`;
- `execution_status` uses the exact canonical enums from `FINAL_WARDEN.md`, including `VALIDATED`, `NO_ACTION_REQUIRED`, `RECOMMENDED`, `AWAITING_APPROVAL`, `AUTHORIZED`, `EXECUTING`, `RECONCILING`, `UNKNOWN`, `COMPLETED`, `AVOIDED`, and the stopped/failure states;
- recurring savings and one-time avoided amounts are separate, and neither is added for `decision_only`;
- an `action_avoided` result must include evidence that the next charge was actually prevented.

Optionally create a shared fixture server or in-process fixture adapter from that contract before interface work starts. Fixtures may drive UI development, but must remain visibly separate from a verified Prava result; do not add a separate service if an in-process adapter is sufficient.

## Suggested ownership

| Area | Owner | Acceptance evidence |
|---|---|---|
| Dashboard, SSE client, and outcome presentation | Frontend contributor | Every outcome type has its canonical visual treatment and wording |
| SQLite, migrations, state machine, portfolio planner, validators, idempotency, and Prava calls | Backend contributor | Transactional state+ledger writes, startup recovery, duplicate-request tests, normalized failures, ambiguous-write reconciliation, signed-callback replay protection, and repeatable sandbox tests |
| Prava passkey rendering decision | Both | Recorded against current SDK documentation before UI work |
| Merchant/cancellation capability matrix | Both | Primary and backup paths verified; unsupported paths are `decision_only` |
| Authentication, ownership, event replay, and structured evidence contract | Both | Cross-user access is rejected; reconnect reproduces the same UI without duplicate effects |
| Correlation IDs, redacted logs, metrics, and operational alerts | Backend contributor | Stuck attempts, lock age, late callbacks, invalid evidence, ledger failures, and replay lag are observable |
| Demo, README, and disclosure | Both | Spoken claims match recorded outcome evidence |

## Integration order

1. Verify the primary merchant, backup merchant, passkey rendering, active-plan change capability, and trial-cancellation authority.
2. Run one real scoped-mandate payment through the backend before polishing the dashboard.
3. Lock the durable contract: IDs, state transitions, minor-unit money fields, idempotency, structured evidence, REST schemas, and replayable SSE envelope.
4. Point the dashboard at the backend and verify live delivery, `Last-Event-ID` replay, duplicate suppression, and a backend restart.
5. Rehearse the three outcomes honestly: one verified payment, a real-or-recommended plan change, and a prevented-or-recommended trial outcome.

## Non-negotiable review checks

- No frontend component may infer completion from a missing error; it must use `outcome_type` and evidence fields.
- No frontend component may treat replayed events as new effects; it deduplicates by `event_id`.
- No contributor may replace a verified OpenAI decision with a cached or canned rehearsal result while presenting it as live reasoning.
- No payment action is autonomous: a real payment requires the user's visible passkey approval.
- No failed, declined, expired, or stale execution may be relabeled as `decision_only`.
- No document, UI label, or spoken script may call an unsupported recommendation a completed payment or realized saving.
