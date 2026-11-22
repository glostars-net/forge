import { describe, expect, test } from "bun:test";
import { validateTiers } from "../src/config";

const model = { model: "nvidia/moonshotai/kimi-k3.1-pro", efforts: ["max", "high", "low"], preferred: "high" };
const grok = { model: "xai/grok-4.7", efforts: ["xhigh", "high", "medium", "low"], preferred: "xhigh" };
const valid = { forge: [model, grok], smith: [model, grok], atelier: [model, grok], critic: [grok, model], scout: [model, grok], prover: [model, grok], scribe: [model, grok] };

describe("tier config", () => {
  test("accepts the seven seats on NVIDIA and xAI", () => {
    expect(validateTiers(valid).critic[0]?.preferred).toBe("xhigh");
  });

  test("rejects a disconnected provider", () => {
    expect(() => validateTiers({ ...valid, smith: [{ ...model, model: "anthropic/claude" }] })).toThrow("provider");
  });

  test("rejects a preferred effort the model does not have", () => {
    expect(() => validateTiers({ ...valid, smith: [{ ...model, preferred: "medium" }] })).toThrow("preferred");
  });

  test("rejects a missing seat", () => {
    expect(() => validateTiers({ ...valid, critic: [] })).toThrow("critic");
  });
});
