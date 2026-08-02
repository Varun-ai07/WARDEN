import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

import fs from "node:fs";

function loadEnvFiles() {
  const root = resolve(import.meta.dirname, "../../..");
  const files = [resolve(root, ".env"), resolve(import.meta.dirname, ".env"), resolve(root, "apps/api/.env")];
  for (const file of files) {
    try {
      const text = fs.readFileSync(file, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const index = trimmed.indexOf("=");
        if (index === -1) continue;
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim();
        if (!(key in process.env)) process.env[key] = value;
      }
    } catch {
      // Ignore missing files.
    }
  }
}

loadEnvFiles();

export const config = {
  port: Number(process.env.PORT ?? 8787),
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  sessionSecret: process.env.SESSION_SECRET ?? "warden-local-development-secret-change-me",
  databasePath: resolve(root, process.env.DATABASE_PATH ?? "apps/api/data/warden.db"),
  reasonerMode: process.env.REASONER_MODE === "openai" ? "openai" : "fake",
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.6-sol",
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  openrouterModel: process.env.OPENROUTER_MODEL ?? "openrouter/free",
  openrouterReferer: process.env.OPENROUTER_HTTP_REFERER ?? process.env.APP_ORIGIN ?? "http://localhost:5173",
  openrouterTitle: process.env.OPENROUTER_TITLE ?? "WARDEN",
  paymentProviderMode: process.env.PAYMENT_PROVIDER_MODE === "prava" ? "prava" : "fake",
  pravaApiKey: process.env.PRAVA_API_KEY,
  pravaBaseUrl: process.env.PRAVA_BASE_URL,
  pravaPublishableKey: (process.env.PRAVA_PUBLISHABLE_KEY || "").trim() || null,
  pravaWebhookSecret: process.env.PRAVA_WEBHOOK_SECRET,
  environment: process.env.PAYMENT_PROVIDER_MODE === "prava" ? "sandbox" : "simulation",
  production: process.env.NODE_ENV === "production",
} as const;

if (config.production && config.sessionSecret === "warden-local-development-secret-change-me") {
  throw new Error("SESSION_SECRET must be set in production");
}
