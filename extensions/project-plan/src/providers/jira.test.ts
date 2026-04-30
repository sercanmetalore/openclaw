import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJiraItems, pushJiraItems } from "./jira.js";

describe("project-plan Jira provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses JQL search results and respects hostUrl override", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          startAt: 0,
          maxResults: 100,
          total: 1,
          issues: [
            {
              id: "10001",
              key: "OC-1",
              fields: {
                summary: "First issue",
                description: null,
                status: { name: "To Do" },
                issuetype: { name: "Task" },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJiraItems({
      token: "jira-token",
      settings: { hostUrl: "https://acme.atlassian.net", projectKey: "OC" },
      planSettings: { source: "jira", syncMode: "manual" },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].externalId).toBe("OC-1");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("https://acme.atlassian.net");
  });

  it("pushes completed items through the first available 'done' transition", async () => {
    const fetchMock = vi
      .fn()
      // first call: list transitions
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            transitions: [
              { id: "11", name: "In Progress", to: { statusCategory: { key: "indeterminate" } } },
              { id: "31", name: "Done", to: { statusCategory: { key: "done" } } },
            ],
          }),
          { status: 200 },
        ),
      )
      // second call: perform the transition
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await pushJiraItems({
      token: "jira-token",
      settings: { hostUrl: "https://acme.atlassian.net", projectKey: "OC" },
      planSettings: { source: "jira", syncMode: "manual" },
      items: [
        {
          id: "local-1",
          type: "task",
          title: "done item",
          status: "done",
          order: 0,
          updatedAt: 0,
          externalId: "OC-1",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodyArg = fetchMock.mock.calls[1]?.[1]?.body as string;
    expect(JSON.parse(bodyArg)).toEqual({ transition: { id: "31" } });
  });

  it("skips push when no matching transition exists (misconfigured workflow)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          transitions: [
            { id: "11", name: "Start", to: { statusCategory: { key: "indeterminate" } } },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await pushJiraItems({
      token: "jira-token",
      settings: { hostUrl: "https://acme.atlassian.net" },
      planSettings: { source: "jira", syncMode: "manual", providerProjectId: "OC" },
      items: [
        {
          id: "local-1",
          type: "task",
          title: "done item",
          status: "done",
          order: 0,
          updatedAt: 0,
          externalId: "OC-42",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores items that are not in a terminal status", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await pushJiraItems({
      token: "jira-token",
      settings: { hostUrl: "https://acme.atlassian.net" },
      planSettings: { source: "jira", syncMode: "manual", providerProjectId: "OC" },
      items: [
        {
          id: "local-1",
          type: "task",
          title: "in progress item",
          status: "in progress",
          order: 0,
          updatedAt: 0,
          externalId: "OC-7",
        },
      ],
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
