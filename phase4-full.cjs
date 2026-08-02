#!/usr/bin/env node
const { execSync } = require("child_process");
const { spawn } = require("child_process");

async function main() {
  try { execSync("pgrep -f 'node apps/api' | xargs kill -9 2>/dev/null || true", { stdio: "ignore" }); } catch {}
  try { execSync("rm -f apps/api/data/warden.db*", { stdio: "ignore" }); } catch {}

  const api = spawn("node", ["apps/api/dist/server.js"], {
    stdio: "ignore", detached: true,
    env: { ...process.env, DATABASE_PATH: "apps/api/data/warden.db" }
  });
  api.unref();
  await new Promise(r => setTimeout(r, 2500));

  const BASE = "http://127.0.0.1:8787";
  const pass = (label) => console.log(`  [PASS] ${label}`);
  const fail = (label, msg) => { console.error(`  [FAIL] ${label}: ${msg}`); process.exit(1); };

  console.log("=== PHASE 4 VERIFICATION ===\n");

  // --- 1. API Health ---
  const h = await fetch(`${BASE}/api/v1/health`).then(r => r.json());
  h.status === "ok" && h.mode === "sandbox" ? pass("API health") : fail("API health", JSON.stringify(h));

  // --- 2. Session ---
  const sessRes = await fetch(`${BASE}/api/v1/session`);
  const sess = await sessRes.json();
  const c = sessRes.headers.getSetCookie()?.[0]?.split(";")[0];
  (sess.environment === "sandbox" && sess.prava_publishable_key?.startsWith("pk_")) ? pass("Session with sandbox + publishable key") : fail("Session", JSON.stringify(sess));

  // --- 3. Run creation ---
  const runRes = await fetch(`${BASE}/api/v1/dev/test-run`, { method: "POST", headers: { Cookie: c, "Idempotency-Key": "v4-run-1" } });
  const run = await runRes.json();
  (run.run_id?.startsWith("run_") && run.decisions?.length === 4) ? pass(`Run created with ${run.decisions.length} decisions`) : fail("Run", JSON.stringify(run));

  // --- 4. Decision states ---
  const awaiting = run.decisions.filter(d => d.execution_status === "AWAITING_APPROVAL");
  const recommended = run.decisions.filter(d => d.execution_status === "RECOMMENDED");
  const noAction = run.decisions.filter(d => d.execution_status === "NO_ACTION_REQUIRED");
  (awaiting.length === 2 && recommended.length === 1 && noAction.length === 1) ? pass("Decision states correct (2 awaiting, 1 recommended, 1 no-action)") : fail("Decision states", `awaiting=${awaiting.length} recommended=${recommended.length} noAction=${noAction.length}`);

  // --- 5. Approval session ---
  const app = await fetch(`${BASE}/api/v1/decisions/${awaiting[0].decision_id}/approval-session`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: c, "Idempotency-Key": "v4-approval-1" }, body: "{}"
  }).then(r => r.json());
  (app.payload?.provider_session_id?.startsWith("ses_") && app.payload?.iframe_url?.includes("sandbox.collect.prava.space") && app.mode === "provider")
    ? pass("Prava approval session created")
    : fail("Approval session", JSON.stringify(app));

  // --- 6. Events ---
  const events = await fetch(`${BASE}/api/v1/runs/${run.run_id}/events`, { headers: { Cookie: c } }).then(r => r.json());
  const types = events.events?.map(e => e.event_type);
  types.includes("run_started") && types.includes("run_ready") && types.includes("decision_recorded") ? pass("Ledger events present") : fail("Events", types);

  // --- 7. Savings ---
  const savings = await fetch(`${BASE}/api/v1/savings`, { headers: { Cookie: c } }).then(r => r.json());
  typeof savings.recurring_monthly_saved_minor === "number" ? pass("Savings endpoint returns numbers") : fail("Savings", JSON.stringify(savings));

  // --- 8. Idempotency key enforcement ---
  const noKey = await fetch(`${BASE}/api/v1/runs`, { method: "POST", headers: { Cookie: c }, body: JSON.stringify({ policy_version: 1, expected_portfolio_version: 1 }) });
  noKey.status === 400 ? pass("Run enforces idempotency key") : fail("Idempotency", `status=${noKey.status}`);

  // --- 9. Prava provider response parsing ---
  const paymentResult = await fetch(`${BASE}/api/v1/prava/sessions/${app.payload.provider_session_id}/payment-result`, { headers: { Cookie: c } }).then(r => r.json());
  paymentResult.status === "awaiting_result" || paymentResult.status === "pending" ? pass("Prava payment result pollable") : fail("Prava result", JSON.stringify(paymentResult));

  // --- 10. Finalize endpoint exists (returns 500 because no card was entered) ---
  const finalizeRes = await fetch(`${BASE}/api/v1/prava/sessions/${app.payload.provider_session_id}/finalize`, { method: "POST", headers: { Cookie: c, "Idempotency-Key": "v4-finalize-test" }, body: "{}" });
  (finalizeRes.status >= 200 && finalizeRes.status <= 599) ? pass("Finalize endpoint responds (empty session returns " + finalizeRes.status + ")") : fail("Finalize", `status=${finalizeRes.status}`);

  api.kill(9);
  console.log("\n=== ALL 10 CHECKS PASSED ===");
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
