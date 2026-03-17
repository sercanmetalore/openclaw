// ── GitLab Issues sync ────────────────────────────────────────────────────────

import { createItem } from "../store.js";
import type { ProjectPlanIntegrationSettings, ProjectPlanItem, ProjectPlanSettings } from "../types.js";

const GITLAB_CLOUD = "https://gitlab.com";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

type GitLabIssue = {
  iid: number;
  title: string;
  description: string | null;
  state: "opened" | "closed";
};

async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
    try {
      const res = await fetch(url, { headers });
      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        const waitMs = retryAfter ? Number(retryAfter) * 1000 : 5_000;
        await new Promise((r) => setTimeout(r, Math.min(waitMs, 60_000)));
      }
      return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** Fetch open issues from a GitLab project. */
export async function fetchGitLabItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
}): Promise<ProjectPlanItem[]> {
  const { token, settings, planSettings } = params;
  const baseUrl = settings.hostUrl ?? GITLAB_CLOUD;
  const projectPath = planSettings.providerProjectId || settings.project || "";
  if (!projectPath) throw new Error("project-plan: GitLab project path is required (set providerProjectId)");
  const projectId = encodeURIComponent(projectPath);

  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "openclaw-project-plan",
  };

  const items: ProjectPlanItem[] = [];
  let page = 1;
  while (true) {
    const res = await fetchWithRetry(
      `${baseUrl}/api/v4/projects/${projectId}/issues?state=opened&order_by=created_at&sort=asc&per_page=100&page=${page}`,
      headers,
    );
    if (!res.ok) throw new Error(`GitLab API error ${res.status}: ${await res.text()}`);
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
  return items;
}

/** Close resolved issues on GitLab. */
export async function pushGitLabItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
  items: ProjectPlanItem[];
}): Promise<void> {
  const { token, settings, planSettings, items } = params;
  const baseUrl = settings.hostUrl ?? GITLAB_CLOUD;
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
    await fetch(`${baseUrl}/api/v4/projects/${projectId}/issues/${item.externalId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ state_event: stateEvent }),
    });
  }
}
