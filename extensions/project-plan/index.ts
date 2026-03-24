import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerGatewayMethods } from "./src/gateway.js";
import { createHttpHandler } from "./src/http.js";
import { createProjectPlanService, registerProjectPlanStopHooks } from "./src/service.js";
import type { ProjectPlanPluginConfig } from "./src/types.js";

const plugin = {
  id: "project-plan",
  name: "Project Plan",
  description:
    "Manage project plans and automate task execution with registered AI agents. " +
    "Supports GitHub, GitLab, Jira, Azure DevOps, and local plans.",

  register(api: OpenClawPluginApi) {
    const pluginConfig = (api.pluginConfig ?? {}) as ProjectPlanPluginConfig;

    registerProjectPlanStopHooks(api);

    // Background service — manages graceful shutdown of agent execution loops.
    api.registerService(createProjectPlanService(api));

    // Gateway methods — plugin.plan.* RPC handlers for the built-in OpenClaw UI.
    registerGatewayMethods(api, pluginConfig);

    // HTTP route — serves the standalone SPA UI at /plugins/project-plan/.
    api.registerHttpRoute({
      path: "/plugins/project-plan",
      auth: "plugin",
      match: "prefix",
      handler: createHttpHandler({ api, pluginConfig }),
    });

    api.logger.info("project-plan: plugin registered");
  },
};

export default plugin;
