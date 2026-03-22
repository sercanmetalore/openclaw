// ── Agent Pack Installer Service ──────────────────────────────────────────────

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk";
import { IDEAFORGE_AGENTS } from "./agents/ideaforge.js";
import { SOFTDEV_AGENTS } from "./agents/softdev.js";
import type { AgentDefinition } from "./types.js";

const ALL_AGENTS: AgentDefinition[] = [...SOFTDEV_AGENTS, ...IDEAFORGE_AGENTS];

function resolveWorkspace(workspace: string): string {
  return workspace.startsWith("~/") ? path.join(os.homedir(), workspace.slice(2)) : workspace;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function installWorkspaceFiles(
  agent: AgentDefinition,
  api: OpenClawPluginApi,
): Promise<void> {
  const workspaceDir = resolveWorkspace(agent.config.workspace);
  await fs.mkdir(workspaceDir, { recursive: true });

  for (const [filename, content] of Object.entries(agent.files) as [string, string][]) {
    const filePath = path.join(workspaceDir, filename);
    if (await fileExists(filePath)) {
      api.logger.info(`agent-pack: ${agent.config.id}/${filename} already exists — skip`);
    } else {
      await fs.writeFile(filePath, content, "utf8");
      api.logger.info(`agent-pack: created ${agent.config.id}/${filename}`);
    }
  }
}

async function installAgentConfig(configPath: string, api: OpenClawPluginApi): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch {
    api.logger.warn("agent-pack: openclaw.json not found — skipping config install");
    return;
  }

  const config = JSON.parse(raw) as {
    agents?: {
      defaults?: unknown;
      list?: Array<{
        id: string;
        default?: boolean;
        model?: string | { primary?: string; fallbacks?: string[] };
      }>;
    };
  };

  config.agents ??= {};
  config.agents.list ??= [];

  const normalizeId = (value: string | undefined): string =>
    typeof value === "string" ? value.trim().toLowerCase() : "";
  const normalizeModelRef = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
  };
  const normalizeFallbackRefs = (values: unknown): string[] => {
    if (!Array.isArray(values)) {
      return [];
    }
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const ref = normalizeModelRef(value);
      if (!ref || seen.has(ref)) {
        continue;
      }
      seen.add(ref);
      out.push(ref);
    }
    return out;
  };

  const hasMain = config.agents.list.some((entry) => normalizeId(entry.id) === "main");
  if (!hasMain) {
    config.agents.list.push({ id: "main" });
    api.logger.info("agent-pack: added agent 'main' to config");
  }

  const existingIds = new Set(config.agents.list.map((a) => normalizeId(a.id)).filter(Boolean));
  let changed = false;

  for (const agent of ALL_AGENTS) {
    const id = normalizeId(agent.config.id);
    if (existingIds.has(id)) {
      api.logger.info(`agent-pack: agent '${agent.config.id}' already in config — skip`);
    } else {
      config.agents.list.push(agent.config);
      existingIds.add(id);
      changed = true;
      api.logger.info(`agent-pack: added agent '${agent.config.id}' to config`);
    }
  }

  // Keep the built-in main agent as canonical default for this pack.
  for (const entry of config.agents.list) {
    const isMain = normalizeId(entry.id) === "main";
    if (Boolean(entry.default) !== isMain) {
      entry.default = isMain;
      changed = true;
    }
  }

  const mainIndex = config.agents.list.findIndex((entry) => normalizeId(entry.id) === "main");
  if (mainIndex > 0) {
    const [mainEntry] = config.agents.list.splice(mainIndex, 1);
    if (mainEntry) {
      config.agents.list.unshift(mainEntry);
      changed = true;
    }
  }

  // Merge fallback chains from all non-main agents into main, so the canonical
  // main agent keeps the broadest fallback model coverage.
  const mainEntry = config.agents.list.find((entry) => normalizeId(entry.id) === "main");
  if (mainEntry) {
    const currentMainModel = mainEntry.model;
    const mainPrimary =
      typeof currentMainModel === "string"
        ? normalizeModelRef(currentMainModel)
        : normalizeModelRef(currentMainModel?.primary);
    const mainFallbacks =
      typeof currentMainModel === "string"
        ? []
        : normalizeFallbackRefs(currentMainModel?.fallbacks);

    const mergedFallbacks = [...mainFallbacks];
    const mergedSeen = new Set(mergedFallbacks);

    for (const entry of config.agents.list) {
      if (normalizeId(entry.id) === "main") {
        continue;
      }
      const model = entry.model;
      if (!model || typeof model === "string") {
        continue;
      }
      for (const fallback of normalizeFallbackRefs(model.fallbacks)) {
        if (mergedSeen.has(fallback)) {
          continue;
        }
        mergedSeen.add(fallback);
        mergedFallbacks.push(fallback);
      }
    }

    const currentMainFallbacks = mainFallbacks;
    const fallbacksChanged =
      currentMainFallbacks.length !== mergedFallbacks.length ||
      currentMainFallbacks.some((value, index) => mergedFallbacks[index] !== value);

    if (fallbacksChanged) {
      mainEntry.model = {
        ...(mainPrimary ? { primary: mainPrimary } : {}),
        fallbacks: mergedFallbacks,
      };
      changed = true;
      api.logger.info("agent-pack: merged non-main fallback models into main agent");
    }
  }

  if (changed) {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
    api.logger.info("agent-pack: openclaw.json updated");
  }
}

export function createAgentPackService(api: OpenClawPluginApi): OpenClawPluginService {
  return {
    id: "agent-pack-softdev-ideaforge",

    async start() {
      api.logger.info("agent-pack: starting installation check for SoftDev & IdeaForge packs");

      const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");

      // Step 1: Ensure all agents are registered in openclaw.json
      await installAgentConfig(configPath, api);

      // Step 2: Create workspace directories and write missing MD files
      for (const agent of ALL_AGENTS) {
        await installWorkspaceFiles(agent, api);
      }

      api.logger.info(`agent-pack: installation complete — ${ALL_AGENTS.length} agents checked`);
    },
  };
}
