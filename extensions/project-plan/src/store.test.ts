import { describe, expect, it } from "vitest";
import { importItemsFromPayload } from "./store.js";

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
