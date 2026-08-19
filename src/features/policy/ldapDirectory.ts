import * as ldap from "ldapjs";

import type { LdapConfig } from "../../config/types";

export interface AdUserRecord {
  displayName: string;
  mail?: string;
  mobile?: string;
  telephoneNumber?: string;
  employeeId?: string;
  department?: string;
  title?: string;
}

function normalizePhoneDigits(value: string | undefined): string {
  return (value ?? "").replace(/[^\d]/g, "");
}

function escapeLdapFilterValue(value: string): string {
  return value.replace(/[\0()*\\]/g, (character) => {
    switch (character) {
      case "\\":
        return "\\5c";
      case "*":
        return "\\2a";
      case "(":
        return "\\28";
      case ")":
        return "\\29";
      case "\0":
        return "\\00";
      default:
        return character;
    }
  });
}

function buildAttributeMap(entry: ldap.SearchEntry): Map<string, string[]> {
    const attributes = entry.pojo.attributes ?? [];
  const map = new Map<string, string[]>();

  for (const attribute of attributes) {
    const values = Array.isArray(attribute.values)
      ? attribute.values.map((value: string | Buffer) => String(value))
      : [];
    map.set(attribute.type.toLowerCase(), values);
  }

  return map;
}

function pickFirstAttribute(map: Map<string, string[]>, name: string): string | undefined {
  const values = map.get(name.toLowerCase());
  return values?.[0];
}

function mapEntryToUser(entry: ldap.SearchEntry): AdUserRecord {
  const attributes = buildAttributeMap(entry);

  return {
    displayName:
      pickFirstAttribute(attributes, "displayName") ??
      pickFirstAttribute(attributes, "cn") ??
      pickFirstAttribute(attributes, "name") ??
      pickFirstAttribute(attributes, "sAMAccountName") ??
      pickFirstAttribute(attributes, "userPrincipalName") ??
      "Unknown",
    mail: pickFirstAttribute(attributes, "mail"),
    mobile: pickFirstAttribute(attributes, "mobile") ?? pickFirstAttribute(attributes, "mobileNumber"),
    telephoneNumber: pickFirstAttribute(attributes, "telephoneNumber"),
    employeeId: pickFirstAttribute(attributes, "employeeID"),
    department: pickFirstAttribute(attributes, "department"),
    title: pickFirstAttribute(attributes, "title"),
  };
}

function scorePhoneCandidate(lookupDigits: string, user: AdUserRecord): number {
  const candidates = [normalizePhoneDigits(user.mobile), normalizePhoneDigits(user.telephoneNumber)].filter(
    (value) => value.length > 0,
  );

  let score = 0;
  for (const candidate of candidates) {
    if (candidate === lookupDigits) {
      score = Math.max(score, 100);
    } else if (candidate.endsWith(lookupDigits) || lookupDigits.endsWith(candidate)) {
      score = Math.max(score, 80);
    } else if (candidate.includes(lookupDigits) || lookupDigits.includes(candidate)) {
      score = Math.max(score, 60);
    }
  }

  return score;
}

export class LdapDirectory {
  constructor(private readonly config: LdapConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.enabled &&
        this.config.url &&
        this.config.bindDn &&
        this.config.bindPassword &&
        this.config.baseDn,
    );
  }

  async findUserByPhone(phone: string | undefined): Promise<AdUserRecord | null> {
    const lookupDigits = normalizePhoneDigits(phone);
    if (!lookupDigits || !this.isConfigured()) {
      return null;
    }

    const phoneFragments = Array.from(
      new Set(
        [
          lookupDigits,
          lookupDigits.startsWith("62") ? `0${lookupDigits.slice(2)}` : "",
          lookupDigits.startsWith("0") ? `62${lookupDigits.slice(1)}` : "",
        ].filter((value) => value.length > 0),
      ),
    );

    const phoneFilter = phoneFragments
      .map((value) => {
        const escaped = escapeLdapFilterValue(value);
        return `(|(mobile=*${escaped}*)(mobileNumber=*${escaped}*)(telephoneNumber=*${escaped}*))`;
      })
      .join("");

    const filter = `(&(|${phoneFilter})(objectCategory=person)(objectClass=user))`;

    return this.withClient(async (client) => {
      const matches = await this.searchUsers(client, filter);
      let bestMatch: { user: AdUserRecord; score: number } | null = null;

      for (const user of matches) {
        const score = scorePhoneCandidate(lookupDigits, user);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { user, score };
        }
      }

      return bestMatch?.score ? bestMatch.user : null;
    });
  }

  private async withClient<T>(operation: (client: ldap.Client) => Promise<T>): Promise<T> {
    const client = ldap.createClient({
      url: this.config.url!,
      timeout: 10000,
      connectTimeout: 10000,
    });

    client.on("error", (_error: ldap.Error) => {
      // The request promise handles surfacing actionable bind/search failures.
    });

    try {
      await new Promise<void>((resolve, reject) => {
        client.bind(this.config.bindDn!, this.config.bindPassword!, (error: ldap.Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      return await operation(client);
    } finally {
      try {
        client.unbind();
      } catch {
        // Ignore teardown errors from already-closed sockets.
      }
    }
  }

  private async searchUsers(client: ldap.Client, filter: string): Promise<AdUserRecord[]> {
    return await new Promise<AdUserRecord[]>((resolve, reject) => {
      client.search(
        this.config.baseDn!,
        {
          scope: "sub",
          filter,
          attributes: [
            "displayName",
            "cn",
            "name",
            "sAMAccountName",
            "userPrincipalName",
            "mail",
            "title",
            "department",
            "mobile",
            "mobileNumber",
            "telephoneNumber",
            "employeeID",
          ],
          sizeLimit: 10,
          timeLimit: 10,
        },
        (error: ldap.Error | null, result: ldap.SearchCallbackResponse) => {
          if (error) {
            reject(error);
            return;
          }

          const users: AdUserRecord[] = [];
          result.on("searchEntry", (entry: ldap.SearchEntry) => {
            users.push(mapEntryToUser(entry));
          });
          result.on("error", reject);
          result.on("end", () => resolve(users));
        },
      );
    });
  }
}
