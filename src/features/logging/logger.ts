import type { LoggingConfig } from "../../config/types";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerContext {
  [key: string]: unknown;
}

type LogFormat = LoggingConfig["format"];

function serializeError(error: Error): Record<string, string> {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack ?? "",
  };
}

function sanitizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, sanitizeValue(entry)]),
    );
  }

  return value;
}

export function maskPhone(value: string | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 6) {
    return digits || "unknown";
  }

  return `${digits.slice(0, 5)}xxxx${digits.slice(-4)}`;
}

export class Logger {
  constructor(
    private readonly scope: string,
    private readonly minLevel: LogLevel = "info",
    private readonly format: LogFormat = "json",
  ) {}

  child(scope: string): Logger {
    return new Logger(`${this.scope}.${scope}`, this.minLevel, this.format);
  }

  debug(event: string, context: LoggerContext = {}): void {
    this.write("debug", event, context);
  }

  info(event: string, context: LoggerContext = {}): void {
    this.write("info", event, context);
  }

  warn(event: string, context: LoggerContext = {}): void {
    this.write("warn", event, context);
  }

  error(event: string, context: LoggerContext = {}): void {
    this.write("error", event, context);
  }

  audit(event: string, context: LoggerContext = {}): void {
    this.write("info", event, { category: "audit", ...context });
  }

  private write(level: LogLevel, event: string, context: LoggerContext): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.minLevel]) {
      return;
    }

    const sanitizedContext = sanitizeValue(context);
    const payload = {
      ts: new Date().toISOString(),
      level,
      scope: this.scope,
      event,
      ...(sanitizedContext && typeof sanitizedContext === "object" && !Array.isArray(sanitizedContext)
        ? sanitizedContext
        : {}),
    };

    const line = this.format === "pretty" ? this.formatPrettyLine(payload) : JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
      return;
    }

    if (level === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  }

  private formatPrettyLine(payload: {
    ts: string;
    level: LogLevel;
    scope: string;
    event: string;
    [key: string]: unknown;
  }): string {
    const { ts, level, scope, event, ...context } = payload;
    const renderedContext = Object.entries(context)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${this.renderPrettyValue(value)}`)
      .join(" ");

    return renderedContext
      ? `[${ts}] ${level.toUpperCase()} ${scope} ${event} ${renderedContext}`
      : `[${ts}] ${level.toUpperCase()} ${scope} ${event}`;
  }

  private renderPrettyValue(value: unknown): string {
    if (typeof value === "string") {
      return JSON.stringify(value);
    }

    if (typeof value === "number" || typeof value === "boolean" || value === null) {
      return String(value);
    }

    return JSON.stringify(value);
  }
}

export function createRootLogger(config: LoggingConfig): Logger {
  return new Logger("wa-plugin", config.level, config.format);
}
