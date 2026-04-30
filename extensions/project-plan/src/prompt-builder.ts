// ── Prompt construction for agent item execution ─────────────────────────────
//
// The item message gives the agent its immediate goal plus epic/task context;
// the system prompt enforces the workspace boundary so the agent cannot touch
// files outside the configured project path.

import { buildExecutionContext } from "./execution.js";
import type { ProjectPlanItem, ProjectPlanRecord } from "./types.js";

export function buildItemMessage(
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

export function buildSystemPrompt(projectPath: string): string {
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
