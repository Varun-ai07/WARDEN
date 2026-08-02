import cookieParser from "cookie-parser";
import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import { createRunSchema, updatePolicySchema } from "@warden/shared";
import { issueSession, readSession, requireCsrf, requireSession } from "./auth.js";
import { config } from "./config.js";
import { logger, generateCorrelationId } from "./logger.js";
import { HttpError, WardenService } from "./service.js";

const attemptSchema = z.object({ execution_attempt_id: z.string().min(1) });

function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: (error?: unknown) => void) => {
    handler(req, res).catch(next);
  };
}

function requiredIdempotencyKey(req: Request): string {
  const value = req.header("idempotency-key");
  if (!value || value.length < 8 || value.length > 200) throw new HttpError(400, "A valid Idempotency-Key header is required", "IDEMPOTENCY_KEY_REQUIRED");
  return value;
}

export function createApp(service = new WardenService()) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", config.appOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key, If-Match, X-CSRF-Token, Last-Event-ID");
    res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use((req, res, next) => {
    const correlationId = req.header("x-correlation-id") ?? generateCorrelationId();
    const startTime = Date.now();
    res.setHeader("x-correlation-id", correlationId);
    (req as any).correlationId = correlationId;
    res.on("finish", () => {
      const duration = Date.now() - startTime;
      const userId = (req as any).userId;
      logger.info("request", { correlationId, userId, requestId: `${req.method} ${req.path}` }, { status: res.statusCode, duration });
    });
    next();
  });

  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok", mode: config.environment }));

  app.get("/api/v1/session", (req, res) => {
    const existing = readSession(req);
    const session = existing ?? issueSession(res);
    res.json({
      user_id: session.userId,
      csrf_token: session.csrfToken,
      environment: config.environment,
      prava_environment: config.paymentProviderMode === "prava" ? "sandbox" : "simulation",
      prava_publishable_key: config.pravaPublishableKey ?? null,
      prava_publishable_key_error: !config.pravaPublishableKey ? "Set PRAVA_PUBLISHABLE_KEY locally to enable the embedded sandbox card flow." : null,
    });
  });

  app.post("/api/v1/provider-callbacks/:provider", (req, res) => {
    if (!config.pravaWebhookSecret || req.header("x-provider-signature") !== config.pravaWebhookSecret) {
      res.status(401).json({ error: { code: "CALLBACK_SIGNATURE_INVALID", message: "Provider callback authentication failed." } });
      return;
    }
    res.status(501).json({ error: { code: "PROVIDER_CALLBACK_NOT_CONFIGURED", message: "The live provider callback mapper requires the current Prava sandbox contract." } });
  });

  app.get("/api/v1/integrations/prava", (_req, res) => {
    res.json({
      mode: config.paymentProviderMode,
      environment: config.paymentProviderMode === "prava" ? "sandbox" : "simulation",
      publishable_key: config.pravaPublishableKey ?? null,
    });
  });

  app.use("/api/v1", requireSession);

  app.get("/api/v1/subscriptions", (req, res) => {
    res.json({ subscriptions: service.subscriptions(req.userId!), portfolio_version: service.portfolioVersion(req.userId!) });
  });
  app.get("/api/v1/policies/current", (req, res) => res.json(service.activePolicy(req.userId!)));
  app.put("/api/v1/policies/current", asyncRoute(async (req, res) => {
    const body = updatePolicySchema.parse(req.body);
    const ifMatch = Number(req.header("if-match"));
    if (!Number.isInteger(ifMatch)) throw new HttpError(400, "If-Match policy version is required", "IF_MATCH_REQUIRED");
    res.json(await service.draftPolicy(req.userId!, body.policy_text, ifMatch));
  }));
  app.post("/api/v1/policies/:policyId/activate", (req, res) => {
    requiredIdempotencyKey(req);
    const version = z.object({ version: z.number().int().positive() }).parse(req.body).version;
    res.json(service.activatePolicy(req.userId!, req.params.policyId!, version));
  });

  app.post("/api/v1/runs", asyncRoute(async (req, res) => {
    const key = requiredIdempotencyKey(req);
    const body = createRunSchema.parse(req.body);
    const run = await service.createRun(req.userId!, key, body.policy_version, body.expected_portfolio_version);
    res.status(202).json(run);
  }));
  app.get("/api/v1/runs/latest", (req, res) => res.json({ run: service.latestRun(req.userId!) }));

  app.post("/api/v1/dev/test-run", asyncRoute(async (req, res) => {
    const key = req.header("idempotency-key") ?? `dev-test-${Date.now()}`;
    const run = await service.createTestRun(req.userId!, key);
    res.status(202).json(run);
  }));
  app.get("/api/v1/runs/:runId", (req, res) => res.json(service.run(req.params.runId!, req.userId!)));
  app.get("/api/v1/runs/:runId/events", (req, res) => {
    const after = Number(req.query.after_sequence ?? 0);
    res.json({ events: service.events(req.params.runId!, req.userId!, Number.isFinite(after) ? after : 0) });
  });
  app.get("/api/v1/runs/:runId/stream", (req, res) => {
    service.run(req.params.runId!, req.userId!);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const lastEventId = req.header("last-event-id");
    const lastEvent = lastEventId ? service.db.get<Record<string, unknown>>("SELECT sequence FROM ledger_events WHERE event_id=? AND run_id=?", lastEventId, req.params.runId!) : undefined;
    let cursor = Number(lastEvent?.sequence ?? req.query.after_sequence ?? 0);
    const send = () => {
      for (const event of service.events(req.params.runId!, req.userId!, cursor)) {
        res.write(`id: ${event.event_id}\nevent: run_event\ndata: ${JSON.stringify(event)}\n\n`);
        cursor = event.sequence;
      }
    };
    send();
    const poll = setInterval(send, 500);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(poll);
      clearInterval(heartbeat);
    });
  });

  app.post("/api/v1/decisions/:decisionId/approval-session", asyncRoute(async (req, res) => {
    res.json(await service.createApprovalSession(req.userId!, String(req.params.decisionId), requiredIdempotencyKey(req)));
  }));
  app.post("/api/v1/decisions/:decisionId/attempts", asyncRoute(async (req, res) => {
    const body = attemptSchema.parse(req.body);
    res.json(await service.executeAttempt(req.userId!, String(req.params.decisionId), body.execution_attempt_id, requiredIdempotencyKey(req)));
  }));
  app.post("/api/v1/decisions/:decisionId/cancel", (req, res) => {
    res.json(service.declineApproval(req.userId!, String(req.params.decisionId), requiredIdempotencyKey(req)));
  });
  app.get("/api/v1/savings", (req, res) => res.json(service.savings(req.userId!)));
  app.get("/api/v1/prava/sessions/:sessionId/payment-result", asyncRoute(async (req, res) => {
    res.json(await service.pravaPaymentResult(req.userId!, String(req.params.sessionId)));
  }));
  app.post("/api/v1/prava/sessions/:sessionId/finalize", asyncRoute(async (req, res) => {
    res.json(await service.finalizePravaSession(req.userId!, String(req.params.sessionId)));
  }));
  app.get("/api/v1/evidence/:evidenceId", (req, res) => res.json(service.evidence(req.userId!, String(req.params.evidenceId))));

  app.use((error: unknown, req: Request, res: Response, _next: (error?: unknown) => void) => {
    const correlationId = (req as any).correlationId;
    const context = { correlationId, userId: (req as any).userId };

    if (error instanceof z.ZodError) {
      logger.warn("validation_error", context, { issues: error.issues });
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request validation failed", issues: error.issues } });
      return;
    }
    if (error instanceof HttpError) {
      if (error.status >= 500) logger.error("server_error", context, error);
      else logger.warn("client_error", context, { code: error.code, status: error.status });
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    logger.error("unhandled_error", context, error);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } });
  });

  return { app, service };
}
