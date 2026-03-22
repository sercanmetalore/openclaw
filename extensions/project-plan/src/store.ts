// ── File-based JSON storage ───────────────────────────────────────────────────

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { decrypt, encrypt, loadOrCreateKey } from "./encrypt.js";
import type {
  ProjectPlanIntegrationId,
  ProjectPlanIntegrationInfo,
  ProjectPlanIntegrationSettings,
  ProjectPlanItem,
  ProjectPlanItemType,
  ProjectPlanLogEntry,
  ProjectPlanPluginConfig,
  ProjectPlanRecord,
  ProjectPlanSource,
  ProjectPlanStatus,
  StoredAccount,
  StoredIntegration,
} from "./types.js";

const PLUGIN_DIR = ["plugins", "project-plan"] as const;
const PLANS_SUBDIR = "plans";
const INTEGRATIONS_FILE = "integrations.json";
const ACCOUNTS_FILE = "accounts.json";
const MAX_LOGS_DEFAULT = 500;

// ── Path helpers ──────────────────────────────────────────────────────────────

function pluginDir(stateDir: string): string {
  return path.join(stateDir, ...PLUGIN_DIR);
}

function planFilePath(stateDir: string, planId: string): string {
  return path.join(pluginDir(stateDir), PLANS_SUBDIR, `${planId}.json`);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function normalizePlanSource(raw: unknown): ProjectPlanSource {
  return raw === "github" ||
    raw === "gitlab" ||
    raw === "azuredevops" ||
    raw === "jira" ||
    raw === "local"
    ? raw
    : "local";
}

function normalizePlanStatus(raw: unknown): ProjectPlanStatus {
  return raw === "to do" ||
    raw === "in progress" ||
    raw === "blocked" ||
    raw === "done" ||
    raw === "failed" ||
    raw === "cancelled"
    ? raw
    : "to do";
}

function toFiniteTimestamp(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function toOptionalFiniteTimestamp(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function normalizeLoadedPlan(raw: unknown): ProjectPlanRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const input = raw as Partial<ProjectPlanRecord>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!id || !name) {
    return null;
  }

  const now = Date.now();
  const createdAt = toFiniteTimestamp(input.createdAt, now);
  const updatedAt = toFiniteTimestamp(input.updatedAt, createdAt);
  const settingsRaw =
    input.settings && typeof input.settings === "object"
      ? (input.settings as Partial<ProjectPlanRecord["settings"]>)
      : {};

  return {
    id,
    name,
    description: typeof input.description === "string" ? input.description : undefined,
    status: normalizePlanStatus(input.status),
    createdAt,
    updatedAt,
    settings: {
      source: normalizePlanSource(settingsRaw.source),
      providerProjectId:
        typeof settingsRaw.providerProjectId === "string"
          ? settingsRaw.providerProjectId
          : undefined,
      providerPlanId:
        typeof settingsRaw.providerPlanId === "string" ? settingsRaw.providerPlanId : undefined,
      defaultAgentId:
        typeof settingsRaw.defaultAgentId === "string" ? settingsRaw.defaultAgentId : undefined,
      syncMode: settingsRaw.syncMode === "pull" ? "pull" : "manual",
      itemScopedSessions: settingsRaw.itemScopedSessions !== false,
      projectPath:
        typeof settingsRaw.projectPath === "string" ? settingsRaw.projectPath : undefined,
      accountId: typeof settingsRaw.accountId === "string" ? settingsRaw.accountId : undefined,
    },
    execution:
      input.execution && typeof input.execution === "object"
        ? {
            running: Boolean(input.execution.running),
            startedAt: toOptionalFiniteTimestamp(input.execution.startedAt),
            lastStartedAt: toOptionalFiniteTimestamp(input.execution.lastStartedAt),
            lastCompletedAt: toOptionalFiniteTimestamp(input.execution.lastCompletedAt),
            currentItemId:
              typeof input.execution.currentItemId === "string"
                ? input.execution.currentItemId
                : undefined,
          }
        : { running: false },
    metrics:
      input.metrics && typeof input.metrics === "object"
        ? {
            runCount:
              typeof input.metrics.runCount === "number" && Number.isFinite(input.metrics.runCount)
                ? input.metrics.runCount
                : 0,
            tokenSpent:
              typeof input.metrics.tokenSpent === "number" &&
              Number.isFinite(input.metrics.tokenSpent)
                ? input.metrics.tokenSpent
                : 0,
            durationMs:
              typeof input.metrics.durationMs === "number" &&
              Number.isFinite(input.metrics.durationMs)
                ? input.metrics.durationMs
                : 0,
          }
        : { runCount: 0, tokenSpent: 0, durationMs: 0 },
    items: Array.isArray(input.items) ? (input.items as ProjectPlanRecord["items"]) : [],
    logs: Array.isArray(input.logs) ? (input.logs as ProjectPlanRecord["logs"]) : [],
  };
}

// ── Plan CRUD ─────────────────────────────────────────────────────────────────

export async function listPlans(stateDir: string): Promise<ProjectPlanRecord[]> {
  const dir = path.join(pluginDir(stateDir), PLANS_SUBDIR);
  await ensureDir(dir);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const plans: ProjectPlanRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf8");
      const parsed = normalizeLoadedPlan(JSON.parse(raw));
      if (parsed) {
        plans.push(parsed);
      }
    } catch {
      // Skip corrupt files.
    }
  }
  return plans.sort((a, b) => a.createdAt - b.createdAt);
}

export async function loadPlan(
  stateDir: string,
  planId: string,
): Promise<ProjectPlanRecord | null> {
  try {
    const raw = await fs.readFile(planFilePath(stateDir, planId), "utf8");
    return normalizeLoadedPlan(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function savePlan(
  stateDir: string,
  plan: ProjectPlanRecord,
  opts?: { maxLogEntries?: number },
): Promise<void> {
  const maxLog = opts?.maxLogEntries ?? MAX_LOGS_DEFAULT;
  if (plan.logs.length > maxLog) {
    plan.logs = plan.logs.slice(-maxLog);
  }
  plan.updatedAt = Date.now();
  const dir = path.join(pluginDir(stateDir), PLANS_SUBDIR);
  const finalPath = planFilePath(stateDir, plan.id);
  // Write via temp + rename so concurrent readers never see partial JSON.
  const tempPath = path.join(
    dir,
    `${plan.id}.json.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`,
  );
  await ensureDir(dir);
  const payload = `${JSON.stringify(plan, null, 2)}\n`;
  await fs.writeFile(tempPath, payload, "utf8");
  try {
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export async function deletePlan(stateDir: string, planId: string): Promise<boolean> {
  try {
    await fs.unlink(planFilePath(stateDir, planId));
    return true;
  } catch {
    return false;
  }
}

// ── Factory helpers ───────────────────────────────────────────────────────────

export function createPlan(params: {
  name: string;
  description?: string;
  source?: ProjectPlanSource;
}): ProjectPlanRecord {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: params.name,
    description: params.description,
    status: "to do",
    createdAt: now,
    updatedAt: now,
    settings: {
      source: params.source ?? "local",
      defaultAgentId: "main",
      syncMode: "manual",
      itemScopedSessions: true,
    },
    execution: { running: false },
    metrics: { runCount: 0, tokenSpent: 0, durationMs: 0 },
    items: [],
    logs: [],
  };
}

export function createItem(params: {
  title: string;
  description?: string;
  type?: ProjectPlanItemType;
  parentId?: string;
  assignedAgentId?: string;
  externalId?: string;
  order?: number;
}): ProjectPlanItem {
  return {
    id: crypto.randomUUID(),
    type: params.type ?? "task",
    title: params.title,
    description: params.description,
    status: "to do",
    order: params.order ?? 0,
    parentId: params.parentId,
    updatedAt: Date.now(),
    assignedAgentId: params.assignedAgentId,
    externalId: params.externalId,
  };
}

export function createLog(params: {
  level: ProjectPlanLogEntry["level"];
  message: string;
  itemId?: string;
}): ProjectPlanLogEntry {
  return {
    id: crypto.randomUUID(),
    ts: Date.now(),
    level: params.level,
    message: params.message,
    itemId: params.itemId,
  };
}

// ── Integrations storage ──────────────────────────────────────────────────────

const INTEGRATION_LABELS: Record<ProjectPlanIntegrationId, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  azuredevops: "Azure DevOps",
  jira: "Jira",
};

async function loadIntegrations(stateDir: string): Promise<StoredIntegration[]> {
  const file = path.join(pluginDir(stateDir), INTEGRATIONS_FILE);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as StoredIntegration[];
  } catch {
    return [];
  }
}

async function saveIntegrations(
  stateDir: string,
  integrations: StoredIntegration[],
): Promise<void> {
  const dir = pluginDir(stateDir);
  await ensureDir(dir);
  await fs.writeFile(
    path.join(dir, INTEGRATIONS_FILE),
    `${JSON.stringify(integrations, null, 2)}\n`,
    "utf8",
  );
}

export async function getIntegrations(stateDir: string): Promise<{
  integrations: ProjectPlanIntegrationInfo[];
  availableSources: ProjectPlanSource[];
}> {
  const stored = await loadIntegrations(stateDir);
  const byId = new Map(stored.map((i) => [i.id, i]));
  const ids: ProjectPlanIntegrationId[] = ["github", "gitlab", "azuredevops", "jira"];
  const integrations: ProjectPlanIntegrationInfo[] = ids.map((id) => {
    const s = byId.get(id);
    return {
      id,
      label: INTEGRATION_LABELS[id],
      configured: Boolean(s?.enabled && s.encryptedToken),
      settings: s ? { ...s.settings, enabled: s.enabled } : undefined,
    };
  });
  const availableSources: ProjectPlanSource[] = [
    "local",
    ...ids.filter((id) => {
      const s = byId.get(id);
      return s?.enabled && s.encryptedToken;
    }),
  ];
  return { integrations, availableSources };
}

export async function saveIntegrationsConfig(
  stateDir: string,
  draft: Partial<Record<ProjectPlanIntegrationId, ProjectPlanIntegrationSettings>>,
): Promise<void> {
  const key = await loadOrCreateKey(stateDir);
  const existing = await loadIntegrations(stateDir);
  const byId = new Map(existing.map((i) => [i.id, i]));
  for (const [id, settings] of Object.entries(draft) as [
    ProjectPlanIntegrationId,
    ProjectPlanIntegrationSettings,
  ][]) {
    const { token, ...rest } = settings;
    const prev = byId.get(id);
    const entry: StoredIntegration = {
      id,
      enabled: settings.enabled ?? prev?.enabled ?? false,
      settings: rest,
      encryptedToken: token ? encrypt(token, key) : prev?.encryptedToken,
    };
    byId.set(id, entry);
  }
  await saveIntegrations(stateDir, [...byId.values()]);
}

export async function resolveIntegrationToken(
  stateDir: string,
  id: ProjectPlanIntegrationId,
): Promise<string | null> {
  const stored = await loadIntegrations(stateDir);
  const entry = stored.find((i) => i.id === id);
  if (!entry?.encryptedToken) return null;
  const key = await loadOrCreateKey(stateDir);
  return decrypt(entry.encryptedToken, key);
}

export async function resolveIntegrationSettings(
  stateDir: string,
  id: ProjectPlanIntegrationId,
): Promise<StoredIntegration | null> {
  const stored = await loadIntegrations(stateDir);
  return stored.find((i) => i.id === id) ?? null;
}

// ── Accounts storage ──────────────────────────────────────────────────────────

export async function loadAccounts(stateDir: string): Promise<StoredAccount[]> {
  const file = path.join(pluginDir(stateDir), ACCOUNTS_FILE);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as StoredAccount[];
  } catch {
    return [];
  }
}

export async function saveAccounts(stateDir: string, accounts: StoredAccount[]): Promise<void> {
  const dir = pluginDir(stateDir);
  await ensureDir(dir);
  await fs.writeFile(
    path.join(dir, ACCOUNTS_FILE),
    `${JSON.stringify(accounts, null, 2)}\n`,
    "utf8",
  );
}

/** Map StoredAccount list to PlanAccount list (tokens hidden). */
export function toPublicAccounts(
  accounts: StoredAccount[],
): Array<{
  id: string;
  name: string;
  provider: ProjectPlanIntegrationId;
  enabled: boolean;
  settings: ProjectPlanIntegrationSettings;
}> {
  return accounts.map(({ encryptedToken: _, ...a }) => ({
    ...a,
    settings: { ...a.settings, token: undefined },
  }));
}

/** Upsert a single account (encrypts token if provided). */
export async function upsertAccount(
  stateDir: string,
  draft: {
    id?: string;
    name: string;
    provider: ProjectPlanIntegrationId;
    enabled: boolean;
    settings: ProjectPlanIntegrationSettings;
  },
): Promise<StoredAccount> {
  const key = await loadOrCreateKey(stateDir);
  const existing = await loadAccounts(stateDir);
  const id = draft.id ?? crypto.randomUUID();
  const { token, ...rest } = draft.settings;
  const prev = existing.find((a) => a.id === id);
  const account: StoredAccount = {
    id,
    name: draft.name,
    provider: draft.provider,
    enabled: draft.enabled,
    settings: rest,
    encryptedToken: token ? encrypt(token, key) : prev?.encryptedToken,
  };
  const updated = prev ? existing.map((a) => (a.id === id ? account : a)) : [...existing, account];
  await saveAccounts(stateDir, updated);
  return account;
}

/** Delete an account by ID. Returns true if deleted. */
export async function deleteAccount(stateDir: string, accountId: string): Promise<boolean> {
  const existing = await loadAccounts(stateDir);
  const filtered = existing.filter((a) => a.id !== accountId);
  if (filtered.length === existing.length) return false;
  await saveAccounts(stateDir, filtered);
  return true;
}

/** Resolve the plaintext token for a specific account. */
export async function resolveAccountToken(
  stateDir: string,
  accountId: string,
): Promise<string | null> {
  const accounts = await loadAccounts(stateDir);
  const account = accounts.find((a) => a.id === accountId);
  if (!account?.encryptedToken) return null;
  const key = await loadOrCreateKey(stateDir);
  return decrypt(account.encryptedToken, key);
}

// ── Plan item JSON upload (local source) ──────────────────────────────────────

type UploadItem = {
  title: string;
  description?: string;
  type?: ProjectPlanItemType;
  children?: UploadItem[];
  assignedAgentId?: string;
};

export type UploadPayload = { items: UploadItem[] } | UploadItem[];

const UPLOAD_TYPE_ALIASES: Record<string, ProjectPlanItemType> = {
  epic: "epic",
  epics: "epic",
  initiative: "epic",
  initiatives: "epic",
  milestone: "epic",
  milestones: "epic",
  feature: "epic",
  features: "epic",
  task: "task",
  tasks: "task",
  item: "task",
  items: "task",
  story: "task",
  stories: "task",
  subtask: "subtask",
  subtasks: "subtask",
  "sub-task": "subtask",
  "sub-tasks": "subtask",
  sub_task: "subtask",
  sub_tasks: "subtask",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const RESERVED_UPLOAD_KEYS = new Set([
  "title",
  "type",
  "description",
  "children",
  "assignedAgentId",
]);

const DESCRIPTION_PRIORITY_KEYS = [
  "summary",
  "goal",
  "objective",
  "context",
  "acceptanceCriteria",
  "knownGaps",
  "scopeBoundaries",
  "designPrinciples",
  "requirements",
  "constraints",
  "assumptions",
  "dependencies",
  "risks",
  "deliverables",
  "definitionOfDone",
  "notes",
  "references",
] as const;

const DESCRIPTION_PRIORITY_KEY_SET = new Set<string>(DESCRIPTION_PRIORITY_KEYS);

function humanizeFieldName(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) {
    return key;
  }
  return spaced[0]!.toUpperCase() + spaced.slice(1);
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
    const compactValues = value
      .map((entry) => formatMetadataValue(entry))
      .filter((entry) => entry.length > 0);
    if (!compactValues.length) {
      return "";
    }
    if (value.every((entry) => ["string", "number", "boolean"].includes(typeof entry))) {
      return compactValues.map((entry) => `- ${entry}`).join("\n");
    }
    return JSON.stringify(value, null, 2);
  }
  if (isRecord(value)) {
    return JSON.stringify(value, null, 2);
  }
  return "";
}

function buildImportedDescription(raw: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  const baseDescription = formatMetadataValue(raw.description);
  if (baseDescription) {
    parts.push(baseDescription);
  }

  const orderedKeys = [
    ...DESCRIPTION_PRIORITY_KEYS.filter((key) => key in raw),
    ...Object.keys(raw).filter(
      (key) => !RESERVED_UPLOAD_KEYS.has(key) && !DESCRIPTION_PRIORITY_KEY_SET.has(key),
    ),
  ];

  for (const key of orderedKeys) {
    const formattedValue = formatMetadataValue(raw[key]);
    if (!formattedValue) {
      continue;
    }
    const label = humanizeFieldName(key);
    if (formattedValue.includes("\n")) {
      parts.push(`${label}:\n${formattedValue}`);
    } else {
      parts.push(`${label}: ${formattedValue}`);
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function normalizeUploadItemType(
  rawType: unknown,
  depth: number,
  hasChildren: boolean,
): ProjectPlanItemType {
  let normalized: ProjectPlanItemType | undefined;
  if (typeof rawType === "string") {
    const key = rawType.trim().toLowerCase().replace(/\s+/g, "-");
    normalized = UPLOAD_TYPE_ALIASES[key];
  }

  if (!normalized) {
    if (depth === 0) {
      return hasChildren ? "epic" : "task";
    }
    if (depth === 1) {
      return "task";
    }
    return "subtask";
  }

  if (depth > 1) {
    return "subtask";
  }
  if (depth === 1 && normalized === "epic") {
    return "task";
  }
  return normalized;
}

export function importItemsFromPayload(payload: UploadPayload, startOrder = 0): ProjectPlanItem[] {
  // Accept both {"items":[...]} and [...] formats.
  const rawItems: UploadItem[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: UploadItem[] }).items
      : [];

  if (!rawItems.length) {
    throw new Error(
      'No items found. Expected {"items":[{"title":"...","type":"task"},...]} or a top-level array.',
    );
  }

  const result: ProjectPlanItem[] = [];
  let order = startOrder;
  const walk = (items: unknown[], depth: number, parentId?: string): void => {
    for (const raw of items) {
      if (!isRecord(raw)) {
        throw new Error("Imported items must be objects with at least a title.");
      }
      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      if (!title) {
        throw new Error("Each imported item must include a non-empty title.");
      }
      const description = buildImportedDescription(raw);
      const assignedAgentId =
        typeof raw.assignedAgentId === "string" && raw.assignedAgentId.trim()
          ? raw.assignedAgentId.trim()
          : undefined;
      const children = raw.children;
      if (children !== undefined && !Array.isArray(children)) {
        throw new Error(`Imported item "${title}" has invalid children; expected an array.`);
      }
      const hasChildren = Array.isArray(children) && children.length > 0;
      const item = createItem({
        title,
        description,
        type: normalizeUploadItemType(raw.type, depth, hasChildren),
        parentId,
        assignedAgentId,
        order: order++,
      });
      result.push(item);
      if (hasChildren) {
        walk(children, depth + 1, item.id);
      }
    }
  };
  walk(rawItems, 0);

  if (!result.length) {
    throw new Error("No importable items were found in the uploaded payload.");
  }

  return result;
}

// ── Status counts helper ──────────────────────────────────────────────────────

export function buildCounts(items: ProjectPlanItem[]): Record<ProjectPlanStatus, number> {
  const counts: Record<ProjectPlanStatus, number> = {
    "to do": 0,
    "in progress": 0,
    blocked: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return counts;
}

// ── Plugin-config helper ──────────────────────────────────────────────────────

export function getPluginConfigOpts(pluginConfig: ProjectPlanPluginConfig): {
  maxLogEntries?: number;
} {
  return { maxLogEntries: pluginConfig.maxLogEntries };
}
