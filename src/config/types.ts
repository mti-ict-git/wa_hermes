export interface HermesConfig {
  baseUrl: string;
  apiKey: string;
  mode: "sync" | "async";
}

export interface OpenWAConfig {
  baseUrl: string;
  sessionId: string;
  apiKey: string;
  apiDocUrl?: string;
  testNumber?: string;
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
}

export interface AppServerConfig {
  host: string;
  port: number;
}

export interface AppConfig {
  appName: string;
  environment: string;
  server: AppServerConfig;
  hermes: HermesConfig;
  openwa: OpenWAConfig;
  ldap: LdapConfig;
  policy: PolicyConfig;
}
