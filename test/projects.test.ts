import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { discoverProjects } from "../src/projects";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("project discovery", () => {
  test("lists the root repository and immediate child repositories only", async () => {
    const parent = await mkdtemp(join(process.cwd(), ".test-tmp-projects-"));
    temporary.push(parent);
    const root = join(parent, "projects");
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, "alpha", ".git"), { recursive: true });
    await mkdir(join(root, "not-a-repo"));
    await mkdir(join(root, "alpha", "nested", ".git"), { recursive: true });

    const projects = await discoverProjects([root]);
    expect(projects.map((project) => project.name)).toEqual(["projects", "alpha"]);
    expect(projects.map((project) => project.path)).toEqual([root, join(root, "alpha")]);
    expect(projects.every((project) => project.group === root)).toBe(true);
  });

  test("ignores inaccessible roots", async () => {
    expect(await discoverProjects(["/definitely/not/a/forge/project"])).toEqual([]);
  });
});
