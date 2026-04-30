// ── Provider webhook signature verification ──────────────────────────────────
//
// Accepts inbound POSTs from GitHub / GitLab / Jira / Azure DevOps and verifies
// each provider's authenticity header. The actual "refresh plan" action lives
// in http.ts; this module is kept pure so it can be unit-tested without a
// running server.
//
// Supported signatures:
//   * GitHub: X-Hub-Signature-256 (sha256=<hex HMAC of raw body>)
//   * GitLab: X-Gitlab-Token (constant-time equals a shared secret)
//   * Azure DevOps: Basic auth header with a configured username/secret pair
//   * Jira: X-Atlassian-Webhook-Identifier + optional shared-secret header
//
// Secrets are resolved from plugin config `webhookSecrets.<provider>` or the
// plan's per-account settings.

import crypto from "node:crypto";

export type WebhookProvider = "github" | "gitlab" | "jira" | "azuredevops";

export type VerifyWebhookResult =
  | { ok: true }
  | { ok: false; reason: string; status: number };

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function hexHmacSha256(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function verifyGitHubWebhook(params: {
  rawBody: string;
  signatureHeader: string | undefined;
  secret: string | undefined;
}): VerifyWebhookResult {
  if (!params.secret) {
    return { ok: false, reason: "github webhook secret not configured", status: 403 };
  }
  const header = params.signatureHeader?.trim() ?? "";
  if (!header.startsWith("sha256=")) {
    return { ok: false, reason: "missing or malformed X-Hub-Signature-256", status: 401 };
  }
  const expected = `sha256=${hexHmacSha256(params.secret, params.rawBody)}`;
  if (!timingSafeEqualStr(header, expected)) {
    return { ok: false, reason: "github signature mismatch", status: 401 };
  }
  return { ok: true };
}

export function verifyGitLabWebhook(params: {
  tokenHeader: string | undefined;
  secret: string | undefined;
}): VerifyWebhookResult {
  if (!params.secret) {
    return { ok: false, reason: "gitlab webhook secret not configured", status: 403 };
  }
  const provided = params.tokenHeader?.trim() ?? "";
  if (!provided) {
    return { ok: false, reason: "missing X-Gitlab-Token", status: 401 };
  }
  if (!timingSafeEqualStr(provided, params.secret)) {
    return { ok: false, reason: "gitlab token mismatch", status: 401 };
  }
  return { ok: true };
}

export function verifyJiraWebhook(params: {
  identifierHeader: string | undefined;
  sharedSecretHeader: string | undefined;
  secret: string | undefined;
}): VerifyWebhookResult {
  // Jira Cloud sends X-Atlassian-Webhook-Identifier; optionally customers put a
  // shared secret in the URL or a custom header. We accept a custom shared
  // secret header "X-OpenClaw-Webhook-Secret" to keep identity out of the path.
  if (!params.secret) {
    return { ok: false, reason: "jira webhook secret not configured", status: 403 };
  }
  const provided = params.sharedSecretHeader?.trim() ?? "";
  if (!provided) {
    return { ok: false, reason: "missing X-OpenClaw-Webhook-Secret", status: 401 };
  }
  if (!timingSafeEqualStr(provided, params.secret)) {
    return { ok: false, reason: "jira shared secret mismatch", status: 401 };
  }
  if (!params.identifierHeader) {
    return { ok: false, reason: "missing X-Atlassian-Webhook-Identifier", status: 401 };
  }
  return { ok: true };
}

export function verifyAzureWebhook(params: {
  basicAuthHeader: string | undefined;
  expectedUser: string | undefined;
  expectedPassword: string | undefined;
}): VerifyWebhookResult {
  const expectedUser = params.expectedUser?.trim() ?? "";
  const expectedPassword = params.expectedPassword?.trim() ?? "";
  if (!expectedUser || !expectedPassword) {
    return { ok: false, reason: "azure webhook credentials not configured", status: 403 };
  }
  const header = params.basicAuthHeader?.trim() ?? "";
  if (!header.toLowerCase().startsWith("basic ")) {
    return { ok: false, reason: "missing Basic authorization", status: 401 };
  }
  const encoded = header.slice("basic ".length).trim();
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed Basic authorization", status: 401 };
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) {
    return { ok: false, reason: "malformed Basic authorization", status: 401 };
  }
  const user = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  if (!timingSafeEqualStr(user, expectedUser) || !timingSafeEqualStr(password, expectedPassword)) {
    return { ok: false, reason: "azure credentials mismatch", status: 401 };
  }
  return { ok: true };
}
