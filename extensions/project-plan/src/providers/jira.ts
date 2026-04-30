// ── Jira Issues sync ──────────────────────────────────────────────────────────

import { createItem } from "../store.js";
import type {
  ProjectPlanIntegrationSettings,
  ProjectPlanItem,
  ProjectPlanItemType,
  ProjectPlanPluginConfig,
  ProjectPlanSettings,
  ProjectPlanStatus,
} from "../types.js";
import { resolveProviderBaseUrl } from "./base-urls.js";
import { fetchWithRetry } from "./fetch-retry.js";
import type { ProviderFetchResult } from "./github.js";

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

type JiraTransition = {
  id: string;
  name: string;
  to?: { name?: string; statusCategory?: { key?: string } };
};

function parseDescription(desc: JiraIssue["fields"]["description"]): string | undefined {
  if (!desc) return undefined;
  if (typeof desc === "string") return desc;
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

function buildAuthHeader(settings: { usernameOrEmail?: string }, token: string): string {
  const username = settings.usernameOrEmail ?? "";
  return username
    ? `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`
    : `Bearer ${token}`;
}

function resolveJiraBaseUrl(params: {
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  pluginConfig?: ProjectPlanPluginConfig;
}): string {
  const resolved = resolveProviderBaseUrl({
    provider: "jira",
    accountHostUrl: params.settings.hostUrl,
    pluginConfig: params.pluginConfig,
  });
  if (!resolved) {
    throw new Error(
      "project-plan: Jira hostUrl is required (set accountHostUrl or providerBaseUrls.jira).",
    );
  }
  return resolved;
}

/** Fetch issues from a Jira project via JQL. */
export async function fetchJiraItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
  pluginConfig?: ProjectPlanPluginConfig;
}): Promise<ProviderFetchResult> {
  const { token, settings, planSettings, pluginConfig } = params;
  const hostUrl = resolveJiraBaseUrl({ settings, pluginConfig });
  const projectKey = planSettings.providerProjectId || settings.projectKey || "";
  if (!projectKey) throw new Error("project-plan: Jira projectKey is required (set providerProjectId)");

  const headers = {
    Authorization: buildAuthHeader(settings, token),
    Accept: "application/json",
    "User-Agent": "openclaw-project-plan",
  };

  const items: ProjectPlanItem[] = [];
  const errors: string[] = [];
  let partial = false;
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const jql = encodeURIComponent(`project = ${projectKey} AND statusCategory != Done ORDER BY created ASC`);
    const res = await fetchWithRetry(
      `${hostUrl}/rest/api/3/search?jql=${jql}&startAt=${startAt}&maxResults=${maxResults}&fields=summary,description,status,issuetype,parent`,
      { headers },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = `Jira API error ${res.status} at startAt=${startAt}: ${body}`;
      if (items.length === 0) {
        throw new Error(msg);
      }
      errors.push(msg);
      partial = true;
      break;
    }
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
  return { items, partial, errors: errors.length ? errors : undefined };
}

/**
 * Map a ProjectPlan status to the expected Jira workflow category.
 * Jira has no universal "Done" transition — each workflow defines custom
 * transitions. We pick the first transition whose target belongs to the
 * matching statusCategory so the push works across standard and custom flows.
 */
const STATUS_TO_CATEGORY: Partial<Record<ProjectPlanStatus, string>> = {
  done: "done",
  cancelled: "done",
};

function pickTransition(
  transitions: JiraTransition[],
  targetCategory: string,
): JiraTransition | undefined {
  return transitions.find(
    (t) => (t.to?.statusCategory?.key ?? "").toLowerCase() === targetCategory,
  );
}

async function listTransitions(params: {
  baseUrl: string;
  issueKey: string;
  headers: Record<string, string>;
}): Promise<JiraTransition[]> {
  const res = await fetchWithRetry(
    `${params.baseUrl}/rest/api/3/issue/${encodeURIComponent(params.issueKey)}/transitions`,
    { headers: params.headers },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { transitions?: JiraTransition[] };
  return data.transitions ?? [];
}

/**
 * Transition resolved items to a terminal Jira status.
 *
 * Strategy: for each completed item, list its available transitions and pick
 * the first one whose target belongs to the "done" status category. Skip items
 * where no such transition exists so a misconfigured workflow does not fail
 * the whole sync.
 */
export async function pushJiraItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
  items: ProjectPlanItem[];
  pluginConfig?: ProjectPlanPluginConfig;
}): Promise<void> {
  const { token, settings, items, pluginConfig } = params;
  const baseUrl = resolveJiraBaseUrl({ settings, pluginConfig });
  const headers = {
    Authorization: buildAuthHeader(settings, token),
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "openclaw-project-plan",
  };

  for (const item of items) {
    if (!item.externalId) continue;
    const targetCategory = STATUS_TO_CATEGORY[item.status];
    if (!targetCategory) continue;

    const transitions = await listTransitions({
      baseUrl,
      issueKey: item.externalId,
      headers,
    });
    const transition = pickTransition(transitions, targetCategory);
    if (!transition) continue;

    await fetchWithRetry(
      `${baseUrl}/rest/api/3/issue/${encodeURIComponent(item.externalId)}/transitions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ transition: { id: transition.id } }),
      },
    );
  }
}
