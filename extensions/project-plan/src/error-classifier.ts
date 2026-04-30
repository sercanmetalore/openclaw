// ── Transient error classification ───────────────────────────────────────────
//
// Agents hitting Anthropic/OpenAI/etc. surface overloaded + rate-limit errors
// in slightly different shapes. The helpers here normalize those signals so
// the plan loop can decide whether to back off and retry, fall back to a
// different agent/model, or mark the item failed.

export function isOverloadedRunError(error: unknown): boolean {
  if (typeof error === "string") {
    const text = error.trim();
    if (/overloaded_error/i.test(text) || /\boverloaded\b/i.test(text)) {
      return true;
    }
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return isOverloadedRunError(JSON.parse(text));
      } catch {
        return false;
      }
    }
    return false;
  }

  if (Array.isArray(error)) {
    return error.some((entry) => isOverloadedRunError(entry));
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const shaped = error as {
    type?: unknown;
    message?: unknown;
    error?: unknown;
    details?: unknown;
  };

  if (typeof shaped.type === "string" && /overloaded_error/i.test(shaped.type)) {
    return true;
  }
  if (typeof shaped.message === "string" && /\boverloaded\b/i.test(shaped.message)) {
    return true;
  }

  return isOverloadedRunError(shaped.error) || isOverloadedRunError(shaped.details);
}

export function isCapacityRateLimitError(error: unknown): boolean {
  if (typeof error === "string") {
    const text = error.trim();
    const normalized = text.toLowerCase();
    if (
      normalized.includes("cloud code assist api error (429)") ||
      normalized.includes("rate limit") ||
      normalized.includes("quota") ||
      (normalized.includes("capacity") && normalized.includes("exhausted"))
    ) {
      return true;
    }
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return isCapacityRateLimitError(JSON.parse(text));
      } catch {
        return false;
      }
    }
    return false;
  }

  if (Array.isArray(error)) {
    return error.some((entry) => isCapacityRateLimitError(entry));
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const shaped = error as {
    type?: unknown;
    message?: unknown;
    status?: unknown;
    code?: unknown;
    error?: unknown;
    details?: unknown;
  };

  if (typeof shaped.status === "number" && shaped.status === 429) {
    return true;
  }
  if (typeof shaped.code === "number" && shaped.code === 429) {
    return true;
  }
  if (typeof shaped.type === "string" && /rate[_-]?limit|quota/i.test(shaped.type)) {
    return true;
  }
  if (typeof shaped.message === "string" && isCapacityRateLimitError(shaped.message)) {
    return true;
  }

  return isCapacityRateLimitError(shaped.error) || isCapacityRateLimitError(shaped.details);
}

export function extractRetryDelayMsFromErrorMessage(
  message: string | undefined,
  maxDelayMs: number,
): number | null {
  if (!message) {
    return null;
  }
  const secondsMatch = message.match(/(?:reset|retry)\s+after\s+(\d+)\s*s(?:ec(?:ond)?s?)?/i);
  if (secondsMatch) {
    const seconds = Number(secondsMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1_000, maxDelayMs);
    }
  }

  const wordSecondsMatch = message.match(/(?:reset|retry)\s+after\s+(\d+)\s*seconds?/i);
  if (wordSecondsMatch) {
    const seconds = Number(wordSecondsMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1_000, maxDelayMs);
    }
  }

  return null;
}

export function resolveTransientRetryDelayMs(params: {
  errorText?: string;
  fallbackDelayMs: number;
  maxDelayMs: number;
}): number {
  const { errorText, fallbackDelayMs, maxDelayMs } = params;
  return extractRetryDelayMsFromErrorMessage(errorText, maxDelayMs) ?? fallbackDelayMs;
}

export function resolveTimeoutFallbackDelayMs(params: {
  timeoutMs: number;
  usedFallback: boolean;
  maxDelayMs: number;
}): number {
  const { timeoutMs, usedFallback, maxDelayMs } = params;
  // Scale cooldown with configured timeout so slow models are retried less aggressively.
  const baseDelayMs = Math.min(Math.max(Math.round(timeoutMs * 0.02), 3_000), 60_000);
  if (!usedFallback) {
    return baseDelayMs;
  }
  return Math.min(baseDelayMs * 2, maxDelayMs);
}

export function isTransientOverloadRunResult(result: { status: string; error?: unknown }): boolean {
  return (
    result.status === "error" &&
    (isOverloadedRunError(result.error) || isCapacityRateLimitError(result.error))
  );
}

export function isTransientOverloadCompletionReason(reason: string): boolean {
  return (
    /Agent run error:/i.test(reason) &&
    (/overloaded_error|\boverloaded\b/i.test(reason) || isCapacityRateLimitError(reason))
  );
}

export function isYieldOrDelegationIssue(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  return /Assistant yielded|Assistant delegated work/i.test(message);
}
