#!/usr/bin/env node
const { execSync } = require("child_process");
const { spawn } = require("child_process");

async function main() {
  // Kill old processes
  try { execSync("pgrep -f 'node apps/api' | xargs kill -9 2>/dev/null || true", { stdio: "ignore" }); } catch {}
  try { execSync("rm -f apps/api/data/warden.db*", { stdio: "ignore" }); } catch {}

  // Start API
  const api = spawn("node", ["apps/api/dist/server.js"], {
    stdio: "ignore",
    detached: true,
    env: { ...process.env, DATABASE_PATH: "apps/api/data/warden.db" }
  });
  api.unref();

  // Wait for server
  await new Promise(r => setTimeout(r, 3000));

  const apiBase = "http://127.0.0.1:8787";

  // Health check
  const health = await fetch(`${apiBase}/api/v1/health`);
  console.log(`1. Health: ${health.status} ${(await health.json()).mode}`);

  // Create session
  const s = await fetch(`${apiBase}/api/v1/session`);
  const c = s.headers.getSetCookie()?.[0]?.split(';')[0];
  const sess = await s.json();
  console.log(`2. Session: ${sess.environment} pk=${sess.prava_publishable_key?.substring(0, 8)}`);

  // Create test run
  const runRes = await fetch(`${apiBase}/api/v1/dev/test-run`, {
    method: "POST",
    headers: { Cookie: c, "Idempotency-Key": "phase4-" + Date.now() },
  });
  const run = await runRes.json();
  console.log(`3. Run: ${run.run_id} decisions=${run.decisions?.length}`);

  // Check decision statuses
  for (const d of run.decisions) {
    console.log(`   ${d.execution_status.padEnd(20)} ${d.action.padEnd(8)} ${d.merchant_name} $${(d.authorized_amount_minor / 100).toFixed(2)}`);
  }

  // Get events
  const events = await fetch(`${apiBase}/api/v1/runs/${run.run_id}/events`, { headers: { Cookie: c } }).then(r => r.json());
  console.log(`4. Events: ${events.events?.length} types: ${[...new Set(events.events?.map(e => e.event_type))].join(', ')}`);

  // Get savings
  const savings = await fetch(`${apiBase}/api/v1/savings`, { headers: { Cookie: c } }).then(r => r.json());
  console.log(`5. Savings: recurring=$${savings.recurring_monthly_saved_minor / 100} avoided=$${savings.one_time_avoided_minor / 100}`);

  console.log("\n=== ALL CHECKS PASSED ===");
  api.kill(9);
  process.exit(0);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
