import { existsSync, readFileSync } from "node:fs";

export interface TechnicianContact {
  id: number;
  name: string;
  ict_name: string;
  phone: string;
  email: string | null;
  technician: string;
  gender?: string | null;
  laps_access: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeTechnicianPhoneNumber(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (!digits) {
    return "";
  }

  if (digits.startsWith("0")) {
    return `62${digits.slice(1)}`;
  }

  return digits;
}

function parseContact(raw: unknown, fallbackId: number): TechnicianContact | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = typeof raw.id === "number" && Number.isFinite(raw.id) ? raw.id : fallbackId;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const ictName = typeof raw.ict_name === "string" ? raw.ict_name.trim() : "";
  const phone = normalizeTechnicianPhoneNumber(typeof raw.phone === "string" ? raw.phone : "");
  const technician = typeof raw.technician === "string" ? raw.technician.trim() : "";
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : raw.email === null ? null : null;
  const gender = typeof raw.gender === "string" ? raw.gender.trim() : raw.gender === null ? null : undefined;
  const lapsAccess = typeof raw.laps_access === "boolean" ? raw.laps_access : false;

  if (!name || !ictName || !phone || !technician) {
    return null;
  }

  return {
    id,
    name,
    ict_name: ictName,
    phone,
    email,
    technician,
    gender,
    laps_access: lapsAccess,
  };
}

export class TechnicianDirectory {
  private cachedPath?: string;
  private cachedContacts: TechnicianContact[] = [];

  constructor(private readonly contactsPath: string) {}

  list(): TechnicianContact[] {
    if (this.cachedPath === this.contactsPath && this.cachedContacts.length > 0) {
      return this.cachedContacts;
    }

    if (!existsSync(this.contactsPath)) {
      this.cachedPath = this.contactsPath;
      this.cachedContacts = [];
      return this.cachedContacts;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.contactsPath, "utf8")) as unknown;
      if (!Array.isArray(parsed)) {
        this.cachedPath = this.contactsPath;
        this.cachedContacts = [];
        return this.cachedContacts;
      }

      this.cachedContacts = parsed
        .map((entry, index) => parseContact(entry, index + 1))
        .filter((entry): entry is TechnicianContact => entry !== null)
        .sort((left, right) => left.id - right.id);
      this.cachedPath = this.contactsPath;
      return this.cachedContacts;
    } catch {
      this.cachedPath = this.contactsPath;
      this.cachedContacts = [];
      return this.cachedContacts;
    }
  }

  findByPhone(phone: string | undefined): TechnicianContact | undefined {
    const normalizedPhone = normalizeTechnicianPhoneNumber(phone ?? "");
    if (!normalizedPhone) {
      return undefined;
    }

    return this.list().find((contact) => contact.phone === normalizedPhone);
  }

  findByEmail(email: string | undefined): TechnicianContact | undefined {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail) {
      return undefined;
    }

    return this.list().find((contact) => contact.email?.toLowerCase() === normalizedEmail);
  }
}
