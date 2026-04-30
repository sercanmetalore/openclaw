import { describe, expect, it, vi } from "vitest";
import { createItem } from "../store.js";
import { syncFromProvider } from "./index.js";

vi.mock("./github.js", () => ({
  fetchGitHubItems: vi.fn(),
  pushGitHubItems: vi.fn(),
}));

describe("project-plan provider sync ordering", () => {
  it("updates existing item order from provider data during sync", async () => {
    const github = await import("./github.js");
    vi.mocked(github.fetchGitHubItems).mockResolvedValueOnce({
      items: [
        createItem({
          title: "Older issue",
          type: "task",
          externalId: "1",
          order: 0,
        }),
        createItem({
          title: "Newer issue",
          type: "task",
          externalId: "2",
          order: 1,
        }),
      ],
    });

    const existingItems = [
      createItem({
        title: "Newer issue",
        type: "task",
        externalId: "2",
        order: 0,
      }),
      createItem({
        title: "Older issue",
        type: "task",
        externalId: "1",
        order: 1,
      }),
    ];

    const result = await syncFromProvider({
      source: "github",
      token: "gh-token",
      settings: { owner: "openclaw", repo: "openclaw" },
      planSettings: { source: "github", syncMode: "manual" },
      existingItems,
    });

    const older = result.items.find((item) => item.externalId === "1");
    const newer = result.items.find((item) => item.externalId === "2");
    expect(older?.order).toBe(0);
    expect(newer?.order).toBe(1);
  });
});
