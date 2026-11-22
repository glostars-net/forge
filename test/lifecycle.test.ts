import { describe, expect, test } from "bun:test";
import { deskWork } from "../src/lifecycle";

describe("interactive desk lifecycle", () => {
  test("an idle desk stays open until q", async () => {
    let resolveQuit!: () => void;
    const quit = new Promise<void>((resolve) => { resolveQuit = resolve; });
    let finished = false;
    const work = deskWork(false, async () => "unexpected", quit);
    void work.then(() => { finished = true; });
    await Bun.sleep(10);
    expect(finished).toBe(false);
    resolveQuit();
    expect(await work).toBeUndefined();
  });

  test("a plan still runs without waiting for q", async () => {
    const work = deskWork(true, async () => "done", new Promise<void>(() => {}));
    expect(await work).toBe("done");
  });
});
