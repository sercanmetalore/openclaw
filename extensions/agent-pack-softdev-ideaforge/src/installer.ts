// ── Agent Pack Installer Service ──────────────────────────────────────────────

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk";
import { SOFTDEV_AGENTS } from "./agents/softdev.js";
import { IDEAFORGE_AGENTS } from "./agents/ideaforge.js";
import type { AgentDefinition } from "./types.js";

const ALL_AGENTS: AgentDefinition[] = [...SOFTDEV_AGENTS, ...IDEAFORGE_AGENTS];

function resolveWorkspace(workspace: string): string {
  return workspace.startsWith("~/")
    ? path.join(os.homedir(), workspace.slice(2))
    : workspace;
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

async function installAgentConfig(
  configPath: string,
  api: OpenClawPluginApi,
): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch {
    api.logger.warn("agent-pack: openclaw.json not found — skipping config install");
    return;
  }

  const config = JSON.parse(raw) as {
    agents?: { defaults?: unknown; list?: Array<{ id: string }> };
  };

  config.agents ??= {};
  config.agents.list ??= [];

  const existingIds = new Set(config.agents.list.map((a) => a.id));
  let changed = false;

  for (const agent of ALL_AGENTS) {
    if (existingIds.has(agent.config.id)) {
      api.logger.info(`agent-pack: agent '${agent.config.id}' already in config — skip`);
    } else {
      config.agents.list.push(agent.config);
      existingIds.add(agent.config.id);
      changed = true;
      api.logger.info(`agent-pack: added agent '${agent.config.id}' to config`);
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

      api.logger.info(
        `agent-pack: installation complete — ${ALL_AGENTS.length} agents checked`,
      );
    },
  };
}
