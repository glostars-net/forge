import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DeskConfig } from "../src/config";
import { applySetup, needsSetup, takeSetupAnswer, welcomeLine } from "../src/welcome";

const base = {
  name: "aj",
  greeting: "Forge is ready.",
  motion: true,
  concurrency: 2,
  idleTimeoutMs: 120_000,
  maxStageMs: 300_000,
  projectRoots: ["/old"],
  skillRoots: ["/skills"],
} satisfies DeskConfig;

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("first-run setup", () => {
  test("asks until setup is recorded", () => {
    expect(needsSetup(base)).toBe(true);
    expect(needsSetup({ ...base, setup: true })).toBe(false);
  });

  test("welcome lines stay stable and use the saved name", () => {
    expect(welcomeLine("aj", 0)).toBe(welcomeLine("aj", 0));
    expect(welcomeLine("aj", 0)).toContain("aj");
    expect(welcomeLine("aj", 1)).not.toBe(welcomeLine("aj", 0));
  });

  test("saves the name and project directories", async () => {
    const main = await mkdtemp(join(process.cwd(), ".test-tmp-setup-"));
    const extra = await mkdtemp(join(process.cwd(), ".test-tmp-setup-"));
    temporary.push(main, extra);
    const saved = applySetup(base, { name: "aj", main, extras: extra });
    expect(saved.setup).toBe(true);
    expect(saved.name).toBe("aj");
    expect(saved.projectRoots).toEqual([main, extra]);
    expect(applySetup(base, { name: "aj", main, extras: "" }).projectRoots).toEqual([main]);
  });

  test("rejects a main path that is not a directory", () => {
    expect(() => applySetup(base, { name: "aj", main: "/definitely/not/a/forge/dir", extras: "" })).toThrow("directory");
  });

  test("asks name, then a real directory, then optional extras", async () => {
    const main = await mkdtemp(join(process.cwd(), ".test-tmp-setup-"));
    temporary.push(main);
    const blank = takeSetupAnswer(0, "  ", base, { name: "", main: "" });
    expect(blank.step).toBe(0);
    expect(blank.error).toBeTruthy();

    const named = takeSetupAnswer(0, "aj", base, { name: "", main: "" });
    expect(named.step).toBe(1);

    const missing = takeSetupAnswer(1, "/definitely/not/a/forge/dir", base, named.answers);
    expect(missing.step).toBe(1);
    expect(missing.error).toContain("directory");

    const rooted = takeSetupAnswer(1, main, base, named.answers);
    expect(rooted.step).toBe(2);

    const done = takeSetupAnswer(2, "", base, rooted.answers);
    expect(done.step).toBe(3);
    expect(done.config?.setup).toBe(true);
    expect(done.config?.projectRoots).toEqual([main]);
  });
});
