import { createServer } from "node:http";
import { createHmac } from "node:crypto";

const environment = process.env.PAYMENT_PROVIDER_MODE === "prava" ? "sandbox" : "demo";
const sessionSecret = process.env.SESSION_SECRET || "warden-local-dev";

function sign(value: string) { return createHmac("sha256", sessionSecret).update(value).digest("base64url"); }

function json(res: any, status: number, data: any) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// Pre-load the full app in background
let _app: any = null;
let _loading = false;
let _loaded = false;

async function loadApp() {
  if (_loaded || _loading) return;
  _loading = true;
  try {
    const mod = await import("./warden-app.js");
    _app = mod.default || mod;
    if (typeof _app !== "function") _app = null;
  } catch (err: any) {
    console.error("Backend load failed:", err.message);
  }
  _loaded = true;
}

loadApp();

export default async function handler(req: any, res: any) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // Health — instant, no deps
  if (path === "/api/v1/health") {
    return json(res, 200, { status: "ok", mode: environment });
  }

  // Session — instant, no deps
  if (path === "/api/v1/session") {
    const payload = `user_demo.${Date.now()}`;
    const value = `${payload}.${sign(payload)}`;
    const csrfToken = sign(`${value}.csrf`);
    const cookie = `warden_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${12*60*60}`;
    res.setHeader("Set-Cookie", cookie);
    return json(res, 200, { user_id: "user_demo", csrf_token: csrfToken, environment, prava_environment: environment, prava_publishable_key: process.env.PRAVA_PUBLISHABLE_KEY || null, prava_publishable_key_error: null });
  }

  // All other routes — delegate to full app
  if (!_app) {
    await loadApp();
  }
  if (_app) {
    return _app(req, res, (err: any) => {
      if (err) return json(res, 500, { error: { code: "INTERNAL_ERROR", message: String(err) } });
      json(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
    });
  }
  json(res, 500, { error: { code: "BACKEND_UNAVAILABLE", message: "API backend not ready yet — retry in a moment" } });
}
