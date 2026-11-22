import { describe, expect, test } from "bun:test";
import { collabFrame, greetingFrame, spinnerFrame, starMark } from "../src/ascii";

describe("desk marks", () => {
  test("draws a static star", () => {
    expect(starMark()).toBe("  *\n* * *\n  *");
  });

  test("animates only active workers and freezes when motion is off", () => {
    expect(collabFrame([], 0, true)).toBe(collabFrame([], 4, true));
    expect(collabFrame([], 0, true)).toContain(".");
    expect(collabFrame(["smith"], 0, true)).toContain("smith");
    expect(collabFrame(["smith"], 0, true)).not.toBe(collabFrame(["smith"], 4, true));
    expect(collabFrame(["smith", "critic"], 2, true)).toContain("smith");
    expect(collabFrame(["smith", "critic"], 2, true)).toContain("critic");
    expect(collabFrame(["smith"], 4, false)).toBe(collabFrame(["smith"], 0, false));
  });
});

describe("terminal motion", () => {
  test("is deterministic and stops changing after 1.2 seconds", () => {
    expect(greetingFrame(0)).toBe(greetingFrame(0));
    expect(greetingFrame(0)).not.toBe(greetingFrame(600));
    expect(greetingFrame(1_200)).toBe(greetingFrame(5_000));
  });

  test("uses only the brightness ramp and a fixed grid", () => {
    const frame = greetingFrame(300, false, 12, 3);
    const lines = frame.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.length === 12)).toBe(true);
    expect(frame).toMatch(/^[ .:\-=+*#%@\n]+$/);
  });

  test("reduced motion is one static frame", () => {
    expect(greetingFrame(0, true)).toBe(greetingFrame(900, true));
    expect(spinnerFrame(0, false)).toBe("•");
    expect(spinnerFrame(1, false)).toBe("•");
  });

  test("the worker spinner ticks without changing layout", () => {
    expect(spinnerFrame(0, true)).toHaveLength(1);
    expect(spinnerFrame(1, true)).toHaveLength(1);
    expect(spinnerFrame(0, true)).not.toBe(spinnerFrame(1, true));
  });
});
