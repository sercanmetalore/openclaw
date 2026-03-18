// ── Background agent execution service ───────────────────────────────────────

import crypto from "node:crypto";
import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk";
import { createLog, loadPlan, savePlan } from "./store.js";
import {
  buildExecutionContext,
  findNextExecutableItem,
  hasOutstandingExecutableItems,
  recomputeContainerStatuses,
} from "./execution.js";
import type { ProjectPlanItem, ProjectPlanPluginConfig, ProjectPlanRecord } from "./types.js";

const DEFAULT_ITEM_TIMEOUT_MINUTES = 30;

// ── In-memory run state ───────────────────────────────────────────────────────

type RunnerState = {
  running: boolean;
  stopRequested: boolean;
  activeRun?: {
    runId: string;
    sessionKey: string;
  };
  abortRequested?: boolean;
};

type TranscriptMessage = {
  role?: string;
  content?: unknown;
};

type CompletionResult =
  | { ok: true; missingAssistantSummary?: boolean }
  | { ok: false; reason: string };

function buildSessionKey(params: {
  plan: ProjectPlanRecord;
  item: ProjectPlanItem;
  runSessionId: string;
}): string {
  const { plan, item, runSessionId } = params;
  const agentId = plan.settings.defaultAgentId ?? "main";
  const baseSessionKey = `agent:${agentId}:project-plan-${plan.id}`;
  if (plan.settings.itemScopedSessions === false) {
    return baseSessionKey;
  }
  return `${baseSessionKey}:run-${runSessionId}:item-${item.id}`;
}

const runners = new Map<string, RunnerState>();

/** Returns true when a plan execution loop is active. */
export function isRunning(planId: string): boolean {
  return runners.get(planId)?.running === true;
}

/** Request graceful stop for a running plan. */
export function requestStop(planId: string, api?: OpenClawPluginApi): void {
  const state = runners.get(planId);
  if (!state) {
    return;
  }
  state.stopRequested = true;
  if (api) {
    requestActiveRunAbort({ api, planId, state });
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
  const state: RunnerState = { running: true, stopRequested: false };
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
    plan.logs.push(createLog({
      level: "error",
      message: "Cannot start: Project Path is not set. Go to Settings and set a project directory.",
    }));
    await savePlan(stateDir, plan, { maxLogEntries: maxLog });
    runners.delete(planId);
    return;
  }

  plan.status = "in progress";
  plan.metrics.runCount++;
  plan.execution.lastStartedAt = Date.now();
  plan.execution.running = true;
  plan.logs.push(createLog({ level: "info", message: `Plan execution started. Working in: ${projectPath}` }));
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
          plan.logs.push(createLog({
            level: "warn",
            message:
              "Plan paused because no executable item is in 'to do' state. Check blocked or failed subtasks.",
          }));
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
        sessionKey: buildSessionKey({ plan, item: nextItem, runSessionId }),
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
  const { plan, item, sessionKey, projectPath, stateDir, api, runnerState, timeoutMs, maxLog } = params;

  item.status = "in progress";
  item.updatedAt = Date.now();
  recomputeContainerStatuses(plan);
  plan.execution.currentItemId = item.id;
  plan.logs.push(createLog({ level: "info", message: `Starting: ${item.title}`, itemId: item.id }));
  await savePlan(stateDir, plan, { maxLogEntries: maxLog });

  try {
    const { runId } = await api.runtime.subagent.run({
      sessionKey,
      idempotencyKey: crypto.randomUUID(),
      message: buildItemMessage(plan, item, projectPath),
      extraSystemPrompt: buildSystemPrompt(projectPath),
    });
    runnerState.activeRun = { runId, sessionKey };
    runnerState.abortRequested = false;
    if (runnerState.stopRequested) {
      requestActiveRunAbort({ api, planId: plan.id, state: runnerState });
    }

    const result = await waitForRunWithStopPolling({
      api,
      runId,
      planId: plan.id,
      runnerState,
      timeoutMs,
    });

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
      const lastAssistantText = await getLastAssistantTextWithRetry({
        api,
        sessionKey,
        attempts: 4,
        delayMs: 200,
      });
      const completion = classifyCompletion(lastAssistantText);

      if (completion.ok) {
        item.status = "done";
        item.updatedAt = Date.now();
        if (completion.missingAssistantSummary) {
          plan.logs.push(
            createLog({
              level: "warn",
              message:
                `Completed: ${item.title} (run finished but no assistant completion message was recorded)`,
              itemId: item.id,
            }),
          );
        } else {
          plan.logs.push(
            createLog({ level: "info", message: `Completed: ${item.title}`, itemId: item.id }),
          );
        }
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
      createLog({ level: "error", message: `Error: ${item.title}: ${String(err)}`, itemId: item.id }),
    );
    api.logger.error(`project-plan: item execution error planId=${plan.id} itemId=${item.id} error=${String(err)}`);
  } finally {
    runnerState.activeRun = undefined;
    runnerState.abortRequested = false;
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

function extractLastAssistantText(messages: unknown[]): string {
  const typed = messages as TranscriptMessage[];
  for (let i = typed.length - 1; i >= 0; i -= 1) {
    const msg = typed[i];
    if (msg?.role !== "assistant") {
      continue;
    }
    const text = extractTextContent(msg.content);
    if (text) {
      return text;
    }
  }
  return "";
}

async function getLastAssistantTextWithRetry(params: {
  api: OpenClawPluginApi;
  sessionKey: string;
  attempts: number;
  delayMs: number;
}): Promise<string> {
  const { api, sessionKey, attempts, delayMs } = params;
  for (let i = 0; i < attempts; i += 1) {
    const transcript = await api.runtime.subagent.getSessionMessages({
      sessionKey,
      limit: 200,
    });
    const text = extractLastAssistantText(transcript.messages);
    if (text) {
      return text;
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return "";
}

export function classifyCompletion(text: string): CompletionResult {
  if (!text.trim()) {
    return { ok: true, missingAssistantSummary: true };
  }

  const failurePattern =
    /\b(cannot|can't|could not|unable|failed|error|not found|permission denied|path escapes sandbox root|no such file|refuse|rejected)\b/i;
  if (failurePattern.test(text)) {
    return { ok: false, reason: "Agent response indicates the task could not be completed" };
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
    "",
    "Complete the assigned task fully within the workspace and confirm when done.",
  ].join("\n");
}

// ── OpenClaw service definition ───────────────────────────────────────────────

export function createProjectPlanService(api: OpenClawPluginApi): OpenClawPluginService {
  return {
    id: "project-plan",
    start: async (_ctx) => {
      api.logger.info("project-plan: service started");
    },
    stop: async (_ctx) => {
      for (const [planId, state] of runners.entries()) {
        if (state.running) {
          requestStop(planId, api);
          api.logger.info(`project-plan: stop requested on shutdown planId=${planId}`);
        }
      }
    },
  };
}
