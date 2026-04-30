import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAzureItems } from "./azure.js";

describe("project-plan Azure provider ordering", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves WIQL created-order even when detail batch response is shuffled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ workItems: [{ id: 11 }, { id: 22 }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              {
                id: 22,
                fields: {
                  "System.Title": "Second item",
                  "System.WorkItemType": "Task",
                  "System.State": "New",
                },
              },
              {
                id: 11,
                fields: {
                  "System.Title": "First item",
                  "System.WorkItemType": "Task",
                  "System.State": "New",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAzureItems({
      token: "az-token",
      settings: { organization: "openclaw", project: "openclaw" },
      planSettings: { source: "azuredevops", syncMode: "manual" },
    });

    expect(result.items.map((item) => item.title)).toEqual(["First item", "Second item"]);
    expect(result.items.map((item) => item.order)).toEqual([0, 1]);
    expect(result.partial).toBeFalsy();
  });
});
