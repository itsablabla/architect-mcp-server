import { RetryConfig } from "../types.js";

export async function executeWithRetry<T>(
    fn: () => Promise<T>,
    config: RetryConfig
): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));

            if (attempt >= config.maxAttempts) {
                break;
            }

            let delay: number;
            if (config.backoff === "exponential") {
                delay = Math.min(
                    config.initialDelayMs * Math.pow(2, attempt - 1),
                    config.maxDelayMs
                );
            } else {
                delay = Math.min(
                    config.initialDelayMs * attempt,
                    config.maxDelayMs
                );
            }

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError || new Error("Retry failed");
}
