export interface SessionState {
  sessionKey: string;
  sessionId?: string;
  updatedAt: string;
}

export class HermesSessionStore {
  private readonly state = new Map<string, SessionState>();
  private readonly resetVersions = new Map<string, number>();
  private readonly resetSeeds = new Map<string, string>();

  get(chatId: string): SessionState | undefined {
    return this.state.get(chatId);
  }

  set(chatId: string, sessionState: SessionState): void {
    this.state.set(chatId, sessionState);
  }

  delete(chatId: string): SessionState | undefined {
    const existing = this.state.get(chatId);
    if (existing) {
      this.state.delete(chatId);
    }
    return existing;
  }

  bumpResetVersion(chatId: string): number {
    const nextVersion = (this.resetVersions.get(chatId) ?? 0) + 1;
    this.resetVersions.set(chatId, nextVersion);
    this.resetSeeds.set(chatId, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    return nextVersion;
  }

  getResetVersion(chatId: string): number {
    return this.resetVersions.get(chatId) ?? 0;
  }

  getResetSeed(chatId: string): string | undefined {
    return this.resetSeeds.get(chatId);
  }

  has(chatId: string): boolean {
    return this.state.has(chatId);
  }

  list(): Array<{ chatId: string; state: SessionState }> {
    return Array.from(this.state.entries()).map(([chatId, state]) => ({
      chatId,
      state,
    }));
  }
}
