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
    res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS,PATCH");
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
      prava_environment: config.environment,
      prava_publishable_key: config.pravaPublishableKey,
      prava_publishable_key_error: null,
    });
  });

  app.get("/api/v1/subscriptions", requireSession, asyncRoute(async (req, res) => {
    res.json({ subscriptions: await service.subscriptions(req.userId!), portfolio_version: await service.portfolioVersion(req.userId!) });
  }));

  app.get("/api/v1/policies/current", requireSession, asyncRoute(async (req, res) => {
    res.json(await service.activePolicy(req.userId!));
  }));

  app.put("/api/v1/policies/current", requireSession, asyncRoute(async (req, res) => {
    const body = updatePolicySchema.parse(req.body);
    const current = await service.activePolicy(req.userId!);
    res.json(await service.draftPolicy(req.userId!, body.policy_text, Number(req.header("if-match") ?? current.version)));
  }));

  app.post("/api/v1/policies/:policyId/activate", requireSession, asyncRoute(async (req, res) => {
    requiredIdempotencyKey(req);
    const version = z.object({ version: z.number().int().positive() }).parse(req.body).version;
    const policyId = String(req.params.policyId);
    res.json(await service.activatePolicy(req.userId!, policyId, version));
  }));

  app.post("/api/v1/runs", requireSession, asyncRoute(async (req, res) => {
    const key = requiredIdempotencyKey(req);
    const body = createRunSchema.parse(req.body);
    const run = await service.createRun(req.userId!, key, body.policy_version, body.expected_portfolio_version);
    res.status(202).json(run);
  }));
  app.get("/api/v1/runs/latest", requireSession, asyncRoute(async (req, res) => {
    res.json({ run: await service.latestRun(req.userId!) });
  }));

  app.get("/api/v1/runs/:runId", requireSession, asyncRoute(async (req, res) => {
    res.json(await service.run(String(req.params.runId), req.userId!));
  }));
  app.patch("/api/v1/runs/:runId", requireSession, asyncRoute(async (req, res) => {
    res.json(await service.run(String(req.params.runId), req.userId!));
  }));
  app.get("/api/v1/runs/:runId/events", requireSession, asyncRoute(async (req, res) => {
    const after = Number(String(req.query.after_sequence ?? 0));
    res.json({ events: await service.events(String(req.params.runId), req.userId!, Number.isFinite(after) ? after : 0) });
  }));
  app.get("/api/v1/runs/:runId/stream", requireSession, asyncRoute(async (req, res) => {
    const runId = String(req.params.runId);
    await service.run(runId, req.userId!);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const lastEventId = req.header("last-event-id");
    const lastEvent = lastEventId ? await service.db.get<Record<string, unknown>>("SELECT sequence FROM ledger_events WHERE event_id=$1 AND run_id=$2", lastEventId, runId) : undefined;
    let cursor = Number(lastEvent?.sequence ?? req.query.after_sequence ?? 0);
    const send = async () => {
      for (const event of await service.events(runId, req.userId!, cursor)) {
        res.write(`id: ${event.event_id}\nevent: run_event\ndata: ${JSON.stringify(event)}\n\n`);
        cursor = event.sequence;
      }
    };
    await send();
    const poll = setInterval(() => { send().catch(() => {}); }, 500);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(poll);
      clearInterval(heartbeat);
    });
  }));

  app.post("/api/v1/decisions/:decisionId/approval-session", requireSession, asyncRoute(async (req, res) => {
    res.json(await service.createApprovalSession(req.userId!, String(req.params.decisionId), requiredIdempotencyKey(req)));
  }));
  app.post("/api/v1/decisions/:decisionId/attempts", requireSession, asyncRoute(async (req, res) => {
    const body = attemptSchema.parse(req.body);
    res.json(await service.executeAttempt(req.userId!, String(req.params.decisionId), body.execution_attempt_id, requiredIdempotencyKey(req)));
  }));
  app.post("/api/v1/decisions/:decisionId/cancel", requireSession, asyncRoute(async (req, res) => {
    res.json(await service.declineApproval(req.userId!, String(req.params.decisionId), requiredIdempotencyKey(req)));
  }));
  app.get("/api/v1/savings", requireSession, asyncRoute(async (req, res) => {
    res.json(await service.savings(req.userId!));
  }));
  app.get("/api/v1/prava/sessions/:sessionId/payment-result", requireSession, asyncRoute(async (req, res) => {
    res.json(await service.pravaPaymentResult(req.userId!, String(req.params.sessionId)));
  }));
  app.post("/api/v1/prava/sessions/:sessionId/finalize", requireSession, asyncRoute(async (req, res) => {
    res.json(await service.finalizePravaSession(req.userId!, String(req.params.sessionId)));
  }));
  app.get("/api/v1/evidence/:evidenceId", requireSession, asyncRoute(async (req, res) => {
    res.json(await service.evidence(req.userId!, String(req.params.evidenceId)));
  }));

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
