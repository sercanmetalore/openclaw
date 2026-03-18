import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../config/sessions.js";
import { resolveSubagentFallbackOwnerAgentId } from "./agent-command.js";

describe("resolveSubagentFallbackOwnerAgentId", () => {
  it("returns current agent for non-subagent sessions", () => {
    const owner = resolveSubagentFallbackOwnerAgentId({
      sessionAgentId: "worker",
      sessionKey: "agent:worker:main",
    });

    expect(owner).toBe("worker");
  });

  it("returns current agent when subagent has no parent metadata", () => {
    const owner = resolveSubagentFallbackOwnerAgentId({
      sessionAgentId: "worker",
      sessionKey: "agent:worker:subagent:child",
    });

    expect(owner).toBe("worker");
  });

  it("inherits fallback owner from direct parent session", () => {
    const owner = resolveSubagentFallbackOwnerAgentId({
      sessionAgentId: "worker",
      sessionKey: "agent:worker:subagent:child",
      sessionEntry: { spawnedBy: "agent:main:main" } as SessionEntry,
    });

    expect(owner).toBe("main");
  });

  it("walks subagent ancestry and resolves root owner when available", () => {
    const sessionStore: Record<string, SessionEntry> = {
      "agent:review:subagent:l2": { spawnedBy: "agent:main:subagent:l1" } as SessionEntry,
      "agent:main:subagent:l1": { spawnedBy: "agent:main:main" } as SessionEntry,
    };

    const owner = resolveSubagentFallbackOwnerAgentId({
      sessionAgentId: "review",
      sessionKey: "agent:review:subagent:child",
      sessionEntry: { spawnedBy: "agent:review:subagent:l2" } as SessionEntry,
      sessionStore,
    });

    expect(owner).toBe("main");
  });

  it("avoids infinite loops in malformed ancestry", () => {
    const sessionStore: Record<string, SessionEntry> = {
      "agent:main:subagent:a": { spawnedBy: "agent:main:subagent:b" } as SessionEntry,
      "agent:main:subagent:b": { spawnedBy: "agent:main:subagent:a" } as SessionEntry,
    };

    const owner = resolveSubagentFallbackOwnerAgentId({
      sessionAgentId: "worker",
      sessionKey: "agent:worker:subagent:child",
      sessionEntry: { spawnedBy: "agent:main:subagent:a" } as SessionEntry,
      sessionStore,
    });

    expect(owner).toBe("main");
  });
});
