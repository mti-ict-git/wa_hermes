import type { Logger } from "../logging/logger";
import type { IdentityContext } from "../policy/identityResolver";
import { LdapDirectory } from "../policy/ldapDirectory";

export interface AdReadOnlyAdapterResult {
  success: boolean;
  code: "ok" | "not_found" | "unsupported" | "unavailable";
  safeResult: Record<string, unknown>;
}

export class AdReadOnlyAdapter {
  private readonly ldapDirectory: LdapDirectory;

  constructor(
    ldapDirectory: LdapDirectory,
    private readonly logger: Logger,
  ) {
    this.ldapDirectory = ldapDirectory;
  }

  async getSelfProfile(identity: IdentityContext, fields?: string[]): Promise<AdReadOnlyAdapterResult> {
    const safeResult = this.pickAllowedFields(
      {
        displayName:
          identity.adUser?.displayName ??
          identity.technicianContact?.ict_name ??
          identity.technicianContact?.name ??
          "Unknown",
        mail: identity.adUser?.mail,
        title: identity.adUser?.title,
        department: identity.adUser?.department,
        employeeId: identity.adUser?.employeeId,
        gender: identity.adUser?.gender ?? identity.technicianContact?.gender,
        role: identity.role,
      },
      fields,
    );

    this.logger.info("ad_self_profile_resolved", {
      role: identity.role,
      fields: Object.keys(safeResult),
    });

    return {
      success: true,
      code: "ok",
      safeResult,
    };
  }

  async lookupUserProfile(query: string, fields?: string[]): Promise<AdReadOnlyAdapterResult> {
    const matches = await this.ldapDirectory.searchUsersByQuery(query, 5);
    if (matches.length === 0) {
      return {
        success: false,
        code: "not_found",
        safeResult: {
          query,
          total: 0,
          matches: [],
        },
      };
    }

    const projectedMatches = matches.map((match) =>
      this.pickAllowedFields(
        {
          displayName: match.displayName,
          mail: match.mail,
          title: match.title,
          department: match.department,
          employeeId: match.employeeId,
          mobile: match.mobile,
          telephoneNumber: match.telephoneNumber,
          passwordLastChanged: match.passwordLastChanged,
        },
        fields,
      ),
    );

    this.logger.info("ad_lookup_user_profile_succeeded", {
      query,
      total: projectedMatches.length,
    });

    return {
      success: true,
      code: "ok",
      safeResult: {
        query,
        total: projectedMatches.length,
        matches: projectedMatches,
      },
    };
  }

  unavailable(message: string): AdReadOnlyAdapterResult {
    return {
      success: false,
      code: "unavailable",
      safeResult: {
        message,
      },
    };
  }

  unsupported(intentName: string): AdReadOnlyAdapterResult {
    return {
      success: false,
      code: "unsupported",
      safeResult: {
        intentName,
        message: "Intent backend belum diaktifkan untuk adapter ini.",
      },
    };
  }

  private pickAllowedFields(source: Record<string, unknown>, requestedFields?: string[]): Record<string, unknown> {
    const allowlist = new Set(
      (requestedFields?.length ? requestedFields : ["displayName", "mail", "title", "department", "employeeId", "role"])
        .filter((field) => typeof field === "string" && field.trim().length > 0)
        .map((field) => field.trim()),
    );

    return Object.fromEntries(
      Object.entries(source).filter(([key, value]) => allowlist.has(key) && value !== undefined && value !== null && value !== ""),
    );
  }
}
