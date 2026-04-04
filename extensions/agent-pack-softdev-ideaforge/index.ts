import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createAgentPackService } from "./src/installer.js";

const plugin = {
  id: "agent-pack-softdev-ideaforge",
  name: "Agent Pack: SoftDev, IdeaForge & QA",
  description:
    "Installs 49 production-ready AI agents into OpenClaw: " +
    "SoftDev (Engineering Manager + 12 specialist subagents) and " +
    "IdeaForge (Venture Builder + 9 specialist subagents) and " +
    "QA (2 supervisors + 24 specialist subagents). " +
    "Duplicate-safe — skips agents and workspace files that already exist.",

  register(api: OpenClawPluginApi) {
    api.registerService(createAgentPackService(api));
    api.logger.info("agent-pack-softdev-ideaforge: plugin registered");
  },
};

export default plugin;
