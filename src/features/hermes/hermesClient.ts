import type { HermesConfig } from "../../config/types";
import type { Logger } from "../logging/logger";
import { withRetry } from "../runtime/retryPolicy";

const RUN_POLL_INTERVAL_MS = 2000;
const RUN_MAX_POLL_ATTEMPTS = 90;

export interface HermesChatRequest {
  message: string;
  sessionKey: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface HermesChatResponse {
  content: string;
  sessionId?: string;
  raw: {
    model?: string;
    usage?: Record<string, unknown>;
    finishReason?: string;
  };
}

interface HermesSyncPayload {
  model?: string;
  usage?: Record<string, unknown>;
  choices?: Array<{ message?: { content?: string } }>;
}

interface HermesRunStartPayload {
  run_id?: string;
}

interface HermesRunStatusPayload {
  status?: string;
  session_id?: string;
  model?: string;
  usage?: Record<string, unknown>;
  output?: string;
  error?: string;
}

export class HermesClient {
  constructor(
    private readonly config: HermesConfig,
    private readonly logger: Logger,
  ) {}

  async chat(request: HermesChatRequest): Promise<HermesChatResponse> {
    if (this.config.mode === "async") {
      return this.chatAsync(request);
    }

    return this.chatSync(request);
  }

  private async chatSync(request: HermesChatRequest): Promise<HermesChatResponse> {
    return withRetry(
      this.config.retryPolicy,
      this.logger,
      {
        operation: "hermes.chat",
        target: `${this.config.baseUrl}/v1/chat/completions`,
      },
      async (attempt, signal) => {
        this.logger.debug("request_started", {
          operation: "hermes.chat",
          attempt,
          sessionKey: request.sessionKey,
          hasSessionId: Boolean(request.sessionId),
        });

        const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
            "X-Hermes-Session-Key": request.sessionKey,
            ...(request.sessionId ? { "X-Hermes-Session-Id": request.sessionId } : {}),
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              {
                role: "user",
                content: request.message,
              },
            ],
            stream: false,
          }),
          signal,
        });

        if (!response.ok) {
          const body = await response.text();
          const error = new Error(`Hermes request failed (${response.status}): ${body}`);
          (error as Error & { status?: number }).status = response.status;
          throw error;
        }

        const payload = (await response.json()) as HermesSyncPayload;

        this.logger.info("request_succeeded", {
          operation: "hermes.chat",
          attempt,
          sessionKey: request.sessionKey,
          sessionId: response.headers.get("X-Hermes-Session-Id") ?? request.sessionId,
        });

        return {
          content: payload.choices?.[0]?.message?.content ?? "",
          sessionId: response.headers.get("X-Hermes-Session-Id") ?? request.sessionId,
          raw: {
            model: payload.model,
            usage: payload.usage,
            finishReason: undefined,
          },
        };
      },
      (error) => this.isRetryable(error),
    );
  }

  private async chatAsync(request: HermesChatRequest): Promise<HermesChatResponse> {
    const startPayload = await withRetry(
      this.config.retryPolicy,
      this.logger,
      {
        operation: "hermes.run.start",
        target: `${this.config.baseUrl}/v1/runs`,
      },
      async (attempt, signal) => {
        this.logger.debug("request_started", {
          operation: "hermes.run.start",
          attempt,
          sessionKey: request.sessionKey,
          hasSessionId: Boolean(request.sessionId),
        });

        const response = await fetch(`${this.config.baseUrl}/v1/runs`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
            "X-Hermes-Session-Key": request.sessionKey,
          },
          body: JSON.stringify({
            model: this.config.model,
            input: request.message,
            ...(request.sessionId ? { session_id: request.sessionId } : {}),
          }),
          signal,
        });

        if (!response.ok) {
          const body = await response.text();
          const error = new Error(`Hermes run start failed (${response.status}): ${body}`);
          (error as Error & { status?: number }).status = response.status;
          throw error;
        }

        return (await response.json()) as HermesRunStartPayload;
      },
      (error) => this.isRetryable(error),
    );

    const runId = startPayload.run_id?.trim();
    if (!runId) {
      throw new Error("Hermes run start did not return run_id.");
    }

    this.logger.info("run_started", {
      operation: "hermes.run.start",
      runId,
      sessionKey: request.sessionKey,
      sessionId: request.sessionId,
    });

    let lastStatus = "";
    for (let pollAttempt = 1; pollAttempt <= RUN_MAX_POLL_ATTEMPTS; pollAttempt += 1) {
      await this.sleep(RUN_POLL_INTERVAL_MS);

      const runPayload = await withRetry(
        this.config.retryPolicy,
        this.logger,
        {
          operation: "hermes.run.poll",
          target: `${this.config.baseUrl}/v1/runs/${runId}`,
        },
        async (attempt, signal) => {
          const response = await fetch(`${this.config.baseUrl}/v1/runs/${runId}`, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${this.config.apiKey}`,
              "Content-Type": "application/json",
            },
            signal,
          });

          if (!response.ok) {
            const body = await response.text();
            const error = new Error(`Hermes run poll failed (${response.status}): ${body}`);
            (error as Error & { status?: number }).status = response.status;
            throw error;
          }

          this.logger.debug("request_succeeded", {
            operation: "hermes.run.poll",
            attempt,
            pollAttempt,
            runId,
          });

          return (await response.json()) as HermesRunStatusPayload;
        },
        (error) => this.isRetryable(error),
      );

      const status = runPayload.status?.trim().toLowerCase() ?? "unknown";
      const returnedSessionId = runPayload.session_id ?? request.sessionId;

      if (status !== lastStatus) {
        this.logger.info("run_status_changed", {
          operation: "hermes.run.poll",
          runId,
          pollAttempt,
          status,
          sessionId: returnedSessionId,
        });
        lastStatus = status;
      }

      if (status === "completed") {
        return {
          content: runPayload.output ?? "",
          sessionId: returnedSessionId,
          raw: {
            model: runPayload.model,
            usage: runPayload.usage,
            finishReason: status,
          },
        };
      }

      if (status === "failed") {
        throw new Error(runPayload.error?.trim() || "Hermes run failed.");
      }

      if (status === "cancelled") {
        throw new Error("Hermes run was cancelled.");
      }
    }

    throw new Error(
      `Hermes run did not complete within ${RUN_MAX_POLL_ATTEMPTS} polls (${RUN_MAX_POLL_ATTEMPTS * RUN_POLL_INTERVAL_MS}ms).`,
    );
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private isRetryable(error: unknown): boolean {
    const status =
      typeof error === "object" && error && "status" in error && typeof error.status === "number"
        ? error.status
        : undefined;

    if (status !== undefined) {
      return status >= 500 || status === 429;
    }

    if (error instanceof Error) {
      return error.name === "TimeoutError" || error.name === "AbortError" || /fetch failed/i.test(error.message);
    }

    return false;
  }
}
