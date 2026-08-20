import type { HelpdeskBroker } from "../hermes/helpdeskBroker";
import type { Logger } from "../logging/logger";
import { maskPhone } from "../logging/logger";
import type { NormalizedInboundEvent } from "../openwa/types";
import type { AccessPolicy } from "../policy/accessPolicy";
import type { IdentityContext } from "../policy/identityResolver";
import { parseCommand } from "./commandParser";
import type { RouteClassification } from "./routeClassifier";
import type { RouteClassifier } from "./routeClassifier";

export interface CommandRouterInput {
  event: NormalizedInboundEvent;
  identity: IdentityContext;
}

export interface CommandRouterResult {
  route: RouteClassification["route"];
  reply: string;
  reason: string;
  handledLocally: boolean;
  auditLog: string;
}

export class CommandRouter {
  constructor(
    private readonly accessPolicy: AccessPolicy,
    private readonly routeClassifier: RouteClassifier,
    private readonly helpdeskBroker: HelpdeskBroker,
    private readonly logger: Logger,
  ) {}

  async route(input: CommandRouterInput): Promise<CommandRouterResult> {
    const policyResult = this.accessPolicy.evaluateMessage(input.identity, input.event.text);
    const classification = this.routeClassifier.classify(input.event.text, policyResult);
    const parsedCommand = parseCommand(input.event.text);

    if (classification.route === "silent_ignore") {
      return this.buildResult(input, classification, "", true, parsedCommand?.normalizedName);
    }

    if (classification.route === "blocked") {
      return this.buildResult(input, classification, classification.reason, true, parsedCommand?.normalizedName);
    }

    if (classification.route === "local_general_command") {
      const reply = this.handleGeneralCommand(parsedCommand?.normalizedName);
      return this.buildResult(input, classification, reply, true, parsedCommand?.normalizedName);
    }

    if (classification.route === "local_user_self_service") {
      const reply = this.handleUserSelfService(parsedCommand?.normalizedName, parsedCommand?.args ?? []);
      return this.buildResult(input, classification, reply, true, parsedCommand?.normalizedName);
    }

    if (classification.route === "local_technician_command") {
      const reply = this.handleTechnicianCommand(parsedCommand?.normalizedName, parsedCommand?.args ?? []);
      return this.buildResult(input, classification, reply, true, parsedCommand?.normalizedName);
    }

    const brokerResult = await this.helpdeskBroker.ask({
      chatId: input.event.chatId,
      message: input.event.text,
      quotedMessageId: input.event.quotedMessageId,
      quotedText: input.event.quotedText,
      quotedParticipantId: input.event.quotedParticipantId,
      role: input.identity.role,
      senderPhone: input.identity.canonicalPhone,
      senderDisplayName: input.identity.adUser?.displayName ?? input.event.chatName ?? undefined,
      identityProfile: {
        displayName: input.identity.adUser?.displayName ?? input.event.chatName ?? undefined,
        mail: input.identity.adUser?.mail,
        title: input.identity.adUser?.title,
        department: input.identity.adUser?.department,
        employeeId: input.identity.adUser?.employeeId,
        gender: input.identity.technicianContact?.gender ?? input.identity.adUser?.gender,
        technicianName: input.identity.technicianContact?.name,
        technicianEmail: input.identity.technicianContact?.email ?? undefined,
        technicianLabel: input.identity.technicianContact?.technician,
        lapsAccess: input.identity.technicianContact?.laps_access,
      },
    });

    return this.buildResult(input, classification, brokerResult.reply, false, parsedCommand?.normalizedName);
  }

  private handleGeneralCommand(commandName: string | undefined): string {
    switch (commandName) {
      case "hi":
        return "Halo, saya MTI ICT Helpdesk. Silakan jelaskan kendala Anda.";
      case "ping":
        return "pong";
      case "help":
        return "Command tersedia: /hi, /ping, /help, /status, /ticket.";
      default:
        return "Command umum belum dikenali.";
    }
  }

  private handleUserSelfService(commandName: string | undefined, args: string[]): string {
    switch (commandName) {
      case "status":
        return "Fitur cek status tiket masih stub. Nanti kita sambungkan ke ServiceDesk Plus.";
      case "ticket":
      case "buaticket":
        return args.length > 0
          ? `Permintaan tiket diterima sebagai draft: ${args.join(" ")}`
          : "Silakan tambahkan ringkasan kendala setelah command tiket Anda.";
      default:
        return "Command self-service belum dikenali.";
    }
  }

  private handleTechnicianCommand(commandName: string | undefined, args: string[]): string {
    return `Command teknisi '${commandName ?? "unknown"}' diizinkan oleh policy, tetapi handler finalnya masih stub. Argumen: ${args.join(" ")}`.trim();
  }

  private buildResult(
    input: CommandRouterInput,
    classification: RouteClassification,
    reply: string,
    handledLocally: boolean,
    commandName?: string,
  ): CommandRouterResult {
    const auditPayload = {
      maskedPhone: maskPhone(input.identity.canonicalPhone),
      role: input.identity.role,
      chatType: input.identity.chatType,
      commandName: commandName ?? null,
      route: classification.route,
      decision: classification.decision,
      reason: classification.reason,
    };
    const auditLog = JSON.stringify(auditPayload);

    this.logger.audit("policy_decision", auditPayload);

    return {
      route: classification.route,
      reply,
      reason: classification.reason,
      handledLocally,
      auditLog,
    };
  }
}
