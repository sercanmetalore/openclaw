// ── GitLab Issues sync ────────────────────────────────────────────────────────

import { createItem } from "../store.js";
import type {
  ProjectPlanIntegrationSettings,
  ProjectPlanItem,
  ProjectPlanPluginConfig,
  ProjectPlanSettings,
} from "../types.js";
import { resolveProviderBaseUrl } from "./base-urls.js";
import { fetchWithRetry } from "./fetch-retry.js";
import type { ProviderFetchResult } from "./github.js";

type GitLabIssue = {
  iid: number;
  title: string;
  description: string | null;
  state: "opened" | "closed";
};

/** Fetch open issues from a GitLab project. */
export async function fetchGitLabItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
  pluginConfig?: ProjectPlanPluginConfig;
}): Promise<ProviderFetchResult> {
  const { token, settings, planSettings, pluginConfig } = params;
  const baseUrl = resolveProviderBaseUrl({
    provider: "gitlab",
    accountHostUrl: settings.hostUrl,
    pluginConfig,
  });
  const projectPath = planSettings.providerProjectId || settings.project || "";
  if (!projectPath) throw new Error("project-plan: GitLab project path is required (set providerProjectId)");
  const projectId = encodeURIComponent(projectPath);

  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "openclaw-project-plan",
  };

  const items: ProjectPlanItem[] = [];
  const errors: string[] = [];
  let partial = false;
  let page = 1;
  while (true) {
    const res = await fetchWithRetry(
      `${baseUrl}/api/v4/projects/${projectId}/issues?state=opened&order_by=created_at&sort=asc&per_page=100&page=${page}`,
      { headers },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = `GitLab API error ${res.status} on page ${page}: ${body}`;
      if (items.length === 0) {
        throw new Error(msg);
      }
      errors.push(msg);
      partial = true;
      break;
    }
    const issues = (await res.json()) as GitLabIssue[];
    if (issues.length === 0) break;
    for (const [idx, issue] of issues.entries()) {
      items.push(
        createItem({
          title: issue.title,
          description: issue.description ?? undefined,
          type: "task",
          externalId: String(issue.iid),
          order: (page - 1) * 100 + idx,
        }),
      );
    }
    if (issues.length < 100) break;
    page++;
  }
  return { items, partial, errors: errors.length ? errors : undefined };
}

/** Close resolved issues on GitLab. */
export async function pushGitLabItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
  items: ProjectPlanItem[];
  pluginConfig?: ProjectPlanPluginConfig;
}): Promise<void> {
  const { token, settings, planSettings, items, pluginConfig } = params;
  const baseUrl = resolveProviderBaseUrl({
    provider: "gitlab",
    accountHostUrl: settings.hostUrl,
    pluginConfig,
  });
  const projectPath = planSettings.providerProjectId || settings.project || "";
  if (!projectPath) return;
  const projectId = encodeURIComponent(projectPath);

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "openclaw-project-plan",
  };

  for (const item of items) {
    if (!item.externalId) continue;
    const stateEvent = item.status === "done" || item.status === "cancelled" ? "close" : "reopen";
    await fetchWithRetry(
      `${baseUrl}/api/v4/projects/${projectId}/issues/${item.externalId}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ state_event: stateEvent }),
      },
    );
  }
}
