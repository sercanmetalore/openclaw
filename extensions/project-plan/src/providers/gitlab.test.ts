import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGitLabItems } from "./gitlab.js";

describe("project-plan GitLab provider ordering", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests issues in ascending created order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { iid: 1, title: "First issue", description: "body", state: "opened" },
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

    const result = await fetchGitLabItems({
      token: "gl-token",
      settings: { project: "openclaw/openclaw" },
      planSettings: { source: "gitlab", syncMode: "manual" },
    });

    expect(result.items).toHaveLength(1);
    expect(result.partial).toBeFalsy();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("order_by=created_at");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("sort=asc");
  });
});
