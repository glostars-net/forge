import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SEATS = ["smith", "atelier", "critic", "scout", "prover", "scribe"] as const;
export type SeatName = (typeof SEATS)[number];
export type TaskStatus = "queued" | "running" | "repair" | "done" | "blocked";

export type QueueTask = {
  id: string;
  title: string;
  seat: SeatName;
  skill?: string;
  files: string[];
  prompt: string;
  verify?: string;
  dependsOn: string[];
  status: TaskStatus;
};

export type PlanQueue = {
  version: 1;
  project: string;
  plan: string;
  createdAt: string;
  tasks: QueueTask[];
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid queue: ${message}`);
}

export function validateQueue(input: unknown, project: string): PlanQueue {
  const raw = input as Partial<PlanQueue>;
  invariant(raw && raw.version === 1, "version must be 1");
  invariant(raw.project === project, `project must be ${project}`);
  invariant(typeof raw.plan === "string" && raw.plan.length > 0, "plan is required");
  invariant(typeof raw.createdAt === "string", "createdAt is required");
  invariant(Array.isArray(raw.tasks), "tasks must be an array");

  const ids = new Set<string>();
  const tasks = raw.tasks.map((item, index) => {
    const task = item as Partial<QueueTask>;
    invariant(typeof task.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(task.id), `task ${index + 1} has an invalid id`);
    invariant(!ids.has(task.id), `duplicate task id ${task.id}`);
    ids.add(task.id);
    invariant(typeof task.title === "string" && task.title.trim().length > 0, `${task.id} needs a title`);
    invariant(SEATS.includes(task.seat as SeatName), `${task.id} has an invalid seat`);
    invariant(typeof task.prompt === "string" && task.prompt.trim().length > 0, `${task.id} needs a prompt`);
    invariant(Array.isArray(task.files) && task.files.every((file) => typeof file === "string"), `${task.id} files must be strings`);
    for (const file of task.files!) {
      const normalized = file.replaceAll("\\", "/");
      invariant(normalized.length > 0 && !normalized.startsWith("/") && !normalized.split("/").includes(".."), `${task.id} has an unsafe file path`);
    }
    invariant(Array.isArray(task.dependsOn) && task.dependsOn.every((id) => typeof id === "string"), `${task.id} dependencies must be ids`);
    invariant(task.skill === undefined || typeof task.skill === "string", `${task.id} skill must be an id`);
    invariant(task.verify === undefined || typeof task.verify === "string", `${task.id} verify must be a command`);
    return {
      id: task.id,
      title: task.title,
      seat: task.seat as SeatName,
      skill: task.skill,
      files: task.files!,
      prompt: task.prompt,
      verify: task.verify,
      dependsOn: task.dependsOn!,
      status: "queued" as const,
    };
  });

  for (const task of tasks) {
    for (const dependency of task.dependsOn) invariant(ids.has(dependency), `${task.id} has an unknown dependency ${dependency}`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string) {
    if (visited.has(id)) return;
    invariant(!visiting.has(id), `dependency cycle at ${id}`);
    visiting.add(id);
    for (const dependency of tasks.find((task) => task.id === id)!.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of tasks) visit(task.id);

  return { version: 1, project, plan: raw.plan, createdAt: raw.createdAt, tasks };
}

function normalize(path: string) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

export function pathsOverlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return true;
  return left.some((a) => right.some((b) => {
    const first = normalize(a);
    const second = normalize(b);
    return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`);
  }));
}

export function readyTasks(queue: PlanQueue) {
  const done = new Set(queue.tasks.filter((task) => task.status === "done").map((task) => task.id));
  const running = queue.tasks.filter((task) => task.status === "running" || task.status === "repair");
  return queue.tasks.filter((task) =>
    task.status === "queued" &&
    task.dependsOn.every((id) => done.has(id)) &&
    running.every((other) => !pathsOverlap(task.files, other.files)),
  );
}

let saveChain: Promise<void> = Promise.resolve();

export function queuePath(project: string) {
  return join(project, ".opencode", "forge", "queue.json");
}

export function saveQueue(queue: PlanQueue) {
  const write = async () => {
    const path = queuePath(queue.project);
    await mkdir(join(path, ".."), { recursive: true });
    const temporary = `${path}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(queue, null, 2)}\n`);
    await rename(temporary, path);
  };
  saveChain = saveChain.then(write, write);
  return saveChain;
}

export async function readQueue(project: string): Promise<PlanQueue> {
  const raw = JSON.parse(await readFile(queuePath(project), "utf8")) as PlanQueue;
  const queue = validateQueue(raw, project);
  queue.tasks.forEach((task, index) => {
    const status = raw.tasks[index]?.status;
    if (status === "done" || status === "blocked") task.status = status;
  });
  return queue;
}
