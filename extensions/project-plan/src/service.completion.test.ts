import { describe, expect, it } from "vitest";
import { classifyCompletion } from "./service.js";

describe("project-plan completion classification", () => {
  it("treats empty assistant message as soft success", () => {
    expect(classifyCompletion("")).toEqual({ ok: true, missingAssistantSummary: true });
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
});
