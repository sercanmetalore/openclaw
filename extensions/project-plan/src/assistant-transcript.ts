// ── Assistant transcript parsing + completion classification ─────────────────
//
// Agent runs return a transcript of messages. The helpers here reduce those to
// a single "assistant outcome" (text, error, or tool-only issue) and then
// classify whether the outcome counts as a successful item completion.

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { normalizeText } from "./agent-router.js";

export type TranscriptMessage = {
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

export type CompletionResult = { ok: true } | { ok: false; reason: string };

export type AssistantOutcome = {
  text: string;
  errorMessage?: string;
  transientToolOnlyIssue?: boolean;
};

export function extractTextContent(content: unknown): string {
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

export function extractAssistantErrorMessage(message: TranscriptMessage): string {
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

export function extractAssistantToolOnlyIssue(message: TranscriptMessage): string {
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

export function toTimestampMs(value: unknown): number | undefined {
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

export function extractLastAssistantOutcome(
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

export async function getLastAssistantOutcomeWithRetry(params: {
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
