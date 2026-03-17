// ── Azure DevOps Work Items sync ──────────────────────────────────────────────

import { createItem } from "../store.js";
import type {
  ProjectPlanIntegrationSettings,
  ProjectPlanItem,
  ProjectPlanItemType,
  ProjectPlanSettings,
} from "../types.js";

const AZURE_API = "https://dev.azure.com";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

type AzureWorkItemRef = { id: number };
type AzureWorkItemFields = {
  "System.Title": string;
  "System.Description"?: string;
  "System.WorkItemType": string;
  "System.State": string;
  "System.Parent"?: number;
};
type AzureWorkItem = { id: number; fields: AzureWorkItemFields };
type AzureWiqlResult = { workItems: AzureWorkItemRef[] };

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  init?: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
    try {
      const res = await fetch(url, { headers, ...init });
      if (res.status === 429) await new Promise((r) => setTimeout(r, 10_000));
      return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function mapWorkItemType(typeName: string): ProjectPlanItemType {
  const lower = typeName.toLowerCase();
  if (lower === "epic") return "epic";
  if (lower === "task" || lower === "bug" || lower === "issue") return "task";
  return "task";
}

/** Fetch active work items from Azure DevOps via WIQL. */
export async function fetchAzureItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
}): Promise<ProjectPlanItem[]> {
  const { token, settings, planSettings } = params;
  const org = settings.organization ?? "";
  if (!org) throw new Error("project-plan: Azure DevOps organization is required");
  // providerProjectId can be "MyProject" or "org/project" form.
  const projectId =
    planSettings.providerProjectId || settings.project || "";
  if (!projectId) throw new Error("project-plan: Azure DevOps project is required (set providerProjectId)");

  const baseUrl = settings.hostUrl ?? AZURE_API;
  const authHeader = `Basic ${Buffer.from(`:${token}`).toString("base64")}`;
  const headers = {
    Authorization: authHeader,
    "Content-Type": "application/json",
    "User-Agent": "openclaw-project-plan",
  };

  // Run WIQL query.
  const wiqlRes = await fetchWithRetry(
    `${baseUrl}/${org}/${projectId}/_apis/wit/wiql?api-version=7.0`,
    headers,
    {
      method: "POST",
      body: JSON.stringify({
        query:
          "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] <> 'Closed' AND [System.State] <> 'Resolved' ORDER BY [System.CreatedDate] ASC",
      }),
    },
  );
  if (!wiqlRes.ok) throw new Error(`Azure WIQL error ${wiqlRes.status}: ${await wiqlRes.text()}`);
  const wiql = (await wiqlRes.json()) as AzureWiqlResult;
  if (!wiql.workItems?.length) return [];

  // Batch-fetch work item details (max 200 per request).
  const ids = wiql.workItems.map((r) => r.id);
  const orderById = new Map(ids.map((id, index) => [id, index]));
  const items: ProjectPlanItem[] = [];
  const BATCH = 200;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const detailRes = await fetchWithRetry(
      `${baseUrl}/${org}/${projectId}/_apis/wit/workitems?ids=${batch.join(",")}&fields=System.Title,System.Description,System.WorkItemType,System.State,System.Parent&api-version=7.0`,
      headers,
    );
    if (!detailRes.ok) continue;
    const data = (await detailRes.json()) as { value: AzureWorkItem[] };
    const orderedBatch = [...data.value].sort(
      (a, b) => (orderById.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
    for (const wi of orderedBatch) {
      items.push(
        createItem({
          title: wi.fields["System.Title"],
          description: wi.fields["System.Description"] ?? undefined,
          type: mapWorkItemType(wi.fields["System.WorkItemType"]),
          externalId: String(wi.id),
          order: orderById.get(wi.id) ?? items.length,
        }),
      );
    }
  }
  return items;
}

/** Update Azure work item state for resolved items. */
export async function pushAzureItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
  items: ProjectPlanItem[];
}): Promise<void> {
  const { token, settings, planSettings, items } = params;
  const org = settings.organization ?? "";
  const projectId = planSettings.providerProjectId || settings.project || "";
  if (!org || !projectId) return;

  const baseUrl = settings.hostUrl ?? AZURE_API;
  const headers = {
    Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
    "Content-Type": "application/json-patch+json",
    "User-Agent": "openclaw-project-plan",
  };

  for (const item of items) {
    if (!item.externalId) continue;
    if (item.status !== "done" && item.status !== "cancelled") continue;
    const state = item.status === "done" ? "Closed" : "Removed";
    await fetch(
      `${baseUrl}/${org}/${projectId}/_apis/wit/workitems/${item.externalId}?api-version=7.0`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify([{ op: "replace", path: "/fields/System.State", value: state }]),
      },
    );
  }
}
