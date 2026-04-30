// ── Append-only audit log ────────────────────────────────────────────────────
//
// For BDDK / KVKK compliance we need a tamper-evident trail of plan mutations
// and provider sync operations that cannot be clobbered by the normal plan log
// rotation. The file is plain JSONL so SIEM tooling (Splunk, ELK, OpenSearch)
// can ingest it without bespoke parsers.
//
// * One file per day under <stateDir>/audit/YYYY-MM-DD.jsonl
// * Each line is a JSON object with monotonic `ts`, `actor`, `event`, `planId`
// * Writes are append + fsync-ish (fs.promises.appendFile is atomic per line
//   on POSIX up to PIPE_BUF). Do not rotate or truncate existing files.

import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectPlanSource, ProjectPlanStatus } from "./types.js";

export type AuditEvent =
  | {
      type: "plan.created";
      planId: string;
      planName: string;
      source: ProjectPlanSource;
    }
  | {
      type: "plan.deleted";
      planId: string;
    }
  | {
      type: "plan.execution.started";
      planId: string;
    }
  | {
      type: "plan.execution.stopped";
      planId: string;
      reason: "user" | "shutdown" | "completed" | "blocked";
    }
  | {
      type: "plan.item.status";
      planId: string;
      itemId: string;
      from: ProjectPlanStatus;
      to: ProjectPlanStatus;
    }
  | {
      type: "provider.sync";
      planId: string;
      source: ProjectPlanSource;
      direction: "pull" | "push";
      added?: number;
      updated?: number;
      partial?: boolean;
      errorCount?: number;
    }
  | {
      type: "integration.token.set";
      provider: ProjectPlanSource;
      accountId?: string;
    }
  | {
      type: "integration.token.removed";
      provider: ProjectPlanSource;
      accountId?: string;
    };

export type AuditEntry = {
  ts: number;
  actor?: string;
  event: AuditEvent;
};

function auditDir(stateDir: string): string {
  return path.join(stateDir, "audit");
}

function auditFileForDay(stateDir: string, date: Date): string {
  const iso = date.toISOString();
  const day = iso.slice(0, 10); // YYYY-MM-DD
  return path.join(auditDir(stateDir), `${day}.jsonl`);
}

/**
 * Append a single audit entry. Never throws — audit failures must not block
 * user-visible actions. Errors are swallowed because the alternative (failing
 * a plan mutation because the disk is read-only) is worse than a missing
 * audit row. The calling layer is expected to also emit a regular log line.
 */
export async function recordAuditEvent(params: {
  stateDir: string;
  event: AuditEvent;
  actor?: string;
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();
  const entry: AuditEntry = {
    ts: now.getTime(),
    actor: params.actor,
    event: params.event,
  };
  const file = auditFileForDay(params.stateDir, now);
  try {
    await fs.mkdir(auditDir(params.stateDir), { recursive: true, mode: 0o700 });
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch {
    // Intentionally swallow — audit is best-effort.
  }
}

/** Read all audit entries for a given ISO day string (YYYY-MM-DD). */
export async function readAuditEntriesForDay(
  stateDir: string,
  day: string,
): Promise<AuditEntry[]> {
  const file = path.join(auditDir(stateDir), `${day}.jsonl`);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const out: AuditEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as AuditEntry);
    } catch {
      // Skip malformed lines rather than fail the whole read.
    }
  }
  return out;
}
