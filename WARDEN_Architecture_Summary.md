# WARDEN — Architecture Summary

> **Status: supporting overview.** [FINAL_WARDEN.md](FINAL_WARDEN.md) is the single source of truth. This summary intentionally omits implementation detail and never overrides the final architecture.

## Product

WARDEN is an AI policy engine for recurring commitments. It interprets a user's plain-language policy, proposes one action per subscription, validates that decision in deterministic backend code, and either executes a supported, user-approved path or records a clearly labeled recommendation.

The core trust property is narrow authority: every real payment uses a single-use Prava mandate for one verified merchant and one exact amount. WARDEN evaluates and recommends automatically within a manually started MVP run; a real payment requires visible user passkey approval.

## MVP architecture

```text
Subscription fixtures + user policy
              ↓
OpenAI policy compiler + structured candidate decisions
              ↓
Atomic portfolio planner + deterministic validation
              ↓
State machine + idempotent verified execution or honest recommendation
              ↓
Structured evidence + SQLite ledger + replayable SSE + dashboard
```

Raw policy prose is compiled into a strict, user-confirmed rule document; unsupported clauses cannot become active. The model never directly executes a payment. Its candidate decisions are planned together against one active policy version and versioned portfolio snapshot, then validated against ownership, plan availability, monthly budget normalization, arithmetic, and merchant capability before WARDEN requests a mandate or displays a terminal outcome.

Each external action follows an explicit state machine from decision through validation, approval, authorization, execution, and an evidenced terminal result. User-scoped idempotency keys and unique provider references prevent retries, double-clicks, reconnects, or restarts from creating duplicate charges.

## Canonical action and outcome model

| Decision action | Meaning |
|---|---|
| `RENEW` | Continue on the current plan |
| `SWITCH` | Move to a different plan; annual conversion is always `SWITCH` |
| `DECLINE` | Prevent the next charge when WARDEN has verified authority, otherwise recommend prevention |

| Outcome | Claim WARDEN may make |
|---|---|
| `transaction_completed` | A verified checkout or plan-change result completed |
| `decision_only` | WARDEN recommends an action but did not execute it |
| `action_avoided` | The specific next charge was prevented and evidence was returned |

The dashboard separates evidenced recurring monthly savings from one-time charges avoided. A missing Prava call never proves that an external merchant trial was stopped, and evidence for one prevented charge does not prove recurring cancellation.

Validation failures, stale plans, failed executions, declines, and expiries are distinct from `decision_only`: they carry `outcome_type: null` and remain visible as stopped or failed work. Evidence is structured and verified against provider, merchant, amount, currency, status, timestamp, and unique reference.

## MVP scope

The hackathon build uses manually seeded subscriptions and one dashboard. Email, bank, CSV, connected-service discovery, browser automation, and broad financial governance are future directions, not implemented MVP capabilities.

The MVP uses authenticated APIs, integer minor-unit money values, SQLite persistence, an append-only ledger, and replayable per-run SSE. Runs are manually triggered; continuous scheduling is future work.

The demo shows:

1. an annual-plan `SWITCH` with a verified payment path;
2. a budget-pressure `SWITCH` that is either completed or visibly recommended;
3. a trial `DECLINE` that is only called avoided after cancellation or prevention evidence exists.

For the canonical money example, $20/month changing to $165/year saves $75/year, or $6.25/month, and charges $165 now. Monthly policy checks use the $13.75 effective monthly cost, not the annual cash charge.

## Long-term direction

Later versions may add discovery integrations, richer usage data, additional merchant capability adapters, and organization-level SaaS controls. Those additions must preserve the same trust boundary: narrowly scoped authority, explicit evidence, deterministic guardrails, and truthful user-facing outcomes.
