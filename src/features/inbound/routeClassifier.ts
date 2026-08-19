export type InboundRoute =
  | "blocked"
  | "local_general_command"
  | "local_user_self_service"
  | "local_technician_command"
  | "hermes_helpdesk_chat";

export interface RouteClassification {
  route: InboundRoute;
  reason: string;
}

export class RouteClassifier {
  classify(message: string): RouteClassification {
    if (message.trim().startsWith("/")) {
      return {
        route: "local_general_command",
        reason: "Slash commands are reserved for local handling.",
      };
    }

    return {
      route: "hermes_helpdesk_chat",
      reason: "Free-text messages are routed to the helpdesk broker.",
    };
  }
}
