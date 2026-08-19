export interface ParsedCommand {
  raw: string;
  name: string;
  normalizedName: string;
  args: string[];
}

export function parseCommand(commandText: string): ParsedCommand | null {
  const trimmed = commandText.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const withoutSlash = trimmed.slice(1).trim();
  if (!withoutSlash) {
    return null;
  }

  const parts = withoutSlash.split(/\s+/).filter((part) => part.length > 0);
  const [name, ...args] = parts;
  if (!name) {
    return null;
  }

  return {
    raw: trimmed,
    name,
    normalizedName: name.toLowerCase(),
    args,
  };
}
