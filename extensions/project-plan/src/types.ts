// ── Project Plan plugin — data types aligned with OpenClaw UI wire protocol ────
// UI-facing types mirror /home/adige/openclaw_pro/ui/src/ui/types.ts exactly.

// ── UI wire types (must match openclaw_pro UI exactly) ───────────────────────

export type ProjectPlanSource = "github" | "gitlab" | "azuredevops" | "jira" | "local";

export type ProjectPlanIntegrationId = Exclude<ProjectPlanSource, "local">;

export type ProjectPlanStatus =
  | "to do"
  | "in progress"
  | "blocked"
  | "done"
  | "failed"
  | "cancelled";

export type ProjectPlanItemType = "epic" | "task" | "subtask";

export type ProjectPlanSettings = {
  source: ProjectPlanSource;
  providerProjectId?: string;
  providerPlanId?: string;
  defaultAgentId?: string;
  syncMode?: "manual" | "pull";
  /** Use a separate subagent session for each plan item to avoid context buildup. */
  itemScopedSessions?: boolean;
  /** Absolute path on the local filesystem where agents are allowed to make changes. */
  projectPath?: string;
  /** ID of the PlanAccount to use for cloud sync operations. */
  accountId?: string;
};

export type ProjectPlanSessionMessage = {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  ts: number;
};

export type ProjectPlanItem = {
  id: string;
  type: ProjectPlanItemType;
  title: string;
  description?: string;
  status: ProjectPlanStatus;
  order: number;
  parentId?: string;
  /** Unix ms timestamp. */
  updatedAt: number;
  assignedAgentId?: string;
  /** Provider-side issue/work-item ID (stored but not exposed to UI). */
  externalId?: string;
  /** Captured session output after item execution. */
  sessionOutput?: ProjectPlanSessionMessage[];
};

export type ProjectPlanLogEntry = {
  id: string;
  /** Unix ms timestamp. */
  ts: number;
  level: "info" | "warn" | "error";
  message: string;
  itemId?: string;
};

export type ProjectPlanRecord = {
  id: string;
  name: string;
  description?: string;
  status: ProjectPlanStatus;
  /** Unix ms timestamp. */
  createdAt: number;
  /** Unix ms timestamp. */
  updatedAt: number;
  settings: ProjectPlanSettings;
  execution: {
    running: boolean;
    startedAt?: number;
    lastStartedAt?: number;
    lastCompletedAt?: number;
    currentItemId?: string;
  };
  metrics: {
    runCount: number;
    tokenSpent: number;
    durationMs: number;
  };
  items: ProjectPlanItem[];
  logs: ProjectPlanLogEntry[];
};

export type ProjectPlanListResult = {
  plans: Array<{
    id: string;
    name: string;
    description?: string;
    status: ProjectPlanStatus;
    source: ProjectPlanSource;
    updatedAt: number;
    running: boolean;
    counts: Record<ProjectPlanStatus, number>;
  }>;
  availableSources?: ProjectPlanSource[];
  integrations?: ProjectPlanIntegrationInfo[];
};

export type ProjectPlanDetailResult = {
  plan: ProjectPlanRecord;
  availableSources?: ProjectPlanSource[];
  integrations?: ProjectPlanIntegrationInfo[];
  dashboard: {
    counts: Record<ProjectPlanStatus, number>;
    totalItems: number;
    completionRatio: number;
    running: boolean;
    tokenSpent: number;
    durationMs: number;
    runCount: number;
    currentItemId?: string;
  };
};

export type ProjectPlanIntegrationSettings = {
  hostUrl?: string;
  organization?: string;
  owner?: string;
  repo?: string;
  project?: string;
  projectKey?: string;
  boardId?: string;
  usernameOrEmail?: string;
  /** Plaintext token — encrypted before storage. */
  token?: string;
  enabled?: boolean;
};

export type ProjectPlanIntegrationInfo = {
  id: ProjectPlanIntegrationId;
  label: string;
  configured: boolean;
  settings?: ProjectPlanIntegrationSettings;
};

/** Stored integration entry (token is AES-256-GCM encrypted). */
export type StoredIntegration = {
  id: ProjectPlanIntegrationId;
  enabled: boolean;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  encryptedToken?: string;
};

export type PlanAccount = {
  id: string;
  name: string;
  provider: ProjectPlanIntegrationId;
  enabled: boolean;
  settings: ProjectPlanIntegrationSettings;
};

/** Stored account entry (token is AES-256-GCM encrypted). */
export type StoredAccount = {
  id: string;
  name: string;
  provider: ProjectPlanIntegrationId;
  enabled: boolean;
  settings: Omit<ProjectPlanIntegrationSettings, "token">;
  encryptedToken?: string;
};

/** An account available for use as a plan source, shown in the source dropdown. */
export type AvailableAccount = {
  accountId: string;
  label: string; // e.g. "GitHub — My Work Account"
  provider: ProjectPlanIntegrationId;
};

export type FsBrowseEntry = { name: string; isDir: boolean };
export type FsBrowseResult = {
  path: string;
  parent: string | null;
  entries: FsBrowseEntry[];
  sep: string;
};

/** Plugin config from openclaw.plugin.json. */
export type ProjectPlanPluginConfig = {
  maxLogEntries?: number;
  itemTimeoutMinutes?: number;
  /** "off" (default) preserves titles; "mask" strips PII and truncates for plan.logs. */
  logSanitizeMode?: "off" | "mask";
  /** Max chars kept when logSanitizeMode is "mask". */
  logSanitizeMaxTitleChars?: number;
  /** Max retry attempts for transient overload errors per item (default: 2). */
  overloadMaxRetries?: number;
  /** Base delay in ms for exponential backoff between overload retries (default: 2000). */
  overloadRetryBaseDelayMs?: number;
  /** Upper bound for transient-capacity wait time in ms (default: 120000). */
  transientCapacityMaxDelayMs?: number;
  /** Provider base URL overrides. Falls back to built-in defaults when omitted. */
  providerBaseUrls?: {
    github?: string;
    gitlab?: string;
    jira?: string;
    azure?: string;
  };
  /** Absolute roots that /api/fs/browse is allowed to surface. Empty = unrestricted (legacy). */
  fsBrowseAllowedRoots?: string[];
  /** Shared secrets for inbound provider webhooks. When unset, webhooks for that provider are rejected. */
  webhookSecrets?: {
    github?: string;
    gitlab?: string;
    jira?: string;
    azureUser?: string;
    azurePassword?: string;
  };
};

/** Convenience: all statuses as an array for building counts records. */
export const ALL_STATUSES: ProjectPlanStatus[] = [
  "to do",
  "in progress",
  "blocked",
  "done",
  "failed",
  "cancelled",
];

/** Build a zeroed counts record. */
export function zeroCounts(): Record<ProjectPlanStatus, number> {
  return Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<
    ProjectPlanStatus,
    number
  >;
}
