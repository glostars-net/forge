import { describe, expect, test } from "bun:test";
import { renderHeadless } from "../src/view";

describe("desk view", () => {
  test("greets aj and summarizes projects, skills, and queue state", () => {
    const text = renderHeadless({
      name: "aj",
      greeting: "Forge is ready.",
      activeProject: "/work/active",
      projects: [{ name: "pen", path: "/work/pen", group: "/work", branch: "main", dirty: true }],
      skillCount: 100,
      queue: { version: 1, project: "/work/pen", plan: "/work/pen/plan.md", createdAt: "now", tasks: [{ id: "one", title: "One", seat: "smith", files: ["src/a.ts"], prompt: "work", dependsOn: [], status: "done" }] },
      logs: ["one: done"],
      active: ["smith · nvidia/moonshotai/kimi-k3.1-pro#high"],
    });
    expect(text).toContain("aj");
    expect(text).toContain("Forge is ready.");
    expect(text).toContain("Project: /work/active");
    expect(text).toContain("pen");
    expect(text).toContain("100 skills");
    expect(text).toContain("1/1 done");
    expect(text).toContain("smith · nvidia/moonshotai/kimi-k3.1-pro#high");
  });
});
