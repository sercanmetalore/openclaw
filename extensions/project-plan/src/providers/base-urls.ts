// ── Provider base URL resolution ─────────────────────────────────────────────
//
// Resolution priority (highest → lowest):
//   1. account-level `settings.hostUrl` (set per account in the UI)
//   2. plugin config `providerBaseUrls.<provider>`
//   3. environment variable
//   4. hardcoded cloud default
//
// Env vars honored:
//   OPENCLAW_PROJECT_PLAN_GITHUB_URL
//   OPENCLAW_PROJECT_PLAN_GITLAB_URL
//   OPENCLAW_PROJECT_PLAN_JIRA_URL
//   OPENCLAW_PROJECT_PLAN_AZURE_URL
//
// Keeping resolution centralized lets on-prem deployments swap endpoints
// without editing per-provider code — e.g. GitHub Enterprise or a corporate
// proxy tier in front of GitLab.

import type { ProjectPlanPluginConfig } from "../types.js";

export type ProviderBaseUrlKey = "github" | "gitlab" | "jira" | "azure";

export const PROVIDER_DEFAULT_BASE_URLS: Record<ProviderBaseUrlKey, string> = {
  github: "https://api.github.com",
  gitlab: "https://gitlab.com",
  jira: "", // Jira has no universal cloud default — per-account hostUrl is required.
  azure: "https://dev.azure.com",
};

const ENV_KEYS: Record<ProviderBaseUrlKey, string> = {
  github: "OPENCLAW_PROJECT_PLAN_GITHUB_URL",
  gitlab: "OPENCLAW_PROJECT_PLAN_GITLAB_URL",
  jira: "OPENCLAW_PROJECT_PLAN_JIRA_URL",
  azure: "OPENCLAW_PROJECT_PLAN_AZURE_URL",
};

export type ResolveBaseUrlParams = {
  provider: ProviderBaseUrlKey;
  accountHostUrl?: string;
  pluginConfig?: ProjectPlanPluginConfig;
  env?: NodeJS.ProcessEnv;
};

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function resolveProviderBaseUrl(params: ResolveBaseUrlParams): string {
  const env = params.env ?? process.env;
  const accountUrl = params.accountHostUrl?.trim();
  if (accountUrl) return stripTrailingSlash(accountUrl);

  const configured = params.pluginConfig?.providerBaseUrls?.[params.provider]?.trim();
  if (configured) return stripTrailingSlash(configured);

  const envValue = env[ENV_KEYS[params.provider]]?.trim();
  if (envValue) return stripTrailingSlash(envValue);

  return PROVIDER_DEFAULT_BASE_URLS[params.provider];
}
