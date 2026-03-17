// ── Jira Issues sync ──────────────────────────────────────────────────────────

import { createItem } from "../store.js";
import type {
  ProjectPlanIntegrationSettings,
  ProjectPlanItem,
  ProjectPlanItemType,
  ProjectPlanSettings,
} from "../types.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

type JiraIssue = {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: { content?: unknown[] } | string | null;
    status: { name: string };
    issuetype: { name: string };
    parent?: { key: string };
  };
};

type JiraSearchResult = {
  issues: JiraIssue[];
  startAt: number;
  maxResults: number;
  total: number;
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
        await new Promise((r) =>
          setTimeout(r, Math.min((retryAfter ? Number(retryAfter) : 5) * 1000, 60_000)),
        );
      }
      return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function parseDescription(desc: JiraIssue["fields"]["description"]): string | undefined {
  if (!desc) return undefined;
  if (typeof desc === "string") return desc;
  // ADF format — extract plain text from content nodes.
  const texts: string[] = [];
  const walk = (nodes: unknown[]): void => {
    for (const node of nodes) {
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.type === "text" && n.text) texts.push(n.text);
      if (n.content?.length) walk(n.content);
    }
  };
  if (Array.isArray(desc.content)) walk(desc.content);
  return texts.join("") || undefined;
}

function mapIssueType(name: string): ProjectPlanItemType {
  const lower = name.toLowerCase();
  if (lower === "epic") return "epic";
  if (lower === "subtask" || lower === "sub-task") return "subtask";
  return "task";
}

/** Fetch issues from a Jira project via JQL. */
export async function fetchJiraItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
}): Promise<ProjectPlanItem[]> {
  const { token, settings, planSettings } = params;
  const hostUrl = settings.hostUrl;
  if (!hostUrl) throw new Error("project-plan: Jira hostUrl is required");
  const projectKey = planSettings.providerProjectId || settings.projectKey || "";
  if (!projectKey) throw new Error("project-plan: Jira projectKey is required (set providerProjectId)");

  const username = settings.usernameOrEmail ?? "";
  const authHeader = username
    ? `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`
    : `Bearer ${token}`;

  const headers = {
    Authorization: authHeader,
    Accept: "application/json",
    "User-Agent": "openclaw-project-plan",
  };

  const items: ProjectPlanItem[] = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const jql = encodeURIComponent(`project = ${projectKey} AND statusCategory != Done ORDER BY created ASC`);
    const res = await fetchWithRetry(
      `${hostUrl}/rest/api/3/search?jql=${jql}&startAt=${startAt}&maxResults=${maxResults}&fields=summary,description,status,issuetype,parent`,
      headers,
    );
    if (!res.ok) throw new Error(`Jira API error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as JiraSearchResult;
    for (const [idx, issue] of data.issues.entries()) {
      items.push(
        createItem({
          title: issue.fields.summary,
          description: parseDescription(issue.fields.description),
          type: mapIssueType(issue.fields.issuetype.name),
          externalId: issue.key,
          order: startAt + idx,
        }),
      );
    }
    startAt += data.issues.length;
    if (startAt >= data.total || data.issues.length === 0) break;
  }
  return items;
}
