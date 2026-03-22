import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importItemsFromPayload, listPlans, loadPlan } from "./store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

async function createTempStateDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "project-plan-store-"));
  tempDirs.push(dir);
  return dir;
}

describe("project-plan importItemsFromPayload", () => {
  it("preserves epic-task-subtask hierarchy", () => {
    const items = importItemsFromPayload({
      items: [
        {
          title: "Platform",
          type: "epic",
          children: [
            {
              title: "Build ingestion pipeline",
              type: "task",
              children: [{ title: "Add queue worker", type: "subtask" }],
            },
          ],
        },
      ],
    });

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.type)).toEqual(["epic", "task", "subtask"]);
    expect(items[1]?.parentId).toBe(items[0]?.id);
    expect(items[2]?.parentId).toBe(items[1]?.id);
    expect(items.map((item) => item.order)).toEqual([0, 1, 2]);
  });

  it("infers a valid hierarchy when types are missing or too deep", () => {
    const items = importItemsFromPayload({
      items: [
        {
          title: "Release readiness",
          children: [
            {
              title: "QA signoff",
              type: "epic",
              children: [{ title: "Regression pass", type: "task" }],
            },
          ],
        },
      ],
    });

    expect(items.map((item) => item.type)).toEqual(["epic", "task", "subtask"]);
  });

  it("folds critical metadata fields into description", () => {
    const items = importItemsFromPayload({
      items: [
        {
          title: "Checkout flow",
          type: "task",
          acceptanceCriteria: ["Card payment works", "3DS fallback handled"],
          knownGaps: ["Fraud scoring is out of scope"],
          designPrinciples: ["Keep retries idempotent"],
          scopeBoundaries: {
            inScope: ["Card payments"],
            outOfScope: ["Refund workflow"],
          },
        },
      ],
    } as never);

    expect(items[0]?.description).toContain("Acceptance Criteria:");
    expect(items[0]?.description).toContain("Card payment works");
    expect(items[0]?.description).toContain("Known Gaps:");
    expect(items[0]?.description).toContain("Design Principles:");
    expect(items[0]?.description).toContain("Scope Boundaries:");
  });

  it("keeps both base description and extra metadata", () => {
    const items = importItemsFromPayload({
      items: [
        {
          title: "Platform",
          type: "epic",
          description: "Primary delivery track",
          notes: "Keep the rollout behind a flag",
        },
      ],
    } as never);

    expect(items[0]?.description).toContain("Primary delivery track");
    expect(items[0]?.description).toContain("Notes: Keep the rollout behind a flag");
  });

  it("rejects payloads that contain non-object items", () => {
    expect(() =>
      importItemsFromPayload({
        items: ["not-an-item"] as never,
      }),
    ).toThrow("Imported items must be objects");
  });

  it("rejects payloads that do not contain non-empty titles", () => {
    expect(() =>
      importItemsFromPayload({
        items: [{ title: "   " }],
      }),
    ).toThrow("Each imported item must include a non-empty title.");
  });
});

describe("project-plan list/load normalization", () => {
  it("lists legacy plan files even when settings are missing", async () => {
    const stateDir = await createTempStateDir();
    const plansDir = path.join(stateDir, "plugins", "project-plan", "plans");
    await fs.mkdir(plansDir, { recursive: true });

    const legacyPlan = {
      id: "legacy-1",
      name: "Legacy Plan",
      status: "in progress",
      createdAt: Date.now() - 10_000,
      updatedAt: Date.now() - 5_000,
      items: [],
      logs: [],
    };

    await fs.writeFile(
      path.join(plansDir, "legacy-1.json"),
      `${JSON.stringify(legacyPlan)}\n`,
      "utf8",
    );

    const plans = await listPlans(stateDir);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.id).toBe("legacy-1");
    expect(plans[0]?.settings.source).toBe("local");
    expect(plans[0]?.settings.syncMode).toBe("manual");
    expect(plans[0]?.execution.running).toBe(false);

    const loaded = await loadPlan(stateDir, "legacy-1");
    expect(loaded?.id).toBe("legacy-1");
    expect(loaded?.settings.source).toBe("local");
  });
});
