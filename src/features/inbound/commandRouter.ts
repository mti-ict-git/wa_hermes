import type { HelpdeskBroker } from "../hermes/helpdeskBroker";
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

function maskPhone(value: string | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 6) {
    return digits || "unknown";
  }

  return `${digits.slice(0, 5)}xxxx${digits.slice(-4)}`;
}

export class CommandRouter {
  constructor(
    private readonly accessPolicy: AccessPolicy,
    private readonly routeClassifier: RouteClassifier,
    private readonly helpdeskBroker: HelpdeskBroker,
  ) {}

  async route(input: CommandRouterInput): Promise<CommandRouterResult> {
    const policyResult = this.accessPolicy.evaluateMessage(input.identity, input.event.text);
    const classification = this.routeClassifier.classify(input.event.text, policyResult);
    const parsedCommand = parseCommand(input.event.text);

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
      role: input.identity.role,
      senderPhone: input.identity.canonicalPhone,
      senderDisplayName: input.identity.adUser?.displayName ?? input.event.chatName ?? undefined,
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

    console.log(`[command-router:audit] ${auditLog}`);

    return {
      route: classification.route,
      reply,
      reason: classification.reason,
      handledLocally,
      auditLog,
    };
  }
}
