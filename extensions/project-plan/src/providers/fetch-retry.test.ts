import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultReadRateLimitWait, fetchWithRetry } from "./fetch-retry.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function stubResponse(init: { status: number; headers?: Record<string, string>; body?: string }): Response {
  return new Response(init.body ?? "", {
    status: init.status,
    headers: init.headers,
  });
}

describe("defaultReadRateLimitWait", () => {
  it("returns the Retry-After seconds for 429", () => {
    const res = stubResponse({ status: 429, headers: { "Retry-After": "7" } });
    expect(defaultReadRateLimitWait(res)).toBe(7_000);
  });

  it("falls back to a sane default when 429 has no Retry-After", () => {
    const res = stubResponse({ status: 429 });
    expect(defaultReadRateLimitWait(res)).toBe(5_000);
  });

  it("returns null for non rate-limit responses", () => {
    expect(defaultReadRateLimitWait(stubResponse({ status: 200 }))).toBe(null);
    expect(defaultReadRateLimitWait(stubResponse({ status: 500 }))).toBe(null);
  });
});

describe("fetchWithRetry", () => {
  it("retries on transport failure and returns the first successful response", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(stubResponse({ status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await fetchWithRetry("https://example.com", {}, { baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws the last error after exhausting attempts", async () => {
    const error = new Error("down");
    const fetchMock = vi.fn().mockRejectedValue(error);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      fetchWithRetry("https://example.com", {}, { baseDelayMs: 1, maxAttempts: 2 }),
    ).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-2xx responses (returned to caller)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(stubResponse({ status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await fetchWithRetry("https://example.com", {}, { baseDelayMs: 1 });
    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors custom rate-limit readers and caps wait to maxWaitMs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stubResponse({ status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const reader = vi.fn().mockReturnValue(500_000);

    await fetchWithRetry(
      "https://example.com",
      {},
      { baseDelayMs: 1, maxWaitMs: 10, readRateLimitWait: reader },
    );
    expect(reader).toHaveBeenCalled();
  });
});
