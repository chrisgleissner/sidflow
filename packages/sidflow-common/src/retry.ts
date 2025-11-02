export interface RetryOptions {
  retries?: number;
  delayMs?: number;
  onRetry?: (error: unknown, attempt: number) => void | Promise<void>;
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 2, delayMs = 0, onRetry } = options;

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }

      attempt += 1;
      if (onRetry) {
        await onRetry(error, attempt);
      }

      if (delayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delayMs);
        });
      }
    }
  }
}
