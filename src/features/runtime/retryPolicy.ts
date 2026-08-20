import type { RetryPolicyConfig } from "../../config/types";
import type { Logger } from "../logging/logger";

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export interface RetryOperationContext {
  operation: string;
  target: string;
}

export async function withRetry<T>(
  policy: RetryPolicyConfig,
  logger: Logger,
  context: RetryOperationContext,
  execute: (attempt: number, signal: AbortSignal) => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await execute(attempt, AbortSignal.timeout(policy.timeoutMs));
    } catch (error: unknown) {
      lastError = error;
      const retryable = shouldRetry(error);

      logger.warn("request_attempt_failed", {
        operation: context.operation,
        target: context.target,
        attempt,
        maxAttempts: policy.maxAttempts,
        retryable,
        error,
      });

      if (!retryable || attempt >= policy.maxAttempts) {
        break;
      }

      await sleep(policy.delayMs);
    }
  }

  throw lastError;
}
