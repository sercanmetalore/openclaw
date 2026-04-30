// ── GitHub Issues sync ────────────────────────────────────────────────────────

import { createItem } from "../store.js";
import type {
  ProjectPlanIntegrationSettings,
  ProjectPlanItem,
  ProjectPlanPluginConfig,
  ProjectPlanSettings,
} from "../types.js";
import { resolveProviderBaseUrl } from "./base-urls.js";
import { fetchWithRetry } from "./fetch-retry.js";

type GitHubIssue = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
};

export type ProviderFetchResult = {
  items: ProjectPlanItem[];
  partial?: boolean;
  errors?: string[];
};

function readGitHubRateLimitWait(res: Response): number | null {
  if (res.status !== 429 && res.status !== 403) return null;
  const resetAt = res.headers.get("X-RateLimit-Reset");
  if (resetAt) {
    const waitMs = Math.max(0, Number(resetAt) * 1000 - Date.now()) + 500;
    return waitMs;
  }
  return 5_000;
}

/** Fetch all open issues from a GitHub repository and return as ProjectPlanItems. */
export async function fetchGitHubItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
  pluginConfig?: ProjectPlanPluginConfig;
}): Promise<ProviderFetchResult> {
  const { token, settings, planSettings, pluginConfig } = params;
  const repo =
    planSettings.providerProjectId ||
    (settings.owner && settings.repo ? `${settings.owner}/${settings.repo}` : "");
  if (!repo) throw new Error("project-plan: GitHub owner/repo is required (set providerProjectId)");

  const baseUrl = resolveProviderBaseUrl({
    provider: "github",
    accountHostUrl: settings.hostUrl,
    pluginConfig,
  });
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "openclaw-project-plan",
  };

  const items: ProjectPlanItem[] = [];
  const errors: string[] = [];
  let partial = false;
  let page = 1;
  while (true) {
    const res = await fetchWithRetry(
      `${baseUrl}/repos/${repo}/issues?state=open&sort=created&direction=asc&per_page=100&page=${page}`,
      { headers },
      { readRateLimitWait: readGitHubRateLimitWait },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = `GitHub API error ${res.status} on page ${page}: ${body}`;
      if (items.length === 0) {
        // No pages fetched yet — fail loudly so the caller can surface it.
        throw new Error(msg);
      }
      // Later-page failure: mark partial success so the UI can warn.
      errors.push(msg);
      partial = true;
      break;
    }
    const issues = (await res.json()) as GitHubIssue[];
    if (issues.length === 0) break;
    for (const [idx, issue] of issues.entries()) {
      items.push(
        createItem({
          title: issue.title,
          description: issue.body ?? undefined,
          type: "task",
          externalId: String(issue.number),
          order: (page - 1) * 100 + idx,
        }),
      );
    }
    if (issues.length < 100) break;
    page++;
  }
  return { items, partial, errors: errors.length ? errors : undefined };
}

/** Close resolved issues on GitHub. */
export async function pushGitHubItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
  items: ProjectPlanItem[];
  pluginConfig?: ProjectPlanPluginConfig;
}): Promise<void> {
  const { token, settings, planSettings, items, pluginConfig } = params;
  const repo =
    planSettings.providerProjectId ||
    (settings.owner && settings.repo ? `${settings.owner}/${settings.repo}` : "");
  if (!repo) return;

  const baseUrl = resolveProviderBaseUrl({
    provider: "github",
    accountHostUrl: settings.hostUrl,
    pluginConfig,
  });
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "openclaw-project-plan",
    "Content-Type": "application/json",
  };

  for (const item of items) {
    if (!item.externalId) continue;
    const state = item.status === "done" || item.status === "cancelled" ? "closed" : "open";
    const res = await fetchWithRetry(
      `${baseUrl}/repos/${repo}/issues/${item.externalId}`,
      { headers },
      { readRateLimitWait: readGitHubRateLimitWait },
    );
    if (!res.ok) continue;
    const current = (await res.json()) as GitHubIssue;
    if (current.state === state) continue;
    await fetchWithRetry(
      `${baseUrl}/repos/${repo}/issues/${item.externalId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ state }),
      },
      { readRateLimitWait: readGitHubRateLimitWait },
    );
  }
}
