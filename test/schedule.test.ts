import { describe, expect, test } from "bun:test";
import { choose, criticSeat, initialSeat, modelRef, type ModelTier } from "../src/schedule";

const kimi: ModelTier = {
  model: "nvidia/moonshotai/kimi-k3.1-pro",
  efforts: ["max", "high", "low"],
  preferred: "high",
};
const grokBuild: ModelTier = { model: "xai/grok-build-0.1", efforts: [], preferred: null };
const grok: ModelTier = {
  model: "xai/grok-4.7",
  efforts: ["xhigh", "high", "medium", "low"],
  preferred: "high",
};
const tiers = [kimi, grokBuild, grok];

describe("model and effort scheduling", () => {
  test("starts Kimi at high effort", () => {
    const state = initialSeat(tiers);
    const decision = choose(tiers, state, { type: "quota", remainingPercent: 80 }, 1_000);
    expect(decision.action).toBe("dispatch");
    expect(modelRef(decision)).toBe("nvidia/moonshotai/kimi-k3.1-pro#high");
  });

  test("drops one effort step on a soft limit before switching models", () => {
    const decision = choose(tiers, initialSeat(tiers), { type: "soft-limit" }, 1_000);
    expect(decision.action).toBe("dispatch");
    expect(modelRef(decision)).toBe("nvidia/moonshotai/kimi-k3.1-pro#low");
    expect(decision.seat.limited[0]).toBe(false);
  });

  test("switches to Grok Build after Kimi reaches its lowest effort", () => {
    const state = initialSeat(tiers);
    state.effortIndex = 2;
    const decision = choose(tiers, state, { type: "quota", remainingPercent: 12 }, 1_000);
    expect(decision.action).toBe("dispatch");
    expect(decision.model).toBe("xai/grok-build-0.1");
    expect(decision.effort).toBeNull();
    expect(decision.seat.limited[0]).toBe(true);
  });

  test("a hard limit switches immediately and starts the next model at its preferred effort", () => {
    const state = initialSeat(tiers);
    state.modelIndex = 1;
    const decision = choose(tiers, state, { type: "hard-limit", resetAt: 50_000 }, 1_000);
    expect(decision.action).toBe("dispatch");
    expect(modelRef(decision)).toBe("xai/grok-4.7#high");
    expect(decision.seat.resetAt[1]).toBe(50_000);
  });

  test("an unavailable model is skipped", () => {
    const decision = choose(tiers, initialSeat(tiers), { type: "unavailable" }, 1_000);
    expect(decision.model).toBe("xai/grok-build-0.1");
    expect(decision.action).toBe("dispatch");
  });

  test("a context error compacts without changing model or effort", () => {
    const decision = choose(tiers, initialSeat(tiers), { type: "context" }, 1_000);
    expect(decision.action).toBe("compact");
    expect(modelRef(decision)).toBe("nvidia/moonshotai/kimi-k3.1-pro#high");
  });

  test("an exhausted roster waits for the earliest known reset", () => {
    const state = initialSeat(tiers);
    state.modelIndex = 2;
    state.limited = [true, true, false];
    state.resetAt = [80_000, 60_000, undefined];
    const decision = choose(tiers, state, { type: "hard-limit", resetAt: 90_000 }, 1_000);
    expect(decision.action).toBe("wait");
    expect(decision.waitUntil).toBe(60_000);
  });

  test("an exhausted unavailable chain stops instead of retrying dead models", () => {
    const state = initialSeat(tiers);
    state.modelIndex = 2;
    state.limited = [true, true, false];
    const decision = choose(tiers, state, { type: "unavailable" }, 1_000);
    expect(decision.action).toBe("stop");
  });

  test("an exhausted roster with unknown resets waits five minutes", () => {
    const state = initialSeat(tiers);
    state.modelIndex = 2;
    state.limited = [true, true, false];
    const decision = choose(tiers, state, { type: "hard-limit" }, 1_000);
    expect(decision.action).toBe("wait");
    expect(decision.waitUntil).toBe(301_000);
  });
});

describe("critic family selection", () => {
  test("a Kimi author is reviewed by Grok", () => {
    const state = criticSeat(tiers, kimi.model);
    expect(tiers[state.modelIndex]!.model).toBe(grokBuild.model);
  });

  test("a Grok author is reviewed by Kimi", () => {
    const state = criticSeat(tiers, grok.model);
    expect(tiers[state.modelIndex]!.model).toBe(kimi.model);
  });
});
