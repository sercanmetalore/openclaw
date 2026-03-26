import { describe, expect, it } from "vitest";
import {
  classifyCompletion,
  isTransientOverloadCompletionReason,
  isTransientOverloadRunResult,
} from "./service.js";

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
    expect(
      classifyCompletion("", { assistantErrorMessage: "Failed to extract accountId from token" }),
    ).toEqual({
      ok: false,
      reason: "Agent run error: Failed to extract accountId from token",
    });
  });

  it("surfaces assistant yield/delegation completion errors when message is missing", () => {
    expect(
      classifyCompletion("", {
        assistantErrorMessage: "Assistant yielded before sending a completion message",
      }),
    ).toEqual({
      ok: false,
      reason: "Agent run error: Assistant yielded before sending a completion message",
    });
  });

  it("detects overloaded run result from JSON-encoded error payload", () => {
    expect(
      isTransientOverloadRunResult({
        status: "error",
        error:
          '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_123"}',
      }),
    ).toBe(true);
  });

  it("does not mark non-overload errors as transient overload", () => {
    expect(
      isTransientOverloadRunResult({
        status: "error",
        error: '{"type":"error","error":{"type":"bad_request","message":"Invalid request"}}',
      }),
    ).toBe(false);
  });

  it("detects overloaded completion reasons as transient", () => {
    expect(
      isTransientOverloadCompletionReason(
        'Agent run error: {"type":"error","error":{"details":null,"type":"overloaded_error","message":"Overloaded"}}',
      ),
    ).toBe(true);
  });

  it("detects 429 quota/capacity run errors as transient", () => {
    expect(
      isTransientOverloadRunResult({
        status: "error",
        error:
          "Cloud Code Assist API error (429): You have exhausted your capacity on this model. Your quota will reset after 58s.",
      }),
    ).toBe(true);
  });

  it("detects 429 quota/capacity completion reasons as transient", () => {
    expect(
      isTransientOverloadCompletionReason(
        "Agent run error: Cloud Code Assist API error (429): You have exhausted your capacity on this model. Your quota will reset after 58s.",
      ),
    ).toBe(true);
  });

  it("does not treat generic completion failures as transient overload", () => {
    expect(
      isTransientOverloadCompletionReason("Agent run error: permission denied while writing files"),
    ).toBe(false);
  });
});
