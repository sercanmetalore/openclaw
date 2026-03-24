// ── HTTP handler — SPA + REST API ────────────────────────────────────────────

import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { recomputeContainerStatuses } from "./execution.js";
import { convertFileToItems } from "./llm-convert.js";
import { syncFromProvider } from "./providers/index.js";
import { askPlanQuestion, isRunning, requestStop, startPlanExecution } from "./service.js";
import {
  buildCounts,
  createItem,
  createLog,
  createPlan,
  deleteAccount,
  deletePlan,
  getIntegrations,
  getPluginConfigOpts,
  importItemsFromPayload,
  listPlans,
  loadAccounts,
  loadPlan,
  resolveAccountToken,
  saveIntegrationsConfig,
  savePlan,
  toPublicAccounts,
  upsertAccount,
  type UploadPayload,
} from "./store.js";
import type {
  AvailableAccount,
  ProjectPlanIntegrationId,
  ProjectPlanIntegrationSettings,
  ProjectPlanPluginConfig,
  ProjectPlanSettings,
  ProjectPlanStatus,
} from "./types.js";
import { renderUI } from "./ui.js";

const BASE = "/plugins/project-plan";
const API = `${BASE}/api`;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

function ok(res: ServerResponse, body: unknown = { ok: true }): void {
  send(res, 200, body);
}

function err(res: ServerResponse, status: number, message: string): void {
  send(res, status, { error: message });
}

async function buildAvailableAccounts(stateDir: string): Promise<AvailableAccount[]> {
  const accounts = await loadAccounts(stateDir);
  return accounts
    .filter((a) => a.enabled && a.encryptedToken)
    .map((a) => ({
      accountId: a.id,
      label: `${providerLabel(a.provider)} — ${a.name}`,
      provider: a.provider,
    }));
}

function providerLabel(p: string): string {
  const map: Record<string, string> = {
    github: "GitHub",
    gitlab: "GitLab",
    azuredevops: "Azure DevOps",
    jira: "Jira",
  };
  return map[p] ?? p;
}

async function buildAvailableAgents(
  api: OpenClawPluginApi,
  stateDir: string,
): Promise<Array<{ id: string; name?: string }>> {
  const configured = api.config.agents?.list ?? [];
  const defaultId = (api.config.agents?.defaults as { id?: string } | undefined)?.id ?? "main";
  const byId = new Map<string, { id: string; name?: string }>();

  for (const entry of configured) {
    if (!entry?.id || typeof entry.id !== "string") {
      continue;
    }
    const id = entry.id.trim();
    if (!id) {
      continue;
    }
    byId.set(id, {
      id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined,
    });
  }

  // Include runtime-created agents discovered on disk so the dropdown stays complete.
  const agentsDir = path.join(stateDir, "agents");
  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const id = entry.name.trim();
      if (!id || byId.has(id)) {
        continue;
      }
      byId.set(id, { id });
    }
  } catch {
    // Ignore missing/unreadable agents directory.
  }

  if (!byId.has(defaultId)) {
    byId.set(defaultId, { id: defaultId });
  }
  if (!byId.has("main")) {
    byId.set("main", { id: "main" });
  }

  const sorted = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (defaultId) {
    const idx = sorted.findIndex((a) => a.id === defaultId);
    if (idx > 0) {
      const [picked] = sorted.splice(idx, 1);
      sorted.unshift(picked!);
    }
  }
  return sorted;
}

function planSummary(plan: Awaited<ReturnType<typeof loadPlan>>, planId: string) {
  if (!plan) return null;
  const running = isRunning(planId);
  const counts = buildCounts(plan.items);
  const totalItems = plan.items.length;
  const doneItems = counts["done"] + counts["cancelled"];
  return {
    plan: { ...plan, execution: { ...plan.execution, running } },
    dashboard: {
      counts,
      totalItems,
      completionRatio: totalItems > 0 ? doneItems / totalItems : 0,
      running,
      tokenSpent: plan.metrics.tokenSpent,
      durationMs: plan.metrics.durationMs,
      runCount: plan.metrics.runCount,
      currentItemId: plan.execution.currentItemId,
    },
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export function createHttpHandler(params: {
  api: OpenClawPluginApi;
  pluginConfig: ProjectPlanPluginConfig;
}) {
  const { api, pluginConfig } = params;
  const opts = getPluginConfigOpts(pluginConfig);

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // ── SPA ─────────────────────────────────────────────────────────────────
    if (!url.startsWith(API)) {
      if (method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderUI());
        return true;
      }
      return false;
    }

    const apiPath = url.slice(API.length).split("?")[0];
    const stateDir = await api.runtime.state.resolveStateDir();

    try {
      // ── GET /api/plans ───────────────────────────────────────────────────
      if (method === "GET" && apiPath === "/plans") {
        const [plans, { integrations, availableSources }, availableAccounts, availableAgents] =
          await Promise.all([
            listPlans(stateDir),
            getIntegrations(stateDir),
            buildAvailableAccounts(stateDir),
            buildAvailableAgents(api, stateDir),
          ]);
        return (
          ok(res, {
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
            availableAccounts,
            availableAgents,
          }),
          true
        );
      }

      // ── POST /api/plans ──────────────────────────────────────────────────
      if (method === "POST" && apiPath === "/plans") {
        const body = (await readBody(req)) as { name: string; description?: string };
        const plan = createPlan({ name: body.name, description: body.description });
        await savePlan(stateDir, plan, opts);
        return (ok(res, { ok: true, plan: { id: plan.id } }), true);
      }

      // ── Plan routes ──────────────────────────────────────────────────────
      const planMatch = apiPath.match(/^\/plans\/([^/]+)(\/.*)?$/);
      if (planMatch) {
        const planId = planMatch[1];
        const sub = planMatch[2] ?? "";

        // GET /api/plans/:id
        if (method === "GET" && sub === "") {
          const [plan, { integrations, availableSources }, availableAccounts, availableAgents] =
            await Promise.all([
              loadPlan(stateDir, planId),
              getIntegrations(stateDir),
              buildAvailableAccounts(stateDir),
              buildAvailableAgents(api, stateDir),
            ]);
          if (!plan) return (err(res, 404, "Plan not found"), true);
          return (
            ok(res, {
              ...planSummary(plan, planId),
              availableSources,
              integrations,
              availableAccounts,
              availableAgents,
            }),
            true
          );
        }

        // PUT /api/plans/:id/settings
        if (method === "PUT" && sub === "/settings") {
          const body = (await readBody(req)) as { settings: ProjectPlanSettings };
          const plan = await loadPlan(stateDir, planId);
          if (!plan) return (err(res, 404, "Plan not found"), true);
          plan.settings = { ...plan.settings, ...body.settings };
          plan.logs.push(createLog({ level: "info", message: "Settings updated." }));
          await savePlan(stateDir, plan, opts);
          return (ok(res), true);
        }

        // POST /api/plans/:id/start
        if (method === "POST" && sub === "/start") {
          const plan = await loadPlan(stateDir, planId);
          if (!plan) return (err(res, 404, "Plan not found"), true);
          if (isRunning(planId)) return (err(res, 409, "Already running"), true);
          startPlanExecution({ planId, stateDir, api, pluginConfig });
          return (ok(res), true);
        }

        // POST /api/plans/:id/retry
        if (method === "POST" && sub === "/retry") {
          const plan = await loadPlan(stateDir, planId);
          if (!plan) return (err(res, 404, "Plan not found"), true);
          if (isRunning(planId)) return (err(res, 409, "Already running"), true);

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
          await savePlan(stateDir, plan, opts);
          return (ok(res, { ok: true, resetCount }), true);
        }

        // POST /api/plans/:id/stop
        if (method === "POST" && sub === "/stop") {
          await requestStop(planId, api);
          return (ok(res), true);
        }

        // DELETE /api/plans/:id
        if (method === "DELETE" && sub === "") {
          await requestStop(planId, api);
          await deletePlan(stateDir, planId);
          return (ok(res), true);
        }

        // POST /api/plans/:id/sync
        if (method === "POST" && sub === "/sync") {
          const plan = await loadPlan(stateDir, planId);
          if (!plan) return (err(res, 404, "Plan not found"), true);
          const source = plan.settings.source;
          if (source === "local") return (err(res, 400, "Local plans do not support sync"), true);

          // Prefer accountId-based auth, fall back to global integration token.
          let token: string | null = null;
          let settings: Omit<ProjectPlanIntegrationSettings, "token"> = {};

          if (plan.settings.accountId) {
            token = await resolveAccountToken(stateDir, plan.settings.accountId);
            const accounts = await loadAccounts(stateDir);
            const acc = accounts.find((a) => a.id === plan.settings.accountId);
            if (acc) settings = acc.settings;
          }

          if (!token) {
            return (err(res, 400, `No account/token configured for ${source}`), true);
          }

          const { items, added, updated } = await syncFromProvider({
            source: source as ProjectPlanIntegrationId,
            token,
            settings,
            planSettings: plan.settings,
            existingItems: plan.items,
          });
          plan.items = items;
          recomputeContainerStatuses(plan);
          plan.logs.push(
            createLog({ level: "info", message: `Sync: ${added} added, ${updated} updated.` }),
          );
          await savePlan(stateDir, plan, opts);
          return (ok(res, { ok: true, added, updated }), true);
        }

        // POST /api/plans/:id/upload
        if (method === "POST" && sub === "/upload") {
          const body = (await readBody(req)) as { payload: string; filename?: string };
          const plan = await loadPlan(stateDir, planId);
          if (!plan) return (err(res, 404, "Plan not found"), true);
          const filename = body.filename || "upload.json";
          const ext = filename.split(".").pop()?.toLowerCase() ?? "json";
          let jsonStr = body.payload;
          let convertMethod: string = "direct";

          try {
            if (ext === "json") {
              // Try direct parse first; if format doesn't match, fall through to LLM.
              let directOk = false;
              try {
                const parsed = JSON.parse(body.payload);
                importItemsFromPayload(parsed as unknown as UploadPayload, 0); // dry-run to validate
                jsonStr = body.payload;
                directOk = true;
              } catch {
                // Non-standard or wrong-shape JSON — normalize with the primary model.
              }
              if (!directOk) {
                const result = await convertFileToItems({ content: body.payload, filename, api });
                jsonStr = result.json;
                convertMethod = result.method;
              }
            } else {
              // Non-JSON file — use LLM (or basic parser fallback) to convert.
              const result = await convertFileToItems({ content: body.payload, filename, api });
              jsonStr = result.json;
              convertMethod = result.method;
            }
          } catch (conversionError) {
            return (err(res, 400, `Import failed: ${String(conversionError)}`), true);
          }

          let payload: unknown;
          try {
            payload = JSON.parse(jsonStr);
          } catch {
            return (err(res, 400, "Invalid JSON — could not parse converted output"), true);
          }
          let newItems: ReturnType<typeof importItemsFromPayload>;
          try {
            newItems = importItemsFromPayload(
              payload as unknown as UploadPayload,
              plan.items.length,
            );
          } catch (importError) {
            return (err(res, 400, `Import failed: ${String(importError)}`), true);
          }
          plan.items = [...plan.items, ...newItems];
          recomputeContainerStatuses(plan);
          plan.logs.push(
            createLog({
              level: "info",
              message: `Imported ${newItems.length} items from ${filename}${convertMethod !== "direct" ? ` (converted via ${convertMethod})` : ""}.`,
            }),
          );
          await savePlan(stateDir, plan, opts);
          return (ok(res, { ok: true, count: newItems.length, method: convertMethod }), true);
        }

        // POST /api/plans/:id/items
        if (method === "POST" && sub === "/items") {
          const body = (await readBody(req)) as {
            title: string;
            type?: string;
            description?: string;
            parentId?: string;
            assignedAgentId?: string;
          };
          const plan = await loadPlan(stateDir, planId);
          if (!plan) return (err(res, 404, "Plan not found"), true);
          const maxOrder = plan.items.reduce((m, i) => Math.max(m, i.order), -1);
          const item = createItem({
            title: body.title,
            type: body.type as never,
            description: body.description,
            parentId: body.parentId,
            assignedAgentId: body.assignedAgentId,
            order: maxOrder + 1,
          });
          plan.items.push(item);
          recomputeContainerStatuses(plan);
          await savePlan(stateDir, plan, opts);
          return (ok(res, { ok: true, item }), true);
        }

        // Item sub-routes
        const itemMatch = sub.match(/^\/items\/([^/]+)(\/.*)?$/);
        if (itemMatch) {
          const itemId = itemMatch[1];
          const itemSub = itemMatch[2] ?? "";

          if (method === "PUT" && itemSub === "/status") {
            const body = (await readBody(req)) as { status: ProjectPlanStatus };
            const plan = await loadPlan(stateDir, planId);
            if (!plan) return (err(res, 404, "Plan not found"), true);
            const item = plan.items.find((i) => i.id === itemId);
            if (!item) return (err(res, 404, "Item not found"), true);
            item.status = body.status;
            item.updatedAt = Date.now();
            recomputeContainerStatuses(plan);
            await savePlan(stateDir, plan, opts);
            return (ok(res), true);
          }

          if (method === "PUT" && itemSub === "") {
            const body = (await readBody(req)) as {
              title?: string;
              description?: string;
              assignedAgentId?: string | null;
              status?: ProjectPlanStatus;
            };
            const plan = await loadPlan(stateDir, planId);
            if (!plan) return (err(res, 404, "Plan not found"), true);
            const item = plan.items.find((i) => i.id === itemId);
            if (!item) return (err(res, 404, "Item not found"), true);
            if (body.title !== undefined) item.title = body.title;
            if ("description" in body) item.description = body.description;
            if ("assignedAgentId" in body) item.assignedAgentId = body.assignedAgentId ?? undefined;
            if ("status" in body && body.status !== undefined) item.status = body.status;
            item.updatedAt = Date.now();
            recomputeContainerStatuses(plan);
            await savePlan(stateDir, plan, opts);
            return (ok(res), true);
          }

          if (method === "DELETE" && itemSub === "") {
            const plan = await loadPlan(stateDir, planId);
            if (!plan) return (err(res, 404, "Plan not found"), true);
            const toRemove = new Set<string>();
            const collect = (id: string) => {
              toRemove.add(id);
              plan.items.filter((i) => i.parentId === id).forEach((i) => collect(i.id));
            };
            collect(itemId);
            plan.items = plan.items.filter((i) => !toRemove.has(i.id));
            recomputeContainerStatuses(plan);
            await savePlan(stateDir, plan, opts);
            return (ok(res), true);
          }

          // GET /api/plans/:id/items/:itemId/session
          if (method === "GET" && itemSub === "/session") {
            const plan = await loadPlan(stateDir, planId);
            if (!plan) return (err(res, 404, "Plan not found"), true);
            const item = plan.items.find((i) => i.id === itemId);
            if (!item) return (err(res, 404, "Item not found"), true);
            return (ok(res, { messages: item.sessionOutput ?? [] }), true);
          }
        }

        // POST /api/plans/:id/ask
        if (method === "POST" && sub === "/ask") {
          const body = (await readBody(req)) as { message: string };
          if (!body.message?.trim()) return (err(res, 400, "Message is required"), true);
          const dir = await api.runtime.state.resolveStateDir();
          const result = await askPlanQuestion({
            planId,
            message: body.message.trim(),
            stateDir: dir,
            api,
          });
          return (ok(res, result), true);
        }

        // GET /api/plans/:id/status-summary
        if (method === "GET" && sub === "/status-summary") {
          const plan = await loadPlan(stateDir, planId);
          if (!plan) return (err(res, 404, "Plan not found"), true);
          const running = isRunning(planId);
          const counts = buildCounts(plan.items);
          const total = plan.items.length;
          const lines: string[] = [];
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
          return (ok(res, { summary: lines.join("\n") }), true);
        }
      }

      // ── GET /api/integrations ────────────────────────────────────────────
      if (method === "GET" && apiPath === "/integrations") {
        return (ok(res, await getIntegrations(stateDir)), true);
      }

      // ── PUT /api/integrations ────────────────────────────────────────────
      if (method === "PUT" && apiPath === "/integrations") {
        const body = (await readBody(req)) as {
          integrations: Partial<Record<ProjectPlanIntegrationId, ProjectPlanIntegrationSettings>>;
        };
        await saveIntegrationsConfig(stateDir, body.integrations);
        return (ok(res), true);
      }

      // ── GET /api/accounts ────────────────────────────────────────────────
      if (method === "GET" && apiPath === "/accounts") {
        const accounts = await loadAccounts(stateDir);
        return (ok(res, { accounts: toPublicAccounts(accounts) }), true);
      }

      // ── POST /api/accounts — create ──────────────────────────────────────
      if (method === "POST" && apiPath === "/accounts") {
        const body = (await readBody(req)) as {
          name: string;
          provider: ProjectPlanIntegrationId;
          enabled: boolean;
          settings: ProjectPlanIntegrationSettings;
        };
        const account = await upsertAccount(stateDir, body);
        return (ok(res, { ok: true, account: { id: account.id } }), true);
      }

      // ── Account routes with ID ───────────────────────────────────────────
      const accountMatch = apiPath.match(/^\/accounts\/([^/]+)$/);
      if (accountMatch) {
        const accountId = accountMatch[1];

        // PUT /api/accounts/:id — update
        if (method === "PUT") {
          const body = (await readBody(req)) as {
            name: string;
            provider: ProjectPlanIntegrationId;
            enabled: boolean;
            settings: ProjectPlanIntegrationSettings;
          };
          const account = await upsertAccount(stateDir, { id: accountId, ...body });
          return (ok(res, { ok: true, account: { id: account.id } }), true);
        }

        // DELETE /api/accounts/:id
        if (method === "DELETE") {
          await deleteAccount(stateDir, accountId);
          return (ok(res), true);
        }
      }

      // ── GET /api/fs/browse ───────────────────────────────────────────────
      if (method === "GET" && apiPath === "/fs/browse") {
        const qs = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
        const requestedPath = qs.get("path") ?? "";
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
          /* permission error */
        }
        const parentPath = path.dirname(resolved);
        return (
          ok(res, {
            path: resolved,
            parent: resolved === parentPath ? null : parentPath,
            entries,
            sep: path.sep,
          }),
          true
        );
      }

      err(res, 404, "Not found");
      return true;
    } catch (e: unknown) {
      api.logger.error(`project-plan: http error ${String(e)}`);
      err(res, 500, String(e));
      return true;
    }
  };
}
