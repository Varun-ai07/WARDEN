# WARDEN Dashboard Blueprint

## Identity

Product UI Designer with an Information Design overlay. The interface is a forensic financial control room, not a consumer-fintech marketing surface.

## Grounding

Assumption: WARDEN should feel adjacent to Linear, Mercury, and Ramp: restrained typography, visible constraints, and evidence-first state presentation. Real Prava and OpenAI credentials are deferred; simulation must remain unmistakably labelled.

## DESIGN.md

The durable visual system lives in [DESIGN.md](DESIGN.md). Its key constraints are a warm paper neutral scale, cobalt control accent, IBM Plex Sans/Mono typography, shared-border ledger planes, and state color used only as semantic encoding.

## Structure

1. **Command strip:** WARDEN wordmark, environment badge, active policy version, connection state, and one `Run policy` action.
2. **Proof summary band:** Current effective monthly commitment, verified recurring monthly saving, one-time avoided charges, and portfolio cap in one ruled strip.
3. **Policy and portfolio split:** Policy prose and normalized active rules beside a dense subscription table with health, next charge, capability, and projected action.
4. **Execution rail:** Vertical state progression for the current run, with the approval-required decision expanded and other decisions compact.
5. **Activity ledger:** Chronological event table keyed by event ID and sequence, with replay and connection indicators.
6. **Proof drawer:** Structured evidence, exact mandate amount, provider references, hash, and entitlement/cancellation status. Closed by default but visibly available.

## Decision Trace

1. **Direction: forensic financial control room.** Reason: WARDEN differentiates on constrained authority and evidence. Alternatives: polished consumer banking; cyber-security dark mode. Tradeoff: denser and less playful.
2. **Warm paper canvas with cobalt control accent.** Reason: serious without copying dark developer dashboards. Alternatives: near-black interface; pure-white enterprise UI. Tradeoff: careful semantic contrast is required.
3. **Shared-border ledger planes instead of floating cards.** Reason: relationships and sequence matter more than independent widgets. Alternatives: shadcn card grid; borderless editorial sections. Tradeoff: responsive behavior is harder.
4. **Mono type reserved for evidence.** Reason: separates machine-verifiable facts from explanatory prose. Alternatives: mono everywhere; single sans family. Tradeoff: one additional font asset.
5. **Two savings totals, not a KPI row.** Reason: recurring savings and one-time avoidance are semantically different. Alternatives: four-card metric row; one blended number. Tradeoff: less dramatic headline presentation.
6. **Execution rail as the primary visual.** Reason: state transitions are WARDEN's operational core. Alternatives: activity feed first; subscription table first. Tradeoff: first-time users need a concise label.
7. **Proof drawer rather than permanent provider detail.** Reason: preserves auditability without overwhelming the common view. Alternatives: permanent right rail; separate evidence page. Tradeoff: one click to inspect evidence.
8. **No provider-like fake biometric UI.** Reason: simulation must not look like real authorization. Alternatives: polished mock modal; no approval preview. Tradeoff: fake-mode demos are less theatrical.

## Anti-slop self-check

Clean: no gradients, KPI-card trios, emoji decoration, rounded shadow grids, generic success chrome, or empty marketing copy. The dashboard uses asymmetric hierarchy and shared ledger structure rather than a uniform panel grid.
