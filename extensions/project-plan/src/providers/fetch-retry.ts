// ── Shared provider fetch helper ─────────────────────────────────────────────
//
// Provider adapters share a common pattern: retry on transport failure, respect
// 429 + Retry-After, and cap wait time so a misbehaving provider can't stall
// the entire plan loop. Centralizing the behavior avoids four copies that drift
// apart over time.

export type FetchRetryOptions = {
  /** Total attempts including the first one (default: 3). */
  maxAttempts?: number;
  /** Base delay between transport-failure retries in ms (default: 1000). */
  baseDelayMs?: number;
  /** Hard cap on Retry-After / rate-limit wait in ms (default: 60000). */
  maxWaitMs?: number;
  /**
   * Optional hook for reading vendor-specific rate-limit headers.
   * Returns the number of ms to wait, or null when the default behavior applies.
   */
  readRateLimitWait?: (res: Response) => number | null;
};

const DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxWaitMs: 60_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Default reader honors RFC 6585 Retry-After (seconds) for 429/503. */
export function defaultReadRateLimitWait(res: Response): number | null {
  if (res.status !== 429 && res.status !== 503) return null;
  const retryAfter = res.headers.get("Retry-After");
  if (!retryAfter) return 5_000;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
  return 5_000;
}

/**
 * Fetch with retries + rate-limit respect. Non-2xx responses are returned to
 * the caller; only transport-level errors trigger another attempt.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: FetchRetryOptions,
): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? DEFAULTS.maxAttempts;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxWaitMs = options?.maxWaitMs ?? DEFAULTS.maxWaitMs;
  const readRateLimitWait = options?.readRateLimitWait ?? defaultReadRateLimitWait;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(baseDelayMs * attempt);
    }
    try {
      const res = await fetch(url, init);
      const waitMs = readRateLimitWait(res);
      if (waitMs !== null && waitMs > 0) {
        await sleep(Math.min(waitMs, maxWaitMs));
      }
      return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
