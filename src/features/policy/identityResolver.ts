import type { LdapConfig, PolicyConfig } from "../../config/types";
import type { NormalizedInboundEvent } from "../openwa/types";
import { normalizeChatIdentity } from "../openwa/eventNormalizer";
import type { AdUserRecord } from "./ldapDirectory";
import { LdapDirectory } from "./ldapDirectory";
import type { TechnicianContact } from "./technicianDirectory";
import { TechnicianDirectory } from "./technicianDirectory";

export type IdentityRole = "unregistered" | "user" | "technician";

export interface IdentityContext {
  chatId: string;
  chatType: "private" | "group" | "unknown";
  sourceId?: string;
  canonicalPhone?: string;
  adUser: AdUserRecord | null;
  technicianContact: TechnicianContact | null;
  hasRequiredMail: boolean;
  isRegisteredUser: boolean;
  isTechnician: boolean;
  role: IdentityRole;
  resolutionReason: string;
}

export interface IdentityResolveInput {
  chatId: string;
  senderId?: string;
}

export class IdentityResolver {
  private readonly ldapDirectory: LdapDirectory;
  private readonly technicianDirectory: TechnicianDirectory;

  constructor(ldapConfig: LdapConfig, policyConfig: PolicyConfig) {
    this.ldapDirectory = new LdapDirectory(ldapConfig);
    this.technicianDirectory = new TechnicianDirectory(policyConfig.technicianContactsPath);
  }

  async resolve(input: IdentityResolveInput): Promise<IdentityContext> {
    const normalizedIdentity = normalizeChatIdentity(input.chatId, input.senderId);
    const adUser = await this.ldapDirectory.findUserByPhone(normalizedIdentity.canonicalPhone);
    const hasRequiredMail = Boolean(adUser?.mail?.trim());
    const technicianContact = this.technicianDirectory.findByPhone(normalizedIdentity.canonicalPhone);
    const isRegisteredUser = Boolean(adUser && hasRequiredMail);
    const isTechnician = isRegisteredUser && Boolean(technicianContact);
    const role: IdentityRole = isTechnician ? "technician" : isRegisteredUser ? "user" : "unregistered";

    let resolutionReason = "No matching AD user was found for the normalized sender identity.";
    if (normalizedIdentity.chatType !== "private") {
      resolutionReason = "Chat context is not private.";
    } else if (!normalizedIdentity.canonicalPhone) {
      resolutionReason = "Sender identity could not be normalized into a canonical phone number.";
    } else if (adUser && !hasRequiredMail) {
      resolutionReason = "AD user was found but the mail attribute is empty.";
    } else if (isTechnician) {
      resolutionReason = "Sender matched AD eligibility and technician contacts.";
    } else if (isRegisteredUser) {
      resolutionReason = "Sender matched AD eligibility and is treated as a regular user.";
    }

    return {
      chatId: normalizedIdentity.chatId,
      chatType: normalizedIdentity.chatType,
      sourceId: normalizedIdentity.sourceId,
      canonicalPhone: normalizedIdentity.canonicalPhone,
      adUser,
      technicianContact: technicianContact ?? null,
      hasRequiredMail,
      isRegisteredUser,
      isTechnician,
      role,
      resolutionReason,
    };
  }

  async resolveFromEvent(event: NormalizedInboundEvent): Promise<IdentityContext> {
    return this.resolve({
      chatId: event.chatId,
      senderId: event.senderId,
    });
  }
}
