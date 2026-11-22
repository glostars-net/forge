import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { planQueue, selectPlannerSkills } from "../src/planner";
import { readQueue } from "../src/queue";
import type { AgentRequest, AgentResult } from "../src/runner";
import type { SkillEntry } from "../src/skills";
import type { ModelTier } from "../src/schedule";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const model: ModelTier = { model: "nvidia/moonshotai/kimi-k3.1-pro", efforts: ["max", "high", "low"], preferred: "high" };
const tiers = { forge: [model], smith: [model], atelier: [model], critic: [model], scout: [model], prover: [model], scribe: [model] };
const skills: SkillEntry[] = [
  { id: "ponytail", description: "Small changes", path: "/skills/ponytail", manual: false },
  { id: "higgsfield-generate", description: "Media", path: "/skills/higgsfield-generate", manual: true },
  { id: "animate", description: "Motion", path: "/skills/animate", manual: false },
  { id: "ascii-animation", description: "ASCII motion", path: "/skills/ascii-animation", manual: false },
];

test("planner skill selection keeps motion skills relevant and media manual", () => {
  const selected = selectPlannerSkills("Draw a clean ASCII animation", skills);
  expect(selected.map((skill) => skill.id)).toContain("animate");
  expect(selected.map((skill) => skill.id)).toContain("ascii-animation");
  expect(selected.map((skill) => skill.id)).not.toContain("higgsfield-generate");
});

async function fixture(planText: string) {
  const project = await mkdtemp(join(process.cwd(), ".test-tmp-planner-"));
  temporary.push(project);
  const plan = join(project, "plan.md");
  await writeFile(plan, planText);
  return { project, plan };
}

function result(project: string, plan: string, tasks: unknown[], fenced = false): AgentResult {
  const json = JSON.stringify({ version: 1, project, plan, createdAt: "2026-11-19T00:00:00.000Z", tasks });
  return { ok: true, text: fenced ? `Here is the queue:\n\`\`\`json\n${json}\n\`\`\`` : json, sessionID: "ses_plan" };
}

describe("JSON-only planner", () => {
  test("parses the response, writes the queue, and drops unknown or unrequested manual skills", async () => {
    const { project, plan } = await fixture("# One task");
    const requests: AgentRequest[] = [];
    const executor = async (request: AgentRequest) => {
      requests.push(request);
      return result(project, plan, [
        { id: "one", title: "One", seat: "smith", skill: "not-installed", files: ["src/a.ts"], prompt: "work", dependsOn: [] },
        { id: "two", title: "Two", seat: "scribe", skill: "higgsfield-generate", files: ["README.md"], prompt: "docs", dependsOn: [] },
      ]);
    };
    const queue = await planQueue(plan, project, tiers, skills, executor, { log: () => {}, update: () => {}, compact: () => {} });
    expect(queue.tasks.map((task) => task.skill)).toEqual([undefined, undefined]);
    expect(requests[0]?.prompt).toContain("# One task");
    expect(requests[0]?.prompt).toContain("Do not use tools");
    expect(requests[0]?.prompt).not.toContain("higgsfield-generate: Media");
    expect((await readQueue(project)).tasks).toHaveLength(2);
  });

  test("accepts fenced JSON and allows a manual media skill named by the plan", async () => {
    const { project, plan } = await fixture("Use higgsfield-generate for the requested cover.");
    const requests: AgentRequest[] = [];
    const executor = async (request: AgentRequest) => {
      requests.push(request);
      return result(project, plan, [{ id: "one", title: "One", seat: "atelier", skill: "higgsfield-generate", files: ["README.md"], prompt: "cover", dependsOn: [] }], true);
    };
    const queue = await planQueue(plan, project, tiers, skills, executor, { log: () => {}, update: () => {}, compact: () => {} });
    expect(queue.tasks[0]?.skill).toBe("higgsfield-generate");
    expect(requests[0]?.prompt).toContain("higgsfield-generate: Media");
  });

  test("normalizes project metadata instead of trusting model output", async () => {
    const { project, plan } = await fixture("# Task");
    const executor = async () => result("/wrong/project", "/wrong/plan", [{ id: "one", title: "One", seat: "scout", files: ["plan.md"], prompt: "read", dependsOn: [] }]);
    const queue = await planQueue(plan, project, tiers, skills, executor, { log: () => {}, update: () => {}, compact: () => {} });
    expect(queue.project).toBe(project);
    expect(queue.plan).toBe(plan);
    expect(Number.isFinite(Date.parse(queue.createdAt))).toBe(true);
  });
});
