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

    const result = await fetchGitHubItems({
      token: "gh-token",
      settings: { owner: "openclaw", repo: "openclaw" },
      planSettings: { source: "github", syncMode: "manual" },
    });

    expect(result.items).toHaveLength(1);
    expect(result.partial).toBeFalsy();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("sort=created");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("direction=asc");
  });

  it("marks partial when a later page fails after the first succeeded", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            Array.from({ length: 100 }, (_, i) => ({
              number: i + 1,
              title: `Issue ${i + 1}`,
              body: null,
              state: "open",
              labels: [],
            })),
          ),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("server down", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGitHubItems({
      token: "gh-token",
      settings: { owner: "openclaw", repo: "openclaw" },
      planSettings: { source: "github", syncMode: "manual" },
    });

    expect(result.items).toHaveLength(100);
    expect(result.partial).toBe(true);
    expect(result.errors?.[0]).toContain("500");
  });

  it("respects plugin-config base URL override", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchGitHubItems({
      token: "gh-token",
      settings: { owner: "openclaw", repo: "openclaw" },
      planSettings: { source: "github", syncMode: "manual" },
      pluginConfig: { providerBaseUrls: { github: "https://ghe.corp.local/api/v3" } },
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("https://ghe.corp.local/api/v3");
  });
});
