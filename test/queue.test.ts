import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathsOverlap, readQueue, readyTasks, saveQueue, validateQueue, type PlanQueue } from "../src/queue";

const base = {
  version: 1,
  project: "/work/repo",
  plan: "/work/repo/plan.md",
  createdAt: "2026-11-19T00:00:00.000Z",
};

function task(id: string, files: string[] = [], dependsOn: string[] = []) {
  return { id, title: id, seat: "smith", files, prompt: `do ${id}`, dependsOn, status: "queued" };
}

describe("queue validation", () => {
  test("accepts a valid queue and fills optional fields", () => {
    const queue = validateQueue({ ...base, tasks: [task("one", ["src/a.ts"])] }, "/work/repo");
    expect(queue.tasks[0]).toMatchObject({ id: "one", status: "queued", skill: undefined, verify: undefined });
  });

  test("rejects a queue aimed at another project", () => {
    expect(() => validateQueue({ ...base, tasks: [task("one")] }, "/other/repo")).toThrow("project");
  });

  test("rejects duplicate ids, unknown dependencies, and cycles", () => {
    expect(() => validateQueue({ ...base, tasks: [task("one"), task("one")] }, base.project)).toThrow("duplicate");
    expect(() => validateQueue({ ...base, tasks: [task("one", [], ["missing"])] }, base.project)).toThrow("dependency");
    expect(() => validateQueue({ ...base, tasks: [task("one", [], ["two"]), task("two", [], ["one"])] }, base.project)).toThrow("cycle");
  });

  test("rejects absolute and parent-escaping file paths", () => {
    expect(() => validateQueue({ ...base, tasks: [task("one", ["/etc/passwd"])] }, base.project)).toThrow("file");
    expect(() => validateQueue({ ...base, tasks: [task("one", ["../outside"])] }, base.project)).toThrow("file");
  });
});

describe("queue persistence", () => {
  const temporary: string[] = [];
  afterEach(async () => {
    await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  test("preserves done tasks and requeues interrupted work on resume", async () => {
    const project = await mkdtemp(join(process.cwd(), ".test-tmp-queue-"));
    temporary.push(project);
    const queue = validateQueue({ ...base, project, tasks: [task("one"), task("two")] }, project);
    queue.tasks[0]!.status = "done";
    queue.tasks[1]!.status = "running";
    await saveQueue(queue);
    const resumed = await readQueue(project);
    expect(resumed.tasks.map((task) => task.status)).toEqual(["done", "queued"]);
  });
});

describe("ready tasks", () => {
  test("waits for dependencies and skips file overlaps with running tasks", () => {
    const queue = validateQueue({
      ...base,
      tasks: [task("first", ["src/shared.ts"]), task("second", ["src/shared.ts"]), task("third", ["src/other.ts"], ["first"])],
    }, base.project) as PlanQueue;
    queue.tasks[0]!.status = "running";
    expect(readyTasks(queue)).toEqual([]);
    queue.tasks[0]!.status = "done";
    expect(readyTasks(queue).map((item) => item.id)).toEqual(["second", "third"]);
  });

  test("an unknown file scope cannot run beside another writer", () => {
    expect(pathsOverlap([], ["src/a.ts"])).toBe(true);
    expect(pathsOverlap(["src"], ["src/a.ts"])).toBe(true);
    expect(pathsOverlap(["src/a.ts"], ["src/b.ts"])).toBe(false);
  });
});
