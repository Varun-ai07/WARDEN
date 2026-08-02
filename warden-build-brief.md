# WARDEN — Build Brief

> **Status: supporting execution checklist.** [FINAL_WARDEN.md](FINAL_WARDEN.md) is the single source of truth. Follow its action semantics, accounting, API/SSE contract, and outcome rules over any wording in this brief.

## Mission

Build a focused WARDEN MVP that proves a trustworthy recurring-payment policy loop:

```text
discover → structured decision → deterministic validation → user-authorized execution or honest recommendation → evidence ledger
```

The goal is not to make every subscription action executable. The goal is to show one verified scoped payment and to represent every unsupported path without overstating what happened.

## Scope

Build:

- a single dashboard with seeded subscriptions and an editable policy;
- the canonical OpenAI policy compiler, user-confirmed active rule document, decision tool, and deterministic validator;
- an atomic portfolio planner over a versioned snapshot;
- a backend-owned Prava SDK/API integration;
- SQLite persistence, transactional append-only ledger events, startup recovery, an execution state machine, idempotency, structured evidence, and replayable SSE;
- one verified payment flow, plus recommendation and prevention paths as capabilities allow.

Do not build inbox/bank discovery, mobile apps, broad browser automation, or unverified merchant adapters.

## Required gates

Before implementation, verify and write down:

1. a primary and backup merchant/sandbox path;
2. a complete session → mandate → visible passkey → checkout flow;
3. whether the passkey is client-side or server-side;
4. whether the selected active plan can be changed;
5. how the selected trial's next charge can be cancelled, revoked, or otherwise prevented.

If a capability cannot be verified, preserve the product value as `decision_only`. Never hardcode a success response, replace an unverified sandbox flow with real money without explicit approval, or narrate a recommendation as an execution.

## Implementation rules

- Use exactly one decision action per subscription: `RENEW`, `SWITCH`, or `DECLINE`.
- Annual billing is `SWITCH`, not `RENEW+SWITCH`.
- A $20/month plan changing to $165/year saves $75/year or $6.25/month; charge authorization remains $165 now.
- Store money as integer minor units with one explicit currency; never use floating-point values for financial calculations.
- The model's function call is a proposal, not an authorization. Backend code validates all calculations, plans, policy constraints, and capabilities.
- Compile raw policy prose into supported strict rules, show the interpretation, and require user activation; unsupported clauses never execute.
- Plan all candidate decisions together against one policy version and immutable portfolio snapshot; reject stale runs.
- Require `run_id`, `decision_id`, event sequence, and idempotency keys throughout the flow. Create `execution_attempt_id` only when external execution begins; `decision_only` and `NO_ACTION_REQUIRED` create no attempt.
- Keep execution state separate from business outcome. Validation failures, stale plans, declined approvals, expiries, and failed attempts have `outcome_type: null`.
- A payment requires a visible user passkey. No stored or blanket payment permission is permitted.
- `transaction_completed` needs verified structured checkout evidence; `action_avoided` needs verified prevention evidence; `decision_only` has no attempt and no savings-counter contribution.
- Authenticate every API and stream, enforce ownership server-side, and keep secrets and untrusted merchant text outside the model instruction boundary.
- Do not cache or conceal rehearsal decisions while presenting them as live model reasoning.

## Practical order

| Phase | Deliverable |
|---|---|
| Verify | Capability matrix and real payment test evidence |
| Foundation | SQLite schema, transactional append-only ledger, startup recovery, state machine, idempotency, fixtures, authenticated REST, and replayable SSE |
| Reasoning | Strict policy compiler, user-confirmed rule version, decision tool, portfolio planner, and deterministic validator |
| Outcomes | Provider adapter, safe retries, payment, fallback recommendation, evidenced prevention, and failure handling |
| Experience | Dashboard, passkey state, ledger, recurring-monthly savings, and one-time avoided-charge totals |
| Proof | State/idempotency/security/contract tests, correlation IDs, redacted logs, operational metrics/alerts, human-run rehearsal, backup video, honest README and pitch |

## Demo guardrail

The demo may say “completed” only after returned execution evidence. It may say “avoided” only after the next charge is demonstrably prevented. Otherwise it says “recommended.”
