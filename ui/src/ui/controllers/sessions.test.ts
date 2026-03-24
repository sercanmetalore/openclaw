import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteAllSessionsAndRefresh,
  deleteSession,
  deleteSessionAndRefresh,
  type SessionsState,
} from "./sessions.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

function createState(request: RequestFn, overrides: Partial<SessionsState> = {}): SessionsState {
  return {
    client: { request } as unknown as SessionsState["client"],
    connected: true,
    sessionsLoading: false,
    sessionsResult: null,
    sessionsError: null,
    sessionsFilterActive: "0",
    sessionsFilterLimit: "0",
    sessionsIncludeGlobal: true,
    sessionsIncludeUnknown: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleteSessionAndRefresh", () => {
  it("refreshes sessions after a successful delete", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.delete") {
        return { ok: true };
      }
      if (method === "sessions.list") {
        return undefined;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const deleted = await deleteSessionAndRefresh(state, "agent:main:test");

    expect(deleted).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, "sessions.delete", {
      key: "agent:main:test",
      deleteTranscript: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
    });
    expect(state.sessionsError).toBeNull();
    expect(state.sessionsLoading).toBe(false);
  });

  it("does not refresh sessions when user cancels delete", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request, { sessionsError: "existing error" });
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const deleted = await deleteSessionAndRefresh(state, "agent:main:test");

    expect(deleted).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(state.sessionsError).toBe("existing error");
    expect(state.sessionsLoading).toBe(false);
  });

  it("does not refresh sessions when delete fails and preserves the delete error", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.delete") {
        throw new Error("delete boom");
      }
      if (method === "sessions.list") {
        return undefined;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const deleted = await deleteSessionAndRefresh(state, "agent:main:test");

    expect(deleted).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("sessions.delete", {
      key: "agent:main:test",
      deleteTranscript: true,
    });
    expect(state.sessionsError).toContain("delete boom");
    expect(state.sessionsLoading).toBe(false);
  });
});

describe("deleteSession", () => {
  it("returns false when already loading", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request, { sessionsLoading: true });

    const deleted = await deleteSession(state, "agent:main:test");

    expect(deleted).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("deleteAllSessionsAndRefresh", () => {
  it("deletes only stale sessions and resets protected stale main sessions", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "sessions.list") {
        return {
          sessions: [
            { key: "agent:softdev:main", updatedAt: now - 2 * 60 * 60 * 1000 },
            { key: "agent:softdev:session-1", updatedAt: now - 90 * 60 * 1000 },
            { key: "agent:softdev:active", updatedAt: now - 10 * 60 * 1000 },
          ],
        };
      }
      if (method === "sessions.delete") {
        const key = (params as { key?: string } | undefined)?.key;
        if (key === "agent:softdev:main") {
          throw new Error("Cannot delete the main session");
        }
        return { ok: true };
      }
      if (method === "sessions.reset") {
        return { ok: true };
      }
      return undefined;
    });
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const cleared = await deleteAllSessionsAndRefresh(state);

    expect(cleared).toBe(2);
    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
      limit: 10000,
    });
    expect(request).toHaveBeenCalledWith("sessions.delete", {
      key: "agent:softdev:main",
      deleteTranscript: true,
      emitLifecycleHooks: false,
    });
    expect(request).toHaveBeenCalledWith("sessions.reset", {
      key: "agent:softdev:main",
      reason: "reset",
    });
    expect(request).toHaveBeenCalledWith("sessions.delete", {
      key: "agent:softdev:session-1",
      deleteTranscript: true,
      emitLifecycleHooks: false,
    });
    expect(request).not.toHaveBeenCalledWith("sessions.delete", {
      key: "agent:softdev:active",
      deleteTranscript: true,
      emitLifecycleHooks: false,
    });
    expect(request).toHaveBeenLastCalledWith("sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
    });
    expect(state.sessionsError).toBeNull();
    expect(state.sessionsLoading).toBe(false);
  });

  it("returns early when user cancels confirmation", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const cleared = await deleteAllSessionsAndRefresh(state);

    expect(cleared).toBe(0);
    expect(request).not.toHaveBeenCalled();
  });
});
