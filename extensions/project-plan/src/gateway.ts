// ── Gateway method registration (plugin.plan.*) ───────────────────────────────

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { recomputeContainerStatuses } from "./execution.js";
import { convertFileToItems } from "./llm-convert.js";
import { syncFromProvider } from "./providers/index.js";
import { isRunning, requestStop, startPlanExecution } from "./service.js";
import {
  buildCounts,
  createItem,
  createLog,
  createPlan,
  deletePlan,
  getIntegrations,
  getPluginConfigOpts,
  importItemsFromPayload,
  listPlans,
  loadAccounts,
  loadPlan,
  resolveIntegrationSettings,
  resolveIntegrationToken,
  saveAccounts,
  saveIntegrationsConfig,
  savePlan,
  toPublicAccounts,
  type UploadPayload,
} from "./store.js";
import type {
  ProjectPlanDetailResult,
  ProjectPlanIntegrationId,
  ProjectPlanIntegrationSettings,
  ProjectPlanItemType,
  ProjectPlanListResult,
  ProjectPlanPluginConfig,
  ProjectPlanSettings,
  ProjectPlanStatus,
  StoredAccount,
} from "./types.js";

export function registerGatewayMethods(
  api: OpenClawPluginApi,
  pluginConfig: ProjectPlanPluginConfig,
): void {
  const opts = getPluginConfigOpts(pluginConfig);

  async function stateDir(): Promise<string> {
    return api.runtime.state.resolveStateDir();
  }

  // ── ping ──────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.ping", (req) => {
    req.respond(true, { ok: true });
  });

  // ── list ──────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.list", async (req) => {
    try {
      const dir = await stateDir();
      const [plans, { integrations, availableSources }] = await Promise.all([
        listPlans(dir),
        getIntegrations(dir),
      ]);
      const result: ProjectPlanListResult = {
        plans: plans.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status,
          source: p.settings.source,
          updatedAt: p.updatedAt,
          running: isRunning(p.id),
          counts: buildCounts(p.items),
        })),
        availableSources,
        integrations,
      };
      req.respond(true, result);
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── get ───────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.get", async (req) => {
    try {
      const dir = await stateDir();
      const planId = req.params.planId as string;
      const [plan, { integrations, availableSources }] = await Promise.all([
        loadPlan(dir, planId),
        getIntegrations(dir),
      ]);
      if (!plan) {
        req.respond(false, undefined, { message: "Plan not found" });
        return;
      }
      const running = isRunning(planId);
      const counts = buildCounts(plan.items);
      const totalItems = plan.items.length;
      const doneItems = counts["done"] + counts["cancelled"];
      const completionRatio = totalItems > 0 ? doneItems / totalItems : 0;
      const result: ProjectPlanDetailResult = {
        plan: { ...plan, execution: { ...plan.execution, running } },
        availableSources,
        integrations,
        dashboard: {
          counts,
          totalItems,
          completionRatio,
          running,
          tokenSpent: plan.metrics.tokenSpent,
          durationMs: plan.metrics.durationMs,
          runCount: plan.metrics.runCount,
          currentItemId: plan.execution.currentItemId,
        },
      };
      req.respond(true, result);
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── create ────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.create", async (req) => {
    try {
      const dir = await stateDir();
      const plan = createPlan({
        name: req.params.name as string,
        description: req.params.description as string | undefined,
      });
      await savePlan(dir, plan, opts);
      req.respond(true, { ok: true, plan: { id: plan.id } });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── settings.save ─────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.settings.save", async (req) => {
    try {
      const dir = await stateDir();
      const planId = req.params.planId as string;
      const settings = req.params.settings as ProjectPlanSettings;
      const plan = await loadPlan(dir, planId);
      if (!plan) {
        req.respond(false, undefined, { message: "Plan not found" });
        return;
      }
      plan.settings = { ...plan.settings, ...settings };
      plan.logs.push(createLog({ level: "info", message: "Settings updated." }));
      await savePlan(dir, plan, opts);
      req.respond(true, { ok: true });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── start ─────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.start", async (req) => {
    try {
      const dir = await stateDir();
      const planId = req.params.planId as string;
      const plan = await loadPlan(dir, planId);
      if (!plan) {
        req.respond(false, undefined, { message: "Plan not found" });
        return;
      }
      if (isRunning(planId)) {
        req.respond(false, undefined, { message: "Plan is already running" });
        return;
      }
      startPlanExecution({ planId, stateDir: dir, api, pluginConfig });
      req.respond(true, { ok: true });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── retry ─────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.retry", async (req) => {
    try {
      const dir = await stateDir();
      const planId = req.params.planId as string;
      const plan = await loadPlan(dir, planId);
      if (!plan) {
        req.respond(false, undefined, { message: "Plan not found" });
        return;
      }
      if (isRunning(planId)) {
        req.respond(false, undefined, { message: "Plan is already running" });
        return;
      }

      const now = Date.now();
      let resetCount = 0;
      for (const item of plan.items) {
        if (
          item.status === "failed" ||
          item.status === "in progress" ||
          item.status === "blocked"
        ) {
          item.status = "to do";
          item.updatedAt = now;
          resetCount += 1;
        }
      }

      recomputeContainerStatuses(plan);
      plan.status = "to do";
      plan.execution.running = false;
      plan.execution.currentItemId = undefined;
      plan.logs.push(
        createLog({
          level: "warn",
          message: `Retry reset: moved ${resetCount} items from failed/in progress/blocked to to do.`,
        }),
      );
      await savePlan(dir, plan, opts);

      req.respond(true, { ok: true, resetCount });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── stop ──────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.stop", async (req) => {
    await requestStop(req.params.planId as string, api);
    req.respond(true, { ok: true });
  });

  // ── delete ────────────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.delete", async (req) => {
    try {
      const dir = await stateDir();
      const planId = req.params.planId as string;
      await requestStop(planId, api);
      await deletePlan(dir, planId);
      req.respond(true, { ok: true });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── item.status ───────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.item.status", async (req) => {
    try {
      const dir = await stateDir();
      const { planId, itemId, status } = req.params as {
        planId: string;
        itemId: string;
        status: ProjectPlanStatus;
      };
      const plan = await loadPlan(dir, planId);
      if (!plan) {
        req.respond(false, undefined, { message: "Plan not found" });
        return;
      }
      const item = plan.items.find((i) => i.id === itemId);
      if (!item) {
        req.respond(false, undefined, { message: "Item not found" });
        return;
      }
      item.status = status;
      item.updatedAt = Date.now();
      recomputeContainerStatuses(plan);
      await savePlan(dir, plan, opts);
      req.respond(true, { ok: true });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── sync.pull ─────────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.sync.pull", async (req) => {
    try {
      const dir = await stateDir();
      const planId = req.params.planId as string;
      const plan = await loadPlan(dir, planId);
      if (!plan) {
        req.respond(false, undefined, { message: "Plan not found" });
        return;
      }
      const source = plan.settings.source;
      if (source === "local") {
        req.respond(false, undefined, { message: "Local plans do not support provider sync" });
        return;
      }
      const token = await resolveIntegrationToken(dir, source);
      if (!token) {
        req.respond(false, undefined, { message: `No token configured for ${source}` });
        return;
      }
      const integration = await resolveIntegrationSettings(dir, source);
      const { items, added, updated } = await syncFromProvider({
        source,
        token,
        settings: integration?.settings ?? {},
        planSettings: plan.settings,
        existingItems: plan.items,
      });
      plan.items = items;
      recomputeContainerStatuses(plan);
      plan.logs.push(
        createLog({ level: "info", message: `Sync complete: ${added} added, ${updated} updated.` }),
      );
      await savePlan(dir, plan, opts);
      req.respond(true, { ok: true, added, updated });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── upload.local ──────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.upload.local", async (req) => {
    try {
      const dir = await stateDir();
      const planId = req.params.planId as string;
      const payloadText = req.params.payload as string;
      const filename = (req.params.filename as string | undefined) ?? "upload.json";
      const plan = await loadPlan(dir, planId);
      if (!plan) {
        req.respond(false, undefined, { message: "Plan not found" });
        return;
      }

      // Route every upload through the shared conversion pipeline so JSON review stays consistent.
      let jsonStr: string;
      let convertMethod: string;
      try {
        const result = await convertFileToItems({ content: payloadText, filename, api });
        jsonStr = result.json;
        convertMethod = result.method;
      } catch {
        req.respond(false, undefined, { message: "Could not parse or convert payload" });
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(jsonStr);
      } catch {
        req.respond(false, undefined, { message: "Invalid JSON after conversion" });
        return;
      }
      const newItems = importItemsFromPayload(
        payload as unknown as UploadPayload,
        plan.items.length,
      );
      plan.items = [...plan.items, ...newItems];
      recomputeContainerStatuses(plan);
      plan.logs.push(
        createLog({
          level: "info",
          message: `Imported ${newItems.length} items (processed via ${convertMethod}).`,
        }),
      );
      await savePlan(dir, plan, opts);
      req.respond(true, { ok: true, count: newItems.length, method: convertMethod });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── integrations.save ─────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.integrations.save", async (req) => {
    try {
      const dir = await stateDir();
      const integrations = req.params.integrations as Partial<
        Record<ProjectPlanIntegrationId, ProjectPlanIntegrationSettings>
      >;
      await saveIntegrationsConfig(dir, integrations);
      req.respond(true, { ok: true });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── integrations.get ──────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.integrations.get", async (req) => {
    try {
      const dir = await stateDir();
      req.respond(true, await getIntegrations(dir));
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── fs.browse ─────────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.fs.browse", async (req) => {
    try {
      const requestedPath = (req.params.path as string | undefined) ?? "";
      const resolved = requestedPath ? path.resolve(requestedPath) : os.homedir();
      let entries: Array<{ name: string; isDir: boolean }> = [];
      try {
        const dirents = await fs.readdir(resolved, { withFileTypes: true });
        entries = dirents
          .map((d: { name: string; isDirectory: () => boolean }) => ({
            name: d.name,
            isDir: d.isDirectory(),
          }))
          .sort((a: { name: string; isDir: boolean }, b: { name: string; isDir: boolean }) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
      } catch {
        // Return empty entries on permission error.
      }
      const parentPath = path.dirname(resolved);
      req.respond(true, {
        path: resolved,
        parent: resolved === parentPath ? null : parentPath,
        entries,
        sep: path.sep,
      });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── item.add ──────────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.item.add", async (req) => {
    try {
      const dir = await stateDir();
      const { planId, title, type, description, parentId, assignedAgentId } = req.params as {
        planId: string;
        title: string;
        type?: ProjectPlanItemType;
        description?: string;
        parentId?: string;
        assignedAgentId?: string;
      };
      const plan = await loadPlan(dir, planId);
      if (!plan) {
        req.respond(false, undefined, { message: "Plan not found" });
        return;
      }
      const maxOrder = plan.items.reduce((m, i) => Math.max(m, i.order), -1);
      const item = createItem({
        title,
        type,
        description,
        parentId,
        assignedAgentId,
        order: maxOrder + 1,
      });
      plan.items.push(item);
      recomputeContainerStatuses(plan);
      await savePlan(dir, plan, opts);
      req.respond(true, { ok: true, item });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── item.update ───────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.item.update", async (req) => {
    try {
      const dir = await stateDir();
      const { planId, itemId, title, description, assignedAgentId, status } = req.params as {
        planId: string;
        itemId: string;
        title: string;
        description?: string;
        assignedAgentId?: string | null;
        status?: ProjectPlanStatus;
      };
      const plan = await loadPlan(dir, planId);
      if (!plan) {
        req.respond(false, undefined, { message: "Plan not found" });
        return;
      }
      const item = plan.items.find((i) => i.id === itemId);
      if (!item) {
        req.respond(false, undefined, { message: "Item not found" });
        return;
      }
      item.title = title;
      item.description = description;
      item.assignedAgentId = assignedAgentId ?? undefined;
      if (status !== undefined) item.status = status;
      item.updatedAt = Date.now();
      recomputeContainerStatuses(plan);
      await savePlan(dir, plan, opts);
      req.respond(true, { ok: true });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── item.delete ───────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.item.delete", async (req) => {
    try {
      const dir = await stateDir();
      const { planId, itemId } = req.params as { planId: string; itemId: string };
      const plan = await loadPlan(dir, planId);
      if (!plan) {
        req.respond(false, undefined, { message: "Plan not found" });
        return;
      }
      // Remove item and all its children.
      const toRemove = new Set<string>();
      const collect = (id: string) => {
        toRemove.add(id);
        for (const child of plan.items.filter((i) => i.parentId === id)) {
          collect(child.id);
        }
      };
      collect(itemId);
      plan.items = plan.items.filter((i) => !toRemove.has(i.id));
      recomputeContainerStatuses(plan);
      await savePlan(dir, plan, opts);
      req.respond(true, { ok: true });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── accounts.list ─────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.accounts.list", async (req) => {
    try {
      const dir = await stateDir();
      const accounts = await loadAccounts(dir);
      req.respond(true, { accounts: toPublicAccounts(accounts) });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── accounts.save ─────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.accounts.save", async (req) => {
    try {
      const dir = await stateDir();
      await saveAccounts(dir, req.params.accounts as StoredAccount[]);
      req.respond(true, { ok: true });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── item.session ─────────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.item.session", async (req) => {
    try {
      const dir = await stateDir();
      const { planId, itemId } = req.params as { planId: string; itemId: string };
      const plan = await loadPlan(dir, planId);
      if (!plan) {
        req.respond(false, undefined, { message: "Plan not found" });
        return;
      }
      const item = plan.items.find((i) => i.id === itemId);
      if (!item) {
        req.respond(false, undefined, { message: "Item not found" });
        return;
      }
      req.respond(true, { messages: item.sessionOutput ?? [] });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });

  // ── status.summary ───────────────────────────────────────────────────────
  api.registerGatewayMethod("plugin.plan.status.summary", async (req) => {
    try {
      const dir = await stateDir();
      const plans = await listPlans(dir);
      if (!plans.length) {
        req.respond(true, { summary: "No plans found." });
        return;
      }
      const lines: string[] = [];
      for (const plan of plans) {
        const running = isRunning(plan.id);
        const counts = buildCounts(plan.items);
        const total = plan.items.length;
        lines.push(`Plan: ${plan.name} [${running ? "RUNNING" : plan.status.toUpperCase()}]`);
        lines.push(
          `Progress: ${counts["done"]}/${total} done, ${counts["failed"]} failed, ${counts["in progress"]} in progress`,
        );
        const epics = plan.items.filter((i) => i.type === "epic");
        for (const epic of epics) {
          lines.push(`\n▸ ${epic.title} [${epic.status}]`);
          const tasks = plan.items.filter((i) => i.parentId === epic.id);
          for (const task of tasks) {
            lines.push(`  ├─ ${task.title} [${task.status}]`);
            const subs = plan.items.filter((i) => i.parentId === task.id);
            for (const s of subs) {
              lines.push(`  │  └─ ${s.title} [${s.status}]`);
            }
          }
        }
        const orphans = plan.items.filter((i) => !i.parentId && i.type !== "epic");
        for (const o of orphans) {
          lines.push(`\n▸ ${o.title} [${o.status}]`);
        }
        lines.push("");
      }
      req.respond(true, { summary: lines.join("\n") });
    } catch (err) {
      req.respond(false, undefined, { message: String(err) });
    }
  });
}
