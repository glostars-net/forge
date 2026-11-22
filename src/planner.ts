import { readFile } from "node:fs/promises";
import { saveQueue, validateQueue } from "./queue";
import { runStage, type AgentExecutor, type RunnerHooks, type Tiers } from "./runner";
import type { SkillEntry } from "./skills";

const CORE_SKILLS = ["ponytail", "test-driven-development", "systematic-debugging", "verification-before-completion", "va-languages"];
const SKILL_RULES: Array<[RegExp, string[]]> = [
  [/ascii|animation|motion|\bui\b|css|design|frontend|interface/i, ["animate", "ascii-animation", "impeccable", "emil-design-eng", "interface-design", "apple-design", "good-css", "better-ui", "design-review", "web-savant"]],
  [/rust/i, ["rust-best-practices", "rust-machine"]],
  [/react native|expo|ios|swift|mobile/i, ["mobile-craft", "write-swift", "animate-expo", "vercel-react-native-skills"]],
  [/postgres|supabase/i, ["supabase", "supabase-postgres-best-practices"]],
  [/readme|changelog|documentation|agents\.md/i, ["writing-guidelines", "writing-for-agents", "va-product"]],
];

export function selectPlannerSkills(planText: string, skills: SkillEntry[]) {
  const selected = new Set<string>();
  for (const skill of skills) if (planText.toLowerCase().includes(skill.id.toLowerCase())) selected.add(skill.id);
  for (const id of CORE_SKILLS) selected.add(id);
  for (const [pattern, ids] of SKILL_RULES) {
    if (pattern.test(planText)) for (const id of ids) selected.add(id);
  }
  return skills.filter((skill) => selected.has(skill.id));
}

export async function planQueue(
  planPath: string,
  project: string,
  tiers: Tiers,
  skills: SkillEntry[],
  executor: AgentExecutor,
  hooks: RunnerHooks,
) {
  const planText = await readFile(planPath, "utf8");
  const createdAt = new Date().toISOString();
  const plannerSkills = selectPlannerSkills(planText, skills);
  const skillList = plannerSkills.map((skill) => `${skill.id}: ${skill.description}${skill.manual ? " (manual only)" : ""}`).join("\n");
  const prompt = `Convert the implementation plan below into a Forge queue. Return only the JSON object, with no markdown fence and no explanation. Do not use tools. Do not read or write files. Do not move the session. Do not recall past sessions.

The JSON shape is:
{
  "version": 1,
  "project": ${JSON.stringify(project)},
  "plan": ${JSON.stringify(planPath)},
  "createdAt": ${JSON.stringify(createdAt)},
  "tasks": [{
    "id": "short-unique-id",
    "title": "Task title",
    "seat": "smith | atelier | scout | scribe",
    "skill": "one installed skill id, only when needed",
    "files": ["relative/paths.ts"],
    "prompt": "that task only, with exact steps and values",
    "verify": "the exact verification command for a code task",
    "dependsOn": [],
    "status": "queued"
  }]
}

Use atelier for UI, motion, or visual design, scout for read-only research, scribe for markdown-only work, and smith for other implementation. Do not add prover or critic tasks; the desk runs those gates. Give every code task a verification command. Use dependsOn for real dependencies. Tasks with overlapping files must be dependent or sequential. Keep each prompt to one task. Do not implement the plan.

Installed skills relevant to this plan:
${skillList || "none"}

A manual-only skill may be assigned only when the plan explicitly names that skill. Do not spend media-generation credits otherwise.

PLAN:
${planText}`;
  const planned = await runStage("forge", tiers.forge, prompt, project, executor, hooks);
  if (!planned.result.ok) throw new Error(planned.result.error || "Planning failed");

  const text = planned.result.text.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Planner returned no JSON object");
  const raw = JSON.parse(text.slice(start, end + 1));
  raw.version = 1;
  raw.project = project;
  raw.plan = planPath;
  raw.createdAt = createdAt;
  const queue = validateQueue(raw, project);
  const installed = new Map(skills.map((skill) => [skill.id, skill]));
  for (const task of queue.tasks) {
    if (!task.skill) continue;
    const skill = installed.get(task.skill);
    if (!skill || (skill.manual && !planText.includes(task.skill))) {
      hooks.log(`${task.id}: dropping unrequested skill ${task.skill}`);
      task.skill = undefined;
    }
  }
  await saveQueue(queue);
  hooks.log(`forge: ${queue.tasks.length} tasks queued`);
  return queue;
}
