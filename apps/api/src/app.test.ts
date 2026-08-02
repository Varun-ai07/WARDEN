import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { WardenDb } from "./db.js";
import { FakeExecutionProvider } from "./provider.js";
import { FakeReasoner } from "./reasoner.js";
import { WardenService } from "./service.js";

test("API requires a signed session and CSRF token", async () => {
  const service = new WardenService(new WardenDb(":memory:"), new FakeReasoner(), new FakeExecutionProvider());
  const { app } = createApp(service);
  await request(app).get("/api/v1/subscriptions").expect(401);

  const agent = request.agent(app);
  const session = await agent.get("/api/v1/session").expect(200);
  assert.equal(session.body.environment, config.environment);
  assert.equal(session.body.prava_environment, config.paymentProviderMode === "prava" ? "sandbox" : "simulation");
  assert.equal(session.body.prava_publishable_key ?? null, config.pravaPublishableKey ?? null);
  const run = await agent
    .post("/api/v1/runs")
    .set("Idempotency-Key", "api-run-key")
    .set("X-CSRF-Token", session.body.csrf_token)
    .send({ policy_version: 1, expected_portfolio_version: 1 })
    .expect(202);
  assert.match(run.body.run_id, /^run_/);
  service.db.close();
});
