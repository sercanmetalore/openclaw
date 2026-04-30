// ── Background agent execution service ───────────────────────────────────────

import crypto from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  chooseExecutionAgentId,
  chooseFallbackExecutionAgentId,
} from "./agent-router.js";
import {
  classifyCompletion,
  getLastAssistantOutcomeWithRetry,
} from "./assistant-transcript.js";
import { recordAuditEvent } from "./audit.js";
import {
  isTransientOverloadCompletionReason,
  isTransientOverloadRunResult,
  isYieldOrDelegationIssue,
  resolveTimeoutFallbackDelayMs,
  resolveTransientRetryDelayMs,
} from "./error-classifier.js";
import {
  findNextExecutableItem,
  hasOutstandingExecutableItems,
  recomputeContainerStatuses,
} from "./execution.js";
import { buildItemMessage, buildSystemPrompt } from "./prompt-builder.js";
import {
  resolveSanitizeMode,
  sanitizeErrorForLog,
  sanitizeForLog,
  type LogSanitizeMode,
} from "./sanitize.js";
import { createLog, loadPlan, savePlan } from "./store.js";
import type {
  ProjectPlanItem,
  ProjectPlanPluginConfig,
  ProjectPlanRecord,
  ProjectPlanSessionMessage,
} from "./types.js";

// Re-exports to preserve the previous public surface of the service module.
export { classifyCompletion } from "./assistant-transcript.js";
export {
  isTransientOverloadCompletionReason,
  isTransientOverloadRunResult,
} from "./error-classifier.js";

const DEFAULT_ITEM_TIMEOUT_MINUTES = 30;
const DEFAULT_OVERLOAD_MAX_RETRIES = 2;
const DEFAULT_OVERLOAD_RETRY_BASE_DELAY_MS = 2_000;
const DEFAULT_TRANSIENT_CAPACITY_MAX_DELAY_MS = 120_000;

type RuntimeLimits = {
  timeoutMs: number;
  overloadMaxRetries: number;
  overloadRetryBaseDelayMs: number;
  transientCapacityMaxDelayMs: number;
};

type LogSanitizer = {
  mode: LogSanitizeMode;
  title: (value: string | undefined) => string;
  error: (value: unknown) => string;
};

function resolveRuntimeLimits(config: ProjectPlanPluginConfig): RuntimeLimits {
  return {
    timeoutMs: (config.itemTimeoutMinutes ?? DEFAULT_ITEM_TIMEOUT_MINUTES) * 60_000,
    overloadMaxRetries: Math.max(
      0,
      config.overloadMaxRetries ?? DEFAULT_OVERLOAD_MAX_RETRIES,
    ),
    overloadRetryBaseDelayMs: Math.max(
      100,
      config.overloadRetryBaseDelayMs ?? DEFAULT_OVERLOAD_RETRY_BASE_DELAY_MS,
    ),
    transientCapacityMaxDelayMs: Math.max(
      1_000,
      config.transientCapacityMaxDelayMs ?? DEFAULT_TRANSIENT_CAPACITY_MAX_DELAY_MS,
    ),
  };
}

function resolveLogSanitizer(config: ProjectPlanPluginConfig): LogSanitizer {
  const mode = resolveSanitizeMode(config.logSanitizeMode);
  const titleMaxChars = config.logSanitizeMaxTitleChars;
  return {
    mode,
    title: (value) => sanitizeForLog(value, { mode, titleMaxChars }),
    error: (value) => sanitizeErrorForLog(value),
  };
}

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
  const limits = resolveRuntimeLimits(pluginConfig);
  const sanitizer = resolveLogSanitizer(pluginConfig);

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
  await recordAuditEvent({
    stateDir,
    event: { type: "plan.execution.started", planId },
  });
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

      const route = chooseExecutionAgentId({ api, plan, item: nextItem });
      const timeoutFallback = chooseFallbackExecutionAgentId({
        api,
        plan,
        primaryAgentId: route.agentId,
      });

      const displayTitle = sanitizer.title(nextItem.title);

      plan.logs.push(
        createLog({
          level: "info",
          message: `Routing: ${displayTitle} -> ${route.agentId} (${route.reason})`,
          itemId: nextItem.id,
        }),
      );
      if (timeoutFallback) {
        plan.logs.push(
          createLog({
            level: "info",
            message: `Timeout fallback: ${displayTitle} -> ${timeoutFallback.agentId} (${timeoutFallback.reason})`,
            itemId: nextItem.id,
          }),
        );
      }

      await processItem({
        plan,
        item: nextItem,
        sessionKey: buildSessionKey({
          agentId: route.agentId,
          itemScopedSessions: plan.settings.itemScopedSessions !== false,
          planId: plan.id,
          item: nextItem,
          runSessionId,
        }),
        fallbackSessionKey: timeoutFallback
          ? buildSessionKey({
              agentId: timeoutFallback.agentId,
              itemScopedSessions: plan.settings.itemScopedSessions !== false,
              planId: plan.id,
              item: nextItem,
              runSessionId,
            })
          : undefined,
        projectPath,
        stateDir,
        api,
        runnerState: state,
        limits,
        sanitizer,
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
      await recordAuditEvent({
        stateDir,
        event: { type: "plan.execution.stopped", planId, reason: "user" },
      });
    } else {
      // Reload to figure out the terminal reason without mutating the record.
      const final = await loadPlan(stateDir, planId);
      const reason: "completed" | "blocked" | "user" =
        final?.status === "done"
          ? "completed"
          : final?.status === "blocked"
            ? "blocked"
            : "user";
      await recordAuditEvent({
        stateDir,
        event: { type: "plan.execution.stopped", planId, reason },
      });
    }
  }
}

// ── Per-item execution ────────────────────────────────────────────────────────

async function processItem(params: {
  plan: ProjectPlanRecord;
  item: ProjectPlanItem;
  sessionKey: string;
  fallbackSessionKey?: string;
  projectPath: string;
  stateDir: string;
  api: OpenClawPluginApi;
  runnerState: RunnerState;
  limits: RuntimeLimits;
  sanitizer: LogSanitizer;
  maxLog?: number;
}): Promise<void> {
  const {
    plan,
    item,
    sessionKey,
    fallbackSessionKey,
    projectPath,
    stateDir,
    api,
    runnerState,
    limits,
    sanitizer,
    maxLog,
  } = params;
  const timeoutMs = limits.timeoutMs;
  const displayTitle = sanitizer.title(item.title);

  item.status = "in progress";
  item.updatedAt = Date.now();
  recomputeContainerStatuses(plan);
  plan.execution.currentItemId = item.id;
  plan.logs.push(createLog({ level: "info", message: `Starting: ${displayTitle}`, itemId: item.id }));
  await savePlan(stateDir, plan, { maxLogEntries: maxLog });

  let activeSessionKey = sessionKey;
  try {
    let usedTimeoutFallback = false;
    let runStartedAt = Date.now();
    let result: Awaited<ReturnType<OpenClawPluginApi["runtime"]["subagent"]["waitForRun"]>> = {
      status: "timeout",
    };

    for (let attempt = 0; attempt <= limits.overloadMaxRetries; attempt += 1) {
      runStartedAt = Date.now();
      const { runId } = await api.runtime.subagent.run({
        sessionKey: activeSessionKey,
        idempotencyKey: crypto.randomUUID(),
        message: buildItemMessage(plan, item, projectPath),
        extraSystemPrompt: buildSystemPrompt(projectPath),
      });
      runnerState.activeRun = { runId, sessionKey: activeSessionKey };
      addTrackedRun(runnerState, runId, activeSessionKey);
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
        deleteTrackedRun(runnerState, runId, activeSessionKey);
      }

      if (runnerState.stopRequested || !isTransientOverloadRunResult(result)) {
        break;
      }
      if (attempt >= limits.overloadMaxRetries) {
        break;
      }

      const delayMs = resolveTransientRetryDelayMs({
        errorText: typeof result.error === "string" ? result.error : undefined,
        fallbackDelayMs: limits.overloadRetryBaseDelayMs * (attempt + 1),
        maxDelayMs: limits.transientCapacityMaxDelayMs,
      });
      plan.logs.push(
        createLog({
          level: "warn",
          message: `Transient capacity: retrying ${displayTitle} (${attempt + 1}/${limits.overloadMaxRetries}, wait=${delayMs}ms)`,
          itemId: item.id,
        }),
      );
      await savePlan(stateDir, plan, { maxLogEntries: maxLog });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (
      !runnerState.stopRequested &&
      result.status === "timeout" &&
      fallbackSessionKey &&
      fallbackSessionKey !== activeSessionKey
    ) {
      usedTimeoutFallback = true;
      plan.logs.push(
        createLog({
          level: "warn",
          message: `Timeout fallback: retrying ${displayTitle} with fallback agent/model`,
          itemId: item.id,
        }),
      );
      await savePlan(stateDir, plan, { maxLogEntries: maxLog });

      activeSessionKey = fallbackSessionKey;
      runStartedAt = Date.now();
      const { runId } = await api.runtime.subagent.run({
        sessionKey: activeSessionKey,
        idempotencyKey: crypto.randomUUID(),
        message: buildItemMessage(plan, item, projectPath),
        extraSystemPrompt: buildSystemPrompt(projectPath),
      });
      runnerState.activeRun = { runId, sessionKey: activeSessionKey };
      addTrackedRun(runnerState, runId, activeSessionKey);
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
        deleteTrackedRun(runnerState, runId, activeSessionKey);
      }
    }

    if (runnerState.stopRequested) {
      item.status = "to do";
      item.updatedAt = Date.now();
      plan.logs.push(
        createLog({
          level: "warn",
          message: `Stopped before completion: ${displayTitle}`,
          itemId: item.id,
        }),
      );
      return;
    }

    if (result.status === "timeout" && usedTimeoutFallback) {
      item.status = "to do";
      item.updatedAt = Date.now();
      const delayMs = resolveTimeoutFallbackDelayMs({
        timeoutMs,
        usedFallback: true,
        maxDelayMs: limits.transientCapacityMaxDelayMs,
      });
      plan.logs.push(
        createLog({
          level: "warn",
          message: `Timeout after fallback: deferring ${displayTitle} for adaptive retry (wait=${delayMs}ms)`,
          itemId: item.id,
        }),
      );
      await savePlan(stateDir, plan, { maxLogEntries: maxLog });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return;
    }

    if (result.status === "ok") {
      let assistantOutcome = await getLastAssistantOutcomeWithRetry({
        api,
        sessionKey: activeSessionKey,
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
            message: `Recovery retry: ${displayTitle} (${assistantOutcome.errorMessage})`,
            itemId: item.id,
          }),
        );

        const recoveryStartedAt = Date.now();
        const { runId: recoveryRunId } = await api.runtime.subagent.run({
          sessionKey: activeSessionKey,
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

        runnerState.activeRun = { runId: recoveryRunId, sessionKey: activeSessionKey };
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
            sessionKey: activeSessionKey,
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
          createLog({ level: "info", message: `Completed: ${displayTitle}`, itemId: item.id }),
        );
      } else if (isTransientOverloadCompletionReason(completion.reason)) {
        item.status = "to do";
        item.updatedAt = Date.now();
        const delayMs = resolveTransientRetryDelayMs({
          errorText: completion.reason,
          fallbackDelayMs: limits.overloadRetryBaseDelayMs,
          maxDelayMs: limits.transientCapacityMaxDelayMs,
        });
        plan.logs.push(
          createLog({
            level: "warn",
            message: `Transient capacity: deferring ${displayTitle} for retry (${completion.reason}, wait=${delayMs}ms)`,
            itemId: item.id,
          }),
        );
        await savePlan(stateDir, plan, { maxLogEntries: maxLog });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return;
      } else {
        item.status = "failed";
        item.updatedAt = Date.now();
        plan.logs.push(
          createLog({
            level: "error",
            message: `Failed: ${displayTitle} (${sanitizer.error(completion.reason)})`,
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
          message: `Failed: ${displayTitle} (${result.status}${result.error ? ": " + sanitizer.error(result.error) : ""})`,
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
        message: `Error: ${displayTitle}: ${sanitizer.error(err)}`,
        itemId: item.id,
      }),
    );
    api.logger.error(
      `project-plan: item execution error planId=${plan.id} itemId=${item.id} error=${sanitizer.error(err)}`,
    );
  } finally {
    runnerState.activeRun = undefined;
    runnerState.abortRequested = false;

    // Capture session output for this item
    try {
      const transcript = await api.runtime.subagent.getSessionMessages({
        sessionKey: activeSessionKey,
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
