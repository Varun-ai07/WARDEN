# WARDEN — Risk Register

> **Status: supporting risk register.** [FINAL_WARDEN.md](FINAL_WARDEN.md) is the single source of truth. This register tracks delivery risks and mitigations; it does not alter the canonical architecture.

| Risk | Why it matters | Required mitigation |
|---|---|---|
| Merchant or sandbox path is unavailable | A realistic UI is not proof of payment execution | Verify primary and backup paths first; use `decision_only` if unsupported |
| Active-plan change is unsupported | Act 2 may not be executable | Validate capability early; present a recommendation, never a simulated success |
| Trial prevention is unsupported | Doing nothing may not stop a merchant's stored payment method | Require cancellation/revocation evidence for `action_avoided`; otherwise recommend cancellation |
| Annual math is misrepresented | $165/year is not a $165 monthly policy cost | Centralize authorized amount, effective monthly cost, and monthly/annual savings calculations |
| Model emits an invalid decision | An LLM cannot be the final financial control | Use the canonical strict function schema and deterministic validator |
| A recommendation looks completed | This defeats the trust proposition | Render only from `outcome_type` and evidence fields; test with an uninformed observer |
| Passkey is hidden or auto-approved | Removes proof of user control | Personally trigger and observe the real approval before demo |
| Credentials leak | Security and submission failure | Keep secrets server-side, ignore environment files, and run a final secret scan |
| Fixture and provider facts drift | Demo claims become inaccurate | Freeze verified fixtures, rerun arithmetic tests, and update the script from the ledger |
| Duplicate run, click, callback, or retry | A user can be charged twice | Require local and provider idempotency keys, unique provider references, and duplicate-effect tests |
| Provider timeout after receiving a write | Blind retry can duplicate an effect | Move to `RECONCILING`; query provider status and preserve uncertainty until confirmed—never mark it `FAILED` merely because lookup is inconclusive |
| Portfolio or policy changes during execution | Actions may violate the latest budget | Plan from a versioned snapshot, lock one execution run, and stop/replan stale work |
| Failure is mislabeled as a recommendation | Hides an attempted but unsuccessful action | Keep `execution_status` separate; failed, declined, and expired attempts have no outcome |
| Forged or mismatched evidence | UI may claim an unsupported result | Verify provider, merchant, amount, currency, status, timestamp, uniqueness, and payload hash |
| Unauthorized API or SSE access | Exposes financial policy and execution data | Authenticate every route/stream and enforce ownership from server-side identity |
| SSE disconnect or duplicate delivery | UI can lose or double-render state | Persist events with IDs and sequence; replay from `Last-Event-ID`; deduplicate client-side |
| Prompt injection in merchant metadata | Untrusted text may influence financial decisions | Separate data from instructions, length-limit it, expose no execution tools, and validate outputs |
| Ambiguous policy prose is treated as executable | The backend may enforce a rule the user did not intend | Compile to supported strict rules, show unsupported clauses, and require explicit activation of each policy version |
| Process crash during execution | State or evidence may be lost | Persist transitions transactionally in SQLite and recover unresolved attempts at startup |
| Floating-point or currency mismatch | Budget and mandate amounts can diverge | Use integer minor units and one configured portfolio currency; reject mismatches |
| One prevented charge is treated as recurring savings | The dashboard overstates future benefit | Track one-time avoided amounts separately; require recurring-cancellation evidence for monthly savings |
| External rules change | Plans may contain stale track or deadline information | Check official live sources before each submission decision |

## Final rehearsal checks

- One payment shows its exact authorized amount, passkey, and provider evidence.
- The annual switch displays $165 now, $13.75 effective monthly cost, $6.25 recurring monthly saving, and $75 annual saving.
- A recommendation does not increment the counter or use completion language.
- An avoided trial charge includes prevention evidence; otherwise it is a recommendation.
- Duplicate requests and reconnects do not create a second execution or counter increment.
- Failed, declined, expired, and stale states remain visible and do not produce savings.
- A process restart reconstructs the run from SQLite and the append-only ledger.
- The narrator uses the same qualified language as the UI.
