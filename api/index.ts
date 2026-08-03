import { createHmac } from "node:crypto";

const env = (k: string, d = "") => process.env[k] || d;
const environment = env("PAYMENT_PROVIDER_MODE") === "prava" ? "sandbox" : "demo";
const pravaKey = env("RAVA_PUBLISHABLE_KEY") || env("PRAVA_PUBLISHABLE_KEY");
const pravaApiKey = env("PRAVA_API_KEY");
const pravaBaseUrl = env("PRAVA_BASE_URL", "https://sandbox.api.prava.space");
const openaiKey = env("OPENAI_API_KEY");
const openrouterKey = env("OPENROUTER_API_KEY");
const openaiModel = env("OPENAI_MODEL", "gpt-4.1");
const openrouterModel = env("OPENROUTER_MODEL", "openrouter/free");
const openrouterUrl = env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1");
const pgUrl = env("DATABASE_URL");
const sessionSecret = env("SESSION_SECRET", "warden-local-dev");

function sign(v: string) { return createHmac("sha256", sessionSecret).update(v).digest("base64url"); }
function id(p: string) { return `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`; }
function now() { return new Date().toISOString(); }
function json(res: any, s: number, d: any) { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); }
function readBody(req: any): Promise<any> { return new Promise(r => { let d = ""; req.on("data", (c: any) => d += c); req.on("end", () => { try { r(JSON.parse(d)); } catch { r({}); } }); }); }

// ─── Supabase helpers ────────────────────────────────────────────────────
async function pgQuery(sql: string, params: any[] = []): Promise<any[]> {
  if (!pgUrl) return [];
  const res = await fetch(pgUrl.replace("postgresql://", "https://") + "?apikey=" + env("SUPABASE_SERVICE_KEY"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": env("SUPABASE_SERVICE_KEY"), "Authorization": "Bearer " + env("SUPABASE_SERVICE_KEY") },
    body: JSON.stringify({ query: sql, params }),
  });
  const j = await res.json();
  return j.data || j.rows || [];
}

// ─── AI reasoner via OpenAI ──────────────────────────────────────────────
async function aiDecide(sub: any, policy: any, portfolioTotal: number): Promise<any> {
  // Try OpenAI first, then OpenRouter, then deterministic fallback
  for (const [key, model, url] of [
    openaiKey ? [openaiKey, openaiModel, "https://api.openai.com/v1/chat/completions"] : null,
    openrouterKey ? [openrouterKey, openrouterModel, `${openrouterUrl}/chat/completions`] : null,
  ].filter(Boolean) as [string, string, string][]) {
    try {
      const availablePlans = sub.alt_plans.map((p: any) => p.plan_id).join(", ") || "None";
      const prompt = `You are WARDEN's AI subscription policy engine. Apply rules EXACTLY and explain your reasoning clearly.

## RULES
1. MONTHLY_CAP ($150/mo): If total exceeds cap, switch expensive items to cheaper plans or decline.
2. MAX_INACTIVE_DAYS (30d): Unused >= 30 days → SWITCH to cheapest plan, or DECLINE if no cheaper plan.
3. ANNUAL_SAVINGS (15%): If annual plan saves > 15% → SWITCH to annual.

## DECISION FRAMEWORK (follow in order)
1. Trial with zero usage → **DECLINE** (prevent paid conversion)
2. Unused >= 30 days with cheaper plan → **SWITCH** to cheapest
3. Unused >= 30 days, no cheaper plan → **DECLINE** (cancel)
4. Active + annual plan saves >15% → **SWITCH** to annual
5. Active + within budget + no better plan → **RENEW**

## IMPORTANT
- For RECOMMENDATION: This merchant is NOT integrated with Prava payment system. If the action requires payment (SWITCH), mark it as RECOMMENDATION and note that Prava integration is needed for automated execution.
- For AWAITING_APPROVAL: This merchant IS integrated with Prava. Payment will be processed through Prava sandbox.

## Portfolio: $${(portfolioTotal / 100).toFixed(2)}/month

## Subscription: ${sub.merchant_name} (${sub.id})
- Plan: ${sub.plan_id} at $${(sub.current_monthly_cost_minor / 100).toFixed(2)}/mo
- Cycle: ${sub.billing_cycle}
- Last used: ${sub.last_used_days_ago !== null ? sub.last_used_days_ago + " days ago" : "Never used"}
- Alt plans: ${sub.alt_plans.map((p: any) => `${p.plan_id} ($${(p.effective_monthly_cost_minor / 100).toFixed(2)}/mo)`).join(", ") || "None"}

Return JSON: {"action":"RENEW|SWITCH|DECLINE","target_plan":"plan_id or null","policy_rule_reference":"rule_id","reasoning":"clear explanation citing the specific rule and numbers"}`;

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key, ...(url.includes("openrouter") ? { "HTTP-Referer": "https://warden-api-ten.vercel.app", "X-Title": "WARDEN" } : {}) },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0.1 }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error?.message || `API error ${resp.status}`);
      const content = data.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);
      if (parsed.action) return { subscription_id: sub.id, action: parsed.action, target_plan: parsed.target_plan || null, policy_rule_reference: parsed.policy_rule_reference || policy.rules[0]?.rule_id || "policy_default", reasoning: parsed.reasoning || "AI analysis complete." };
    } catch (err: any) { console.error(`AI reasoner (${url}):`, err.message); }
  }
  return fallbackDecide(sub, policy, portfolioTotal);
}

function fallbackDecide(sub: any, policy: any, portfolioTotal: number): any {
  const cap = policy.rules.find((r: any) => r.type === "MONTHLY_CAP");
  const unused = policy.rules.find((r: any) => r.type === "MAX_INACTIVE_DAYS");
  const annual = policy.rules.find((r: any) => r.type === "MIN_ANNUAL_SAVINGS_BPS");
  if (sub.plan_id === "trial" && sub.last_used_days_ago === null) return { subscription_id: sub.id, action: "DECLINE", target_plan: null, policy_rule_reference: unused?.rule_id || "policy_default", reasoning: `${sub.merchant_name} has no recorded use and is approaching a paid conversion.` };
  if (sub.last_used_days_ago !== null && unused && sub.last_used_days_ago >= unused.days) { const cheapest = sub.alt_plans.sort((a: any, b: any) => a.effective_monthly_cost_minor - b.effective_monthly_cost_minor)[0]; if (cheapest) return { subscription_id: sub.id, action: "SWITCH", target_plan: cheapest.plan_id, policy_rule_reference: unused.rule_id, reasoning: `${sub.merchant_name} unused ${sub.last_used_days_ago} days. Switch to cheapest plan: ${cheapest.plan_id}.` }; return { subscription_id: sub.id, action: "DECLINE", target_plan: null, policy_rule_reference: unused.rule_id, reasoning: `${sub.merchant_name} unused ${sub.last_used_days_ago} days with no alternatives.` }; }
  if (sub.alt_plans.length > 0 && annual) { const best = sub.alt_plans[0]; const savingsPct = ((sub.current_monthly_cost_minor - best.effective_monthly_cost_minor) / sub.current_monthly_cost_minor) * 100; if (savingsPct > annual.basis_points / 100) return { subscription_id: sub.id, action: "SWITCH", target_plan: best.plan_id, policy_rule_reference: annual.rule_id, reasoning: `Annual plan saves ${savingsPct.toFixed(0)}%, exceeding ${(annual.basis_points / 100).toFixed(0)}% threshold.` }; }
  return { subscription_id: sub.id, action: "RENEW", target_plan: null, policy_rule_reference: cap?.rule_id || "policy_default", reasoning: `${sub.merchant_name} remains within the policy. Current portfolio: $${(portfolioTotal / 100).toFixed(2)}/month.` };
}

// ─── Prava helpers ───────────────────────────────────────────────────────
async function pravaRequest(path: string, init: RequestInit = {}): Promise<any> {
  const url = `${pravaBaseUrl}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${pravaApiKey}`,
    ...(init.headers as Record<string, string> || {}),
  };
  const resp = await fetch(url, { ...init, headers });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body?.error?.message || `Prava error ${resp.status}`);
  return body;
}

function formatAmount(minor: number): string { return (minor / 100).toFixed(2); }
function sanitizeMerchantName(name: string): string { const s = name.replace(/[^A-Za-z0-9 ]/g, "").trim(); return s.length > 0 ? s : "Merchant"; }

async function pravaCreateSession(decision: any): Promise<any> {
  const amount = formatAmount(decision.authorized_amount_minor);
  const merchantName = sanitizeMerchantName(decision.merchant_name);
  return pravaRequest("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      user_id: decision.subscription_id,
      user_email: `warden+${decision.subscription_id}@example.com`,
      total_amount: amount,
      currency: decision.currency || "USD",
      description: `WARDEN ${decision.action} ${merchantName}`.slice(0, 200),
      integration_type: "embedding",
      purchase_context: [{
        merchant_details: { name: merchantName, url: "https://example.com", country_code_iso2: "US", category: "Software Services" },
        product_details: [{ description: `WARDEN ${decision.action} ${merchantName}`.slice(0, 200), unit_price: amount, quantity: 1 }],
      }],
    }),
  });
}

// ─── Demo data ───────────────────────────────────────────────────────────
const SUBS = [
  { id: "sub_adobe", merchant_id: "merchant_adobe", merchant_name: "Adobe Creative Cloud", plan_id: "monthly", current_monthly_cost_minor: 5500, currency: "USD", billing_cycle: "monthly", next_charge_at: "2026-08-03T18:00:00Z", last_used_days_ago: 35, usage_frequency_score: 15, explicit_priority_score: 40, version: 1, capability: "unverified", alt_plans: [{ plan_id: "annual", authorized_amount_minor: 59900, effective_monthly_cost_minor: 4992, currency: "USD" }], health_score: 25, health_data_status: "complete" },
  { id: "sub_gym", merchant_id: "merchant_gym", merchant_name: "Equinox Gym", plan_id: "standard", current_monthly_cost_minor: 2500, currency: "USD", billing_cycle: "monthly", next_charge_at: "2026-08-03T18:00:00Z", last_used_days_ago: 42, usage_frequency_score: 12, explicit_priority_score: 30, version: 1, capability: "unverified", alt_plans: [{ plan_id: "basic", authorized_amount_minor: 1000, effective_monthly_cost_minor: 1000, currency: "USD" }], health_score: 21, health_data_status: "complete" },
  { id: "sub_spotify", merchant_id: "merchant_spotify", merchant_name: "Spotify", plan_id: "family", current_monthly_cost_minor: 1700, currency: "USD", billing_cycle: "monthly", next_charge_at: "2026-08-03T18:00:00Z", last_used_days_ago: 3, usage_frequency_score: 85, explicit_priority_score: 88, version: 1, capability: "payment", alt_plans: [{ plan_id: "individual", authorized_amount_minor: 1100, effective_monthly_cost_minor: 1100, currency: "USD" }], health_score: 85, health_data_status: "complete" },
  { id: "sub_figma", merchant_id: "merchant_figma", merchant_name: "Figma", plan_id: "professional", current_monthly_cost_minor: 1500, currency: "USD", billing_cycle: "monthly", next_charge_at: "2026-08-03T18:00:00Z", last_used_days_ago: 1, usage_frequency_score: 90, explicit_priority_score: 92, version: 1, capability: "payment", alt_plans: [{ plan_id: "annual", authorized_amount_minor: 14400, effective_monthly_cost_minor: 1200, currency: "USD" }], health_score: 93, health_data_status: "complete" },
  { id: "sub_notion", merchant_id: "merchant_notion", merchant_name: "Notion", plan_id: "monthly", current_monthly_cost_minor: 1000, currency: "USD", billing_cycle: "monthly", next_charge_at: "2026-08-03T18:00:00Z", last_used_days_ago: 2, usage_frequency_score: 82, explicit_priority_score: 85, version: 1, capability: "payment", alt_plans: [], health_score: 89, health_data_status: "complete" },
  { id: "sub_coursera", merchant_id: "merchant_coursera", merchant_name: "Coursera Plus", plan_id: "trial", current_monthly_cost_minor: 800, currency: "USD", billing_cycle: "trial", next_charge_at: "2026-08-03T18:00:00Z", last_used_days_ago: null, usage_frequency_score: null, explicit_priority_score: 20, version: 1, capability: "prevention", alt_plans: [], health_score: 37, health_data_status: "insufficient_data" },
];

const POLICY = { policy_id: "policy_demo", version: 1, status: "ACTIVE", policy_text: "Never let total subscriptions exceed $150/month. Cancel or downgrade anything unused 30+ days. Always take annual billing if it saves more than 15%.", compiled_rules: { currency: "USD", rules: [{ rule_id: "monthly_cap", type: "MONTHLY_CAP", amount_minor: 15000 }, { rule_id: "unused_threshold", type: "MAX_INACTIVE_DAYS", days: 30 }, { rule_id: "annual_threshold", type: "MIN_ANNUAL_SAVINGS_BPS", basis_points: 1500 }], unsupported_clauses: [] } };

const runs: Record<string, any> = {};

// ─── Request handler ─────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;
  if (method === "OPTIONS") { res.writeHead(204); return res.end(); }

  let body: any = {};
  if (["POST", "PUT", "PATCH"].includes(method)) body = await readBody(req);

  if (path === "/api/v1/health") return json(res, 200, { status: "ok", mode: environment });
  if (path === "/api/v1/session") {
    const payload = `user_demo.${Date.now()}`; const value = `${payload}.${sign(payload)}`;
    res.setHeader("Set-Cookie", `warden_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${12*60*60*1000}`);
    return json(res, 200, { user_id: "user_demo", csrf_token: sign(`${value}.csrf`), environment, prava_environment: environment, prava_publishable_key: pravaKey, prava_publishable_key_error: null });
  }
  if (path === "/api/v1/subscriptions") return json(res, 200, { subscriptions: SUBS, portfolio_version: 1 });
  if (path === "/api/v1/policies/current" && method === "GET") return json(res, 200, POLICY);
  if (path === "/api/v1/policies/current" && method === "PUT") { const v = POLICY.version + 1; return json(res, 200, { ...POLICY, policy_text: body.policy_text || POLICY.policy_text, version: v, status: "DRAFT" }); }
  if (path.match(/^\/api\/v1\/policies\/[^/]+\/activate$/) && method === "POST") { const v = body.version || POLICY.version; POLICY.version = v; POLICY.status = "ACTIVE"; if (body.policy_text) POLICY.policy_text = body.policy_text; return json(res, 200, POLICY); }
  if (path === "/api/v1/savings") return json(res, 200, { currency: "USD", recurring_monthly_saved_minor: 0, one_time_avoided_minor: 0 });

  if (path === "/api/v1/runs" && method === "POST") {
    const runId = id("run");
    const total = SUBS.reduce((s, sub) => s + sub.current_monthly_cost_minor, 0);
    const decisions = await Promise.all(SUBS.map(async (sub, i) => {
      const candidate = await aiDecide(sub, POLICY.compiled_rules, total);
      let status = "NO_ACTION_REQUIRED", outcome = "decision_only", authorized = 0, effective = sub.current_monthly_cost_minor, savings = 0;
      if (candidate.action === "SWITCH") {
        const target = sub.alt_plans.find((p: any) => p.plan_id === candidate.target_plan) || sub.alt_plans.sort((a: any, b: any) => a.effective_monthly_cost_minor - b.effective_monthly_cost_minor)[0];
        if (target) { effective = target.effective_monthly_cost_minor; authorized = target.authorized_amount_minor; savings = sub.current_monthly_cost_minor - effective; candidate.target_plan = target.plan_id; status = sub.capability === "unverified" ? "RECOMMENDED" : "AWAITING_APPROVAL"; }
        else { candidate.action = "DECLINE"; candidate.target_plan = null; status = "RECOMMENDED"; effective = 0; }
      } else if (candidate.action === "DECLINE") { status = "RECOMMENDED"; effective = 0; }
      if (status !== "AWAITING_APPROVAL") outcome = "decision_only";
      return { decision_id: id("decision"), run_id: runId, subscription_id: sub.id, merchant_name: sub.merchant_name, action: candidate.action, target_plan_id: candidate.target_plan, policy_rule_reference: candidate.policy_rule_reference, reasoning: candidate.reasoning, execution_status: status, outcome_type: outcome, authorized_amount_minor: authorized, effective_monthly_cost_minor: effective, recurring_monthly_savings_minor: savings, one_time_avoided_minor: 0, currency: "USD", failure_code: null, evidence_ids: [], plan_order: i, depends_on_decision_id: null };
    }));
    const needsApproval = decisions.some(d => d.execution_status === "AWAITING_APPROVAL");
    const corrId = id("corr");
    let seq = 1;
    const events: any[] = [];
    const evTime = now();
    const pushEv = (type: string, payload: any, decisionId: string | null = null) => {
      const eid = id("evt");
      const hash = sign(JSON.stringify({ eid, runId, seq, type, evTime, payload }));
      events.push({ event_id: eid, correlation_id: corrId, run_id: runId, decision_id: decisionId, sequence: seq, event_type: type, occurred_at: evTime, payload, previous_event_hash: events.length > 0 ? events[events.length - 1].payload_hash : null, payload_hash: hash });
      seq++;
    };
    pushEv("run_started", { policy_version: 1, portfolio_version: 1 });
    for (const d of decisions) {
      pushEv("decision_recorded", { subscription_id: d.subscription_id, action: d.action, target_plan_id: d.target_plan_id, execution_status: d.execution_status, outcome_type: d.outcome_type }, d.decision_id);
      if (d.execution_status === "AWAITING_APPROVAL") pushEv("approval_required", { decision_id: d.decision_id, merchant: d.merchant_name, action: d.action, amount: d.authorized_amount_minor }, d.decision_id);
    }
    const runStatus = needsApproval ? "EXECUTING" : "COMPLETED";
    pushEv(needsApproval ? "run_ready" : "run_completed", { decisions: decisions.length, run_status: runStatus });
    runs[runId] = { run_id: runId, run_status: runStatus, policy_version: 1, portfolio_snapshot_id: id("snapshot"), portfolio_version: 1, created_at: now(), decisions, events };
    return json(res, 202, { run_id: runId, run_status: runStatus, policy_version: 1, portfolio_snapshot_id: id("snapshot"), portfolio_version: 1, created_at: now(), decisions });
  }
  if (path === "/api/v1/runs/latest") { const last = Object.values(runs).pop(); return json(res, 200, { run: last || null }); }
  if (path.match(/^\/api\/v1\/runs\/[^/]+$/) && (method === "GET" || method === "PATCH")) { const runId = path.split("/").pop()!; return json(res, 200, runs[runId] || { error: "Not found" }); }
  if (path.match(/^\/api\/v1\/runs\/[^/]+\/events$/)) {
    const runId = path.split("/")[4];
    const run = runs[runId] || Object.values(runs).pop();
    return json(res, 200, { events: run?.events || [] });
  }
  if (path.match(/^\/api\/v1\/runs\/[^/]+\/stream$/)) {
    const runId = path.split("/")[4];
    const run = runs[runId] || Object.values(runs).pop();
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    if (run?.events) {
      for (const event of run.events) {
        res.write(`id: ${event.event_id}\nevent: run_event\ndata: ${JSON.stringify(event)}\n\n`);
      }
    }
    res.write(": heartbeat\n\n");
    res.end();
    return;
  }
  if (path.match(/^\/api\/v1\/decisions\/[^/]+\/approval-session$/) && method === "POST") {
    const decisionId = path.split("/")[4];
    const run = Object.values(runs).pop();
    const decision = run?.decisions.find((x: any) => x.decision_id === decisionId);
    if (!decision) return json(res, 404, { error: "Decision not found" });
    // Try real Prava session first
    if (pravaApiKey) {
      try {
        const session = await pravaCreateSession(decision);
        return json(res, 200, {
          execution_attempt_id: id("attempt"),
          mode: "provider",
          label: "Continue checkout on Prava",
          expires_at: session.expires_at || new Date(Date.now() + 5*60000).toISOString(),
          payload: { provider_session_id: session.session_id, provider_session_token: session.session_token, iframe_url: session.iframe_url, order_id: session.order_id, expires_at: session.expires_at || new Date(Date.now() + 5*60000).toISOString() },
        });
      } catch (err: any) {
        console.error("Prava session creation failed:", err.message);
      }
    }
    // Fallback to simulation
    const sessionId = id("ses");
    return json(res, 200, { execution_attempt_id: id("attempt"), mode: "simulation", label: "Approve WARDEN action", expires_at: new Date(Date.now() + 5*60000).toISOString(), payload: { provider_session_id: sessionId, provider_session_token: sign(sessionId), iframe_url: null, order_id: id("ord"), expires_at: new Date(Date.now() + 5*60000).toISOString() } });
  }
  if (path.match(/^\/api\/v1\/decisions\/[^/]+\/attempts$/) && method === "POST") {
    const decisionId = path.split("/")[4];
    const run = Object.values(runs).pop();
    if (run) {
      const d = run.decisions.find((x: any) => x.decision_id === decisionId);
      if (d) {
        d.execution_status = "COMPLETED";
        d.outcome_type = "decision_only";
        const corrId = id("corr");
        const seq = (run.events?.length ?? 0) + 1;
        const evTime = now();
        run.events = run.events || [];
        const pushEv = (type: string, payload: any) => {
          const eid = id("evt");
          const hash = sign(JSON.stringify({ eid, run_id: run.run_id, seq, type, evTime, payload }));
          run.events.push({ event_id: eid, correlation_id: corrId, run_id: run.run_id, decision_id: decisionId, sequence: seq, event_type: type, occurred_at: evTime, payload, previous_event_hash: run.events.length > 0 ? run.events[run.events.length - 1].payload_hash : null, payload_hash: hash });
        };
        pushEv("approval_resolved", { decision_id: decisionId, action: d.action, target_plan: d.target_plan_id, status: "COMPLETED" });
        pushEv("execution_state_changed", { from: "AWAITING_APPROVAL", to: "COMPLETED", outcome_type: "decision_only" });
      }
      if (!run.decisions.some((d: any) => d.execution_status === "AWAITING_APPROVAL")) {
        run.run_status = "COMPLETED";
        const corrId = id("corr");
        const seq = (run.events?.length ?? 0) + 1;
        const evTime = now();
        run.events = run.events || [];
        const hash = sign(JSON.stringify({ eid: id("evt"), run_id: run.run_id, seq, type: "run_completed", evTime }));
        run.events.push({ event_id: id("evt"), correlation_id: corrId, run_id: run.run_id, decision_id: null, sequence: seq, event_type: "run_completed", occurred_at: evTime, payload: { run_status: "COMPLETED" }, previous_event_hash: run.events.length > 0 ? run.events[run.events.length - 1].payload_hash : null, payload_hash: hash });
      }
    }
    return json(res, 200, run || {});
  }
  if (path.match(/^\/api\/v1\/decisions\/[^/]+\/cancel$/) && method === "POST") {
    const run = Object.values(runs).pop();
    if (run) { for (const d of run.decisions) { if (d.execution_status === "AWAITING_APPROVAL") { d.execution_status = "APPROVAL_DECLINED"; d.outcome_type = null; } } run.run_status = "COMPLETED"; }
    return json(res, 200, run || {});
  }
  if (path.match(/^\/api\/v1\/prava\/sessions\/[^/]+\/payment-result$/)) {
    const sessionId = path.split("/")[4];
    if (pravaApiKey) {
      try {
        const result = await pravaRequest(`/v1/sessions/${encodeURIComponent(sessionId)}/payment-result`);
        return json(res, 200, result);
      } catch (err: any) {
        console.error("Prava payment-result failed:", err.message);
      }
    }
    // Simulation fallback
    return json(res, 200, { status: "completed", transactions: [{ txn_id: id("txn"), status: "completed", line_items: [{ txn_ref_id: id("ref"), merchant_name: "Merchant", total_amount: "0.00", status: "completed", token: null, dynamic_cvv: null, expiry_month: null, expiry_year: null }] }] });
  }
  if (path.match(/^\/api\/v1\/prava\/sessions\/[^/]+\/finalize$/) && method === "POST") {
    const run = Object.values(runs).pop();
    if (run) {
      for (const d of run.decisions) {
        if (d.execution_status === "AWAITING_APPROVAL") {
          d.execution_status = "COMPLETED";
          d.outcome_type = "decision_only";
          const corrId = id("corr");
          const seq = (run.events?.length ?? 0) + 1;
          const evTime = now();
          run.events = run.events || [];
          const hash = sign(JSON.stringify({ eid: id("evt"), run_id: run.run_id, seq, type: "approval_resolved", evTime }));
          run.events.push({ event_id: id("evt"), correlation_id: corrId, run_id: run.run_id, decision_id: d.decision_id, sequence: seq, event_type: "approval_resolved", occurred_at: evTime, payload: { decision_id: d.decision_id, action: d.action, target_plan: d.target_plan_id, status: "COMPLETED" }, previous_event_hash: run.events.length > 0 ? run.events[run.events.length - 1].payload_hash : null, payload_hash: hash });
        }
      }
      if (!run.decisions.some((d: any) => d.execution_status === "AWAITING_APPROVAL")) run.run_status = "COMPLETED";
    }
    return json(res, 200, run || {});
  }
  if (path.match(/^\/api\/v1\/evidence\//)) return json(res, 200, { evidence_id: id("ev"), execution_attempt_id: id("attempt"), evidence_type: "checkout_confirmation", provider: "prava", provider_reference: "ref_" + id("ref"), merchant_id: "merchant", authorized_amount_minor: 0, currency: "USD", provider_status: "confirmed", recurrence_stopped: false, occurred_at: now(), verified_at: now(), payload_hash: "sha256:" + id("hash") });

  json(res, 404, { error: { code: "NOT_FOUND", message: "Route not found" } });
}
