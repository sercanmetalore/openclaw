import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAuditEntriesForDay, recordAuditEvent } from "./audit.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-plan-audit-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("recordAuditEvent", () => {
  it("creates the audit directory and appends a JSONL entry", async () => {
    const now = new Date("2026-04-18T10:00:00Z");
    await recordAuditEvent({
      stateDir: tmp,
      event: { type: "plan.created", planId: "p1", planName: "Test", source: "local" },
      actor: "sercan@metalore.ai",
      now,
    });

    const entries = await readAuditEntriesForDay(tmp, "2026-04-18");
    expect(entries).toHaveLength(1);
    expect(entries[0].actor).toBe("sercan@metalore.ai");
    expect(entries[0].event.type).toBe("plan.created");
  });

  it("appends multiple entries in order", async () => {
    const day = new Date("2026-04-18T00:00:00Z");
    await recordAuditEvent({
      stateDir: tmp,
      event: { type: "plan.execution.started", planId: "p1" },
      now: day,
    });
    await recordAuditEvent({
      stateDir: tmp,
      event: {
        type: "plan.execution.stopped",
        planId: "p1",
        reason: "completed",
      },
      now: new Date(day.getTime() + 1000),
    });

    const entries = await readAuditEntriesForDay(tmp, "2026-04-18");
    expect(entries.map((e) => e.event.type)).toEqual([
      "plan.execution.started",
      "plan.execution.stopped",
    ]);
    expect(entries[1].ts).toBeGreaterThan(entries[0].ts);
  });

  it("splits entries by UTC day", async () => {
    await recordAuditEvent({
      stateDir: tmp,
      event: { type: "plan.created", planId: "p1", planName: "A", source: "local" },
      now: new Date("2026-04-18T23:59:59Z"),
    });
    await recordAuditEvent({
      stateDir: tmp,
      event: { type: "plan.created", planId: "p2", planName: "B", source: "local" },
      now: new Date("2026-04-19T00:00:01Z"),
    });

    const day1 = await readAuditEntriesForDay(tmp, "2026-04-18");
    const day2 = await readAuditEntriesForDay(tmp, "2026-04-19");
    expect(day1).toHaveLength(1);
    expect(day2).toHaveLength(1);
  });

  it("returns [] when the file does not exist", async () => {
    const entries = await readAuditEntriesForDay(tmp, "2026-01-01");
    expect(entries).toEqual([]);
  });

  it("skips malformed lines rather than failing the read", async () => {
    const day = new Date("2026-04-18T00:00:00Z");
    await recordAuditEvent({
      stateDir: tmp,
      event: { type: "plan.deleted", planId: "p1" },
      now: day,
    });
    const file = path.join(tmp, "audit", "2026-04-18.jsonl");
    await fs.appendFile(file, "this is not json\n");
    await recordAuditEvent({
      stateDir: tmp,
      event: { type: "plan.deleted", planId: "p2" },
      now: new Date(day.getTime() + 5000),
    });

    const entries = await readAuditEntriesForDay(tmp, "2026-04-18");
    expect(entries).toHaveLength(2);
  });

  it("never throws when the target directory is read-only", async () => {
    // Point stateDir at a path that cannot be created (a file).
    const blocker = path.join(tmp, "blocker");
    await fs.writeFile(blocker, "x");
    await expect(
      recordAuditEvent({
        stateDir: blocker,
        event: { type: "plan.deleted", planId: "p1" },
      }),
    ).resolves.toBeUndefined();
  });
});
