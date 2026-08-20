import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { AppConfig } from "./types";

const DEFAULT_ENV_PATH = resolve(process.cwd(), ".env");

function normalizeEnvValue(rawValue: string | undefined): string | undefined {
  if (rawValue === undefined) {
    return undefined;
  }

  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function loadEnvFile(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, "utf8");
    const values: Record<string, string> = {};

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (key) {
        values[key] = value;
      }
    }

    return values;
  } catch {
    return {};
  }
}

function getValue(key: string, envFileValues: Record<string, string>): string | undefined {
  const processValue = normalizeEnvValue(process.env[key]);
  if (processValue) {
    return processValue;
  }

  const fileValue = normalizeEnvValue(envFileValues[key]);
  return fileValue || undefined;
}

function getRequiredValue(key: string, envFileValues: Record<string, string>): string {
  const value = getValue(key, envFileValues);
  if (!value) {
    throw new Error(`Missing required configuration value: ${key}`);
  }
  return value;
}

function getNumberValue(
  key: string,
  fallback: number,
  envFileValues: Record<string, string>,
): number {
  const value = getValue(key, envFileValues);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric configuration value: ${key}`);
  }

  return parsed;
}

function getHermesMode(rawValue: string | undefined): "sync" | "async" {
  return rawValue?.toLowerCase() === "async" ? "async" : "sync";
}

function getLogLevel(rawValue: string | undefined): "debug" | "info" | "warn" | "error" {
  const normalized = rawValue?.toLowerCase();
  if (normalized === "debug" || normalized === "warn" || normalized === "error") {
    return normalized;
  }

  return "info";
}

function getLogFormat(rawValue: string | undefined, environment: string): "json" | "pretty" {
  const normalized = rawValue?.toLowerCase();
  if (normalized === "json" || normalized === "pretty") {
    return normalized;
  }

  return environment === "production" ? "json" : "pretty";
}

function getListValue(key: string, envFileValues: Record<string, string>): string[] {
  const value = getValue(key, envFileValues);
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function hasLdapConfiguration(envFileValues: Record<string, string>): boolean {
  return Boolean(
    getValue("LDAP_URL", envFileValues) &&
      (getValue("BIND_DN", envFileValues) || getValue("LDAP_USERNAME", envFileValues)) &&
      (getValue("BIND_PW", envFileValues) || getValue("LDAP_PASSWORD", envFileValues)) &&
      (getValue("BASE_OU", envFileValues) || getValue("LDAP_BASE_DN", envFileValues)),
  );
}

export function loadConfig(envPath = DEFAULT_ENV_PATH): AppConfig {
  const envFileValues = loadEnvFile(envPath);
  const environment = getValue("NODE_ENV", envFileValues) ?? "development";

  return {
    appName: getValue("APP_NAME", envFileValues) ?? "wa-plugin-helpdesk",
    environment,
    server: {
      host: getValue("APP_HOST", envFileValues) ?? "127.0.0.1",
      port: getNumberValue("APP_PORT", 8787, envFileValues),
    },
    logging: {
      level: getLogLevel(getValue("LOG_LEVEL", envFileValues)),
      format: getLogFormat(getValue("LOG_FORMAT", envFileValues), environment),
    },
    hermes: {
      baseUrl: getRequiredValue("HERMES_BASE_URL", envFileValues),
      apiKey: getRequiredValue("API_SERVER_KEY", envFileValues),
      model: getValue("HERMES_MODEL", envFileValues) ?? "marisa",
      mode: getHermesMode(getValue("HERMES_MODE", envFileValues)),
      retryPolicy: {
        maxAttempts: getNumberValue("HERMES_MAX_ATTEMPTS", 2, envFileValues),
        delayMs: getNumberValue("HERMES_RETRY_DELAY_MS", 500, envFileValues),
        timeoutMs: getNumberValue("HERMES_TIMEOUT_MS", 20000, envFileValues),
      },
    },
    openwa: {
      baseUrl: getRequiredValue("OPENWA_BASE_URL", envFileValues),
      sessionId: getRequiredValue("OPENWA_SESSION_ID", envFileValues),
      apiKey: getRequiredValue("OPENWA_API_KEY", envFileValues),
      apiDocUrl: getValue("OPENWA_API_DOC", envFileValues),
      testNumber: getValue("OPENWA_NUMBER_TEST", envFileValues),
      botMentionAliases: getListValue("OPENWA_BOT_MENTION_ALIASES", envFileValues),
      retryPolicy: {
        maxAttempts: getNumberValue("OPENWA_MAX_ATTEMPTS", 2, envFileValues),
        delayMs: getNumberValue("OPENWA_RETRY_DELAY_MS", 500, envFileValues),
        timeoutMs: getNumberValue("OPENWA_TIMEOUT_MS", 15000, envFileValues),
      },
    },
    ldap: {
      enabled: (getValue("LDAP_ENABLED", envFileValues) ?? String(hasLdapConfiguration(envFileValues))) === "true",
      url: getValue("LDAP_URL", envFileValues),
      bindDn: getValue("BIND_DN", envFileValues) ?? getValue("LDAP_USERNAME", envFileValues),
      bindPassword: getValue("BIND_PW", envFileValues) ?? getValue("LDAP_PASSWORD", envFileValues),
      baseDn: getValue("BASE_OU", envFileValues) ?? getValue("LDAP_BASE_DN", envFileValues),
    },
    policy: {
      technicianContactsPath:
        getValue("TECHNICIAN_CONTACTS_PATH", envFileValues) ??
        resolve(process.cwd(), "reference", "whatsapp_openwa", "technicianContacts.json"),
      authContextSecret: getValue("AUTH_CONTEXT_SECRET", envFileValues) ?? getRequiredValue("API_SERVER_KEY", envFileValues),
      authContextPolicyVersion: getValue("AUTH_CONTEXT_POLICY_VERSION", envFileValues) ?? "2026-08-20",
      authContextTtlSeconds: getNumberValue("AUTH_CONTEXT_TTL_SECONDS", 120, envFileValues),
    },
  };
}
