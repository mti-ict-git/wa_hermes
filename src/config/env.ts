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

  return {
    appName: getValue("APP_NAME", envFileValues) ?? "wa-plugin-helpdesk",
    environment: getValue("NODE_ENV", envFileValues) ?? "development",
    server: {
      host: getValue("APP_HOST", envFileValues) ?? "127.0.0.1",
      port: getNumberValue("APP_PORT", 8787, envFileValues),
    },
    hermes: {
      baseUrl: getRequiredValue("HERMES_BASE_URL", envFileValues),
      apiKey: getRequiredValue("API_SERVER_KEY", envFileValues),
      mode: getHermesMode(getValue("HERMES_MODE", envFileValues)),
    },
    openwa: {
      baseUrl: getRequiredValue("OPENWA_BASE_URL", envFileValues),
      sessionId: getRequiredValue("OPENWA_SESSION_ID", envFileValues),
      apiKey: getRequiredValue("OPENWA_API_KEY", envFileValues),
      apiDocUrl: getValue("OPENWA_API_DOC", envFileValues),
      testNumber: getValue("OPENWA_NUMBER_TEST", envFileValues),
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
    },
  };
}
