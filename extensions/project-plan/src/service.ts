// ── Background agent execution service ───────────────────────────────────────

import crypto from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  buildExecutionContext,
  findNextExecutableItem,
  hasOutstandingExecutableItems,
  recomputeContainerStatuses,
} from "./execution.js";
import { createLog, loadPlan, savePlan } from "./store.js";
import type {
  ProjectPlanItem,
  ProjectPlanPluginConfig,
  ProjectPlanRecord,
  ProjectPlanSessionMessage,
} from "./types.js";

const DEFAULT_ITEM_TIMEOUT_MINUTES = 30;
const OVERLOAD_MAX_RETRIES = 2;
const OVERLOAD_RETRY_BASE_DELAY_MS = 2_000;

// ── In-memory run state ───────────────────────────────────────────────────────

type RunnerState = {
  running: boolean;
  stopRequested: boolean;
  activeRun?: {
    runId: string;
    sessionKey: string;
  };
  abortRequested?: boolean;
  trackedRuns: Map<string, { runId: string; sessionKey: string }>;
};

type TranscriptMessage = {
  role?: string;
  content?: unknown;
  stopReason?: string;
  errorMessage?: unknown;
  error?: unknown;
  timestamp?: unknown;
};

type ToolCallLike = {
  name?: unknown;
};

type CompletionResult = { ok: true } | { ok: false; reason: string };

type AssistantOutcome = {
  text: string;
  errorMessage?: string;
  transientToolOnlyIssue?: boolean;
};

function isOverloadedRunError(error: unknown): boolean {
  if (typeof error === "string") {
    const text = error.trim();
    if (/overloaded_error/i.test(text) || /\boverloaded\b/i.test(text)) {
      return true;
    }
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return isOverloadedRunError(JSON.parse(text));
      } catch {
        return false;
      }
    }
    return false;
  }

  if (Array.isArray(error)) {
    return error.some((entry) => isOverloadedRunError(entry));
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const shaped = error as {
    type?: unknown;
    message?: unknown;
    error?: unknown;
    details?: unknown;
  };

  if (typeof shaped.type === "string" && /overloaded_error/i.test(shaped.type)) {
    return true;
  }
  if (typeof shaped.message === "string" && /\boverloaded\b/i.test(shaped.message)) {
    return true;
  }

  return isOverloadedRunError(shaped.error) || isOverloadedRunError(shaped.details);
}

export function isTransientOverloadRunResult(result: { status: string; error?: unknown }): boolean {
  return result.status === "error" && isOverloadedRunError(result.error);
}

export function isTransientOverloadCompletionReason(reason: string): boolean {
  return /Agent run error:/i.test(reason) && /overloaded_error|\boverloaded\b/i.test(reason);
}

function isYieldOrDelegationIssue(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  return /Assistant yielded|Assistant delegated work/i.test(message);
}

function buildSessionKey(params: {
  agentId: string;
  itemScopedSessions: boolean;
  planId: string;
  item: ProjectPlanItem;
  runSessionId: string;
}): string {
  const { agentId, itemScopedSessions, planId, item, runSessionId } = params;
  const baseSessionKey = `agent:${agentId}:project-plan-${planId}`;
  if (!itemScopedSessions) {
    return baseSessionKey;
  }
  return `${baseSessionKey}:run-${runSessionId}:item-${item.id}`;
}

function normalizeText(value: string): string {
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

function findAssigneeRole(text: string): string {
  const match = text.match(/Assignee role:\s*([^\n\r]+)/i);
  return match?.[1]?.trim() ?? "";
}

function mapRoleToAgentId(params: {
  configuredIds: Set<string>;
  role: string;
}): { agentId: string; reason: string } | undefined {
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

function chooseExecutionAgentId(params: {
  api: OpenClawPluginApi;
  plan: ProjectPlanRecord;
  item: ProjectPlanItem;
}): { agentId: string; reason: string } {
  const { api, plan, item } = params;
  const defaultAgentId = plan.settings.defaultAgentId ?? "main";
  const configuredIds = new Set(
    (api.config.agents?.list ?? [])
      .map((entry) => (typeof entry?.id === "string" ? entry.id.trim() : ""))
      .filter(Boolean),
  );
  configuredIds.add(defaultAgentId);
  configuredIds.add("main");

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

const runners = new Map<string, RunnerState>();

function runRefKey(runId: string, sessionKey: string): string {
  return `${runId}@@${sessionKey}`;
}

function addTrackedRun(state: RunnerState, runId: string, sessionKey: string): void {
  state.trackedRuns.set(runRefKey(runId, sessionKey), { runId, sessionKey });
}

function deleteTrackedRun(state: RunnerState, runId: string, sessionKey?: string): void {
  for (const [key, ref] of state.trackedRuns.entries()) {
    const runMatches = runId ? ref.runId === runId : false;
    const sessionMatches = sessionKey ? ref.sessionKey === sessionKey : false;
    if (runMatches || sessionMatches) {
      state.trackedRuns.delete(key);
    }
  }
}

function findPlanIdBySessionKey(sessionKey: string | undefined): string | undefined {
  if (!sessionKey) {
    return undefined;
  }
  for (const [planId, state] of runners.entries()) {
    if (!state.running) {
      continue;
    }
    if (sessionKey.includes(`project-plan-${planId}`)) {
      return planId;
    }
  }
  return undefined;
}

async function abortTrackedRuns(params: {
  api: OpenClawPluginApi;
  planId: string;
  state: RunnerState;
}): Promise<void> {
  const { api, planId, state } = params;
  const refs = [...state.trackedRuns.values()];
  await Promise.allSettled(
    refs.map(async (ref) => {
      try {
        const res = await api.runtime.subagent.abortRun({
          sessionKey: ref.sessionKey,
          runId: ref.runId,
        });
        if (res.aborted) {
          api.logger.info(
            `project-plan: aborted tracked run planId=${planId} runId=${ref.runId} sessionKey=${ref.sessionKey}`,
          );
        }
      } catch (err: unknown) {
        api.logger.warn(
          `project-plan: tracked abort failed planId=${planId} runId=${ref.runId} sessionKey=${ref.sessionKey} error=${String(err)}`,
        );
      }
    }),
  );
}

export function registerProjectPlanStopHooks(api: OpenClawPluginApi): void {
  api.on("subagent_delivery_target", (event) => {
    const planId = findPlanIdBySessionKey(event.requesterSessionKey);
    if (!planId || !event.childRunId) {
      return;
    }
    const state = runners.get(planId);
    if (!state || !state.running) {
      return;
    }
    addTrackedRun(state, event.childRunId, event.childSessionKey);
  });

  api.on("subagent_spawned", (event, ctx) => {
    const planId = findPlanIdBySessionKey(ctx.requesterSessionKey);
    if (!planId) {
      return;
    }
    const state = runners.get(planId);
    if (!state || !state.running) {
      return;
    }
    addTrackedRun(state, event.runId, event.childSessionKey);
  });

  api.on("subagent_ended", (event) => {
    for (const state of runners.values()) {
      deleteTrackedRun(state, event.runId ?? "", event.targetSessionKey);
    }
  });
}

/** Returns true when a plan execution loop is active. */
export function isRunning(planId: string): boolean {
  return runners.get(planId)?.running === true;
}

/** Request graceful stop for a running plan. */
export async function requestStop(planId: string, api?: OpenClawPluginApi): Promise<void> {
  const state = runners.get(planId);
  if (!state) {
    return;
  }
  state.stopRequested = true;
  if (api) {
    requestActiveRunAbort({ api, planId, state });
    await abortTrackedRuns({ api, planId, state });
  }
}

/** Return a snapshot of all active runner IDs. */
export function listRunningPlanIds(): string[] {
  return [...runners.entries()].filter(([, s]) => s.running).map(([id]) => id);
}

// ── Execution entry point ─────────────────────────────────────────────────────

/** Start the plan execution loop in the background (fire-and-forget). */
export function startPlanExecution(params: {
  planId: string;
  stateDir: string;
  api: OpenClawPluginApi;
  pluginConfig: ProjectPlanPluginConfig;
}): void {
  const { planId, stateDir, api, pluginConfig } = params;
  if (runners.get(planId)?.running) return;
  const state: RunnerState = { running: true, stopRequested: false, trackedRuns: new Map() };
  runners.set(planId, state);
  runPlanLoop({ planId, stateDir, api, pluginConfig, state }).catch((err: unknown) => {
    api.logger.error(`project-plan: unhandled loop error planId=${planId} error=${String(err)}`);
  });
}

// ── Execution loop ────────────────────────────────────────────────────────────

async function runPlanLoop(params: {
  planId: string;
  stateDir: string;
  api: OpenClawPluginApi;
  pluginConfig: ProjectPlanPluginConfig;
  state: RunnerState;
}): Promise<void> {
  const { planId, stateDir, api, pluginConfig, state } = params;
  const maxLog = pluginConfig.maxLogEntries;
  const timeoutMs = (pluginConfig.itemTimeoutMinutes ?? DEFAULT_ITEM_TIMEOUT_MINUTES) * 60_000;

  let plan = await loadPlan(stateDir, planId);
  if (!plan) {
    api.logger.error(`project-plan: plan not found at run start planId=${planId}`);
    runners.delete(planId);
    return;
  }

  const projectPath = plan.settings.projectPath?.trim() ?? "";
  if (!projectPath) {
    plan.status = "blocked";
    plan.logs.push(
      createLog({
        level: "error",
        message:
          "Cannot start: Project Path is not set. Go to Settings and set a project directory.",
      }),
    );
    await savePlan(stateDir, plan, { maxLogEntries: maxLog });
    runners.delete(planId);
    return;
  }

  plan.status = "in progress";
  plan.metrics.runCount++;
  plan.execution.lastStartedAt = Date.now();
  plan.execution.running = true;
  plan.logs.push(
    createLog({ level: "info", message: `Plan execution started. Working in: ${projectPath}` }),
  );
  await savePlan(stateDir, plan, { maxLogEntries: maxLog });

  const runSessionId = crypto.randomUUID();

  try {
    while (!state.stopRequested) {
      // Reload on every iteration to pick up manual edits from the UI.
      plan = await loadPlan(stateDir, planId);
      if (!plan) break;

      recomputeContainerStatuses(plan);
      await savePlan(stateDir, plan, { maxLogEntries: maxLog });

      const nextItem = findNextExecutableItem(plan);
      if (!nextItem) {
        if (hasOutstandingExecutableItems(plan)) {
          plan.status = "blocked";
          plan.execution.running = false;
          plan.execution.currentItemId = undefined;
          plan.logs.push(
            createLog({
              level: "warn",
              message:
                "Plan paused because no executable item is in 'to do' state. Check blocked or failed subtasks.",
            }),
          );
          await savePlan(stateDir, plan, { maxLogEntries: maxLog });
          break;
        }
        plan.status = "done";
        plan.execution.running = false;
        plan.execution.currentItemId = undefined;
        plan.execution.lastCompletedAt = Date.now();
        plan.logs.push(createLog({ level: "info", message: "All items completed." }));
        await savePlan(stateDir, plan, { maxLogEntries: maxLog });
        break;
      }

      await processItem({
        plan,
        item: nextItem,
        sessionKey: (() => {
          const route = chooseExecutionAgentId({ api, plan, item: nextItem });
          plan.logs.push(
            createLog({
              level: "info",
              message: `Routing: ${nextItem.title} -> ${route.agentId} (${route.reason})`,
              itemId: nextItem.id,
            }),
          );
          return buildSessionKey({
            agentId: route.agentId,
            itemScopedSessions: plan.settings.itemScopedSessions !== false,
            planId: plan.id,
            item: nextItem,
            runSessionId,
          });
        })(),
        projectPath,
        stateDir,
        api,
        runnerState: state,
        timeoutMs,
        maxLog,
      });
    }
  } finally {
    runners.delete(planId);
    if (state.stopRequested) {
      plan = await loadPlan(stateDir, planId);
      if (plan && plan.status === "in progress") {
        plan.status = "blocked";
        plan.execution.running = false;
        plan.execution.currentItemId = undefined;
        plan.logs.push(createLog({ level: "warn", message: "Plan execution stopped by user." }));
        await savePlan(stateDir, plan, { maxLogEntries: maxLog });
      }
    }
  }
}

// ── Per-item execution ────────────────────────────────────────────────────────

async function processItem(params: {
  plan: ProjectPlanRecord;
  item: ProjectPlanItem;
  sessionKey: string;
  projectPath: string;
  stateDir: string;
  api: OpenClawPluginApi;
  runnerState: RunnerState;
  timeoutMs: number;
  maxLog?: number;
}): Promise<void> {
  const { plan, item, sessionKey, projectPath, stateDir, api, runnerState, timeoutMs, maxLog } =
    params;

  item.status = "in progress";
  item.updatedAt = Date.now();
  recomputeContainerStatuses(plan);
  plan.execution.currentItemId = item.id;
  plan.logs.push(createLog({ level: "info", message: `Starting: ${item.title}`, itemId: item.id }));
  await savePlan(stateDir, plan, { maxLogEntries: maxLog });

  try {
    let runStartedAt = Date.now();
    let result: Awaited<ReturnType<OpenClawPluginApi["runtime"]["subagent"]["waitForRun"]>> = {
      status: "timeout",
    };

    for (let attempt = 0; attempt <= OVERLOAD_MAX_RETRIES; attempt += 1) {
      runStartedAt = Date.now();
      const { runId } = await api.runtime.subagent.run({
        sessionKey,
        idempotencyKey: crypto.randomUUID(),
        message: buildItemMessage(plan, item, projectPath),
        extraSystemPrompt: buildSystemPrompt(projectPath),
      });
      runnerState.activeRun = { runId, sessionKey };
      addTrackedRun(runnerState, runId, sessionKey);
      runnerState.abortRequested = false;
      if (runnerState.stopRequested) {
        requestActiveRunAbort({ api, planId: plan.id, state: runnerState });
      }

      result = await waitForRunWithStopPolling({
        api,
        runId,
        planId: plan.id,
        runnerState,
        timeoutMs,
      });

      if (result.status !== "timeout") {
        deleteTrackedRun(runnerState, runId, sessionKey);
      }

      if (runnerState.stopRequested || !isTransientOverloadRunResult(result)) {
        break;
      }
      if (attempt >= OVERLOAD_MAX_RETRIES) {
        break;
      }

      const delayMs = OVERLOAD_RETRY_BASE_DELAY_MS * (attempt + 1);
      plan.logs.push(
        createLog({
          level: "warn",
          message: `Transient overload: retrying ${item.title} (${attempt + 1}/${OVERLOAD_MAX_RETRIES})`,
          itemId: item.id,
        }),
      );
      await savePlan(stateDir, plan, { maxLogEntries: maxLog });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (runnerState.stopRequested) {
      item.status = "to do";
      item.updatedAt = Date.now();
      plan.logs.push(
        createLog({
          level: "warn",
          message: `Stopped before completion: ${item.title}`,
          itemId: item.id,
        }),
      );
      return;
    }

    if (result.status === "ok") {
      let assistantOutcome = await getLastAssistantOutcomeWithRetry({
        api,
        sessionKey,
        attempts: 30,
        delayMs: 500,
        sinceTimestampMs: runStartedAt,
      });
      let completion = classifyCompletion(assistantOutcome.text, {
        assistantErrorMessage: assistantOutcome.errorMessage,
      });

      // If the model ended in a tool-only yield/delegation turn, retry once with an explicit
      // follow-up that asks for a final completion message in the same session.
      if (!completion.ok && isYieldOrDelegationIssue(assistantOutcome.errorMessage)) {
        plan.logs.push(
          createLog({
            level: "warn",
            message: `Recovery retry: ${item.title} (${assistantOutcome.errorMessage})`,
            itemId: item.id,
          }),
        );

        const recoveryStartedAt = Date.now();
        const { runId: recoveryRunId } = await api.runtime.subagent.run({
          sessionKey,
          idempotencyKey: crypto.randomUUID(),
          message: [
            `Retry the current item now: ${item.title}`,
            "Delegation is allowed, but this workflow requires a final completion message from you.",
            "If you already delegated work, collect the result and synthesize it.",
            "Do not end with tool calls only.",
            "Send a final completion message now.",
          ].join("\n"),
          extraSystemPrompt: buildSystemPrompt(projectPath),
        });

        runnerState.activeRun = { runId: recoveryRunId, sessionKey };
        runnerState.abortRequested = false;
        if (runnerState.stopRequested) {
          requestActiveRunAbort({ api, planId: plan.id, state: runnerState });
        }

        const recoveryResult = await waitForRunWithStopPolling({
          api,
          runId: recoveryRunId,
          planId: plan.id,
          runnerState,
          timeoutMs,
        });

        if (recoveryResult.status === "ok") {
          assistantOutcome = await getLastAssistantOutcomeWithRetry({
            api,
            sessionKey,
            attempts: 30,
            delayMs: 500,
            sinceTimestampMs: recoveryStartedAt,
          });
          completion = classifyCompletion(assistantOutcome.text, {
            assistantErrorMessage: assistantOutcome.errorMessage,
          });
        } else {
          completion = {
            ok: false,
            reason: `Agent run error: recovery attempt ended with ${recoveryResult.status}`,
          };
        }
      }

      if (completion.ok) {
        item.status = "done";
        item.updatedAt = Date.now();
        plan.logs.push(
          createLog({ level: "info", message: `Completed: ${item.title}`, itemId: item.id }),
        );
      } else if (isTransientOverloadCompletionReason(completion.reason)) {
        item.status = "to do";
        item.updatedAt = Date.now();
        plan.logs.push(
          createLog({
            level: "warn",
            message: `Transient overload: deferring ${item.title} for retry (${completion.reason})`,
            itemId: item.id,
          }),
        );
        await savePlan(stateDir, plan, { maxLogEntries: maxLog });
        await new Promise((resolve) => setTimeout(resolve, OVERLOAD_RETRY_BASE_DELAY_MS));
        return;
      } else {
        item.status = "failed";
        item.updatedAt = Date.now();
        plan.logs.push(
          createLog({
            level: "error",
            message: `Failed: ${item.title} (${completion.reason})`,
            itemId: item.id,
          }),
        );
      }
    } else {
      item.status = "failed";
      item.updatedAt = Date.now();
      plan.logs.push(
        createLog({
          level: "error",
          message: `Failed: ${item.title} (${result.status}${result.error ? ": " + result.error : ""})`,
          itemId: item.id,
        }),
      );
    }
  } catch (err: unknown) {
    item.status = "failed";
    item.updatedAt = Date.now();
    plan.logs.push(
      createLog({
        level: "error",
        message: `Error: ${item.title}: ${String(err)}`,
        itemId: item.id,
      }),
    );
    api.logger.error(
      `project-plan: item execution error planId=${plan.id} itemId=${item.id} error=${String(err)}`,
    );
  } finally {
    runnerState.activeRun = undefined;
    runnerState.abortRequested = false;

    // Capture session output for this item
    try {
      const transcript = await api.runtime.subagent.getSessionMessages({
        sessionKey,
        limit: 200,
      });
      const msgs = (transcript.messages ?? []) as Array<{
        role?: string;
        content?: unknown;
        timestamp?: unknown;
        toolName?: string;
      }>;
      const captured: ProjectPlanSessionMessage[] = [];
      for (const m of msgs) {
        if (!m.role || m.role === "user") continue;
        let content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
        if (content.length > 3000) content = content.slice(0, 3000) + "…";
        captured.push({
          role: m.role as ProjectPlanSessionMessage["role"],
          content,
          toolName: m.toolName,
          ts: typeof m.timestamp === "number" ? m.timestamp : Date.now(),
        });
      }
      item.sessionOutput = captured.slice(-50);
    } catch {
      // Session capture is best-effort.
    }
  }

  recomputeContainerStatuses(plan);
  await savePlan(stateDir, plan, { maxLogEntries: maxLog });
}

async function waitForRunWithStopPolling(params: {
  api: OpenClawPluginApi;
  runId: string;
  planId: string;
  runnerState: RunnerState;
  timeoutMs: number;
}): Promise<Awaited<ReturnType<OpenClawPluginApi["runtime"]["subagent"]["waitForRun"]>>> {
  const { api, runId, planId, runnerState, timeoutMs } = params;
  const start = Date.now();
  let remainingMs = timeoutMs;

  while (remainingMs > 0) {
    if (runnerState.stopRequested) {
      requestActiveRunAbort({ api, planId, state: runnerState });
    }

    const sliceMs = Math.min(remainingMs, 1500);
    const result = await api.runtime.subagent.waitForRun({ runId, timeoutMs: sliceMs });
    if (result.status !== "timeout") {
      return result;
    }

    remainingMs = timeoutMs - (Date.now() - start);
  }

  return { status: "timeout" };
}

function requestActiveRunAbort(params: {
  api: OpenClawPluginApi;
  planId: string;
  state: RunnerState;
}): void {
  const { api, planId, state } = params;
  const activeRun = state.activeRun;
  if (!activeRun || state.abortRequested) {
    return;
  }
  state.abortRequested = true;

  void api.runtime.subagent
    .abortRun({ sessionKey: activeRun.sessionKey, runId: activeRun.runId })
    .then((res) => {
      if (res.aborted) {
        api.logger.info(
          `project-plan: aborted active run planId=${planId} runId=${activeRun.runId}`,
        );
      }
    })
    .catch((err: unknown) => {
      api.logger.warn(
        `project-plan: abort request failed planId=${planId} runId=${activeRun.runId} error=${String(err)}`,
      );
    });
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        return "";
      }
      const typedBlock = block as { type?: unknown; text?: unknown };
      return typedBlock.type === "text" && typeof typedBlock.text === "string"
        ? typedBlock.text
        : "";
    })
    .join("")
    .trim();
}

function extractAssistantErrorMessage(message: TranscriptMessage): string {
  if (typeof message.errorMessage === "string" && message.errorMessage.trim()) {
    return message.errorMessage.trim();
  }

  const directError = message.error;
  if (typeof directError === "string" && directError.trim()) {
    return directError.trim();
  }

  if (directError && typeof directError === "object" && !Array.isArray(directError)) {
    const errorObj = directError as { message?: unknown };
    if (typeof errorObj.message === "string" && errorObj.message.trim()) {
      return errorObj.message.trim();
    }
  }

  return "";
}

function extractAssistantToolOnlyIssue(message: TranscriptMessage): string {
  const content = message.content;
  if (!Array.isArray(content)) {
    return "";
  }

  let hasText = false;
  let sawYield = false;
  let sawSpawn = false;

  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const entry = part as Record<string, unknown>;
    if (entry.type === "text" && typeof entry.text === "string" && entry.text.trim()) {
      hasText = true;
      break;
    }
    if (entry.type === "toolCall") {
      const call = part as ToolCallLike;
      const toolName = typeof call.name === "string" ? call.name : "";
      if (toolName === "sessions_yield") {
        sawYield = true;
      }
      if (toolName === "sessions_spawn") {
        sawSpawn = true;
      }
    }
  }

  if (hasText) {
    return "";
  }
  if (sawYield) {
    return "Assistant yielded before sending a completion message";
  }
  if (sawSpawn) {
    return "Assistant delegated work but did not send a completion message";
  }
  return "";
}

function toTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function extractLastAssistantOutcome(
  messages: unknown[],
  options?: { sinceTimestampMs?: number },
): AssistantOutcome {
  const sinceTimestampMs = options?.sinceTimestampMs;
  const typed = messages as TranscriptMessage[];
  for (let i = typed.length - 1; i >= 0; i -= 1) {
    const msg = typed[i];
    if (msg?.role !== "assistant") {
      continue;
    }

    if (typeof sinceTimestampMs === "number") {
      const msgTimestampMs = toTimestampMs(msg.timestamp);
      if (typeof msgTimestampMs === "number" && msgTimestampMs < sinceTimestampMs) {
        continue;
      }
    }

    const text = extractTextContent(msg.content);
    if (text) {
      return { text };
    }

    const errorMessage = extractAssistantErrorMessage(msg);
    if (errorMessage || msg.stopReason === "error") {
      return {
        text: "",
        errorMessage: errorMessage || "Assistant run ended with an error",
      };
    }

    const toolOnlyIssue = extractAssistantToolOnlyIssue(msg);
    if (toolOnlyIssue) {
      return {
        text: "",
        errorMessage: toolOnlyIssue,
        transientToolOnlyIssue: true,
      };
    }
  }

  return { text: "" };
}

async function getLastAssistantOutcomeWithRetry(params: {
  api: OpenClawPluginApi;
  sessionKey: string;
  attempts: number;
  delayMs: number;
  sinceTimestampMs?: number;
}): Promise<AssistantOutcome> {
  const { api, sessionKey, attempts, delayMs, sinceTimestampMs } = params;
  let lastTransientToolOnlyIssue = "";
  for (let i = 0; i < attempts; i += 1) {
    const transcript = await api.runtime.subagent.getSessionMessages({
      sessionKey,
      limit: 200,
    });
    const outcome = extractLastAssistantOutcome(transcript.messages, { sinceTimestampMs });
    if (outcome.text) {
      return outcome;
    }
    if (outcome.errorMessage) {
      if (outcome.transientToolOnlyIssue) {
        lastTransientToolOnlyIssue = outcome.errorMessage;
      } else {
        return outcome;
      }
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  if (lastTransientToolOnlyIssue) {
    return { text: "", errorMessage: lastTransientToolOnlyIssue };
  }
  return { text: "" };
}

export function classifyCompletion(
  text: string,
  options?: { assistantErrorMessage?: string },
): CompletionResult {
  if (!text.trim()) {
    const assistantErrorMessage = options?.assistantErrorMessage?.trim();
    if (assistantErrorMessage) {
      return { ok: false, reason: `Agent run error: ${assistantErrorMessage}` };
    }
    return { ok: false, reason: "No assistant completion message" };
  }

  const normalized = normalizeText(text);
  const completionPattern =
    /(✅|\b(completed|done|finished|implemented|successful|successfully|tamamlandi|tamamlandı|bitti)\b)/i;

  // Long status reports can include incidental failure words while still ending in
  // an explicit completion statement. Prefer the final summary signal in that case.
  const trailingWindow = normalized.slice(-500);
  const hasTrailingCompletionSignal = completionPattern.test(trailingWindow);

  const hardFailurePattern =
    /(cannot|can't|could not|unable to|failed to|permission denied|path escapes sandbox root|no such file|rejected|refused)[^\n\r]{0,160}(complete|finish|proceed|execute|perform|run|do|continue)/i;
  if (hardFailurePattern.test(normalized) && !hasTrailingCompletionSignal) {
    return { ok: false, reason: "Agent response indicates the task could not be completed" };
  }

  if (completionPattern.test(normalized)) {
    return { ok: true };
  }

  return { ok: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildItemMessage(
  plan: ProjectPlanRecord,
  item: ProjectPlanItem,
  projectPath: string,
): string {
  const context = buildExecutionContext(plan, item);
  const lines: string[] = [
    `⚠️ WORKING DIRECTORY: ${projectPath}`,
    `⚠️ ALL file operations MUST be inside: ${projectPath}`,
    `⚠️ Do NOT create or modify files outside: ${projectPath}`,
    "",
    `Plan: ${plan.name}`,
  ];
  if (plan.description) {
    lines.push(`Plan description: ${plan.description}`);
  }
  lines.push("");
  if (item.type === "subtask") {
    lines.push(`Current subtask: ${item.title}`);
  } else {
    lines.push(`Current task: ${item.title}`);
  }
  if (item.description) {
    lines.push("", `Current item description:\n${item.description}`);
  }
  if (context.task && context.task.id !== item.id) {
    lines.push("", `Parent task: ${context.task.title}`);
    if (context.task.description) {
      lines.push(`Parent task description:\n${context.task.description}`);
    }
  }
  if (context.epic && context.epic.id !== item.id) {
    lines.push("", `Epic: ${context.epic.title}`);
    if (context.epic.description) {
      lines.push(`Epic description:\n${context.epic.description}`);
    }
  }
  lines.push(
    "",
    "Implement only the current execution item.",
    "You may delegate subtasks when useful, but you must always return with a final completion message.",
    "Do not end the run with tool calls only; report completion in plain assistant text.",
    "Use the parent task and epic context as mandatory requirements and constraints for this work.",
    `Remember: work exclusively inside ${projectPath}. Do not touch any files outside this directory.`,
    "When you have finished the task, confirm that it is complete.",
  );
  return lines.join("\n");
}

function buildSystemPrompt(projectPath: string): string {
  return [
    "You are executing a project plan task inside a strictly bounded workspace.",
    "",
    `MANDATORY WORKSPACE: ${projectPath}`,
    "",
    "HARD RULES — you MUST follow these without exception:",
    `1. Your working directory is ${projectPath}. Start every session with: cd "${projectPath}"`,
    `2. ALL file reads, writes, edits, and deletions MUST be under ${projectPath}.`,
    `3. NEVER create, edit, or delete files outside ${projectPath}.`,
    `4. NEVER run commands that affect paths outside ${projectPath}.`,
    "5. If a task description implies working outside this directory, refuse and note the constraint.",
    "6. Delegation to child/sub-agents is allowed when needed.",
    "7. You must send a final completion message in assistant text; do not end with tool calls only.",
    "",
    "Complete the assigned task fully within the workspace and confirm when done.",
  ].join("\n");
}

// ── Ask plan question ─────────────────────────────────────────────────────────

export async function askPlanQuestion(params: {
  planId: string;
  message: string;
  stateDir: string;
  api: OpenClawPluginApi;
}): Promise<{ reply: string }> {
  const { planId, message, stateDir, api } = params;
  const plan = await loadPlan(stateDir, planId);
  if (!plan) throw new Error("Plan not found");

  const sessionKey = `plan-chat:${planId}`;
  const fullMessage = `/plan-context ${planId} ${message}`;

  const { runId } = await api.runtime.subagent.run({
    sessionKey,
    idempotencyKey: crypto.randomUUID(),
    message: fullMessage,
  });

  const result = await api.runtime.subagent.waitForRun({ runId, timeoutMs: 120_000 });

  // Extract assistant reply from session
  const transcript = await api.runtime.subagent.getSessionMessages({
    sessionKey,
    limit: 50,
  });
  const msgs = (transcript.messages ?? []) as Array<{
    role?: string;
    content?: unknown;
  }>;

  // Find the last assistant message
  let reply = "";
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "assistant" && m.content) {
      reply = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      break;
    }
  }

  return { reply: reply || "(No response)" };
}

// ── OpenClaw service definition ───────────────────────────────────────────────

export function createProjectPlanService(api: OpenClawPluginApi) {
  return {
    id: "project-plan",
    start: async (_ctx: unknown) => {
      api.logger.info("project-plan: service started");
    },
    stop: async (_ctx: unknown) => {
      for (const [planId, state] of runners.entries()) {
        if (state.running) {
          await requestStop(planId, api);
          api.logger.info(`project-plan: stop requested on shutdown planId=${planId}`);
        }
      }
    },
  };
}
