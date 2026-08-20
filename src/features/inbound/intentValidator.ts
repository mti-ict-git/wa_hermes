import type { SignedAuthContext } from "../security/authContext";
import { AuthContextService } from "../security/authContext";
import type { TypedIntentEnvelope, TypedIntentName, TypedIntentTargetRef } from "./typedIntent";
import {
  CONTROL_INTENT_NAMES,
  SELF_SERVICE_INTENT_NAMES,
  TECHNICIAN_READ_ONLY_INTENT_NAMES,
  parseTypedIntentCandidate,
} from "./typedIntent";

const CONTROL_INTENT_SET = new Set<string>(CONTROL_INTENT_NAMES);
const SELF_SERVICE_INTENT_SET = new Set<string>(SELF_SERVICE_INTENT_NAMES);
const TECHNICIAN_READ_ONLY_INTENT_SET = new Set<string>(TECHNICIAN_READ_ONLY_INTENT_NAMES);

export interface IntentValidatorInput {
  authContext: SignedAuthContext;
  typedIntentCandidate: unknown;
}

export interface ValidatedIntentResult {
  allowed: boolean;
  validatedIntentName: TypedIntentName | null;
  validatedTargetScope: TypedIntentEnvelope["target_scope"] | null;
  validatedTargetRef: TypedIntentTargetRef | null;
  normalizedArguments: Record<string, unknown> | null;
  denialCode:
    | null
    | "auth.invalid_signature"
    | "auth.expired"
    | "auth.invalid_schema"
    | "intent.invalid_schema"
    | "intent.unknown_name"
    | "intent.role_denied"
    | "intent.target_scope_denied"
    | "intent.arguments_invalid";
  reason: string;
}

const ALLOWED_ARGUMENTS_BY_INTENT: Record<TypedIntentName, readonly string[]> = {
  "helpdesk.no_backend_action": [],
  "ad.get_self_profile": ["fields"],
  "ad.get_self_status": [],
  "veeam.lookup_self_related_status": ["date_range"],
  "ad.lookup_user_profile": ["fields"],
  "ad.lookup_user_status": [],
  "veeam.lookup_backup_summary": ["date_range", "job_name"],
  "veeam.lookup_job_status": ["job_name", "date_range"],
  "veeam.lookup_restore_points": ["job_name", "date_range"],
};

export class IntentValidator {
  constructor(private readonly authContextService: AuthContextService) {}

  validate(input: IntentValidatorInput): ValidatedIntentResult {
    const authVerification = this.authContextService.verify(input.authContext);
    if (!authVerification.valid) {
      return {
        allowed: false,
        validatedIntentName: null,
        validatedTargetScope: null,
        validatedTargetRef: null,
        normalizedArguments: null,
        denialCode: authVerification.code === "ok" ? "auth.invalid_schema" : authVerification.code,
        reason: authVerification.reason,
      };
    }

    const parsedIntent = parseTypedIntentCandidate(input.typedIntentCandidate);
    if (!parsedIntent.ok || !parsedIntent.intent) {
      return {
        allowed: false,
        validatedIntentName: null,
        validatedTargetScope: null,
        validatedTargetRef: null,
        normalizedArguments: null,
        denialCode: parsedIntent.code ?? "intent.invalid_schema",
        reason: parsedIntent.reason ?? "Typed intent parsing failed.",
      };
    }

    const intent = parsedIntent.intent;
    if (intent.request_id !== input.authContext.request_id) {
      return {
        allowed: false,
        validatedIntentName: null,
        validatedTargetScope: null,
        validatedTargetRef: null,
        normalizedArguments: null,
        denialCode: "intent.invalid_schema",
        reason: "Typed intent request_id does not match AuthContext request_id.",
      };
    }

    if (!this.isRoleAllowed(input.authContext.role, intent.intent_name)) {
      return {
        allowed: false,
        validatedIntentName: null,
        validatedTargetScope: null,
        validatedTargetRef: null,
        normalizedArguments: null,
        denialCode: "intent.role_denied",
        reason: `Role '${input.authContext.role}' is not allowed to execute '${intent.intent_name}'.`,
      };
    }

    if (!this.isTargetScopeAllowed(input.authContext.role, intent.target_scope, intent.target_ref)) {
      return {
        allowed: false,
        validatedIntentName: null,
        validatedTargetScope: null,
        validatedTargetRef: null,
        normalizedArguments: null,
        denialCode: "intent.target_scope_denied",
        reason: "Typed intent target scope is not allowed for the resolved role.",
      };
    }

    const normalizedArguments = this.normalizeArguments(intent.intent_name, intent.arguments);
    if (!normalizedArguments) {
      return {
        allowed: false,
        validatedIntentName: null,
        validatedTargetScope: null,
        validatedTargetRef: null,
        normalizedArguments: null,
        denialCode: "intent.arguments_invalid",
        reason: "Typed intent arguments contain unsupported keys or invalid values.",
      };
    }

    return {
      allowed: true,
      validatedIntentName: intent.intent_name,
      validatedTargetScope: intent.target_scope,
      validatedTargetRef: intent.target_ref,
      normalizedArguments,
      denialCode: null,
      reason: "Typed intent is allowed.",
    };
  }

  private isRoleAllowed(role: SignedAuthContext["role"], intentName: TypedIntentName): boolean {
    if (CONTROL_INTENT_SET.has(intentName)) {
      return role === "user" || role === "technician";
    }

    if (role === "technician") {
      return TECHNICIAN_READ_ONLY_INTENT_SET.has(intentName) || SELF_SERVICE_INTENT_SET.has(intentName);
    }

    if (role === "user") {
      return SELF_SERVICE_INTENT_SET.has(intentName);
    }

    return false;
  }

  private isTargetScopeAllowed(
    role: SignedAuthContext["role"],
    targetScope: TypedIntentEnvelope["target_scope"],
    targetRef: TypedIntentEnvelope["target_ref"],
  ): boolean {
    if (targetScope === "no_target" && targetRef === null) {
      return role === "user" || role === "technician";
    }

    if (role === "user") {
      return targetScope === "self" && targetRef === null;
    }

    if (role === "technician") {
      if (targetScope === "self" && targetRef === null) {
        return true;
      }

      return targetScope === "resolved_user" && Boolean(targetRef);
    }

    return false;
  }

  private normalizeArguments(
    intentName: TypedIntentName,
    value: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const allowedKeys = ALLOWED_ARGUMENTS_BY_INTENT[intentName];
    const normalized: Record<string, unknown> = {};

    for (const [key, rawValue] of Object.entries(value)) {
      if (!allowedKeys.includes(key)) {
        return null;
      }

      if (typeof rawValue === "string") {
        normalized[key] = rawValue.trim();
        continue;
      }

      if (Array.isArray(rawValue) && rawValue.every((entry) => typeof entry === "string")) {
        normalized[key] = rawValue.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
        continue;
      }

      if (rawValue === null) {
        normalized[key] = null;
        continue;
      }

      return null;
    }

    return normalized;
  }
}
