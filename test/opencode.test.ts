import { describe, expect, test } from "bun:test";
import { classifyFailure, compactArgs, extractResetAt, openCodeArgs, parseRunOutput, quotaPercent, retryFailure } from "../src/opencode";

describe("CLI process arguments", () => {
  test("uses a private server so workers cannot restart the parent's shared service", () => {
    expect(openCodeArgs({ seat: "smith", model: "nvidia/moonshotai/kimi-k3.1-pro#high", prompt: "work", project: "/work" })).toEqual([
      "run", "--standalone", "--agent", "smith", "--model", "nvidia/moonshotai/kimi-k3.1-pro#high", "--format", "json", "work",
    ]);
  });
});

test("compaction also uses a private server", () => {
  expect(compactArgs("ses_test")).toEqual(["api", "--standalone", "post", "/api/session/ses_test/compact", "--data", "{}"]);
});

describe("OpenCode JSON run output", () => {
  test("collects the session id, assistant text, and token usage", () => {
    const output = [
      JSON.stringify({ type: "step_start", sessionID: "ses_test", part: { type: "step-start" } }),
      JSON.stringify({ type: "text", sessionID: "ses_test", part: { type: "text", text: "implemented" } }),
      JSON.stringify({ type: "step_finish", sessionID: "ses_test", part: { type: "step-finish", tokens: { input: 100, output: 20, reasoning: 3 } } }),
    ].join("\n");
    expect(parseRunOutput(output)).toEqual({
      sessionID: "ses_test",
      text: "implemented",
      tokens: { input: 100, output: 20, reasoning: 3 },
      error: undefined,
    });
  });

  test("keeps multiple text parts separate and ignores malformed lines", () => {
    const output = `not json\n${JSON.stringify({ type: "text", sessionID: "ses_a", part: { text: "one" } })}\n${JSON.stringify({ type: "text", sessionID: "ses_a", part: { text: "two" } })}`;
    expect(parseRunOutput(output).text).toBe("one\ntwo");
  });

  test("extracts provider errors", () => {
    const output = JSON.stringify({ type: "error", sessionID: "ses_err", error: { data: { message: "429 quota exceeded" } } });
    expect(parseRunOutput(output).error).toBe("429 quota exceeded");
  });

  test("aborts a provider rate-limit retry and preserves its retry time", () => {
    const event = { type: "retry", nextRetryAt: 50_000, error: { type: "provider.rate-limit", message: "Provider request failed with HTTP 429" } };
    expect(retryFailure(event)).toEqual({ failure: "hard-limit", error: "Provider request failed with HTTP 429", resetAt: 50_000 });
    expect(retryFailure({ type: "retry", error: { type: "network", message: "socket closed" } })).toBeNull();
    expect(parseRunOutput(JSON.stringify(event)).error).toBe("Provider request failed with HTTP 429");
  });
});

describe("failure classification", () => {
  test("recognizes rate and usage limits", () => {
    expect(classifyFailure("HTTP 429: rate limit reached")).toBe("hard-limit");
    expect(classifyFailure("weekly usage limit exhausted")).toBe("hard-limit");
    expect(classifyFailure("insufficient credits")).toBe("hard-limit");
  });

  test("distinguishes context limits from usage limits", () => {
    expect(classifyFailure("maximum context length exceeded")).toBe("context");
    expect(classifyFailure("prompt is too long for this model")).toBe("context");
  });

  test("distinguishes unavailable models from task failures", () => {
    expect(classifyFailure("model not found: nvidia/nope")).toBe("unavailable");
    expect(classifyFailure("provider is not configured")).toBe("unavailable");
    expect(classifyFailure("The model has reached its end of life and is no longer available (410)")).toBe("unavailable");
    expect(classifyFailure("test suite failed")).toBeNull();
    expect(classifyFailure("permission denied")).toBeNull();
  });
});

describe("quota payload", () => {
  test("uses the lowest remaining percentage in provider rows", () => {
    expect(quotaPercent({ providers: { xai: { rows: [{ value: { percentRemaining: 42 } }, { value: { percentRemaining: 12 } }] } } })).toBe(12);
  });

  test("reports unavailable quota as unknown", () => {
    expect(quotaPercent({ providers: {} })).toBeUndefined();
  });
});

describe("reset extraction", () => {
  test("reads retry-after seconds", () => {
    expect(extractResetAt("try again in 30 seconds", 1_000)).toBe(31_000);
  });

  test("reads an ISO reset time", () => {
    expect(extractResetAt("quota resets at 2026-11-20T01:02:03.000Z", 1_000)).toBe(Date.parse("2026-11-20T01:02:03.000Z"));
  });

  test("does not invent a reset", () => {
    expect(extractResetAt("429 rate limited", 1_000)).toBeUndefined();
  });
});
