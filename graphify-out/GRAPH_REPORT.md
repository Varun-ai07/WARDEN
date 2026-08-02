# Graph Report - Warden  (2026-08-03)

## Corpus Check
- 22 files · ~161,888 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 246 nodes · 505 edges · 15 communities (10 shown, 5 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 62 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `30d12498`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Durable API Ledger and Governance|Durable API Ledger and Governance]]
- [[_COMMUNITY_Payment Trust and Idempotency|Payment Trust and Idempotency]]
- [[_COMMUNITY_Policy Compilation and Portfolio Planning|Policy Compilation and Portfolio Planning]]
- [[_COMMUNITY_Runtime Recovery and Observability|Runtime Recovery and Observability]]
- [[_COMMUNITY_Evidence and Truthful Outcomes|Evidence and Truthful Outcomes]]
- [[_COMMUNITY_Deterministic Plan Execution|Deterministic Plan Execution]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]

## God Nodes (most connected - your core abstractions)
1. `WardenService` - 37 edges
2. `id()` - 21 edges
3. `now()` - 18 edges
4. `WardenDb` - 17 edges
5. `sha256()` - 13 edges
6. `Replayable Per-Run SSE` - 10 edges
7. `Logger` - 9 edges
8. `PravaExecutionProvider` - 9 edges
9. `Narrow Authority Trust Model` - 9 edges
10. `Runtime Execution State Machine` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Original Narrow-Authority Trust Property` --rationale_for--> `Atomic Portfolio Planner`  [INFERRED]
  WARDEN_Architecture_Summary.md → FINAL_WARDEN.md
- `Original Narrow-Authority Trust Property` --rationale_for--> `End-to-End Idempotency`  [INFERRED]
  WARDEN_Architecture_Summary.md → FINAL_WARDEN.md
- `Original Narrow-Authority Trust Property` --rationale_for--> `Structured Verified Evidence Object`  [INFERRED]
  WARDEN_Architecture_Summary.md → FINAL_WARDEN.md
- `Original Narrow-Authority Trust Property` --references--> `FINAL_WARDEN Single Source of Truth`  [EXTRACTED]
  WARDEN_Architecture_Summary.md → FINAL_WARDEN.md
- `Durable Runtime Contract Delivery Gate` --references--> `FINAL_WARDEN Single Source of Truth`  [EXTRACTED]
  warden-build-brief.md → FINAL_WARDEN.md

## Hyperedges (group relationships)
- **Trust Enforcement Stack** — final_warden_narrow_authority_trust_model, final_warden_compiled_policy_rules, final_warden_deterministic_decision_validator, final_warden_visible_passkey_approval, final_warden_single_use_scoped_mandate, final_warden_structured_evidence [INFERRED 0.95]
- **Durable Execution Control Loop** — final_warden_runtime_execution_state_machine, final_warden_end_to_end_idempotency, final_warden_provider_reconciliation, final_warden_sqlite_system_of_record, final_warden_append_only_evidence_ledger [EXTRACTED 1.00]
- **Replayable User Projection** — final_warden_append_only_evidence_ledger, final_warden_authenticated_rest_api, final_warden_replayable_sse, final_warden_event_id_client_deduplication, final_warden_truthful_dashboard_projection [INFERRED 0.95]

## Communities (15 total, 5 thin omitted)

### Community 0 - "Durable API Ledger and Governance"
Cohesion: 0.07
Nodes (61): Append-Only Evidence Ledger, Atomic Portfolio Planner, Atomic Subscription and Portfolio Version Advancement, Authenticated REST v1 API, Authorized Amount versus Effective Monthly Cost, Callback Service Authentication and Server-Side Reference Mapping, Discover Decide Validate Authorize or Prevent Record Evidence Loop, Strict Versioned Compiled Policy Rules (+53 more)

### Community 1 - "Payment Trust and Idempotency"
Cohesion: 0.1
Nodes (17): id(), now(), sha256(), buildCheckoutEvidence(), executeMerchantCheckout(), GenericMerchantCheckoutAdapter, getAdapter(), NotionCheckoutAdapter (+9 more)

### Community 3 - "Runtime Recovery and Observability"
Cohesion: 0.13
Nodes (14): annualSavingsBps(), assertTransition(), compilePolicyDeterministically(), conservativeMonthlyCost(), getRule(), healthScore(), stableJson(), createExecutionProvider() (+6 more)

### Community 4 - "Evidence and Truthful Outcomes"
Cohesion: 0.15
Nodes (12): asyncRoute(), createApp(), annualSavingsBps(), DeterministicReasoner, issueSession(), readSession(), requireCsrf(), requireSession() (+4 more)

## Knowledge Gaps
- **5 isolated node(s):** `Unsupported Policy Clauses`, `Run State Machine`, `Honest Recommendation Fallback`, `Per-Run Ledger Hash Chain`, `Lossless Replay-to-Live Handoff`
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `WardenService` connect `Policy Compilation and Portfolio Planning` to `Runtime Recovery and Observability`, `Evidence and Truthful Outcomes`?**
  _High betweenness centrality (0.114) - this node is a cross-community bridge._
- **Why does `WardenDb` connect `Community 6` to `Runtime Recovery and Observability`, `Evidence and Truthful Outcomes`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `id()` connect `Payment Trust and Idempotency` to `Policy Compilation and Portfolio Planning`, `Runtime Recovery and Observability`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Are the 16 inferred relationships involving `id()` (e.g. with `.checkout()` and `.checkout()`) actually correct?**
  _`id()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `now()` (e.g. with `buildCheckoutEvidence()` and `.execute()`) actually correct?**
  _`now()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `sha256()` (e.g. with `buildCheckoutEvidence()` and `.execute()`) actually correct?**
  _`sha256()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Unsupported Policy Clauses`, `Run State Machine`, `Honest Recommendation Fallback` to the rest of the system?**
  _5 weakly-connected nodes found - possible documentation gaps or missing edges._