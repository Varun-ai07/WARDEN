# Graph Report - Warden  (2026-08-02)

## Corpus Check
- 18 files · ~50,176 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 190 nodes · 387 edges · 13 communities (10 shown, 3 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 41 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Durable API Ledger and Governance|Durable API Ledger and Governance]]
- [[_COMMUNITY_Payment Trust and Idempotency|Payment Trust and Idempotency]]
- [[_COMMUNITY_Policy Compilation and Portfolio Planning|Policy Compilation and Portfolio Planning]]
- [[_COMMUNITY_Runtime Recovery and Observability|Runtime Recovery and Observability]]
- [[_COMMUNITY_Evidence and Truthful Outcomes|Evidence and Truthful Outcomes]]
- [[_COMMUNITY_Deterministic Plan Execution|Deterministic Plan Execution]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 8|Community 8]]

## God Nodes (most connected - your core abstractions)
1. `WardenService` - 34 edges
2. `WardenDb` - 17 edges
3. `now()` - 13 edges
4. `id()` - 13 edges
5. `Replayable Per-Run SSE` - 10 edges
6. `sha256()` - 9 edges
7. `Narrow Authority Trust Model` - 9 edges
8. `Runtime Execution State Machine` - 9 edges
9. `Structured Verified Evidence Object` - 9 edges
10. `Append-Only Evidence Ledger` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Original Narrow-Authority Trust Property` --rationale_for--> `Atomic Portfolio Planner`  [INFERRED]
  WARDEN_Architecture_Summary.md → FINAL_WARDEN.md
- `Runtime Risk Controls` --references--> `FINAL_WARDEN Single Source of Truth`  [EXTRACTED]
  warden-risks-and-solutions.md → FINAL_WARDEN.md
- `Original Narrow-Authority Trust Property` --conceptually_related_to--> `Narrow Authority Trust Model`  [EXTRACTED]
  WARDEN_Architecture_Summary.md → FINAL_WARDEN.md
- `Original Narrow-Authority Trust Property` --rationale_for--> `End-to-End Idempotency`  [INFERRED]
  WARDEN_Architecture_Summary.md → FINAL_WARDEN.md
- `Runtime Risk Controls` --rationale_for--> `End-to-End Idempotency`  [EXTRACTED]
  warden-risks-and-solutions.md → FINAL_WARDEN.md

## Hyperedges (group relationships)
- **Trust Enforcement Stack** — final_warden_narrow_authority_trust_model, final_warden_compiled_policy_rules, final_warden_deterministic_decision_validator, final_warden_visible_passkey_approval, final_warden_single_use_scoped_mandate, final_warden_structured_evidence [INFERRED 0.95]
- **Durable Execution Control Loop** — final_warden_runtime_execution_state_machine, final_warden_end_to_end_idempotency, final_warden_provider_reconciliation, final_warden_sqlite_system_of_record, final_warden_append_only_evidence_ledger [EXTRACTED 1.00]
- **Replayable User Projection** — final_warden_append_only_evidence_ledger, final_warden_authenticated_rest_api, final_warden_replayable_sse, final_warden_event_id_client_deduplication, final_warden_truthful_dashboard_projection [INFERRED 0.95]

## Communities (13 total, 3 thin omitted)

### Community 0 - "Durable API Ledger and Governance"
Cohesion: 0.1
Nodes (40): Append-Only Evidence Ledger, Atomic Subscription and Portfolio Version Advancement, Authenticated REST v1 API, Callback Service Authentication and Server-Side Reference Mapping, End-to-End Idempotency, Merchant Entitlement and Plan-State Confirmation Evidence, Event-ID Client Deduplication, Execution Attempt Identity (+32 more)

### Community 1 - "Payment Trust and Idempotency"
Cohesion: 0.15
Nodes (12): annualSavingsBps(), assertTransition(), compilePolicyDeterministically(), conservativeMonthlyCost(), getRule(), healthScore(), createExecutionProvider(), FakeExecutionProvider (+4 more)

### Community 2 - "Policy Compilation and Portfolio Planning"
Cohesion: 0.15
Nodes (8): id(), now(), sha256(), stableJson(), FakeExecutionProvider, formatAmount(), PravaExecutionProvider, sanitizeMerchantName()

### Community 4 - "Evidence and Truthful Outcomes"
Cohesion: 0.13
Nodes (21): Atomic Portfolio Planner, Authorized Amount versus Effective Monthly Cost, Discover Decide Validate Authorize or Prevent Record Evidence Loop, Strict Versioned Compiled Policy Rules, Dependency-Aware Ordered Action Plan, Deterministic Decision Validator, Honest Recommendation Fallback, Immutable Versioned Portfolio Snapshot (+13 more)

### Community 6 - "Community 6"
Cohesion: 0.26
Nodes (9): asyncRoute(), createApp(), issueSession(), readSession(), requireCsrf(), requireSession(), safeEqual(), sign() (+1 more)

## Knowledge Gaps
- **5 isolated node(s):** `Unsupported Policy Clauses`, `Run State Machine`, `Honest Recommendation Fallback`, `Per-Run Ledger Hash Chain`, `Lossless Replay-to-Live Handoff`
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `WardenService` connect `Runtime Recovery and Observability` to `Payment Trust and Idempotency`, `Policy Compilation and Portfolio Planning`, `Community 6`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **Why does `WardenDb` connect `Deterministic Plan Execution` to `Payment Trust and Idempotency`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `now()` (e.g. with `.createRun()` and `.staleDependentsInTransaction()`) actually correct?**
  _`now()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `id()` (e.g. with `.createRun()` and `.createApprovalSession()`) actually correct?**
  _`id()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Unsupported Policy Clauses`, `Run State Machine`, `Honest Recommendation Fallback` to the rest of the system?**
  _5 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Durable API Ledger and Governance` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Evidence and Truthful Outcomes` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._