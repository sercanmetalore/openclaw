import { describe, expect, it } from "vitest";
import { resolveSanitizeMode, sanitizeErrorForLog, sanitizeForLog } from "./sanitize.js";

describe("resolveSanitizeMode", () => {
  it("defaults unknown inputs to off", () => {
    expect(resolveSanitizeMode(undefined)).toBe("off");
    expect(resolveSanitizeMode("bogus")).toBe("off");
    expect(resolveSanitizeMode("")).toBe("off");
  });

  it("recognizes mask mode", () => {
    expect(resolveSanitizeMode("mask")).toBe("mask");
  });
});

describe("sanitizeForLog", () => {
  it("returns the input unchanged in off mode", () => {
    const input = "Customer: Ahmet Yılmaz <ahmet@example.com>";
    expect(sanitizeForLog(input, { mode: "off" })).toBe(input);
    expect(sanitizeForLog(input)).toBe(input);
  });

  it("handles undefined / empty input", () => {
    expect(sanitizeForLog(undefined, { mode: "mask" })).toBe("");
    expect(sanitizeForLog("", { mode: "mask" })).toBe("");
  });

  it("masks emails in mask mode", () => {
    expect(sanitizeForLog("Send invoice to a.b@acme.co", { mode: "mask" })).toContain("[email]");
  });

  it("masks phone numbers in mask mode", () => {
    const out = sanitizeForLog("Call +90 212 555 66 77 now", { mode: "mask" });
    expect(out).toContain("[phone]");
  });

  it("masks long digit runs (PII-like identifiers)", () => {
    const out = sanitizeForLog("TCKN 12345678901 verification", { mode: "mask" });
    expect(out).toContain("[digits]");
  });

  it("truncates long titles with ellipsis", () => {
    const long = "A".repeat(200);
    const out = sanitizeForLog(long, { mode: "mask", titleMaxChars: 40 });
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
  });

  it("enforces a minimum title cap to prevent over-truncation", () => {
    const out = sanitizeForLog("hello world test title", { mode: "mask", titleMaxChars: 1 });
    // Minimum is 8 chars + ellipsis.
    expect(out.length).toBeGreaterThanOrEqual(9);
  });
});

describe("sanitizeErrorForLog", () => {
  it("redacts bearer tokens", () => {
    const out = sanitizeErrorForLog("fetch failed: Authorization: Bearer sk_live_abcdef123");
    expect(out).not.toContain("sk_live_abcdef123");
    expect(out.toLowerCase()).toContain("[redacted]");
  });

  it("redacts x-api-key headers", () => {
    const out = sanitizeErrorForLog("X-API-Key: k1Qv-secret-value-123");
    expect(out).not.toContain("k1Qv-secret-value-123");
  });

  it("redacts token= parameter leaks", () => {
    const out = sanitizeErrorForLog("url?token=abcXYZ123");
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("abcXYZ123");
  });

  it("passes through strings with no secrets", () => {
    expect(sanitizeErrorForLog("plain error")).toBe("plain error");
  });
});
