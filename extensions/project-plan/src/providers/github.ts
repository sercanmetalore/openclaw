// ── GitHub Issues sync ────────────────────────────────────────────────────────

import { createItem } from "../store.js";
import type { ProjectPlanIntegrationSettings, ProjectPlanItem, ProjectPlanSettings } from "../types.js";

const GITHUB_API = "https://api.github.com";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

type GitHubIssue = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
};

async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
    try {
      const res = await fetch(url, { headers });
      if (res.status === 429 || res.status === 403) {
        const resetAt = res.headers.get("X-RateLimit-Reset");
        if (resetAt) {
          const waitMs = Math.max(0, Number(resetAt) * 1000 - Date.now()) + 500;
          await new Promise((r) => setTimeout(r, Math.min(waitMs, 60_000)));
        }
      }
      return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** Fetch all open issues from a GitHub repository and return as ProjectPlanItems. */
export async function fetchGitHubItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
}): Promise<ProjectPlanItem[]> {
  const { token, settings, planSettings } = params;
  // Resolve owner/repo: prefer providerProjectId on the plan, then settings fields.
  const repo =
    planSettings.providerProjectId ||
    (settings.owner && settings.repo ? `${settings.owner}/${settings.repo}` : "");
  if (!repo) throw new Error("project-plan: GitHub owner/repo is required (set providerProjectId)");

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "openclaw-project-plan",
  };

  const items: ProjectPlanItem[] = [];
  let page = 1;
  while (true) {
    const res = await fetchWithRetry(
      `${GITHUB_API}/repos/${repo}/issues?state=open&sort=created&direction=asc&per_page=100&page=${page}`,
      headers,
    );
    if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
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
  return items;
}

/** Close resolved issues on GitHub. */
export async function pushGitHubItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
  items: ProjectPlanItem[];
}): Promise<void> {
  const { token, settings, planSettings, items } = params;
  const repo =
    planSettings.providerProjectId ||
    (settings.owner && settings.repo ? `${settings.owner}/${settings.repo}` : "");
  if (!repo) return;

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
      `${GITHUB_API}/repos/${repo}/issues/${item.externalId}`,
      headers,
    );
    if (!res.ok) continue;
    const current = (await res.json()) as GitHubIssue;
    if (current.state === state) continue;
    await fetch(`${GITHUB_API}/repos/${repo}/issues/${item.externalId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ state }),
    });
  }
}
