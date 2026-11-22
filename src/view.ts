import type { Project } from "./projects";
import type { PlanQueue } from "./queue";

export type DeskViewState = {
  name: string;
  greeting: string;
  activeProject?: string;
  projects: Project[];
  skillCount: number;
  queue?: PlanQueue;
  logs: string[];
  active: string[];
};

export function projectLines(projects: Project[]) {
  return projects.length ? projects.map((project) => `${project.dirty ? "●" : "○"} ${project.name}  ${project.branch}`) : ["No repositories found"];
}

export function queueLines(queue?: PlanQueue) {
  if (!queue) return ["No queue", "forge <plan> --project <repo>"];
  const done = queue.tasks.filter((task) => task.status === "done").length;
  return [
    `${done}/${queue.tasks.length} done`,
    ...queue.tasks.map((task) => {
      const mark = task.status === "done" ? "✓" : task.status === "blocked" ? "×" : task.status === "queued" ? "·" : "›";
      return `${mark} ${task.id}  ${task.seat}`;
    }),
  ];
}

export function renderHeadless(state: DeskViewState) {
  const done = state.queue?.tasks.filter((task) => task.status === "done").length ?? 0;
  const total = state.queue?.tasks.length ?? 0;
  return [
    `Forge · ${state.name}`,
    state.greeting,
    ...(state.activeProject ? [`Project: ${state.activeProject}`] : []),
    `${state.skillCount} skills indexed`,
    "",
    "Projects",
    ...projectLines(state.projects),
    "",
    "Queue",
    ...(state.queue ? [`${done}/${total} done`, ...queueLines(state.queue).slice(1)] : queueLines()),
    "",
    "Active",
    ...(state.active.length ? state.active : ["idle"]),
    "",
    "Log",
    ...state.logs.slice(-8),
  ].join("\n");
}
