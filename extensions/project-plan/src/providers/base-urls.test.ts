import { describe, expect, it } from "vitest";
import {
  PROVIDER_DEFAULT_BASE_URLS,
  resolveProviderBaseUrl,
} from "./base-urls.js";

describe("resolveProviderBaseUrl", () => {
  it("prefers the account-level hostUrl", () => {
    const out = resolveProviderBaseUrl({
      provider: "github",
      accountHostUrl: "https://ghe.corp.local",
      pluginConfig: { providerBaseUrls: { github: "https://via-config" } },
      env: { OPENCLAW_PROJECT_PLAN_GITHUB_URL: "https://via-env" },
    });
    expect(out).toBe("https://ghe.corp.local");
  });

  it("falls back to plugin config when no account override", () => {
    const out = resolveProviderBaseUrl({
      provider: "gitlab",
      pluginConfig: { providerBaseUrls: { gitlab: "https://gitlab.corp" } },
      env: { OPENCLAW_PROJECT_PLAN_GITLAB_URL: "https://via-env" },
    });
    expect(out).toBe("https://gitlab.corp");
  });

  it("falls back to env var when neither account nor config set", () => {
    const out = resolveProviderBaseUrl({
      provider: "azure",
      env: { OPENCLAW_PROJECT_PLAN_AZURE_URL: "https://dev.azure.corp" },
    });
    expect(out).toBe("https://dev.azure.corp");
  });

  it("returns the hardcoded default when nothing is configured", () => {
    const out = resolveProviderBaseUrl({ provider: "github", env: {} });
    expect(out).toBe(PROVIDER_DEFAULT_BASE_URLS.github);
  });

  it("strips trailing slashes", () => {
    const out = resolveProviderBaseUrl({
      provider: "github",
      accountHostUrl: "https://ghe.corp/",
      env: {},
    });
    expect(out).toBe("https://ghe.corp");
  });

  it("returns an empty Jira default so callers can require per-account hostUrl", () => {
    const out = resolveProviderBaseUrl({ provider: "jira", env: {} });
    expect(out).toBe("");
  });
});
