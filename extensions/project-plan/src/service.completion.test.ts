import { describe, expect, it } from "vitest";
import { classifyCompletion } from "./service.js";

describe("project-plan completion classification", () => {
  it("fails when assistant message is missing", () => {
    expect(classifyCompletion("")).toEqual({
      ok: false,
      reason: "No assistant completion message",
    });
  });

  it("fails when assistant message clearly indicates failure", () => {
    expect(classifyCompletion("I could not complete this due to permission denied.")).toEqual({
      ok: false,
      reason: "Agent response indicates the task could not be completed",
    });
  });

  it("treats non-failure assistant text as success", () => {
    expect(classifyCompletion("I updated the files and pushed the change.")).toEqual({ ok: true });
  });

  it("surfaces assistant runtime errors when completion message is missing", () => {
    expect(classifyCompletion("", { assistantErrorMessage: "Failed to extract accountId from token" })).toEqual({
      ok: false,
      reason: "Agent run error: Failed to extract accountId from token",
    });
  });
});
