import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGitHubItems } from "./github.js";

describe("project-plan GitHub provider ordering", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests issues in ascending created order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { number: 1, title: "First issue", body: "body", state: "open", labels: [] },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const items = await fetchGitHubItems({
      token: "gh-token",
      settings: { owner: "openclaw", repo: "openclaw" },
      planSettings: { source: "github", syncMode: "manual" },
    });

    expect(items).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("sort=created");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("direction=asc");
  });
});
