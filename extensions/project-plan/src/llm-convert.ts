// ── LLM-powered file → plan items conversion ─────────────────────────────────
// Prefers the system default agent (main) and waits synchronously for output.
// Falls back to the embedded runner and then basic parsers.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseStructuredTextToItems, type StructuredImportItem } from "./text-structure.js";

// ── Load embedded runner ──────────────────────────────────────────────────────

type RunFn = (params: Record<string, unknown>) => Promise<{
  payloads?: Array<{ text?: string }>;
}>;

type TranscriptMessage = {
  role?: string;
  content?: unknown;
};

type NormalizedItem = StructuredImportItem;
type JsonNormalizationStrategy = "array" | "plan-container" | "roadmap" | "section-fallback";

async function loadRunner(): Promise<RunFn | null> {
  const require = createRequire(import.meta.url);

  // Resolve openclaw's root directory from the plugin-sdk entrypoint.
  let sdkPath: string;
  try {
    sdkPath = require.resolve("openclaw/plugin-sdk");
  } catch {
    return null;
  }

  // Walk up from the resolved SDK path to find the dist/ or src/ root.
  const candidates: string[] = [];
  let dir = path.dirname(sdkPath);
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, "dist", "extensionAPI.js"));
    candidates.push(path.join(dir, "extensionAPI.js"));
    candidates.push(path.join(dir, "src", "agents", "pi-embedded-runner.js"));
    dir = path.dirname(dir);
  }

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (await import(candidate)) as any;
      if (typeof mod.runEmbeddedPiAgent === "function") {
        return mod.runEmbeddedPiAgent as RunFn;
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ── Strip markdown code fences ────────────────────────────────────────────────

function stripFences(s: string): string {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? (m[1] ?? "").trim() : s.trim();
}

function resolvePrimaryAgentId(api: OpenClawPluginApi): string {
  const defaults = api.config.agents?.defaults as { id?: string } | undefined;
  return defaults?.id?.trim() || "main";
}

// ── Extract JSON object/array from freeform text ──────────────────────────────

function extractJson(text: string): string | null {
  const stripped = stripFences(text);
  // Try the full stripped text first.
  try {
    JSON.parse(stripped);
    return stripped;
  } catch {
    /* continue */
  }
  // Find the first { or [ and try from there.
  const start = stripped.search(/[{[]/);
  if (start === -1) return null;
  const sub = stripped.slice(start);
  try {
    JSON.parse(sub);
    return sub;
  } catch {
    /* continue */
  }
  // Try regex extraction of a JSON block.
  const objMatch = stripped.match(/(\{[\s\S]*\})/);
  if (objMatch) {
    try {
      JSON.parse(objMatch[1]!);
      return objMatch[1]!;
    } catch {
      /* continue */
    }
  }
  const arrMatch = stripped.match(/(\[[\s\S]*\])/);
  if (arrMatch) {
    try {
      JSON.parse(arrMatch[1]!);
      return arrMatch[1]!;
    } catch {
      /* continue */
    }
  }
  return null;
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
    .join("");
}

function extractLastAssistantText(messages: unknown[]): string {
  const typed = messages as TranscriptMessage[];
  for (let i = typed.length - 1; i >= 0; i -= 1) {
    const msg = typed[i];
    if (msg?.role !== "assistant") {
      continue;
    }
    const text = extractTextContent(msg.content).trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : key;
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const formatted = value
      .map((entry) => formatMetadataValue(entry))
      .filter((entry) => entry.length > 0);
    if (!formatted.length) {
      return "";
    }
    if (value.every((entry) => ["string", "number", "boolean"].includes(typeof entry))) {
      return formatted.map((entry) => `- ${entry}`).join("\n");
    }
    return JSON.stringify(value, null, 2);
  }
  if (isRecord(value)) {
    return JSON.stringify(value, null, 2);
  }
  return "";
}

function joinDescriptionBlocks(blocks: Array<string | undefined>): string | undefined {
  const normalized = blocks
    .map((block) => block?.trim())
    .filter((block): block is string => Boolean(block && block.length > 0));
  return normalized.length ? normalized.join("\n\n") : undefined;
}

function buildDescriptionFromRecord(
  record: Record<string, unknown>,
  ignoredKeys: string[] = [],
): string | undefined {
  const ignore = new Set(ignoredKeys);
  const blocks: string[] = [];
  if (typeof record.description === "string" && record.description.trim()) {
    blocks.push(record.description.trim());
    ignore.add("description");
  }
  for (const [key, value] of Object.entries(record)) {
    if (ignore.has(key)) {
      continue;
    }
    const formatted = formatMetadataValue(value);
    if (!formatted) {
      continue;
    }
    const label = humanizeKey(key);
    blocks.push(formatted.includes("\n") ? `${label}:\n${formatted}` : `${label}: ${formatted}`);
  }
  return joinDescriptionBlocks(blocks);
}

function pickRecordTitle(record: Record<string, unknown>, fallback?: string): string | undefined {
  for (const key of ["title", "name", "label", "summary"]) {
    if (typeof record[key] === "string" && record[key]!.trim()) {
      return record[key]!.trim();
    }
  }
  if (fallback?.trim()) {
    return fallback.trim();
  }
  return undefined;
}

function normalizeGenericChildItem(
  raw: unknown,
  type: NormalizedItem["type"],
  extraDescription?: string,
  fallbackTitle?: string,
): NormalizedItem | null {
  if (typeof raw === "string" && raw.trim()) {
    return {
      title: raw.trim(),
      type,
      description: extraDescription,
    };
  }
  if (!isRecord(raw)) {
    return null;
  }
  const title = pickRecordTitle(raw, fallbackTitle);
  if (!title) {
    return null;
  }
  const ignored = ["title", "name", "label", "summary"];
  const description = joinDescriptionBlocks([
    buildDescriptionFromRecord(raw, ignored),
    extraDescription,
  ]);
  return {
    title,
    type,
    description,
  };
}

function buildSharedCriticalContext(root: Record<string, unknown>): string | undefined {
  const blocks: string[] = [];
  const project = isRecord(root.project) ? root.project : undefined;
  if (project) {
    const projectSummary = buildDescriptionFromRecord(project, [
      "name",
      "version",
      "parent_plan",
      "related_plan_reviewed",
    ]);
    if (projectSummary) {
      blocks.push(`Project context:\n${projectSummary}`);
    }
  }

  const currentStateAnchors = isRecord(root.currentStateAnchors)
    ? root.currentStateAnchors
    : undefined;
  if (currentStateAnchors) {
    const knownGaps = formatMetadataValue(currentStateAnchors.knownGaps);
    if (knownGaps) {
      blocks.push(`Known Gaps:\n${knownGaps}`);
    }
  }

  for (const key of ["scopeBoundaries", "designPrinciples"]) {
    if (!isRecord(root[key])) {
      continue;
    }
    const formatted = buildDescriptionFromRecord(root[key] as Record<string, unknown>);
    if (formatted) {
      blocks.push(`${humanizeKey(key)}:\n${formatted}`);
    }
  }

  const acceptanceCriteria = formatMetadataValue(root.acceptanceCriteria);
  if (acceptanceCriteria) {
    blocks.push(`Acceptance Criteria:\n${acceptanceCriteria}`);
  }

  return joinDescriptionBlocks(blocks);
}

function normalizeTaskRecord(raw: unknown, sharedCriticalContext?: string): NormalizedItem | null {
  if (!isRecord(raw)) {
    return normalizeGenericChildItem(raw, "task", sharedCriticalContext);
  }
  const title = pickRecordTitle(raw);
  if (!title) {
    return null;
  }
  const subtasksSource = Array.isArray(raw.subtasks)
    ? raw.subtasks
    : Array.isArray(raw.children)
      ? raw.children
      : [];
  const children = subtasksSource
    .map((entry, index) =>
      normalizeGenericChildItem(entry, "subtask", undefined, `Subtask ${index + 1}`),
    )
    .filter((item): item is NormalizedItem => Boolean(item));
  return {
    title,
    type: "task",
    description: joinDescriptionBlocks([
      buildDescriptionFromRecord(raw, [
        "title",
        "name",
        "label",
        "summary",
        "subtasks",
        "children",
      ]),
      sharedCriticalContext,
    ]),
    children: children.length ? children : undefined,
  };
}

function normalizeEpicRecord(
  raw: unknown,
  sprintContext?: string,
  sharedCriticalContext?: string,
): NormalizedItem | null {
  if (!isRecord(raw)) {
    return normalizeGenericChildItem(
      raw,
      "epic",
      joinDescriptionBlocks([sprintContext, sharedCriticalContext]),
    );
  }
  const title = pickRecordTitle(raw);
  if (!title) {
    return null;
  }
  const tasksSource = Array.isArray(raw.tasks)
    ? raw.tasks
    : Array.isArray(raw.children)
      ? raw.children
      : [];
  const children = tasksSource
    .map((entry) => normalizeTaskRecord(entry, sharedCriticalContext))
    .filter((item): item is NormalizedItem => Boolean(item));
  return {
    title,
    type: "epic",
    description: joinDescriptionBlocks([
      buildDescriptionFromRecord(raw, ["title", "name", "label", "summary", "tasks", "children"]),
      sprintContext,
      sharedCriticalContext,
    ]),
    children: children.length ? children : undefined,
  };
}

function normalizePlanContainer(
  payload: Record<string, unknown>,
  sharedCriticalContext?: string,
): NormalizedItem[] {
  const sprints = Array.isArray(payload.sprints) ? payload.sprints : [];
  const sprintItems = sprints.flatMap((sprint, sprintIndex) => {
    if (!isRecord(sprint)) {
      return [];
    }
    const sprintTitle = pickRecordTitle(sprint, `Sprint ${sprintIndex + 1}`);
    const sprintContext = joinDescriptionBlocks([
      sprintTitle ? `Sprint: ${sprintTitle}` : undefined,
      buildDescriptionFromRecord(sprint, ["title", "name", "label", "summary", "epics"]),
    ]);
    const epics = Array.isArray(sprint.epics) ? sprint.epics : [];
    return epics
      .map((epic) => normalizeEpicRecord(epic, sprintContext, sharedCriticalContext))
      .filter((item): item is NormalizedItem => Boolean(item));
  });
  if (sprintItems.length) {
    return sprintItems;
  }

  for (const key of ["epics", "tasks", "items", "steps"]) {
    const section = payload[key];
    if (!Array.isArray(section)) {
      continue;
    }
    const type = key === "epics" ? "epic" : "task";
    const items = section
      .map((entry, index) =>
        type === "epic"
          ? normalizeEpicRecord(entry, undefined, sharedCriticalContext)
          : (normalizeTaskRecord(entry, sharedCriticalContext) ??
            normalizeGenericChildItem(
              entry,
              "task",
              sharedCriticalContext,
              `${humanizeKey(key)} ${index + 1}`,
            )),
      )
      .filter((item): item is NormalizedItem => Boolean(item));
    if (items.length) {
      return items;
    }
  }

  return [];
}

export function normalizeJsonPayloadToItems(payload: unknown): {
  items: NormalizedItem[];
  strategy: JsonNormalizationStrategy;
} {
  if (Array.isArray(payload)) {
    const items = payload
      .map(
        (entry, index) =>
          normalizeEpicRecord(entry, undefined, undefined) ??
          normalizeGenericChildItem(entry, "task", undefined, `Item ${index + 1}`),
      )
      .filter((item): item is NormalizedItem => Boolean(item));
    if (items.length) {
      return { items, strategy: "array" };
    }
    throw new Error("JSON fallback could not find any importable items in the array payload.");
  }

  if (!isRecord(payload)) {
    throw new Error("JSON fallback expected an object or array payload.");
  }

  const sharedCriticalContext = buildSharedCriticalContext(payload);
  const directItems = normalizePlanContainer(payload, sharedCriticalContext);
  if (directItems.length) {
    return { items: directItems, strategy: "plan-container" };
  }

  const roadmap = isRecord(payload.roadmap) ? payload.roadmap : undefined;
  if (roadmap) {
    const roadmapItems = normalizePlanContainer(
      roadmap,
      joinDescriptionBlocks([
        buildDescriptionFromRecord(roadmap, [
          "title",
          "name",
          "label",
          "summary",
          "sprints",
          "epics",
          "tasks",
          "items",
          "steps",
        ]),
        sharedCriticalContext,
      ]),
    );
    if (roadmapItems.length) {
      return { items: roadmapItems, strategy: "roadmap" };
    }
  }

  const sectionItems = Object.entries(payload)
    .filter(([key]) => !["project", "sprints"].includes(key))
    .map<NormalizedItem | null>(([key, value]) => {
      if (Array.isArray(value)) {
        const children = value
          .map((entry, index) =>
            normalizeGenericChildItem(entry, "task", undefined, `${humanizeKey(key)} ${index + 1}`),
          )
          .filter((item): item is NormalizedItem => Boolean(item));
        if (children.length) {
          return {
            title: humanizeKey(key),
            type: "epic" as const,
            description: joinDescriptionBlocks([sharedCriticalContext]),
            children,
          };
        }
      }
      const formatted = formatMetadataValue(value);
      if (!formatted) {
        return null;
      }
      return {
        title: humanizeKey(key),
        type: "task" as const,
        description: joinDescriptionBlocks([
          formatted.includes("\n") ? `${humanizeKey(key)}:\n${formatted}` : formatted,
          sharedCriticalContext,
        ]),
      };
    })
    .filter((item): item is NormalizedItem => item !== null);

  if (sectionItems.length) {
    return { items: sectionItems, strategy: "section-fallback" };
  }

  throw new Error("JSON fallback could not infer a project-plan hierarchy from the payload.");
}

// ── Basic fallback parsers ────────────────────────────────────────────────────

function parseCSV(content: string): object {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { items: [] };
  // Detect header row
  const header = lines[0]!.toLowerCase();
  const hasHeader = header.includes("title") || header.includes("name") || header.includes("task");
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const cols = hasHeader ? lines[0]!.split(",").map((c) => c.trim().toLowerCase()) : null;
  const titleIdx = cols
    ? cols.indexOf("title") !== -1
      ? cols.indexOf("title")
      : cols.indexOf("name") !== -1
        ? cols.indexOf("name")
        : 0
    : 0;
  const descIdx = cols ? cols.indexOf("description") : -1;
  const typeIdx = cols ? cols.indexOf("type") : -1;
  const items = dataLines
    .map((line) => {
      const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
      const title = parts[titleIdx] ?? line;
      if (!title) return null;
      const item: Record<string, string> = { title, type: "task" };
      if (descIdx !== -1 && parts[descIdx]) item.description = parts[descIdx]!;
      if (typeIdx !== -1 && parts[typeIdx]) item.type = parts[typeIdx]!;
      return item;
    })
    .filter(Boolean);
  return { items };
}

// ── Main conversion ───────────────────────────────────────────────────────────

const MAX_PROMPT_CHARS = 20_000;

const CONVERT_PROMPT = (filename: string, content: string) =>
  `
You are a project planning assistant. Convert the following file content into a structured project plan for OpenClaw Project Plan.

Output ONLY valid JSON in this exact format — no explanation, no markdown prose, just the JSON:
{
  "items": [
    {
      "title": "Epic or main group title",
      "type": "epic",
      "description": "optional description",
      "children": [
        {
          "title": "Task title",
          "type": "task",
          "description": "optional description",
          "children": [
            { "title": "Subtask title", "type": "subtask" }
          ]
        }
      ]
    }
  ]
}

Rules:
- type must be "epic", "task", or "subtask"
- Use "epic" for high-level groups, "task" for work items, "subtask" for sub-items
- description is optional only when the source truly has no useful context
- children is optional — omit for leaf items
- Extract ALL actionable items from the content
- Preserve the original parent-child hierarchy as accurately as possible
- Never collapse rich source items into title-only entries when metadata exists
- If the source includes important fields such as acceptanceCriteria, knownGaps, scopeBoundaries, designPrinciples, assumptions, constraints, risks, dependencies, notes, document excerpts, or references, preserve them in the item's description
- For epics and tasks especially, use description as a loss-minimized context container for any critical source details that do not fit elsewhere
- When the source is JSON with extra keys beyond title/type/children, merge those extra fields into description in a readable way instead of dropping them
- Never output raw JSON syntax fragments, braces, commas, keys, or one-character placeholders as titles
- Never split a single sentence into multiple items unless it clearly contains separate actionable tasks
- If the source is arbitrary JSON with a different schema, infer the correct epic > task > subtask structure and map it into the target shape

File name: ${filename}

File content:
${content.slice(0, MAX_PROMPT_CHARS)}
`.trim();

const CONVERT_SYSTEM_PROMPT = [
  "You are a strict JSON transformer for project planning imports.",
  "Return ONLY valid JSON and no prose.",
  'The JSON must match this shape: {"items":[...]} where each item can have title, type, description, children.',
  "Allowed item types: epic, task, subtask.",
  "Preserve important source metadata in description instead of dropping it.",
  "Epics and tasks must keep critical context such as acceptance criteria, gaps, boundaries, principles, risks, and notes inside description when present.",
  "Do not include markdown code fences.",
].join("\n");

export type ConvertResult = {
  json: string;
  method: "llm" | "basic" | "json-fallback" | "text-structure";
};

export async function convertFileToItems(params: {
  content: string;
  filename: string;
  api: OpenClawPluginApi;
}): Promise<ConvertResult> {
  const { content, filename, api } = params;
  const ext = path.extname(filename).toLowerCase();

  if (ext === ".json" || ext === ".jsonc" || ext === ".json5") {
    try {
      const parsed = JSON.parse(content);
      const normalized = normalizeJsonPayloadToItems(parsed);
      if (normalized.strategy !== "section-fallback") {
        return { json: JSON.stringify({ items: normalized.items }), method: "json-fallback" };
      }
      api.logger.warn(
        "project-plan: JSON fallback found only low-confidence section items, escalating to LLM",
      );
    } catch (error) {
      api.logger.warn(
        `project-plan: JSON fallback normalize failed, trying LLM error=${String(error)}`,
      );
    }
  }

  if (ext === ".md" || ext === ".markdown" || ext === ".txt") {
    try {
      const normalized = parseStructuredTextToItems({
        content,
        markdown: ext !== ".txt" || /^#{1,6}\s/m.test(content),
      });
      if (normalized.items.length > 0) {
        return { json: JSON.stringify(normalized), method: "text-structure" };
      }
    } catch (error) {
      api.logger.warn(
        `project-plan: structured text normalize failed, trying LLM error=${String(error)}`,
      );
    }
  }

  const primaryAgentId = resolvePrimaryAgentId(api);
  const sessionKey = `agent:${primaryAgentId}:project-plan-convert`;

  // ── Try default subagent conversion first (blocking) ────────────────────
  try {
    const { runId } = await api.runtime.subagent.run({
      sessionKey,
      idempotencyKey: crypto.randomUUID(),
      message: CONVERT_PROMPT(filename, content),
      extraSystemPrompt: CONVERT_SYSTEM_PROMPT,
    });
    const result = await api.runtime.subagent.waitForRun({
      runId,
      timeoutMs: 90_000,
    });
    if (result.status === "ok") {
      const transcript = await api.runtime.subagent.getSessionMessages({
        sessionKey,
        limit: 200,
      });
      const text = extractLastAssistantText(transcript.messages);
      const extracted = extractJson(text);
      if (extracted) {
        JSON.parse(extracted);
        return { json: extracted, method: "llm" };
      }
    }
  } catch (e) {
    api.logger.warn(
      `project-plan: default agent convert failed, trying embedded runner error=${String(e)}`,
    );
  }

  // ── Try LLM conversion ───────────────────────────────────────────────────
  const runner = await loadRunner();
  if (runner) {
    let tmpDir: string | null = null;
    try {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pp-convert-"));
      const sessionFile = path.join(tmpDir, "session.jsonl");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfg = (api as any).config;
      const result = await runner({
        sessionId: `pp-convert-${Date.now()}`,
        sessionFile,
        workspaceDir: cfg?.agents?.defaults?.workspace ?? process.cwd(),
        config: cfg,
        prompt: CONVERT_PROMPT(filename, content),
        timeoutMs: 60_000,
        runId: crypto.randomUUID(),
        disableTools: true,
        streamParams: { maxTokens: 4096 },
      });
      const text = result.payloads?.find((p) => p.text)?.text ?? "";
      const extracted = extractJson(text);
      if (extracted) {
        // Validate it can be parsed
        JSON.parse(extracted);
        return { json: extracted, method: "llm" };
      }
    } catch (e) {
      api.logger.warn(
        `project-plan: LLM convert failed, falling back to basic parser error=${String(e)}`,
      );
    } finally {
      if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ── Basic fallback parsers ───────────────────────────────────────────────
  if (ext === ".json" || ext === ".jsonc" || ext === ".json5") {
    try {
      const parsed = JSON.parse(content);
      const normalized = normalizeJsonPayloadToItems(parsed);
      return { json: JSON.stringify(normalized), method: "json-fallback" };
    } catch (error) {
      throw new Error(
        `Could not normalize the uploaded JSON into OpenClaw Project Plan format using either the primary agent or the JSON fallback parser: ${String(error)}`,
      );
    }
  }

  let parsed: object;
  if (ext === ".csv") {
    parsed = parseCSV(content);
  } else if (ext === ".md" || ext === ".txt" || ext === ".markdown") {
    parsed = parseStructuredTextToItems({
      content,
      markdown: ext !== ".txt" || /^#{1,6}\s/m.test(content),
    });
  } else {
    // Unknown text format — treat each line as a task
    parsed = parseStructuredTextToItems({ content, markdown: /^#{1,6}\s/m.test(content) });
  }
  return { json: JSON.stringify(parsed), method: "basic" };
}
