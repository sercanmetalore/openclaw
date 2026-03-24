import { toNumber } from "../format.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { SessionsListResult } from "../types.ts";

const STALE_SESSION_WINDOW_MS = 60 * 60 * 1000;

export type SessionsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionsLoading: boolean;
  sessionsResult: SessionsListResult | null;
  sessionsError: string | null;
  sessionsFilterActive: string;
  sessionsFilterLimit: string;
  sessionsIncludeGlobal: boolean;
  sessionsIncludeUnknown: boolean;
};

export async function loadSessions(
  state: SessionsState,
  overrides?: {
    activeMinutes?: number;
    limit?: number;
    includeGlobal?: boolean;
    includeUnknown?: boolean;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.sessionsLoading) {
    return;
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  try {
    const includeGlobal = overrides?.includeGlobal ?? state.sessionsIncludeGlobal;
    const includeUnknown = overrides?.includeUnknown ?? state.sessionsIncludeUnknown;
    const activeMinutes = overrides?.activeMinutes ?? toNumber(state.sessionsFilterActive, 0);
    const limit = overrides?.limit ?? toNumber(state.sessionsFilterLimit, 0);
    const params: Record<string, unknown> = {
      includeGlobal,
      includeUnknown,
    };
    if (activeMinutes > 0) {
      params.activeMinutes = activeMinutes;
    }
    if (limit > 0) {
      params.limit = limit;
    }
    const res = await state.client.request<SessionsListResult | undefined>("sessions.list", params);
    if (res) {
      state.sessionsResult = res;
    }
  } catch (err) {
    state.sessionsError = String(err);
  } finally {
    state.sessionsLoading = false;
  }
}

export async function patchSession(
  state: SessionsState,
  key: string,
  patch: {
    label?: string | null;
    thinkingLevel?: string | null;
    fastMode?: boolean | null;
    verboseLevel?: string | null;
    reasoningLevel?: string | null;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const params: Record<string, unknown> = { key };
  if ("label" in patch) {
    params.label = patch.label;
  }
  if ("thinkingLevel" in patch) {
    params.thinkingLevel = patch.thinkingLevel;
  }
  if ("fastMode" in patch) {
    params.fastMode = patch.fastMode;
  }
  if ("verboseLevel" in patch) {
    params.verboseLevel = patch.verboseLevel;
  }
  if ("reasoningLevel" in patch) {
    params.reasoningLevel = patch.reasoningLevel;
  }
  try {
    await state.client.request("sessions.patch", params);
    await loadSessions(state);
  } catch (err) {
    state.sessionsError = String(err);
  }
}

export async function deleteSession(state: SessionsState, key: string): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  if (state.sessionsLoading) {
    return false;
  }
  const confirmed = window.confirm(
    `Delete session "${key}"?\n\nDeletes the session entry and archives its transcript.`,
  );
  if (!confirmed) {
    return false;
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  try {
    await state.client.request("sessions.delete", { key, deleteTranscript: true });
    return true;
  } catch (err) {
    state.sessionsError = String(err);
    return false;
  } finally {
    state.sessionsLoading = false;
  }
}

export async function deleteSessionAndRefresh(state: SessionsState, key: string): Promise<boolean> {
  const deleted = await deleteSession(state, key);
  if (!deleted) {
    return false;
  }
  await loadSessions(state);
  return true;
}

export async function deleteAllSessionsAndRefresh(state: SessionsState): Promise<number> {
  if (!state.client || !state.connected) {
    return 0;
  }
  if (state.sessionsLoading) {
    return 0;
  }

  const confirmed = window.confirm(
    "Clear all sessions?\n\nThis clears only sessions that were inactive for more than 1 hour. Active sessions are kept.",
  );
  if (!confirmed) {
    return 0;
  }

  state.sessionsLoading = true;
  state.sessionsError = null;

  let cleared = 0;
  const failures: string[] = [];
  try {
    const listRes = await state.client.request<SessionsListResult | undefined>("sessions.list", {
      includeGlobal: state.sessionsIncludeGlobal,
      includeUnknown: state.sessionsIncludeUnknown,
      limit: 10000,
    });

    const sessions = listRes?.sessions ?? state.sessionsResult?.sessions ?? [];
    const cutoff = Date.now() - STALE_SESSION_WINDOW_MS;
    const staleSessions = sessions.filter((row) => {
      if (typeof row.updatedAt !== "number") {
        return true;
      }
      return row.updatedAt < cutoff;
    });

    for (const row of staleSessions) {
      try {
        await state.client.request("sessions.delete", {
          key: row.key,
          deleteTranscript: true,
          emitLifecycleHooks: false,
        });
        cleared += 1;
      } catch {
        try {
          await state.client.request("sessions.reset", {
            key: row.key,
            reason: "reset",
          });
          cleared += 1;
        } catch (resetErr) {
          failures.push(`${row.key}: ${String(resetErr)}`);
        }
      }
    }
  } finally {
    state.sessionsLoading = false;
  }

  await loadSessions(state);
  if (failures.length > 0) {
    const preview = failures.slice(0, 3).join("; ");
    const extra = failures.length > 3 ? ` (+${failures.length - 3} more)` : "";
    state.sessionsError = `Cleared ${cleared} sessions; ${failures.length} failed: ${preview}${extra}`;
  }
  return cleared;
}
