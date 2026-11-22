import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "../src/cli";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("CLI arguments", () => {
  test("resolves a plan and project and enables headless mode", () => {
    expect(parseArgs(["plan.md", "--project", "../repo", "--headless"], "/work/app")).toEqual({
      plan: "/work/app/plan.md",
      project: "/work/repo",
      headless: true,
      resume: false,
      help: false,
    });
  });

  test("supports resuming without creating a new queue", () => {
    expect(parseArgs(["--resume", "--project", "/work/repo"], "/work/app")).toMatchObject({ resume: true, project: "/work/repo", plan: undefined });
  });

  test("rejects planning and resume together", () => {
    expect(() => parseArgs(["plan.md", "--resume"], "/work/app")).toThrow("resume");
  });

  test("opens a positional directory as the selected project", async () => {
    const directory = await mkdtemp(join(process.cwd(), ".test-tmp-cli-"));
    temporary.push(directory);
    expect(parseArgs([directory, "--headless"], "/work/app")).toMatchObject({ project: directory, plan: undefined, headless: true });
    expect(parseArgs(["--resume", directory], "/work/app")).toMatchObject({ project: directory, plan: undefined, resume: true });
  });

  test("opens the current directory as the selected project", () => {
    expect(parseArgs(["."], process.cwd())).toMatchObject({ project: process.cwd(), plan: undefined });
  });

  test("shows help", () => {
    expect(parseArgs(["--help"], "/work/app").help).toBe(true);
  });
});
