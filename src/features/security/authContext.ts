import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export type AuthContextRole = "unregistered" | "user" | "technician";
export type AuthContextChatType = "private" | "group" | "unknown";

export interface AuthContextClaims {
  auth_version: "v1";
  source: "openwa";
  chat_id: string;
  chat_type: AuthContextChatType;
  sender_id: string;
  sender_phone?: string;
  role: AuthContextRole;
  is_registered_user: boolean;
  session_key: string;
  session_id?: string;
  policy_version: string;
  request_id: string;
  issued_at: string;
  expires_at: string;
  nonce: string;
}

export interface SignedAuthContext extends AuthContextClaims {
  signature: string;
}

export interface AuthContextCreateInput {
  chatId: string;
  chatType: AuthContextChatType;
  senderId: string;
  senderPhone?: string;
  role: AuthContextRole;
  isRegisteredUser: boolean;
  sessionKey: string;
  sessionId?: string;
  policyVersion: string;
  source?: "openwa";
  requestId?: string;
  issuedAt?: Date;
  ttlSeconds?: number;
}

export interface AuthContextServiceOptions {
  ttlSeconds?: number;
  now?: () => Date;
}

export interface AuthContextVerificationResult {
  valid: boolean;
  code: "ok" | "auth.invalid_signature" | "auth.expired" | "auth.invalid_schema";
  reason: string;
}

const DEFAULT_TTL_SECONDS = 120;

const AUTH_CONTEXT_FIELDS: Array<keyof AuthContextClaims> = [
  "auth_version",
  "source",
  "chat_id",
  "chat_type",
  "sender_id",
  "sender_phone",
  "role",
  "is_registered_user",
  "session_key",
  "session_id",
  "policy_version",
  "request_id",
  "issued_at",
  "expires_at",
  "nonce",
];

export class AuthContextService {
  private readonly ttlSeconds: number;
  private readonly now: () => Date;

  constructor(
    private readonly secret: string,
    options: AuthContextServiceOptions = {},
  ) {
    if (!secret.trim()) {
      throw new Error("AuthContextService requires a non-empty HMAC secret.");
    }

    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.now = options.now ?? (() => new Date());
  }

  create(input: AuthContextCreateInput): SignedAuthContext {
    const issuedAt = input.issuedAt ?? this.now();
    const ttlSeconds = input.ttlSeconds ?? this.ttlSeconds;
    const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);

    const claims: AuthContextClaims = {
      auth_version: "v1",
      source: input.source ?? "openwa",
      chat_id: input.chatId,
      chat_type: input.chatType,
      sender_id: input.senderId,
      sender_phone: input.senderPhone,
      role: input.role,
      is_registered_user: input.isRegisteredUser,
      session_key: input.sessionKey,
      session_id: input.sessionId,
      policy_version: input.policyVersion,
      request_id: input.requestId ?? randomUUID(),
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      nonce: randomBytes(16).toString("base64url"),
    };

    return {
      ...claims,
      signature: this.signClaims(claims),
    };
  }

  verify(context: SignedAuthContext): AuthContextVerificationResult {
    if (!this.hasValidShape(context)) {
      return {
        valid: false,
        code: "auth.invalid_schema",
        reason: "AuthContext is missing required fields or has invalid types.",
      };
    }

    const claims = this.toClaims(context);
    const expectedSignature = this.signClaims(claims);
    const providedSignature = context.signature.trim();

    if (!this.safeSignatureEquals(providedSignature, expectedSignature)) {
      return {
        valid: false,
        code: "auth.invalid_signature",
        reason: "AuthContext signature verification failed.",
      };
    }

    const nowMs = this.now().getTime();
    const expiresAtMs = Date.parse(context.expires_at);

    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
      return {
        valid: false,
        code: "auth.expired",
        reason: "AuthContext is expired.",
      };
    }

    return {
      valid: true,
      code: "ok",
      reason: "AuthContext is valid.",
    };
  }

  private signClaims(claims: AuthContextClaims): string {
    return createHmac("sha256", this.secret).update(this.serializeClaims(claims)).digest("base64url");
  }

  private serializeClaims(claims: AuthContextClaims): string {
    return AUTH_CONTEXT_FIELDS.map((field) => `${field}=${this.normalizeValue(claims[field])}`).join("\n");
  }

  private normalizeValue(value: AuthContextClaims[keyof AuthContextClaims]): string {
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }

    return value ?? "";
  }

  private safeSignatureEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private hasValidShape(context: SignedAuthContext): boolean {
    return Boolean(
      context &&
        typeof context.auth_version === "string" &&
        typeof context.source === "string" &&
        typeof context.chat_id === "string" &&
        typeof context.chat_type === "string" &&
        typeof context.sender_id === "string" &&
        typeof context.role === "string" &&
        typeof context.is_registered_user === "boolean" &&
        typeof context.session_key === "string" &&
        typeof context.policy_version === "string" &&
        typeof context.request_id === "string" &&
        typeof context.issued_at === "string" &&
        typeof context.expires_at === "string" &&
        typeof context.nonce === "string" &&
        typeof context.signature === "string",
    );
  }

  private toClaims(context: SignedAuthContext): AuthContextClaims {
    return {
      auth_version: context.auth_version,
      source: context.source,
      chat_id: context.chat_id,
      chat_type: context.chat_type,
      sender_id: context.sender_id,
      sender_phone: context.sender_phone,
      role: context.role,
      is_registered_user: context.is_registered_user,
      session_key: context.session_key,
      session_id: context.session_id,
      policy_version: context.policy_version,
      request_id: context.request_id,
      issued_at: context.issued_at,
      expires_at: context.expires_at,
      nonce: context.nonce,
    };
  }
}
