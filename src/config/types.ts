export interface RetryPolicyConfig {
  maxAttempts: number;
  delayMs: number;
  timeoutMs: number;
}

export interface HermesConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  mode: "sync" | "async";
  retryPolicy: RetryPolicyConfig;
}

export interface OpenWAConfig {
  baseUrl: string;
  sessionId: string;
  apiKey: string;
  apiDocUrl?: string;
  testNumber?: string;
  botMentionAliases: string[];
  retryPolicy: RetryPolicyConfig;
}

export interface LdapConfig {
  enabled: boolean;
  url?: string;
  bindDn?: string;
  bindPassword?: string;
  baseDn?: string;
}

export interface PolicyConfig {
  technicianContactsPath: string;
  authContextSecret: string;
  authContextPolicyVersion: string;
  authContextTtlSeconds: number;
}

export interface AppServerConfig {
  host: string;
  port: number;
}

export interface LoggingConfig {
  level: "debug" | "info" | "warn" | "error";
  format: "json" | "pretty";
}

export interface AppConfig {
  appName: string;
  environment: string;
  server: AppServerConfig;
  logging: LoggingConfig;
  hermes: HermesConfig;
  openwa: OpenWAConfig;
  ldap: LdapConfig;
  policy: PolicyConfig;
}
