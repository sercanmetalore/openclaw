// ── Log sanitization helpers ─────────────────────────────────────────────────
//
// Applied to plan.logs messages and audit entries so that plan titles or
// descriptions containing PII (customer names, emails, phone numbers) can be
// masked before persistence. Controlled by ProjectPlanPluginConfig.logSanitize.

export type LogSanitizeMode = "off" | "mask";

export type LogSanitizeOptions = {
  mode?: LogSanitizeMode;
  /** Max characters kept from a title/description before truncation. */
  titleMaxChars?: number;
};

const DEFAULT_TITLE_MAX_CHARS = 40;

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
// Match E.164 / permissive phone digit runs of length >= 8.
const PHONE_RE = /\b\+?\d[\d\s().-]{7,}\d\b/g;
// Common Turkish identity / payment-looking digit runs (11-19 digits).
const LONG_DIGIT_RE = /\b\d{11,19}\b/g;

export function resolveSanitizeMode(
  raw: LogSanitizeMode | string | undefined,
): LogSanitizeMode {
  if (raw === "mask") return "mask";
  return "off";
}

/**
 * Sanitize a free-form title/description before persisting into a log or audit
 * record. In "off" mode the input is returned unchanged.
 */
export function sanitizeForLog(
  value: string | undefined,
  options?: LogSanitizeOptions,
): string {
  const text = value ?? "";
  if (!text) return "";

  const mode = options?.mode ?? "off";
  if (mode === "off") return text;

  const maxChars = Math.max(8, options?.titleMaxChars ?? DEFAULT_TITLE_MAX_CHARS);
  let masked = text
    .replace(EMAIL_RE, "[email]")
    .replace(LONG_DIGIT_RE, "[digits]")
    .replace(PHONE_RE, "[phone]");

  if (masked.length > maxChars) {
    masked = `${masked.slice(0, maxChars).trimEnd()}…`;
  }
  return masked;
}

/** Strip bearer-like secrets from error strings before they hit logs. */
export function sanitizeErrorForLog(value: unknown): string {
  const text = typeof value === "string" ? value : String(value);
  return text
    .replace(/(authorization\s*:\s*)(bearer\s+)?[A-Za-z0-9._\-]+/gi, "$1$2[redacted]")
    .replace(/(x-api-key\s*:\s*)[A-Za-z0-9._\-]+/gi, "$1[redacted]")
    .replace(/(token\s*[=:]\s*)[A-Za-z0-9._\-]+/gi, "$1[redacted]");
}
