import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { buildDesk } from "../src/desk";
import type { DeskViewState } from "../src/view";

const setups: TestRendererSetup[] = [];
afterEach(async () => {
  await Promise.all(setups.splice(0).map((setup) => setup.dispose()));
});

const state: DeskViewState = {
  name: "aj",
  greeting: "Forge is ready.",
  activeProject: "/work/active",
  projects: [{ name: "pen", path: "/work/pen", group: "/work", branch: "main", dirty: false }],
  skillCount: 100,
  queue: { version: 1, project: "/work/pen", plan: "/work/pen/plan.md", createdAt: "now", tasks: [{ id: "one", title: "One", seat: "smith", files: ["src/a.ts"], prompt: "work", dependsOn: [], status: "queued" }] },
  logs: ["waiting"],
  active: [],
};

describe("OpenTUI desk", () => {
  test("renders projects, queue, and skills and updates to done", async () => {
    const setup = await createTestRenderer({ width: 100, height: 30 });
    setups.push(setup);
    const desk = buildDesk(setup.renderer, state, { motion: false });
    await setup.renderOnce();
    const initial = setup.captureCharFrame();
    expect(initial).toContain("Forge is ready.");
    expect(initial).toContain("/work/active");
    expect(initial).toContain("100 skills");
    expect(initial).toContain("pen");
    expect(initial).toContain("0/1 done");

    desk.update({ ...state, active: ["smith · nvidia/moonshotai/kimi-k3.1-pro#high"], queue: { ...state.queue!, tasks: [{ ...state.queue!.tasks[0]!, status: "done" }] } });
    await setup.renderOnce();
    const updated = setup.captureCharFrame();
    expect(updated).toContain("1/1 done");
    expect(updated).toContain("kimi-k3.");
    expect(updated).toContain("1-pro#high");
  });

  test("moves the worker field only while a seat is active", async () => {
    const setup = await createTestRenderer({ width: 120, height: 32 });
    setups.push(setup);
    const desk = buildDesk(setup.renderer, state, { motion: true });
    await setup.renderOnce();
    const idle = setup.captureCharFrame();
    desk.tick();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toBe(idle);

    desk.update({ ...state, active: ["smith · model"] });
    await setup.renderOnce();
    const moving = setup.captureCharFrame();
    desk.tick();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toBe(moving);
    expect(setup.captureCharFrame()).toContain("smith");
    expect(setup.captureCharFrame()).toContain("critic");
  });

  test("q types and tab switches mode without animation", async () => {
    const setup = await createTestRenderer({ width: 100, height: 30 });
    setups.push(setup);
    let quit = 0;
    const desk = buildDesk(setup.renderer, state, { motion: false, onQuit: () => { quit++; } });
    setup.mockInput.pressKey("q");
    await setup.renderOnce();
    expect(quit).toBe(0);
    expect(setup.captureCharFrame()).toContain("PLAN");
    setup.mockInput.pressTab();
    await setup.renderOnce();
    const switched = setup.captureCharFrame();
    expect(switched).toContain("BUILD");
    expect(switched).toContain("0/1 done");
    expect(desk.mode()).toBe("build");
  });

  test("ctrl-c quits", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24, exitOnCtrlC: false });
    setups.push(setup);
    let quit = 0;
    buildDesk(setup.renderer, state, { motion: false, onQuit: () => { quit++; } });
    setup.mockInput.pressKey("c", { ctrl: true });
    expect(quit).toBe(1);
  });

  test("enter submits the box in the current mode", async () => {
    const setup = await createTestRenderer({ width: 120, height: 32 });
    setups.push(setup);
    const submitted: Array<[string, string]> = [];
    buildDesk(setup.renderer, state, { motion: false, onSubmit: (text, mode) => submitted.push([text, mode]) });
    await setup.mockInput.typeText("hi");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(submitted).toEqual([["hi", "plan"]]);
    expect(setup.captureCharFrame()).toContain("*");
    expect(setup.captureCharFrame()).not.toContain("AJ");
  });
});
