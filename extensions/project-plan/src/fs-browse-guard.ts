// ── Directory browsing guard ─────────────────────────────────────────────────
//
// Hardens the /api/fs/browse endpoint against obviously unsafe inputs:
//   * null bytes (path injection)
//   * excessively long inputs
//   * paths escaping the allowed root prefixes (when configured)
//
// The endpoint is already plugin-auth-gated, so this is defense in depth rather
// than a primary authorization layer. On-prem deployments that want stricter
// confinement can set `fsBrowseAllowedRoots` to a short list of project roots.

import path from "node:path";

export type BrowseGuardOptions = {
  /** When provided, the resolved path must live under one of these roots. */
  allowedRoots?: string[];
  /** Maximum byte length of the raw requested path. */
  maxRequestedPathLength?: number;
};

export type GuardDecision =
  | { ok: true; resolved: string }
  | { ok: false; reason: string; status: number };

const DEFAULT_MAX_PATH_LENGTH = 4096;

export function guardBrowsePath(
  requestedPath: string,
  fallbackHome: string,
  options?: BrowseGuardOptions,
): GuardDecision {
  const maxLen = options?.maxRequestedPathLength ?? DEFAULT_MAX_PATH_LENGTH;

  if (typeof requestedPath !== "string") {
    return { ok: false, reason: "path must be a string", status: 400 };
  }
  if (requestedPath.length > maxLen) {
    return { ok: false, reason: "path too long", status: 400 };
  }
  if (requestedPath.includes("\0")) {
    return { ok: false, reason: "null byte in path", status: 400 };
  }

  const resolved = requestedPath ? path.resolve(requestedPath) : fallbackHome;

  const roots = (options?.allowedRoots ?? [])
    .map((root) => (typeof root === "string" ? path.resolve(root) : ""))
    .filter(Boolean);

  if (roots.length > 0 && !isWithinAnyRoot(resolved, roots)) {
    return { ok: false, reason: "path is outside allowed roots", status: 403 };
  }

  return { ok: true, resolved };
}

export function isWithinAnyRoot(candidate: string, roots: string[]): boolean {
  const normalized = path.resolve(candidate);
  return roots.some((root) => isWithinRoot(normalized, root));
}

export function isWithinRoot(candidate: string, root: string): boolean {
  const normalizedRoot = path.resolve(root);
  if (candidate === normalizedRoot) {
    return true;
  }
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : `${normalizedRoot}${path.sep}`;
  return candidate.startsWith(rootWithSep);
}
