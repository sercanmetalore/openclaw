// ── Provider sync orchestration ───────────────────────────────────────────────

import type {
  ProjectPlanIntegrationId,
  ProjectPlanIntegrationSettings,
  ProjectPlanItem,
  ProjectPlanPluginConfig,
  ProjectPlanSettings,
  ProjectPlanStatus,
} from "../types.js";
import { fetchAzureItems, pushAzureItems } from "./azure.js";
import { fetchGitHubItems, pushGitHubItems } from "./github.js";
import { fetchGitLabItems, pushGitLabItems } from "./gitlab.js";
import { fetchJiraItems, pushJiraItems } from "./jira.js";

export type SyncResult = {
  added: number;
  updated: number;
  items: ProjectPlanItem[];
};

// Statuses that indicate local work has been done — preserve them during sync.
const PRESERVE_STATUSES = new Set<ProjectPlanStatus>(["in progress", "done", "failed", "cancelled"]);

/**
 * Pull items from the cloud provider and merge them with the existing local list.
 * Strategy: last-write-wins by externalId for metadata; local status is preserved
 * when the item has been worked on.
 */
export async function syncFromProvider(params: {
  source: ProjectPlanIntegrationId;
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
  existingItems: ProjectPlanItem[];
  pluginConfig?: ProjectPlanPluginConfig;
}): Promise<SyncResult & { partial?: boolean; errors?: string[] }> {
  const { source, token, settings, planSettings, existingItems, pluginConfig } = params;

  let fetched: ProjectPlanItem[];
  let partial = false;
  const errors: string[] = [];
  if (source === "github") {
    const res = await fetchGitHubItems({ token, settings, planSettings, pluginConfig });
    fetched = res.items;
    partial = res.partial ?? false;
    if (res.errors?.length) errors.push(...res.errors);
  } else if (source === "gitlab") {
    const res = await fetchGitLabItems({ token, settings, planSettings, pluginConfig });
    fetched = res.items;
    partial = res.partial ?? false;
    if (res.errors?.length) errors.push(...res.errors);
  } else if (source === "jira") {
    const res = await fetchJiraItems({ token, settings, planSettings, pluginConfig });
    fetched = res.items;
    partial = res.partial ?? false;
    if (res.errors?.length) errors.push(...res.errors);
  } else if (source === "azuredevops") {
    const res = await fetchAzureItems({ token, settings, planSettings, pluginConfig });
    fetched = res.items;
    partial = res.partial ?? false;
    if (res.errors?.length) errors.push(...res.errors);
  } else {
    return { added: 0, updated: 0, items: existingItems };
  }

  const byExternalId = new Map<string, ProjectPlanItem>(
    existingItems.filter((i) => i.externalId).map((i) => [i.externalId!, i]),
  );

  let added = 0;
  let updated = 0;
  const merged: ProjectPlanItem[] = [...existingItems];

  for (const incoming of fetched) {
    if (!incoming.externalId) {
      merged.push(incoming);
      added++;
      continue;
    }
    const existing = byExternalId.get(incoming.externalId);
    if (existing) {
      existing.title = incoming.title;
      existing.description = incoming.description;
      existing.order = incoming.order;
      // Preserve local status if item has been worked on.
      if (!PRESERVE_STATUSES.has(existing.status)) {
        existing.status = incoming.status;
      }
      existing.updatedAt = Date.now();
      updated++;
    } else {
      merged.push(incoming);
      added++;
    }
  }

  return { added, updated, items: merged, partial, errors: errors.length ? errors : undefined };
}

/**
 * Push locally completed/cancelled items back to the cloud provider.
 */
export async function syncToProvider(params: {
  source: ProjectPlanIntegrationId;
  token: string;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  planSettings: ProjectPlanSettings;
  items: ProjectPlanItem[];
  pluginConfig?: ProjectPlanPluginConfig;
}): Promise<void> {
  const { source, token, settings, planSettings, items, pluginConfig } = params;
  if (source === "github") {
    await pushGitHubItems({ token, settings, planSettings, items, pluginConfig });
  } else if (source === "gitlab") {
    await pushGitLabItems({ token, settings, planSettings, items, pluginConfig });
  } else if (source === "azuredevops") {
    await pushAzureItems({ token, settings, planSettings, items, pluginConfig });
  } else if (source === "jira") {
    await pushJiraItems({ token, settings, planSettings, items, pluginConfig });
  }
}
