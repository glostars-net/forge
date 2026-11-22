import type { PlanQueue, QueueTask, SeatName } from "./queue";
import { readyTasks } from "./queue";
import { choose, criticSeat, initialSeat, modelRef, type ModelTier, type SeatState } from "./schedule";

export type Tiers = Record<"forge" | SeatName, ModelTier[]>;

export type AgentRequest = {
  seat: "forge" | SeatName;
  model: string;
  prompt: string;
  project: string;
  timeoutMs?: number;
  maxDurationMs?: number;
};

export type AgentResult = {
  ok: boolean;
  text: string;
  sessionID?: string;
  error?: string;
  failure?: "soft-limit" | "hard-limit" | "context" | "unavailable";
  resetAt?: number;
};

export type AgentExecutor = (request: AgentRequest) => Promise<AgentResult>;

export type RunnerHooks = {
  log: (message: string) => void;
  stage?: (seat: "forge" | SeatName, model: string | null) => void;
  update: (queue: PlanQueue) => void | Promise<void>;
  compact: (sessionID: string) => void | Promise<void>;
  quota?: (model: string) => Promise<number | undefined>;
  sleep?: (milliseconds: number) => Promise<void>;
  verify?: (command: string, project: string) => Promise<{ ok: boolean; output: string }>;
  concurrency?: number;
  timeoutMs?: number;
  maxDurationMs?: number;
};

export async function runStage(
  seat: "forge" | SeatName,
  tiers: ModelTier[],
  prompt: string,
  project: string,
  executor: AgentExecutor,
  hooks: RunnerHooks,
  state = initialSeat(tiers),
): Promise<{ result: AgentResult; model: string }> {
  let compacted = false;
  try {
    for (;;) {
    const remaining = await hooks.quota?.(tiers[state.modelIndex]!.model);
    let decision = choose(tiers, state, { type: "quota", remainingPercent: remaining ?? 100 }, Date.now());
    state = decision.seat;

    if (decision.action === "stop") {
      hooks.log(`${seat}: ${decision.reason}`);
      return { result: { ok: false, text: "", error: decision.reason }, model: decision.model };
    }
    if (decision.action === "wait") {
      hooks.log(`${seat}: ${decision.reason}; waiting until ${new Date(decision.waitUntil!).toISOString()}`);
      await (hooks.sleep?.(Math.max(0, decision.waitUntil! - Date.now())) ?? Promise.resolve());
      state = initialSeat(tiers);
      continue;
    }

    const model = modelRef(decision);
    hooks.log(`${seat}: ${model}`);
    hooks.stage?.(seat, model);
    const result = await executor({ seat, model, prompt, project, timeoutMs: hooks.timeoutMs, maxDurationMs: hooks.maxDurationMs });
    if (result.ok) {
      hooks.stage?.(seat, null);
      return { result, model: decision.model };
    }

    if (!result.failure) {
      if (result.error || result.text.trim()) hooks.log(`${seat}: ${result.error ?? result.text.trim()}`);
      hooks.stage?.(seat, null);
      return { result, model: decision.model };
    }
    if (result.failure === "context") {
      if (!compacted && result.sessionID) {
        compacted = true;
        hooks.log(`${seat}: compacting ${result.sessionID}`);
        await hooks.compact(result.sessionID);
        continue;
      }
      return { result, model: decision.model };
    }

    decision = choose(tiers, state, { type: result.failure, resetAt: result.resetAt }, Date.now());
    state = decision.seat;
    hooks.log(`${seat}: ${decision.reason}`);
    if (decision.action === "stop") {
      hooks.log(`${seat}: ${decision.reason}`);
      return { result: { ok: false, text: "", error: decision.reason }, model: decision.model };
    }
    if (decision.action === "wait") {
      hooks.log(`${seat}: waiting until ${new Date(decision.waitUntil!).toISOString()}`);
      await (hooks.sleep?.(Math.max(0, decision.waitUntil! - Date.now())) ?? Promise.resolve());
      state = initialSeat(tiers);
    }
    }
  } finally {
    hooks.stage?.(seat, null);
  }
}

function taskPrompt(task: QueueTask) {
  return [
    `Task ${task.id}: ${task.title}`,
    task.prompt,
    `Files in scope: ${task.files.length ? task.files.join(", ") : "unknown; inspect before editing"}`,
    task.skill ? `Load skill: ${task.skill}` : "Do not load a skill unless the task names one.",
    "Do only this task. Do not spawn agents, ask the user, push, or edit the Forge queue or ledger.",
    "Stay inside the named files. Commit only when the task includes a commit step.",
  ].filter(Boolean).join("\n\n");
}

function passed(output: string) {
  return output.includes("FORGE_CRITIC: CLEAN");
}

export async function runCommand(command: string, project: string) {
  const child = Bun.spawn(["bash", "-lc", command], { cwd: project, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { ok: code === 0, output: [stdout, stderr].filter(Boolean).join("\n") || `exit ${code}` };
}

async function processTask(task: QueueTask, queue: PlanQueue, tiers: Tiers, executor: AgentExecutor, hooks: RunnerHooks) {
  const basePrompt = taskPrompt(task);
  let implementation = await runStage(task.seat, tiers[task.seat], basePrompt, queue.project, executor, hooks);
  if (!implementation.result.ok) return false;

  if (task.verify) {
    const check = hooks.verify ?? runCommand;
    let proof = await check(task.verify, queue.project);
    hooks.log(`${task.id}: verify ${proof.ok ? "passed" : "failed"}`);
    if (!proof.ok) {
      const repairPrompt = `${basePrompt}\n\nVerification failed. Repair this task once using this output:\n${proof.output}`;
      implementation = await runStage(task.seat, tiers[task.seat], repairPrompt, queue.project, executor, hooks);
      if (!implementation.result.ok) return false;
      proof = await check(task.verify, queue.project);
      hooks.log(`${task.id}: verify ${proof.ok ? "passed" : "failed"}`);
      if (!proof.ok) return false;
    }
  }

  if (["smith", "atelier", "scribe"].includes(task.seat)) {
    const reviewPrompt = `Review only the current diff for task ${task.id}: ${task.title}.\nFiles in scope: ${task.files.join(", ") || "unknown"}.\nRead-only. If this is not a git repository, read the files in scope instead of using git diff. Findings in severity order with file and line. Mark each blocking or nit. End with FORGE_CRITIC: BLOCKING when any blocking finding exists, otherwise FORGE_CRITIC: CLEAN.`;
    let review = await runStage("critic", tiers.critic, reviewPrompt, queue.project, executor, hooks, criticSeat(tiers.critic, implementation.model));
    if (!review.result.ok) {
      if (review.result.error === "no usable model remains") {
        hooks.log(`${task.id}: review skipped, no usable model`);
        return true;
      }
      return false;
    }
    if (!passed(review.result.text)) {
      const repairPrompt = `${basePrompt}\n\nReview found blocking findings. Repair this task once:\n${review.result.text}`;
      implementation = await runStage(task.seat, tiers[task.seat], repairPrompt, queue.project, executor, hooks);
      if (!implementation.result.ok) return false;
      review = await runStage("critic", tiers.critic, reviewPrompt, queue.project, executor, hooks, criticSeat(tiers.critic, implementation.model));
      if (!review.result.ok || !passed(review.result.text)) return false;
    }
  }

  return true;
}

export async function executeQueue(queue: PlanQueue, tiers: Tiers, executor: AgentExecutor, hooks: RunnerHooks) {
  let blocked = false;
  const worker = async () => {
    while (!blocked) {
      const task = readyTasks(queue)[0];
      if (!task) return;
      task.status = "running";
      await hooks.update(queue);
      const success = await processTask(task, queue, tiers, executor, hooks);
      task.status = success ? "done" : "blocked";
      if (!success) blocked = true;
      await hooks.update(queue);
      hooks.log(`${task.id}: ${task.status}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, hooks.concurrency ?? 2) }, worker));
  return queue;
}
