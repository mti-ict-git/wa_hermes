export const INTENT_VERSION = "v1" as const;

export const SELF_SERVICE_INTENT_NAMES = ["ad.get_self_profile", "ad.get_self_status", "veeam.lookup_self_related_status"] as const;

export const TECHNICIAN_READ_ONLY_INTENT_NAMES = [
  "ad.lookup_user_profile",
  "ad.lookup_user_status",
  "veeam.lookup_backup_summary",
  "veeam.lookup_job_status",
  "veeam.lookup_restore_points",
] as const;

export const TYPED_INTENT_NAMES = [...SELF_SERVICE_INTENT_NAMES, ...TECHNICIAN_READ_ONLY_INTENT_NAMES] as const;

export type TypedIntentName = (typeof TYPED_INTENT_NAMES)[number];
export type TargetScope = "self" | "resolved_user" | "no_target";
export type TargetRefType = "employee_id" | "username" | "mail" | "phone" | "directory_id";

export interface TypedIntentTargetRef {
  type: TargetRefType;
  value: string;
}

export interface TypedIntentEnvelope {
  intent_version: typeof INTENT_VERSION;
  intent_name: TypedIntentName;
  confidence: number;
  target_scope: TargetScope;
  target_ref: TypedIntentTargetRef | null;
  arguments: Record<string, unknown>;
  reasoning_summary?: string;
  request_id: string;
}

export interface ParsedTypedIntentResult {
  ok: boolean;
  intent?: TypedIntentEnvelope;
  code?: "intent.invalid_schema" | "intent.unknown_name";
  reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTypedIntentName(value: unknown): value is TypedIntentName {
  return typeof value === "string" && TYPED_INTENT_NAMES.includes(value as TypedIntentName);
}

function isTargetScope(value: unknown): value is TargetScope {
  return value === "self" || value === "resolved_user" || value === "no_target";
}

function isTargetRef(value: unknown): value is TypedIntentTargetRef | null {
  if (value === null) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.type === "string" &&
    ["employee_id", "username", "mail", "phone", "directory_id"].includes(value.type) &&
    typeof value.value === "string" &&
    value.value.trim().length > 0
  );
}

export function parseTypedIntentCandidate(value: unknown): ParsedTypedIntentResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      code: "intent.invalid_schema",
      reason: "Typed intent payload must be an object.",
    };
  }

  if (!isTypedIntentName(value.intent_name)) {
    return {
      ok: false,
      code: typeof value.intent_name === "string" ? "intent.unknown_name" : "intent.invalid_schema",
      reason: "Typed intent name is missing or not allowlisted.",
    };
  }

  if (
    value.intent_version !== INTENT_VERSION ||
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    !isTargetScope(value.target_scope) ||
    !isTargetRef(value.target_ref) ||
    !isRecord(value.arguments) ||
    typeof value.request_id !== "string" ||
    value.request_id.trim().length === 0
  ) {
    return {
      ok: false,
      code: "intent.invalid_schema",
      reason: "Typed intent payload failed schema validation.",
    };
  }

  if (value.reasoning_summary !== undefined && typeof value.reasoning_summary !== "string") {
    return {
      ok: false,
      code: "intent.invalid_schema",
      reason: "Typed intent reasoning_summary must be a string when present.",
    };
  }

  return {
    ok: true,
    intent: {
      intent_version: INTENT_VERSION,
      intent_name: value.intent_name,
      confidence: value.confidence,
      target_scope: value.target_scope,
      target_ref: value.target_ref,
      arguments: value.arguments,
      reasoning_summary: value.reasoning_summary,
      request_id: value.request_id.trim(),
    },
  };
}
