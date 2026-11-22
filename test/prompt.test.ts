import { describe, expect, test } from "bun:test";
import { interpretPrompt } from "../src/prompt";

describe("desk prompt", () => {
  test("ignores an empty plan box and runs the queue from an empty build box", () => {
    expect(interpretPrompt("  ", "plan", "/work")).toEqual({ kind: "ignore" });
    expect(interpretPrompt("", "build", "/work")).toEqual({ kind: "build-queue" });
  });

  test("plans typed text and builds a markdown path or a one-line task", () => {
    expect(interpretPrompt("fix login", "plan", "/work")).toEqual({ kind: "plan", planPath: "/work/.opencode/forge/inbox.md" });
    expect(interpretPrompt("docs/plan.md", "build", "/work")).toEqual({ kind: "build-file", planPath: "/work/docs/plan.md" });
    expect(interpretPrompt("raise the timeout", "build", "/work")).toEqual({ kind: "build-text", title: "raise the timeout", prompt: "raise the timeout" });
  });
});
