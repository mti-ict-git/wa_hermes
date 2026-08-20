import type { AccessPolicyResult } from "../policy/accessPolicy";
import { parseCommand } from "./commandParser";

export type InboundRoute =
  | "blocked"
  | "silent_ignore"
  | "local_general_command"
  | "local_user_self_service"
  | "local_technician_command"
  | "hermes_helpdesk_chat";

export interface RouteClassification {
  route: InboundRoute;
  reason: string;
  commandName?: string;
  decision: AccessPolicyResult["decision"];
  role: AccessPolicyResult["role"];
}

export class RouteClassifier {
  classify(message: string, policyResult: AccessPolicyResult): RouteClassification {
    const parsedCommand = parseCommand(message);
    if (policyResult.decision === "deny") {
      return {
        route: "blocked",
        reason: policyResult.reason,
        commandName: parsedCommand?.normalizedName,
        decision: policyResult.decision,
        role: policyResult.role,
      };
    }

    return {
      route: policyResult.route,
      reason:
        parsedCommand?.normalizedName && policyResult.route !== "hermes_helpdesk_chat"
          ? `Parsed slash command '${parsedCommand.normalizedName}' for local route ${policyResult.route}.`
          : policyResult.reason,
      commandName: parsedCommand?.normalizedName,
      decision: policyResult.decision,
      role: policyResult.role,
    };
  }
}
