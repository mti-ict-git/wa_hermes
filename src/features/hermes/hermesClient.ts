import type { HermesConfig } from "../../config/types";

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

export class HermesClient {
  constructor(private readonly config: HermesConfig) {}

  async chat(request: HermesChatRequest): Promise<HermesChatResponse> {
    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        "X-Hermes-Session-Key": request.sessionKey,
        ...(request.sessionId ? { "X-Hermes-Session-Id": request.sessionId } : {}),
      },
      body: JSON.stringify({
        model: "hermes-agent",
        messages: [
          {
            role: "user",
            content: request.message,
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Hermes request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as {
      model?: string;
      usage?: Record<string, unknown>;
      choices?: Array<{ message?: { content?: string } }>;
    };

    return {
      content: payload.choices?.[0]?.message?.content ?? "",
      sessionId: response.headers.get("X-Hermes-Session-Id") ?? request.sessionId,
      raw: {
        model: payload.model,
        usage: payload.usage,
        finishReason: undefined,
      },
    };
  }
}
