# DESIGN.md — WARDEN

## 1. Objective

WARDEN should feel like a financial control room where every claim can be inspected. Confidence comes from visible constraints, exact amounts, and evidence trails rather than decorative polish. The quality bar is a credible product demo that could become an operations-grade interface without changing its visual grammar.

## 2. Product Context

- **What the product does:** Evaluates recurring commitments against a user-confirmed policy and executes only narrowly authorized, evidence-backed actions.
- **Who it's for:** A technically comfortable consumer or operator who wants automation but refuses opaque financial authority.
- **Adjacent brands:** Linear for interface rhythm, Mercury for financial restraint, Ramp for operational clarity.
- **Distant brand:** Revolut marketing surfaces; their promotional gloss would weaken WARDEN's proof-first posture.
- **Cultural register:** Serious, technical, candid. WARDEN exposes uncertainty rather than smoothing it away.

## 3. Visual Foundations

### 3a. Color

- **Neutral scale:** `--n-0: #FCFBF7`, `--n-50: #F5F2EA`, `--n-100: #ECE7DB`, `--n-200: #D8D1C2`, `--n-400: #8B8375`, `--n-600: #575147`, `--n-800: #2C2A25`, `--n-950: #151512`.
- **Primary accent:** `--cobalt: #2947F2`.
- **Secondary accent:** `--signal: #F05A28`.
- **Semantic:** `--success: #16735A`, `--warning: #A86500`, `--error: #BC3F35`, `--info: #2947F2`, `--unknown: #6957A5`.
- **Usage rules:** Cobalt marks one primary action or active run focus per screen. Signal orange marks approval-required states only. Semantic colors encode state and never decorate whole sections. Most structure uses ink, paper, and hairline borders.

### 3b. Typography

- **Display face:** IBM Plex Sans Variable, 560–650 weight, tracking `-0.025em` above 28px.
- **Body face:** IBM Plex Sans Variable, 400–520 weight.
- **Data face:** IBM Plex Mono, 400–600 weight for IDs, money, state, and timestamps.
- **Fallback stack:** `"IBM Plex Sans", "Aptos", "Segoe UI", sans-serif`; mono: `"IBM Plex Mono", "SFMono-Regular", monospace`.
- **Type scale:** `11 / 12 / 14 / 16 / 20 / 28 / 40 / 56`.
- **Weight discipline:** 400 for prose, 500 for labels and controls, 600 for page/section headings. Never bold whole rows or paragraphs.

### 3c. Spacing & rhythm

- **Base unit:** 4px.
- **Spacing scale:** `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`.
- **Whitespace rule:** Desktop page gutters are 28–40px; primary sections separate by 32px. Dense tables use 12px vertical rows. Mobile gutters are 16px.

### 3d. Component seeds

- **Buttons:** Three variants only: filled cobalt primary, bordered neutral secondary, and text action. Radius 4px; 36px default height; no pill buttons.
- **Containers:** Hairline bordered planes with 4–8px radius and no shadows. Sections may share borders to read as one ledger rather than floating cards.
- **Iconography:** Lucide at 16px, 1.75px stroke. Every icon-only control has a tooltip and accessible name.
- **State marks:** Compact mono labels with a left rule or dot. Meaning is always repeated in text, not color alone.
- **Evidence:** Provider references, event IDs, amounts, and timestamps use mono type and align in columns.

## 4. Accessibility

- Body text meets 4.5:1 contrast; large text and UI marks meet 3:1.
- Motion defaults to short opacity/position transitions and disables under `prefers-reduced-motion`.
- Focus is a 2px cobalt outline with 2px offset on light surfaces and a paper outline on cobalt.
- Decorative marks are hidden from assistive technology; informational state icons repeat their meaning in text.
- Tables retain headers and become labelled stacked records below 760px.
- Live run updates use a polite ARIA region; approval and failure states use assertive announcements only when user action is required.

## 5. Voice & Tone

- **Register:** Technical, direct, calm.
- **Sentence rhythm:** Short declarative statements. Evidence details can use compact fragments.
- **Words WARDEN uses:** verified, scoped, awaiting approval, recommended, unresolved.
- **Words WARDEN refuses:** seamless, magic, autonomous payment, saved (without evidence), done (without a terminal result).
- **Address:** “You” for user decisions; “WARDEN” for system actions.

## 6. Implementation Practices

- **Token format:** CSS custom properties consumed by CSS modules/global styles; no utility-class soup.
- **Component convention:** Bespoke React components with Radix only when an accessible primitive is genuinely needed.
- **Image treatment:** No stock imagery or illustration. Product state and evidence are the visual material.
- **Grid system:** 12-column desktop grid with an asymmetric 7/5 primary split; one-column below 980px.
- **Motion:** `cubic-bezier(0.2, 0.8, 0.2, 1)`, 120–220ms. No bounce, glow pulse, or continuous ambient animation.
- **Density:** Comfortable default with a compact ledger mode available later; initial build ships one deliberate density.

## 7. Anti-Patterns

- **No gradient surfaces.** Financial trust should come from constraints and evidence, not fintech atmosphere.
- **No KPI-card row.** Recurring savings and avoided charges are two ledger totals in one summary band, not four floating stats.
- **No rounded shadow card grid.** Shared borders and tabular alignment create a more credible operational surface.
- **No generic success checkmarks.** Completion requires explicit outcome wording and evidence references.
- **No color-only state.** Unknown, failed, recommended, and completed states always have text labels.
- **No fake passkey modal.** Fake mode is labelled as simulation and never imitates provider-native biometric chrome.
- **No motivational copy.** The interface states what happened, what remains uncertain, and what needs approval.

## 8. Decision-Making

1. **Truth before reassurance.** Unknown or failed state remains visible even when a cleaner success presentation is available.
2. **User control before flow completion.** Approval friction is shown rather than hidden.
3. **Evidence before decoration.** IDs, amounts, state transitions, and provider references occupy the space a generic dashboard would spend on illustration.
4. **Hierarchy before density.** Keep the ledger dense, but give the active decision and required action unmistakable visual priority.
5. **Accessibility before brand color.** Adjust semantic hues or treatment whenever contrast or non-color comprehension fails.
6. **MVP restraint before breadth.** One excellent dashboard and proof drawer beat multiple shallow pages.

## 9. Workflow

1. Read the canonical action, state, outcome, and evidence contracts in `FINAL_WARDEN.md`.
2. Identify the screen's active run state and the single action the user may need to take.
3. Lay out information in reading order: policy, portfolio effect, active execution, evidence history.
4. Apply mono treatment to facts and sans treatment to interpretation.
5. Verify every state has text, evidence expectations, and an accessible announcement policy.
6. Run the dashboard anti-pattern pass: remove floating KPI cards, decorative gradients, and generic success treatments.
7. Test 1440px, 1024px, 768px, and 390px layouts plus keyboard and reduced-motion behavior.
8. Compare all claims against the ledger payload before shipping.
