// ── Agent routing for softdev plans ──────────────────────────────────────────
//
// When the plan's default agent is a softdev-* ensemble, the routing rules
// below pick the specialist whose keyword signature matches the item best.
// Explicit "Assignee role:" markers in the description win; otherwise a
// keyword scan over the item + task + epic text chooses the specialist.

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { buildExecutionContext } from "./execution.js";
import type { ProjectPlanItem, ProjectPlanRecord } from "./types.js";

export type RouteDecision = { agentId: string; reason: string };

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("ı", "i")
    .replaceAll("İ", "i")
    .replaceAll("ş", "s")
    .replaceAll("Ş", "s")
    .replaceAll("ğ", "g")
    .replaceAll("Ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("Ü", "u")
    .replaceAll("ö", "o")
    .replaceAll("Ö", "o")
    .replaceAll("ç", "c")
    .replaceAll("Ç", "c");
}

export function findAssigneeRole(text: string): string {
  const match = text.match(/Assignee role:\s*([^\n\r]+)/i);
  return match?.[1]?.trim() ?? "";
}

export function mapRoleToAgentId(params: {
  configuredIds: Set<string>;
  role: string;
}): RouteDecision | undefined {
  const role = normalizeText(params.role);
  if (!role) {
    return undefined;
  }

  const roleRules: Array<{ target: string; tokens: string[]; reason: string }> = [
    {
      target: "softdev-devops",
      tokens: ["devops", "sre", "platform", "infrastructure"],
      reason: "assignee-role-devops",
    },
    {
      target: "softdev-qa",
      tokens: ["qa", "quality", "test"],
      reason: "assignee-role-qa",
    },
    {
      target: "softdev-database",
      tokens: ["database", "data", "sql", "typeorm"],
      reason: "assignee-role-database",
    },
    {
      target: "softdev-backend",
      tokens: ["backend", "api", "server"],
      reason: "assignee-role-backend",
    },
    {
      target: "softdev-frontend",
      tokens: ["frontend", "ui", "ux"],
      reason: "assignee-role-frontend",
    },
    {
      target: "softdev-security",
      tokens: ["security", "secops"],
      reason: "assignee-role-security",
    },
    {
      target: "softdev-docs",
      tokens: ["docs", "documentation", "technical writer"],
      reason: "assignee-role-docs",
    },
    {
      target: "softdev-release",
      tokens: ["release", "reliability"],
      reason: "assignee-role-release",
    },
  ];

  for (const rule of roleRules) {
    if (!params.configuredIds.has(rule.target)) {
      continue;
    }
    if (rule.tokens.some((token) => role.includes(token))) {
      return { agentId: rule.target, reason: rule.reason };
    }
  }
  return undefined;
}

function collectConfiguredAgentIds(
  api: OpenClawPluginApi,
  defaultAgentId: string,
): Set<string> {
  const configuredIds = new Set(
    (api.config.agents?.list ?? [])
      .map((entry) => (typeof entry?.id === "string" ? entry.id.trim() : ""))
      .filter(Boolean),
  );
  configuredIds.add(defaultAgentId);
  configuredIds.add("main");
  return configuredIds;
}

export function chooseExecutionAgentId(params: {
  api: OpenClawPluginApi;
  plan: ProjectPlanRecord;
  item: ProjectPlanItem;
}): RouteDecision {
  const { api, plan, item } = params;
  const defaultAgentId = plan.settings.defaultAgentId ?? "main";
  const configuredIds = collectConfiguredAgentIds(api, defaultAgentId);

  // Keep behavior unchanged for non-softdev setups.
  if (!defaultAgentId.startsWith("softdev")) {
    return { agentId: defaultAgentId, reason: "default-agent" };
  }

  const context = buildExecutionContext(plan, item);
  const itemAndTaskText = [
    item.title,
    item.description ?? "",
    context.task?.title ?? "",
    context.task?.description ?? "",
  ]
    .join("\n")
    .trim();

  const explicitRole =
    findAssigneeRole(item.description ?? "") ||
    findAssigneeRole(context.task?.description ?? "") ||
    findAssigneeRole(context.epic?.description ?? "");

  const mappedByRole = mapRoleToAgentId({ configuredIds, role: explicitRole });
  if (mappedByRole) {
    return mappedByRole;
  }

  const haystack = normalizeText(itemAndTaskText);

  const routeRules: Array<{ target: string; tokens: string[]; reason: string }> = [
    {
      target: "softdev-qa",
      tokens: ["qa", "test", "fixture", "smoke", "e2e", "integration", "validation"],
      reason: "qa-keywords",
    },
    {
      target: "softdev-devops",
      tokens: ["devops", "docker", "kubernetes", "helm", "ci", "cd", "deploy", "infrastructure"],
      reason: "devops-keywords",
    },
    {
      target: "softdev-database",
      tokens: ["database", "db", "sql", "typeorm", "migration", "schema", "postgres", "query"],
      reason: "database-keywords",
    },
    {
      target: "softdev-backend",
      tokens: ["backend", "api", "nest", "service", "controller", "endpoint"],
      reason: "backend-keywords",
    },
    {
      target: "softdev-frontend",
      tokens: ["frontend", "ui", "ux", "react", "component", "page", "style"],
      reason: "frontend-keywords",
    },
    {
      target: "softdev-security",
      tokens: ["security", "vulnerability", "auth", "permission", "encryption", "xss", "csrf"],
      reason: "security-keywords",
    },
    {
      target: "softdev-docs",
      tokens: ["docs", "documentation", "readme", "guide", "mintlify"],
      reason: "docs-keywords",
    },
    {
      target: "softdev-release",
      tokens: ["release", "changelog", "version", "publish", "tag", "notar"],
      reason: "release-keywords",
    },
  ];

  for (const rule of routeRules) {
    if (!configuredIds.has(rule.target)) {
      continue;
    }
    if (rule.tokens.some((token) => haystack.includes(token))) {
      return { agentId: rule.target, reason: rule.reason };
    }
  }

  return { agentId: defaultAgentId, reason: "fallback-default" };
}

export function chooseFallbackExecutionAgentId(params: {
  api: OpenClawPluginApi;
  plan: ProjectPlanRecord;
  primaryAgentId: string;
}): RouteDecision | undefined {
  const { api, plan, primaryAgentId } = params;
  const defaultAgentId = plan.settings.defaultAgentId ?? "main";
  const configuredIds = collectConfiguredAgentIds(api, defaultAgentId);

  if (primaryAgentId !== defaultAgentId && configuredIds.has(defaultAgentId)) {
    return { agentId: defaultAgentId, reason: "timeout-fallback-default-agent" };
  }
  if (primaryAgentId !== "main" && configuredIds.has("main")) {
    return { agentId: "main", reason: "timeout-fallback-main" };
  }

  return undefined;
}
