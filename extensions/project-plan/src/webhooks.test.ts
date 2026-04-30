import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  verifyAzureWebhook,
  verifyGitHubWebhook,
  verifyGitLabWebhook,
  verifyJiraWebhook,
} from "./webhooks.js";

function githubSig(secret: string, body: string): string {
  const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hex}`;
}

describe("verifyGitHubWebhook", () => {
  it("accepts a valid HMAC signature", () => {
    const body = '{"action":"opened"}';
    const out = verifyGitHubWebhook({
      rawBody: body,
      signatureHeader: githubSig("s3cr3t", body),
      secret: "s3cr3t",
    });
    expect(out.ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = '{"action":"opened"}';
    const signature = githubSig("s3cr3t", body);
    const out = verifyGitHubWebhook({
      rawBody: '{"action":"closed"}',
      signatureHeader: signature,
      secret: "s3cr3t",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(401);
  });

  it("rejects when the header is missing", () => {
    const out = verifyGitHubWebhook({
      rawBody: "{}",
      signatureHeader: undefined,
      secret: "s3cr3t",
    });
    expect(out.ok).toBe(false);
  });

  it("returns 403 when no secret is configured", () => {
    const out = verifyGitHubWebhook({
      rawBody: "{}",
      signatureHeader: "sha256=abc",
      secret: undefined,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(403);
  });
});

describe("verifyGitLabWebhook", () => {
  it("accepts an equal token", () => {
    const out = verifyGitLabWebhook({ tokenHeader: "tok", secret: "tok" });
    expect(out.ok).toBe(true);
  });

  it("rejects different tokens", () => {
    const out = verifyGitLabWebhook({ tokenHeader: "foo", secret: "bar" });
    expect(out.ok).toBe(false);
  });
});

describe("verifyJiraWebhook", () => {
  it("accepts when shared secret and identifier are present", () => {
    const out = verifyJiraWebhook({
      identifierHeader: "abc-123",
      sharedSecretHeader: "shared",
      secret: "shared",
    });
    expect(out.ok).toBe(true);
  });

  it("rejects missing identifier", () => {
    const out = verifyJiraWebhook({
      identifierHeader: undefined,
      sharedSecretHeader: "shared",
      secret: "shared",
    });
    expect(out.ok).toBe(false);
  });

  it("rejects wrong shared secret", () => {
    const out = verifyJiraWebhook({
      identifierHeader: "abc",
      sharedSecretHeader: "wrong",
      secret: "shared",
    });
    expect(out.ok).toBe(false);
  });
});

describe("verifyAzureWebhook", () => {
  it("accepts valid Basic credentials", () => {
    const encoded = Buffer.from("user:pass").toString("base64");
    const out = verifyAzureWebhook({
      basicAuthHeader: `Basic ${encoded}`,
      expectedUser: "user",
      expectedPassword: "pass",
    });
    expect(out.ok).toBe(true);
  });

  it("rejects missing header", () => {
    const out = verifyAzureWebhook({
      basicAuthHeader: undefined,
      expectedUser: "user",
      expectedPassword: "pass",
    });
    expect(out.ok).toBe(false);
  });

  it("rejects wrong password", () => {
    const encoded = Buffer.from("user:bad").toString("base64");
    const out = verifyAzureWebhook({
      basicAuthHeader: `Basic ${encoded}`,
      expectedUser: "user",
      expectedPassword: "pass",
    });
    expect(out.ok).toBe(false);
  });

  it("returns 403 when secret not configured", () => {
    const out = verifyAzureWebhook({
      basicAuthHeader: "Basic x",
      expectedUser: undefined,
      expectedPassword: undefined,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(403);
  });
});
