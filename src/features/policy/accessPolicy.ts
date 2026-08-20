import type { IdentityContext } from "./identityResolver";

export type AccessDecision = "allow" | "deny";
export type RouteTarget =
  | "blocked"
  | "silent_ignore"
  | "local_general_command"
  | "local_user_self_service"
  | "local_technician_command"
  | "hermes_helpdesk_chat";

export interface AccessPolicyResult {
  decision: AccessDecision;
  route: RouteTarget;
  reason: string;
  role: IdentityContext["role"];
}

export class AccessPolicy {
  evaluateMessage(identity: IdentityContext, message: string): AccessPolicyResult {
    if (!identity.isRegisteredUser) {
      return {
        decision: "deny",
        route: "blocked",
        reason: "Nomor Anda belum terdaftar di directory perusahaan. Hubungi ICT Helpdesk.",
        role: identity.role,
      };
    }

    if (identity.chatType !== "private") {
      return {
        decision: "deny",
        route: "blocked",
        reason: "Helpdesk chat currently requires private chat.",
        role: identity.role,
      };
    }

    const command = this.getCommandName(message);
    if (command) {
      return this.evaluateCommand(identity, command);
    }

    return {
      decision: "allow",
      route: "hermes_helpdesk_chat",
      reason: "Registered private-chat sender may continue to the helpdesk conversation flow.",
      role: identity.role,
    };
  }

  evaluateFreeText(identity: IdentityContext): AccessPolicyResult {
    return this.evaluateMessage(identity, "");
  }

  private evaluateCommand(identity: IdentityContext, command: string): AccessPolicyResult {
    return {
      decision: "allow",
      route: "silent_ignore",
      reason: `Slash command '/${command.toLowerCase()}' is ignored in private chat by policy.`,
      role: identity.role,
    };
  }

  private getCommandName(message: string): string | undefined {
    const trimmed = message.trim();
    if (!trimmed.startsWith("/")) {
      return undefined;
    }

    const withoutSlash = trimmed.slice(1).trim();
    const [command] = withoutSlash.split(/\s+/, 1);
    return command?.trim();
  }
}
