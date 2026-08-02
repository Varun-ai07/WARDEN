# WARDEN — Final Architecture

**An AI policy engine for recurring payments**

## Document authority

`FINAL_WARDEN.md` is WARDEN's **single source of truth** for the hackathon MVP. It defines the product contract, decision semantics, data model, API/SSE contract, accounting rules, and permitted demo claims.

The other WARDEN markdown files are supporting documents only. They may add delivery, risk, integrity, or strategy guidance, but they must not override this file. If a supporting document conflicts with this one, this file wins.

## Implementation status

The repository contains a working implementation, not only design documentation. The backend implements the fake and Prava provider adapters, authenticated REST, replayable SSE, SQLite persistence, and the canonical state machine. The frontend implements policy editing, approval review, evidence inspection, and live run updates.

Live Prava behavior still depends on valid sandbox credentials and a reachable embedded collection/polling surface. Reasoning behavior may use OpenAI directly or OpenRouter's Responses API; when using `openrouter/free`, strict function-calling behavior is endpoint-dependent until validated against the live provider.

---

## 1. Vision

WARDEN evaluates a snapshot of recurring commitments against a user-authored policy and either executes a supported, user-approved action or records an honestly labeled recommendation.

**Canonical loop:** discover → decide → validate → authorize or prevent → record evidence.

**Product insight:** WARDEN never receives blanket card authority. Each real payment receives a single-use Prava mandate limited to one verified merchant and one exact authorized amount. Policy evaluation and recommendation can be automated; every real payment remains user-authorized through a visible passkey approval. The hackathon MVP starts runs manually.

---

## 2. System architecture

```text
Authenticated user + versioned policy + portfolio snapshot
                         │
                         ▼
               OpenAI policy reasoner
                         │ candidate decisions only
                         ▼
          deterministic portfolio planner + validator
                         │ valid, ordered action plan
                         ▼
             execution state machine + idempotency
                  ┌──────┴─────────┐
                  ▼                ▼
       verified provider path   honest recommendation
                  │
                  ▼
       scoped approval + execution attempt
                  │
                  ▼
       structured evidence + append-only ledger
                  │
                  ▼
        authenticated REST + replayable SSE
```

The model interprets policy and proposes structured candidate decisions. It does **not** directly execute a payment or determine the final portfolio plan. The backend validates the candidates against one immutable portfolio snapshot, calculates an ordered plan, executes only verified merchant paths, and records structured evidence for every displayed outcome.

SQLite is the MVP system of record. SSE is a projection of persisted ledger events, never the source of truth.

---

## 3. Canonical product rules

### 3.1 Actions

Every subscription receives exactly one action:

| Action | Meaning | Example |
|---|---|---|
| `RENEW` | Continue on the current plan | Keep Notion at $10/month |
| `SWITCH` | Change to a different plan | Move a monthly plan to annual or basic |
| `DECLINE` | Prevent the next charge or recommend prevention | Cancel an unused trial |

An annual conversion is always `SWITCH` with `target_plan: "annual"`; it is never `RENEW+SWITCH`.

`RENEW` may require a new scoped payment when the current plan is due and no valid authorization exists. If the current plan is already continuing and no external effect is needed, it terminates as `NO_ACTION_REQUIRED / decision_only` and the UI says “Keep current plan”; it does not fabricate a transaction.

### 3.2 Money and budget accounting

WARDEN keeps two values separate:

- **Authorized amount:** the exact amount a mandate and checkout may charge now.
- **Effective monthly cost:** the normalized recurring cost used for a monthly policy cap.

The canonical fixture uses an AI service at **$20/month** with an annual alternative of **$165/year**:

| Measure | Value |
|---|---:|
| Annualized monthly plan | $240.00/year |
| Annual authorized charge | $165.00 now |
| Annual saving | $75.00/year |
| Monthly-equivalent saving | $6.25/month |
| Percentage saving | 31.25% |

The dashboard separates **verified recurring monthly savings** from **one-time charges avoided**. It never converts a single prevented charge into an indefinite monthly saving or presents an upfront annual saving as though it were this month's cash saving.

Internally, all monetary values use integer minor units plus an ISO currency code. For example, `$165.00` is stored as `16500` with `currency: "USD"`. Decimal display values in this document are explanatory only. The MVP supports one configured currency per portfolio and performs no foreign-exchange conversion.

Normalization retains the exact period total and divisor. For policy enforcement, a non-even periodic amount is converted conservatively with integer ceiling division so cost is never understated. Human-facing monthly estimates use round-half-up to the currency's minor unit and always display the exact period charge alongside them. Savings are calculated from exact period totals before display rounding; rounding differences never enter the mandate amount.

### 3.3 Demo fixtures

Fixtures demonstrate the policy engine; they are not claims that a named production merchant is supported. Before a live demo, every merchant label, plan, amount, and capability must be mapped to a verified sandbox or merchant path.

| id | merchant label | current cost | usage | canonical action | expected monthly effect |
|---|---|---:|---|---|---:|
| `sub_ai_service` | Sample AI service | $20.00/month | used yesterday | `SWITCH` to $165/year | save $6.25/month |
| `sub_gym` | Sample gym service | $25.00/month | unused 42 days | `SWITCH` to basic $10/month, or recommend it | save $15.00/month if completed |
| `sub_free_trial` | Sample SaaS trial | $12.00/month at conversion | never opened | `DECLINE` | avoid $12.00/month only with prevention evidence |
| `sub_notion` | Notion | $10.00/month | used two days ago | `RENEW` | $0.00/month |

The initial effective monthly portfolio cost is **$67.00**. Switching the AI service leaves $60.75/month, so a supported gym-plan switch brings it to $45.75/month. Preventing the trial conversion reduces it further to $33.75/month.

### 3.4 Runtime state and terminal claims

Business outcomes and execution state are separate fields. `outcome_type` describes a proven business result; `execution_status` describes where an execution attempt is or why it stopped.

```text
DISCOVERED
  → DECIDED
      ├─ invalid candidate   → VALIDATION_FAILED
      ├─ stale snapshot      → STALE
      └─ valid candidate     → VALIDATED
      ├─ no external effect     → NO_ACTION_REQUIRED
      ├─ unsupported/unverified → RECOMMENDED
      └─ external effect needed → AWAITING_APPROVAL
            ├─ user rejects      → APPROVAL_DECLINED
            ├─ approval expires  → EXPIRED
            └─ approved          → AUTHORIZED
                                      → EXECUTING
                                          ├─ COMPLETED
                                          ├─ AVOIDED
                                          ├─ confirmed failure → FAILED
                                          └─ ambiguous result  → RECONCILING
                                                ├─ confirmed success → COMPLETED | AVOIDED
                                                ├─ confirmed failure → FAILED
                                                └─ still unknown     → UNKNOWN
```

Permitted terminal mappings:

| `execution_status` | `outcome_type` | Meaning |
|---|---|---|
| `COMPLETED` | `transaction_completed` | Provider evidence confirms the requested transaction or plan change |
| `AVOIDED` | `action_avoided` | Provider evidence confirms the next charge was prevented |
| `RECOMMENDED` | `decision_only` | No external action was attempted |
| `NO_ACTION_REQUIRED` | `decision_only` | The policy chose to keep the current state and no external effect was needed |
| `VALIDATION_FAILED`, `STALE`, `APPROVAL_DECLINED`, `EXPIRED`, `FAILED`, `UNKNOWN` | `null` | An action did not complete or remains uncertain; show the stopped/failed/unknown state, not a recommendation or saving |

Transitions are append-only and validated in backend code. A state cannot be skipped, reversed, or rewritten. `UNKNOWN` is quarantined: it may accept a late provider confirmation into `COMPLETED`, `AVOIDED`, or `FAILED`, but no retry, compensation, or new attempt may start while the external effect remains unresolved.

A new attempt creates a new `execution_attempt_id` and is allowed only after the prior attempt is terminal and unambiguous. It requires a fresh approval whenever the prior approval expired, the merchant/amount/currency changed, or the provider cannot prove the old approval remains valid.

Run status aggregates decision states:

```text
CREATED → PLANNING → READY → EXECUTING
  → COMPLETED | PARTIALLY_COMPLETED | FAILED | CANCELLED | STALE
```

`COMPLETED` means every decision reached an allowed terminal state; it does not imply every candidate action moved money. `PARTIALLY_COMPLETED` means at least one external action succeeded and at least one attempted action failed or expired. A run containing `UNKNOWN` remains nonterminal and blocks new execution for that portfolio until reconciled or explicitly escalated.

---

## 4. Core modules

### 4.1 Subscription discovery

For the MVP, subscriptions are manually seeded. Email, bank, CSV, and connected-service discovery are future product directions, not hackathon requirements.

Each subscription records its current plan, normalized cost, alternative plans, next charge, usage signals, and execution capability.

Runs are manually triggered through the authenticated API for the hackathon. A production scheduler, notification service, and time-zone-aware renewal scanner are future work; the MVP must not claim continuous background monitoring.

### 4.2 Usage intelligence

The deterministic health score uses:

- recency of use;
- frequency within a billing cycle;
- cost efficiency;
- explicit user priority.

Model confidence is recorded separately with a decision; it is not an input to the health score.

For the MVP, each input is normalized to `0..100` and the score is fixed as `40% recency + 25% frequency + 20% cost efficiency + 15% explicit priority`. Missing usage data produces an `insufficient_data` flag and a conservative score; it is never silently inferred by the model.

### 4.3 Policy compiler and OpenAI decision reasoner

Raw policy text is never executed directly. On policy update, OpenAI first compiles the text into a strict, versioned policy document using only MVP-supported rule types:

```json
{
  "currency": "USD",
  "rules": [
    { "rule_id": "monthly_cap", "type": "MONTHLY_CAP", "amount_minor": 6000 },
    { "rule_id": "unused_30d", "type": "MAX_INACTIVE_DAYS", "days": 30 },
    { "rule_id": "annual_15pct", "type": "MIN_ANNUAL_SAVINGS_BPS", "basis_points": 1500 }
  ],
  "unsupported_clauses": []
}
```

Backend code validates rule types, units, ranges, currency, duplicate/conflicting rules, and arithmetic. The UI shows the normalized interpretation and any unsupported clauses. A policy version becomes `ACTIVE` only after explicit user confirmation; otherwise it remains `DRAFT` and cannot start an execution run. Active policy versions are immutable.

The policy reasoner uses an OpenAI-compatible function tool to produce one structured decision per subscription. The function is a decision interface, not a payment tool.

The implementation uses a strict schema, disables parallel calls for this per-subscription decision, and validates the returned object before any action. When using OpenAI directly, it follows the Responses API function-calling contract. When using OpenRouter, it uses the Responses API path through `https://openrouter.ai/api/v1/responses` and treats tool-calling support as endpoint-specific.

```json
{
  "type": "function",
  "name": "decide_subscription_action",
  "description": "Return one policy decision for the supplied subscription. Do not execute a payment or claim that execution succeeded.",
  "strict": true,
  "parameters": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "subscription_id": { "type": "string" },
      "action": { "type": "string", "enum": ["RENEW", "SWITCH", "DECLINE"] },
      "target_plan": { "type": ["string", "null"] },
      "policy_rule_reference": { "type": "string" },
      "reasoning": { "type": "string" }
    },
    "required": [
      "subscription_id",
      "action",
      "target_plan",
      "policy_rule_reference",
      "reasoning"
    ]
  }
}
```

The system instruction requires the reasoning to cite the exact policy rule and data point. It also says:

```text
Return exactly one action for the supplied subscription.
Use SWITCH when the plan changes; use RENEW only when it does not.
Do not claim that a payment, cancellation, or saving has completed.
Do not calculate financial totals; backend code calculates and validates all monetary effects.
```

`policy_rule_reference` must match a `rule_id` in the active compiled policy. The decision reasoner receives raw prose for explainability and the compiled rules for grounding; deterministic planning and enforcement use only the validated compiled rules.

### 4.4 Atomic portfolio planner

Budget policy is portfolio-wide, so WARDEN never executes independently generated subscription decisions in arbitrary order.

For each run, the backend:

1. starts a SQLite `BEGIN IMMEDIATE` transaction, acquires a database-enforced portfolio lock with a fencing token, creates an immutable portfolio snapshot, records the exact policy version, and persists the initial run;
2. asks the model for candidate decisions against that snapshot;
3. recalculates every cost and saving deterministically;
4. persists a dependency-aware, ordered action plan that satisfies the policy;
5. records the projected portfolio version after each planned action;
6. rechecks the portfolio version immediately before every external effect.

Only one active execution run may hold the portfolio execution lock, enforced by a unique database constraint plus fencing token. State mutation and its ledger append commit in the same SQLite transaction. After each evidenced effect, WARDEN atomically advances the subscription/portfolio version and verifies it matches the plan's expected next version.

If a prerequisite action is declined, expires, fails, becomes unknown, or changes differently from the projected result, all dependent actions stop before external execution and the run becomes `STALE` or `PARTIALLY_COMPLETED`. WARDEN does not silently reorder or continue with stale budget assumptions; a new run must replan from a fresh snapshot. Independent recommendation-only decisions may still be displayed from the original run.

### 4.5 Deterministic decision validator

After the model response and before any execution, backend code validates:

- one and only one decision for the requested subscription;
- authenticated ownership of the subscription and referenced portfolio;
- the run's policy version and portfolio snapshot version are still current;
- the policy is `ACTIVE`, its compiled rule document validates, and every cited rule ID exists;
- `SWITCH` has a valid, available `target_plan`; other actions have `target_plan: null`;
- integer-minor-unit arithmetic, currency equality, rounding, monthly normalization, and savings;
- policy cap against effective monthly cost, not an annual cash outflow;
- merchant, plan, currency, and exact authorized amount;
- capability evidence for the requested operation;
- outcome evidence before any completed or avoided claim is displayed.

If structural, ownership, arithmetic, policy, or snapshot validation fails, WARDEN records `VALIDATION_FAILED` or `STALE` with `outcome_type: null`. If the candidate is valid but its execution capability is unsupported or unverified, WARDEN records `RECOMMENDED / decision_only`. It never improvises a transaction.

### 4.6 Merchant capability analyzer

The analyzer is configuration backed. It never assumes a production merchant or sandbox path works merely because it appears in fixtures.

| Capability | Permitted result |
|---|---|
| Verified Prava checkout | `transaction_completed` after checkout confirmation |
| Verified official merchant API cancellation/change | `action_avoided` or `transaction_completed` with returned evidence |
| Verified Prava-managed future mandate cancellation | `action_avoided` with prevention evidence |
| Unsupported or unverified path | `decision_only` |
| Guided manual instructions | `decision_only` |

Browser automation is out of scope for the MVP unless separately verified for the chosen merchant and explicitly approved as an execution path.

### 4.7 Execution orchestrator and idempotency

Every side-effecting request is associated with `user_id`, `run_id`, `decision_id`, `execution_attempt_id`, and an `idempotency_key`.

- `POST /api/v1/runs` requires an idempotency key unique per user.
- Provider requests use a stable provider idempotency key derived from the execution attempt.
- Provider transaction references are unique in the local database.
- A retry first queries the provider when the previous result is ambiguous; WARDEN never blindly repeats a charge.
- Safe reads may retry with bounded exponential backoff. Approval, checkout, cancellation, and plan-change writes retry only when the adapter proves the operation is idempotent.
- Double-clicks, network reconnects, worker restarts, and repeated SSE delivery cannot create a second execution attempt unless the user explicitly starts one.
- `POST /api/v1/decisions/{decision_id}/attempts` rejects creation while another attempt is active, `RECONCILING`, or `UNKNOWN`; it also enforces the fresh-approval rules in §3.4.

If a provider write has a confirmed failure after authorization, the orchestrator records `FAILED` with a normalized failure code and preserves the provider response. If delivery may have occurred, it records `RECONCILING` with `reconciliation_deadline_at` and polls or accepts a signed callback. An inconclusive deadline becomes `UNKNOWN`, raises an operator alert, and keeps the portfolio fenced from new execution. A late, verified callback may resolve `UNKNOWN` to `COMPLETED`, `AVOIDED`, or `FAILED` through a new ledger transition. It does not convert any attempted action to `decision_only`. Compensation, if supported, is a separate approved and evidenced action.

### 4.8 Explainability and structured evidence ledger

Every decision records policy reasoning, health score, normalized budget effect, capability selected, execution state, and evidence. The UI evaluates `execution_status` first: pending, stopped, failed, stale, reconciling, and unknown states take precedence. It displays a business outcome only when the status-to-outcome mapping is valid and the required evidence verifies successfully.

| Outcome type | Required evidence | UI treatment | Counter eligibility |
|---|---|---|---|
| `transaction_completed` | Confirmed checkout plus merchant entitlement/plan-change evidence when a plan change is claimed | Green completion state; exact authorized amount; provider badge | Recurring saving only when the new plan/entitlement is confirmed |
| `decision_only` | No execution evidence | Amber “Recommended” for `RECOMMENDED`; neutral “No action required” for `NO_ACTION_REQUIRED` | Never |
| `action_avoided` | Cancellation, revocation, or verified prevention reference | “Avoided next charge” state | One-time avoided amount; recurring saving only if evidence confirms recurring cancellation |

**Hard rule:** a missing mandate request does not prove a trial was prevented. `action_avoided` requires evidence that the next charge cannot occur through the relevant payment or merchant path. Evidence that proves only one prevented charge populates `one_time_avoided_minor`; `recurring_monthly_savings_minor` remains zero unless the provider confirms that the recurring obligation was cancelled or never activated.

Evidence is a verified object, not an opaque string:

```json
{
  "evidence_id": "ev_...",
  "provider": "prava",
  "evidence_type": "plan_activation_confirmation",
  "provider_reference": "provider_ref_...",
  "merchant_id": "merchant_...",
  "authorized_amount_minor": 16500,
  "currency": "USD",
  "provider_status": "confirmed",
  "recurrence_stopped": false,
  "occurred_at": "2026-08-01T18:03:00Z",
  "verified_at": "2026-08-01T18:03:02Z",
  "payload_hash": "sha256:..."
}
```

The backend verifies merchant, amount, currency, provider status, entitlement/plan state, recurrence status, and reference uniqueness before attaching evidence to an outcome. Payment confirmation alone proves payment, not activation of a promised annual or cheaper plan. A plan switch therefore requires an evidence set containing both `checkout_confirmation` and `plan_activation_confirmation` records, potentially from different provider adapters. Raw provider payloads are encrypted at rest or reduced to a hash plus the minimum fields needed for audit.

### 4.9 Persistence and audit model

SQLite is required for the MVP; in-memory state is not sufficient for payment execution. The minimum tables are:

```text
users
policies + policy_versions
subscriptions + plans
portfolio_snapshots
runs
decisions
execution_attempts
execution_evidence
ledger_events
idempotency_keys
```

Ledger events are append-only and carry `event_id`, `correlation_id`, `run_id`, `decision_id`, `sequence`, `event_type`, `occurred_at`, `previous_event_hash`, a durable JSON payload, and a payload hash. State mutation and its ledger event append in the same database transaction. A unique `(run_id, sequence)` constraint enforces ordering. Corrections are new events; existing financial events are never edited or deleted. The per-run hash chain makes accidental mutation detectable.

### 4.10 Security and privacy boundary

- Every user-facing API route and SSE stream is authenticated. `user_id` comes from the authenticated server session, never request JSON.
- The MVP uses a same-origin server session in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie for its synthetic demo user; it exposes no unauthenticated execution route.
- Authorization checks bind users to policies, subscriptions, runs, decisions, and evidence.
- Passkey approval is cryptographically bound to the user, `decision_id`, merchant, amount, currency, and expiry.
- Every external mutation requires explicit user confirmation. Payment confirmation uses the Prava passkey flow; non-payment cancellation or plan-change confirmation uses a signed, expiring approval bound to the same decision.
- Merchant descriptions, plan metadata, and usage text are treated as untrusted data, separated from model instructions, length-limited, and never allowed to introduce tools or override policy.
- Model-generated reasoning is also untrusted display text. The UI escapes it as plain text, strips control characters, enforces length limits, and never treats it as HTML, Markdown, executable content, evidence, or instructions for a later model call.
- The model receives no Prava credentials, payment tokens, raw provider payloads, or unnecessary personal data.
- Secrets remain server-side, are loaded from environment/secret storage, and are redacted from logs.
- Cookie sessions require CSRF protection; all deployments use restrictive CORS, TLS, request-size limits, and per-user rate limits.
- Usage and evidence records follow data-minimization and explicit retention rules. The MVP uses synthetic demo data only.
- Provider callback routes are the only session-auth exception. They are service-authenticated using provider signatures, timestamp tolerance, and replay protection, and resolve `user_id`, `run_id`, and `execution_attempt_id` from a server-side provider-reference mapping rather than trusting callback-supplied ownership fields.

### 4.11 MVP deployment profile

To keep these guarantees feasible in 48 hours, the MVP runs as one backend process with one SQLite database, one configured currency, synthetic data, and at most one active execution run per portfolio. A separate queue, distributed lock service, multi-region failover, external identity provider, production scheduler, and multi-currency conversion are explicitly out of scope. Their interfaces are represented by the run, adapter, lock/fencing, and authenticated-session boundaries so they can replace the MVP implementations later without changing product semantics.

---

## 5. Execution flows

### Act 1 — annual-plan switch

```text
AI service due for renewal
  → capture policy version + portfolio snapshot
  → policy + budget check
  → select annual plan: $165.00 now / $13.75 effective monthly
  → VALIDATED with a unique decision and execution attempt
  → AWAITING_APPROVAL → AUTHORIZED
  → idempotent Prava session → single-use mandate → visible passkey → checkout
  → verify checkout and annual-plan activation evidence → COMPLETED / transaction_completed
  → record $6.25 monthly and $75 annual saving separately
```

### Act 2 — budget-pressure plan switch

```text
Portfolio remains above monthly cap
  → portfolio planner identifies a valid ordered action set
  → validate SWITCH decision, target plan, snapshot version, and projected portfolio
  → if active-plan modification is verified:
       user passkey → idempotent execution → evidence → COMPLETED
  → otherwise:
       RECOMMENDED / decision_only → “Recommended: switch to basic — potential $15/month saving”
```

### Act 3 — prevent a trial conversion

```text
Trial conversion is imminent and usage is absent
  → validate DECLINE decision
  → verify that WARDEN can cancel/revoke/prevent the specific next charge
  → if prevention succeeds and returns evidence:
       AVOIDED / action_avoided → “Avoided the next $12 charge”
       count recurring savings only if evidence confirms the recurring conversion was cancelled
  → otherwise:
       RECOMMENDED / decision_only → “Recommended: cancel before conversion”
```

The demo's minimum honest shape is **one verified payment plus two clearly represented outcomes**. Act 2 and Act 3 may be `decision_only` if their execution capabilities are not verified.

---

## 6. Canonical data model

### Subscription

```json
{
  "id": "sub_ai_service",
  "user_id": "user_demo",
  "merchant_id": "merchant_ai_service",
  "plan_id": "monthly",
  "current_monthly_cost_minor": 2000,
  "currency": "USD",
  "billing_cycle": "monthly",
  "next_charge_at": "2026-08-02T18:00:00Z",
  "last_used_days_ago": 1,
  "health_score": 85,
  "version": 4,
  "alt_plans": [
    {
      "plan_id": "annual",
      "authorized_amount_minor": 16500,
      "effective_monthly_cost_minor": 1375,
      "currency": "USD"
    }
  ],
  "capability_version": "cap_7"
}
```

### Policy

```json
{
  "policy_id": "policy_demo",
  "user_id": "user_demo",
  "version": 3,
  "status": "ACTIVE",
  "policy_text": "Never let total subscriptions exceed $60/month. Cancel or downgrade anything unused 30+ days. Always take annual billing if it saves more than 15%.",
  "compiled_rules": {
    "currency": "USD",
    "rules": [
      { "rule_id": "monthly_cap", "type": "MONTHLY_CAP", "amount_minor": 6000 },
      { "rule_id": "unused_30d", "type": "MAX_INACTIVE_DAYS", "days": 30 },
      { "rule_id": "annual_15pct", "type": "MIN_ANNUAL_SAVINGS_BPS", "basis_points": 1500 }
    ],
    "unsupported_clauses": []
  }
}
```

### Run and decision

```json
{
  "run_id": "run_...",
  "user_id": "user_demo",
  "idempotency_key": "run:user_demo:2026-08-01T18:00Z",
  "policy_version": 3,
  "portfolio_snapshot_id": "snapshot_...",
  "run_status": "EXECUTING",
  "decision_id": "decision_...",
  "subscription_id": "sub_ai_service",
  "action": "SWITCH",
  "target_plan_id": "annual",
  "reasoning": "The annual plan costs $165 now, or $13.75/month, versus $20/month. It saves $75/year (31.25%), exceeding the 15% policy threshold.",
  "execution_status": "AWAITING_APPROVAL",
  "outcome_type": null,
  "authorized_amount_minor": 16500,
  "effective_monthly_cost_minor": 1375,
  "recurring_monthly_savings_minor": 625,
  "one_time_avoided_minor": 0,
  "annual_savings_minor": 7500,
  "currency": "USD"
}
```

### Execution attempt

```json
{
  "execution_attempt_id": "attempt_...",
  "decision_id": "decision_...",
  "provider": "prava",
  "provider_idempotency_key": "attempt_...",
  "execution_status": "EXECUTING",
  "approval_expires_at": "2026-08-01T18:08:00Z",
  "failure_code": null,
  "evidence_id": null
}
```

For `action_avoided`, the linked evidence is a cancellation, revocation, or prevention confirmation. For `decision_only`, no execution attempt or evidence is created. Failed attempts retain their failure code and provider response metadata but have `outcome_type: null`.

### Ledger event envelope

```json
{
  "event_id": "evt_...",
  "correlation_id": "corr_...",
  "run_id": "run_...",
  "decision_id": "decision_...",
  "sequence": 12,
  "event_type": "execution_state_changed",
  "occurred_at": "2026-08-01T18:03:00Z",
  "payload": { "from": "AUTHORIZED", "to": "EXECUTING" },
  "previous_event_hash": "sha256:...",
  "payload_hash": "sha256:..."
}
```

---

## 7. Internal API and SSE contract

All endpoints are authenticated and scoped to the current user. Side-effecting endpoints reject missing authorization, stale versions, and missing idempotency keys.

### REST v1

```text
GET  /api/v1/subscriptions
GET  /api/v1/policies/current
PUT  /api/v1/policies/current         + If-Match: <policy-version>
  → stores DRAFT text and returns validated compiled rules + unsupported clauses
POST /api/v1/policies/{policy_id}/activate + Idempotency-Key
  → explicit user confirmation creates the immutable ACTIVE version

POST /api/v1/runs                     + Idempotency-Key
  body: { policy_version, expected_portfolio_version }
  → 202 { run_id, run_status: "CREATED" }

GET  /api/v1/runs/{run_id}
GET  /api/v1/runs/{run_id}/events
GET  /api/v1/runs/{run_id}/stream

POST /api/v1/decisions/{decision_id}/approval-session + Idempotency-Key
POST /api/v1/decisions/{decision_id}/attempts         + Idempotency-Key
POST /api/v1/decisions/{decision_id}/cancel            + Idempotency-Key

POST /api/v1/provider-callbacks/{provider}
  → service-authenticated callback; no user-session cookie required

GET  /api/v1/savings
  → { currency, recurring_monthly_saved_minor, one_time_avoided_minor }
```

Version conflicts return `409`; duplicate idempotency keys return the original resource; invalid transitions return `422`. Approval endpoints return only provider-safe client data, never secrets or raw payment credentials.

### Replayable SSE — `GET /api/v1/runs/{run_id}/stream`

```text
id: evt_...
event: run_event
data: {
  event_id, run_id, decision_id, sequence, event_type, occurred_at, payload
}
```

Canonical `event_type` values include `run_started`, `decision_recorded`, `execution_state_changed`, `approval_required`, `approval_resolved`, `outcome_recorded`, `execution_failed`, and `run_completed`.

The server assigns a strictly increasing sequence per run, supports `Last-Event-ID` replay from the ledger, emits heartbeat comments, and authorizes stream ownership before sending data. The database cursor is authoritative: after replaying through a captured high-water sequence, the server registers its wake-up subscription and immediately re-queries for sequences above the cursor before waiting. Notifications only wake the query loop, so the replay-to-live handoff cannot lose an event. Replayed or duplicate events are safe because clients key by `event_id`.

MVP ledger events are retained for the full demo lifecycle and remain queryable through the REST events endpoint after SSE reconnect. Production retention and archival are policy-controlled. The frontend never infers success from event order or the absence of an error.

---

## 8. Prava integration

**Integration path:** the Prava SDK/API sandbox path, implemented with embedded session creation, secure iframe collection, payment-result polling, and report-status confirmation.

### Required verification gate

Before a live demo, verify these five facts against current Prava documentation, credentials, and sandbox tests:

1. Primary and backup merchant paths are reachable.
2. The exact session → secure collection → passkey approval → payment-result flow works for one payment.
3. Whether the secure surface is rendered through the embedded SDK or a hosted redirect.
4. Whether an active plan can be changed through the selected path.
5. How the selected trial's next charge can actually be cancelled, revoked, or prevented.

### Trust boundary

- The backend holds Prava credentials; the frontend never receives raw payment credentials.
- Each real payment uses a merchant- and amount-scoped mandate.
- The user visibly approves each real payment with a passkey.
- A trial prevention is only displayed as completed after returned prevention evidence.

### Provider adapter and failure handling

All Prava or merchant operations sit behind an adapter that normalizes `create_approval`, `get_status`, `execute`, `cancel_or_prevent`, `get_entitlement`, and `verify_evidence`. The adapter records request IDs and maps provider responses to stable internal failure codes such as `APPROVAL_DECLINED`, `APPROVAL_EXPIRED`, `PROVIDER_TIMEOUT`, `PROVIDER_REJECTED`, `CAPABILITY_UNAVAILABLE`, and `EVIDENCE_INVALID`.

When a write request times out after it may have reached the provider, WARDEN queries provider status with the same idempotency key before any retry. Signed provider callbacks, when used, require signature verification, timestamp tolerance, and replay protection before they can advance the state machine.

---

## 9. Dashboard

The MVP is one page with:

| Component | Required behavior |
|---|---|
| Subscription list | Shows current monthly cost, next charge, usage, health, and available plans |
| Policy editor | Edits plain-language policy text |
| Activity ledger | Streams reasoning and visually distinguishes all three outcome types |
| Verified savings | Separately shows recurring monthly savings and one-time charges avoided |
| Payment approval | Shows the real Prava passkey state only for pending payment actions |
| Run status and failures | Shows pending, reconciling, unknown, declined, expired, failed, stale, no-action, and completed states without converting failures into recommendations |

Decision cards show the action, target plan, policy-specific reasoning, current and normalized cost, and the correct evidence state. `RECOMMENDED / decision_only` says **Recommended**; `NO_ACTION_REQUIRED / decision_only` says **No action required**. Neither exposes a fake approval or completion control.

---

## 10. Build order

| Hours | Phase | Required checkpoint |
|---|---|---|
| H0–H4 | Verify the five Prava facts and freeze the contract | Human reads the written answers |
| H4–H8 | Build one end-to-end payment loop | Human triggers and observes the real passkey and confirmation |
| H8–H16 | Add SQLite schema, state machine, idempotency, authenticated REST, ledger, and replayable SSE | State, duplicate-request, recovery, arithmetic, and contract tests pass |
| H16–H20 | Add LLM candidates, atomic portfolio planner, and deterministic validator | Actual reasoning cites correct numbers; stale snapshots are rejected |
| H20–H30 | Implement provider adapter, approval, evidence verification, reconciliation, and three outcome flows | Each UI state matches state and evidence; ambiguous writes are reconciled |
| H30–H38 | Build and connect the dashboard | Full click-through and SSE reconnect are reviewed |
| H38–H44 | Run failure/security tests and rehearse the honest demo | No unsupported action is narrated as complete |
| H44–H48 | Backup video, README, disclosure, and pitch | Live rules and submission requirements are rechecked |

---

## 11. Verification and observability

Minimum automated verification:

- unit and property tests for minor-unit arithmetic, normalization, rounding, and portfolio-cap invariants;
- state-transition tests proving invalid skips and reversals are rejected;
- idempotency tests for duplicate run creation, duplicate approval, timeout reconciliation, and worker restart;
- authorization tests for cross-user subscriptions, runs, streams, and evidence;
- contract tests for REST schemas, SSE event envelopes, replay, sequence ordering, and reconnects;
- provider-adapter tests for decline, expiry, timeout, duplicate callback, invalid signature, ambiguous result, and unsupported capability;
- adversarial model tests for malformed arguments, merchant-text prompt injection, unavailable plans, and fabricated evidence;
- policy-compiler tests for unsupported clauses, conflicts, invalid units/ranges, duplicate rules, stale activation, and rule-reference mismatches;
- deterministic fake-adapter end-to-end tests for one completed payment, one recommendation, one prevented charge, one approval decline, one ambiguous write, and one provider failure;
- live sandbox end-to-end tests only for capabilities verified by the current provider. If live prevention is unavailable, the live test must expect `RECOMMENDED / decision_only` while the fake adapter tests the prevention state machine.

Every request and ledger event carries a correlation ID. Structured logs redact secrets and include `run_id`, `decision_id`, `execution_attempt_id`, provider request ID, state transition, and failure code. MVP metrics track run completion, approval decline, provider failure, stale-plan rejection, duplicate suppression, and SSE replay. Alerts cover attempts stuck in `EXECUTING` or `RECONCILING`, `UNKNOWN` deadlines, portfolio-lock age, late callbacks, invalid evidence, ledger transaction failures, and SSE replay lag. No log may contain payment tokens, raw credentials, or unredacted provider payloads.

---

## 12. Demo script

1. “Warden applies this policy: stay under $60 per month, change unused services, and take annual plans that save more than 15%.”
2. **Act 1:** “This AI service can switch from $20/month to $165/year. That is $13.75 per month, saving $6.25 per month or $75 per year. I approve this exact $165 mandate with my passkey.” Show checkout evidence.
3. **Act 2:** “The remaining portfolio is still above the cap. Warden proposes the basic gym plan. If this merchant path is supported, I approve it; otherwise it remains an explicitly labeled recommendation.”
4. **Act 3:** “This unused trial is converting to $12/month. Warden shows an avoided charge only after the cancellation or revocation is confirmed; otherwise it recommends cancellation.”
5. “Warden evaluates the portfolio automatically when I start a run. Future scheduling can trigger those checks continuously, but every payment remains limited to one merchant and one amount and subject to my passkey approval.”

---

## 13. Definition of done

- [ ] `FINAL_WARDEN.md` is the only normative architecture document.
- [ ] One payment completes through a verified scoped Prava flow with visible passkey approval.
- [ ] Every model decision passes deterministic validation before execution.
- [ ] A versioned portfolio snapshot and policy version determine one ordered plan per run.
- [ ] Duplicate run, approval, callback, retry, and reconnect tests cannot create a second charge.
- [ ] Every external action follows the state machine; failures remain failures with `outcome_type: null`.
- [ ] Annual cash charges and effective monthly policy costs are shown separately.
- [ ] All internal monetary values use minor units and one explicit currency.
- [ ] Each outcome has the canonical UI treatment and evidence fields.
- [ ] Evidence is structured, verified, uniquely referenced, and linked to its execution attempt.
- [ ] A `decision_only` result is never called paid, done, prevented, or saved.
- [ ] An `action_avoided` result has prevention evidence and correctly distinguishes one-time from recurring prevention.
- [ ] Savings displays use evidenced recurring monthly savings and one-time avoided amounts as separate totals.
- [ ] API and SSE ownership, replay, stale-version, and rate-limit tests pass.
- [ ] SQLite survives a process restart without losing runs, attempts, evidence, or ledger order.
- [ ] Logs and stored records satisfy redaction and synthetic-data retention rules.
- [ ] Backup video, README disclosure, and live event requirements are checked before submission.

---

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Merchant or sandbox path is unavailable | Verify primary and backup paths before implementation; downgrade to `decision_only` rather than simulate success |
| Active-plan switch is unsupported | Use the canonical recommended-state fallback |
| Trial prevention is unsupported | Show a recommendation; do not claim an avoided charge |
| Policy math is inconsistent | Centralize normalized-cost calculations in deterministic code and test the fixtures |
| Model output is malformed or generic | Enforce the strict function schema and validator; review actual reasoning before demo |
| Payment approval is hidden or auto-approved | Treat visible user passkey approval as a hard gate |
| Duplicate request or ambiguous provider timeout | Enforce local/provider idempotency and query provider state before retrying |
| Portfolio changes during a run | Lock execution per portfolio; reject stale snapshots and replan |
| Unauthorized run or stream access | Authenticate every route and verify ownership from server-side identity |
| SSE disconnect loses or duplicates events | Persist events, assign IDs and sequence numbers, and support `Last-Event-ID` replay |
| Prompt injection through merchant metadata | Treat metadata as untrusted data; separate it from instructions and validate all tool output |
| Evidence is forged, reused, or mismatched | Verify provider status, merchant, amount, currency, uniqueness, timestamp, and payload hash |
| Process restart loses financial state | Use SQLite transactions and append-only ledger events; recover active attempts on startup |
| Event/track details change | Recheck live official sources; no planning document is an authority for external rules |
