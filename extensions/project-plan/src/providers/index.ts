// ── Provider sync orchestration ───────────────────────────────────────────────

import type {
  ProjectPlanIntegrationId,
  ProjectPlanIntegrationSettings,
  ProjectPlanItem,
  ProjectPlanSettings,
  ProjectPlanStatus,
} from "../types.js";
import { fetchAzureItems, pushAzureItems } from "./azure.js";
import { fetchGitHubItems, pushGitHubItems } from "./github.js";
import { fetchGitLabItems, pushGitLabItems } from "./gitlab.js";
import { fetchJiraItems } from "./jira.js";

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
}): Promise<SyncResult> {
  const { source, token, settings, planSettings, existingItems } = params;

  let fetched: ProjectPlanItem[];
  if (source === "github") {
    fetched = await fetchGitHubItems({ token, settings, planSettings });
  } else if (source === "gitlab") {
    fetched = await fetchGitLabItems({ token, settings, planSettings });
  } else if (source === "jira") {
    fetched = await fetchJiraItems({ token, settings, planSettings });
  } else if (source === "azuredevops") {
    fetched = await fetchAzureItems({ token, settings, planSettings });
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

  return { added, updated, items: merged };
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
}): Promise<void> {
  const { source, token, settings, planSettings, items } = params;
  if (source === "github") {
    await pushGitHubItems({ token, settings, planSettings, items });
  } else if (source === "gitlab") {
    await pushGitLabItems({ token, settings, planSettings, items });
  } else if (source === "azuredevops") {
    await pushAzureItems({ token, settings, planSettings, items });
  }
  // Jira push not yet implemented — requires transition resolution.
}
