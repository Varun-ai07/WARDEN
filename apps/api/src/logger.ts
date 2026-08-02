import { randomUUID } from "node:crypto";

export interface LogContext {
  correlationId?: string;
  userId?: string;
  requestId?: string;
}

class Logger {
  private format(level: string, message: string, context?: LogContext, data?: unknown): string {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
      ...(data !== undefined ? { data } : {}),
    };
    return JSON.stringify(entry);
  }

  info(message: string, context?: LogContext, data?: unknown) {
    console.log(this.format("info", message, context, data));
  }

  warn(message: string, context?: LogContext, data?: unknown) {
    console.warn(this.format("warn", message, context, data));
  }

  error(message: string, context?: LogContext, error?: unknown) {
    const errorData = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : error !== undefined ? { raw: String(error) } : undefined;
    console.error(this.format("error", message, context, errorData));
  }

  debug(message: string, context?: LogContext, data?: unknown) {
    if (process.env.NODE_ENV !== "production") {
      console.log(this.format("debug", message, context, data));
    }
  }
}

export const logger = new Logger();

export function generateCorrelationId(): string {
  return `corr_${randomUUID().slice(0, 12)}`;
}
