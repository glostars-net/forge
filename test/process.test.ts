import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runOpenCode } from "../src/opencode";

const temporary: string[] = [];
const originalPath = process.env.PATH;
afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("worker process watchdog", () => {
  test("skips a model that goes silent", async () => {
    const directory = await mkdtemp(join(process.cwd(), ".test-tmp-process-"));
    temporary.push(directory);
    const fake = join(directory, "opencode");
    await writeFile(fake, "#!/bin/sh\necho '{\"type\":\"step_start\",\"sessionID\":\"ses_quiet\",\"part\":{}}'\nexec sleep 5\n");
    await chmod(fake, 0o755);
    process.env.PATH = `${directory}:${originalPath}`;
    const started = Date.now();
    const result = await runOpenCode({ seat: "forge", model: "nvidia/test", prompt: "work", project: directory, timeoutMs: 500 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("unavailable");
    expect(result.sessionID).toBe("ses_quiet");
    expect(result.error).toContain("inactive");
  });

  test("caps total stage time even when the model keeps emitting events", async () => {
    const directory = await mkdtemp(join(process.cwd(), ".test-tmp-process-"));
    temporary.push(directory);
    const fake = join(directory, "opencode");
    await writeFile(fake, "#!/bin/sh\nwhile true; do echo '{\"type\":\"step_start\",\"sessionID\":\"ses_loop\",\"part\":{}}'; sleep 0.05; done\n");
    await chmod(fake, 0o755);
    process.env.PATH = `${directory}:${originalPath}`;
    const started = Date.now();
    const result = await runOpenCode({ seat: "forge", model: "nvidia/test", prompt: "work", project: directory, timeoutMs: 1_000, maxDurationMs: 200 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("unavailable");
    expect(result.error).toContain("exceeded");
  });
});
