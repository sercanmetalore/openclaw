import path from "node:path";
import { describe, expect, it } from "vitest";
import { guardBrowsePath, isWithinRoot } from "./fs-browse-guard.js";

const HOME = "/home/user";

describe("guardBrowsePath", () => {
  it("falls back to the home directory for an empty path", () => {
    const out = guardBrowsePath("", HOME);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.resolved).toBe(HOME);
  });

  it("rejects paths containing null bytes", () => {
    const out = guardBrowsePath("/etc/passwd\0/.ssh", HOME);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(400);
      expect(out.reason).toMatch(/null byte/);
    }
  });

  it("rejects excessively long paths", () => {
    const longPath = "/tmp/" + "a".repeat(5000);
    const out = guardBrowsePath(longPath, HOME);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(400);
  });

  it("flattens relative traversal attempts via path.resolve", () => {
    // Without allowlist, resolution is just path.resolve — dangerous but not forbidden.
    const out = guardBrowsePath("/home/user/../../etc/passwd", HOME);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.resolved).toBe("/etc/passwd");
  });

  it("enforces an allowlist when configured", () => {
    const out = guardBrowsePath("/etc/passwd", HOME, {
      allowedRoots: ["/home/user", "/var/projects"],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(403);
  });

  it("accepts paths inside the allowlist", () => {
    const target = path.join("/home/user", "workspace/app");
    const out = guardBrowsePath(target, HOME, {
      allowedRoots: ["/home/user"],
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.resolved).toBe(target);
  });

  it("does not let /home/usermalicious bypass the /home/user allowlist", () => {
    const out = guardBrowsePath("/home/usermalicious", HOME, {
      allowedRoots: ["/home/user"],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(403);
  });
});

describe("isWithinRoot", () => {
  it("returns true when the candidate equals the root", () => {
    expect(isWithinRoot("/home/user", "/home/user")).toBe(true);
  });

  it("returns true for nested paths", () => {
    expect(isWithinRoot("/home/user/app/src", "/home/user")).toBe(true);
  });

  it("returns false for sibling paths with shared prefix", () => {
    expect(isWithinRoot("/home/userother/file", "/home/user")).toBe(false);
  });

  it("returns false when the candidate is above the root", () => {
    expect(isWithinRoot("/home", "/home/user")).toBe(false);
  });
});
