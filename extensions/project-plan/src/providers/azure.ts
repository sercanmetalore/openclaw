// ── Azure DevOps Work Items sync ──────────────────────────────────────────────

import { createItem } from "../store.js";
import type {
  ProjectPlanIntegrationSettings,
  ProjectPlanItem,
  ProjectPlanItemType,
  ProjectPlanPluginConfig,
  ProjectPlanSettings,
} from "../types.js";
import { resolveProviderBaseUrl } from "./base-urls.js";
import { fetchWithRetry } from "./fetch-retry.js";
import type { ProviderFetchResult } from "./github.js";

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

function readAzureRateLimitWait(res: Response): number | null {
  if (res.status !== 429) return null;
  const retryAfter = res.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  return 10_000;
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
  pluginConfig?: ProjectPlanPluginConfig;
}): Promise<ProviderFetchResult> {
  const { token, settings, planSettings, pluginConfig } = params;
  const org = settings.organization ?? "";
  if (!org) throw new Error("project-plan: Azure DevOps organization is required");
  const projectId =
    planSettings.providerProjectId || settings.project || "";
  if (!projectId) throw new Error("project-plan: Azure DevOps project is required (set providerProjectId)");

  const baseUrl = resolveProviderBaseUrl({
    provider: "azure",
    accountHostUrl: settings.hostUrl,
    pluginConfig,
  });
  const authHeader = `Basic ${Buffer.from(`:${token}`).toString("base64")}`;
  const headers = {
    Authorization: authHeader,
    "Content-Type": "application/json",
    "User-Agent": "openclaw-project-plan",
  };

  const wiqlRes = await fetchWithRetry(
    `${baseUrl}/${org}/${projectId}/_apis/wit/wiql?api-version=7.0`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        query:
          "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] <> 'Closed' AND [System.State] <> 'Resolved' ORDER BY [System.CreatedDate] ASC",
      }),
    },
    { readRateLimitWait: readAzureRateLimitWait },
  );
  if (!wiqlRes.ok) throw new Error(`Azure WIQL error ${wiqlRes.status}: ${await wiqlRes.text()}`);
  const wiql = (await wiqlRes.json()) as AzureWiqlResult;
  if (!wiql.workItems?.length) return { items: [] };

  const ids = wiql.workItems.map((r) => r.id);
  const orderById = new Map(ids.map((id, index) => [id, index]));
  const items: ProjectPlanItem[] = [];
  const errors: string[] = [];
  let partial = false;
  const BATCH = 200;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const detailRes = await fetchWithRetry(
      `${baseUrl}/${org}/${projectId}/_apis/wit/workitems?ids=${batch.join(",")}&fields=System.Title,System.Description,System.WorkItemType,System.State,System.Parent&api-version=7.0`,
      { headers },
      { readRateLimitWait: readAzureRateLimitWait },
    );
    if (!detailRes.ok) {
      const body = await detailRes.text().catch(() => "");
      errors.push(`Azure detail batch ${i}-${i + batch.length} error ${detailRes.status}: ${body}`);
      partial = true;
      continue;
    }
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
  return { items, partial, errors: errors.length ? errors : undefined };
}

/** Update Azure work item state for resolved items. */
export async function pushAzureItems(params: {
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
  items: ProjectPlanItem[];
  pluginConfig?: ProjectPlanPluginConfig;
}): Promise<void> {
  const { token, settings, planSettings, items, pluginConfig } = params;
  const org = settings.organization ?? "";
  const projectId = planSettings.providerProjectId || settings.project || "";
  if (!org || !projectId) return;

  const baseUrl = resolveProviderBaseUrl({
    provider: "azure",
    accountHostUrl: settings.hostUrl,
    pluginConfig,
  });
  const headers = {
    Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
    "Content-Type": "application/json-patch+json",
    "User-Agent": "openclaw-project-plan",
  };

  for (const item of items) {
    if (!item.externalId) continue;
    if (item.status !== "done" && item.status !== "cancelled") continue;
    const state = item.status === "done" ? "Closed" : "Removed";
    await fetchWithRetry(
      `${baseUrl}/${org}/${projectId}/_apis/wit/workitems/${item.externalId}?api-version=7.0`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify([{ op: "replace", path: "/fields/System.State", value: state }]),
      },
      { readRateLimitWait: readAzureRateLimitWait },
    );
  }
}
