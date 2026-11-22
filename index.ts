#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs, type CliOptions } from "./src/cli";
import { loadConfig, saveDesk, type DeskConfig } from "./src/config";
import { startDesk, type DeskMode } from "./src/desk";
import { compactSession, createQuotaReader, runOpenCode, stopAllRuns } from "./src/opencode";
import { planQueue } from "./src/planner";
import { interpretPrompt, oneTaskQueue, type PromptAction } from "./src/prompt";
import { discoverProjects } from "./src/projects";
import { readQueue, saveQueue } from "./src/queue";
import { executeQueue, type RunnerHooks, type Tiers } from "./src/runner";
import { discoverSkillRoots, indexSkills, type SkillEntry } from "./src/skills";
import { renderHeadless, type DeskViewState } from "./src/view";
import { needsSetup, SETUP_QUESTIONS, takeSetupAnswer, welcomeLine } from "./src/welcome";

const USAGE = `Forge · plan desk

  forge
  forge <directory>
  forge <plan.md> --project <repo> [--headless]
  forge --resume <directory> [--headless]

Type in the box. Tab switches PLAN and BUILD. Ctrl-C quits.`;

function currentProject(cwd: string) {
  const result = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "ignore" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
}

function makeHooks(project: string, desk: DeskConfig, state: DeskViewState, emit: (message: string) => void, refresh: () => void): RunnerHooks {
  const active = new Map<string, string>();
  return {
    log: emit,
    stage(seat, model) {
      if (model) active.set(seat, model);
      else active.delete(seat);
      state.active = [...active].map(([name, value]) => `${name} · ${value}`);
      refresh();
    },
    async update(queue) {
      state.queue = queue;
      await saveQueue(queue);
      refresh();
    },
    compact: (sessionID) => compactSession(sessionID, project),
    quota: createQuotaReader(),
    sleep: Bun.sleep,
    concurrency: desk.concurrency,
    timeoutMs: Number(process.env.FORGE_IDLE_TIMEOUT_MS ?? desk.idleTimeoutMs),
    maxDurationMs: Number(process.env.FORGE_MAX_STAGE_MS ?? desk.maxStageMs),
  };
}

async function runForge(options: CliOptions, tiers: Tiers, skills: SkillEntry[], hooks: RunnerHooks, state: DeskViewState, refresh: () => void) {
  const project = options.project ?? currentProject(process.cwd());
  if (!project) throw new Error("Use --project <repo>; the current directory is not a git repository");
  const queue = options.resume
    ? await readQueue(project)
    : await planQueue(options.plan!, project, tiers, skills, runOpenCode, hooks);
  state.queue = queue;
  await saveQueue(queue);
  refresh();
  return executeQueue(queue, tiers, runOpenCode, hooks);
}

async function writeInbox(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text.endsWith("\n") ? text : `${text}\n`);
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2), process.cwd());
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const loaded = await loadConfig();
  const tiers = loaded.tiers;
  let desk = loaded.desk;
  const [projects, skills] = await Promise.all([
    discoverProjects(desk.projectRoots),
    indexSkills(await discoverSkillRoots(desk.skillRoots)),
  ]);
  const state: DeskViewState = {
    name: desk.name,
    greeting: desk.greeting,
    activeProject: options.project ?? currentProject(process.cwd()),
    projects,
    skillCount: skills.length,
    logs: [`Indexed ${projects.length} projects and ${skills.length} skills`],
    active: [],
  };

  if (options.headless) {
    if (!options.plan && !options.resume) {
      console.log(renderHeadless(state));
      return;
    }
    const refresh = () => {};
    const emit = (message: string) => {
      state.logs.push(message);
      console.log(message);
    };
    try {
      const project = options.project ?? currentProject(process.cwd()) ?? process.cwd();
      state.queue = await runForge(options, tiers, skills, makeHooks(project, desk, state, emit, refresh), state, refresh);
    } catch (error) {
      state.logs.push(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    console.log(renderHeadless(state));
    return;
  }

  state.greeting = welcomeLine(desk.name, 0);
  let resolveQuit!: () => void;
  const quit = new Promise<void>((resolve) => { resolveQuit = resolve; });
  let welcomeTimer: ReturnType<typeof setInterval> | undefined;
  let view!: Awaited<ReturnType<typeof startDesk>>;
  const refresh = () => view.update(state);
  const emit = (message: string) => {
    state.logs.push(message);
    refresh();
  };
  const projectOf = () => state.activeProject ?? options.project ?? currentProject(process.cwd());
  let setupStep = needsSetup(desk) ? 0 : -1;
  let answers = { name: "", main: "" };
  let busy = false;
  let cli: Promise<unknown> = Promise.resolve();

  function startCli() {
    if (busy || setupStep >= 0 || (!options.plan && !options.resume)) return;
    busy = true;
    const project = projectOf() ?? process.cwd();
    cli = runForge(options, tiers, skills, makeHooks(project, desk, state, emit, refresh), state, refresh)
      .then((queue) => { state.queue = queue; })
      .catch((error) => {
        emit(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      })
      .finally(() => { busy = false; refresh(); });
  }

  async function runAction(project: string, action: PromptAction, text: string) {
    const hooks = makeHooks(project, desk, state, emit, refresh);
    if (action.kind === "plan") {
      await writeInbox(action.planPath, text.trim());
      state.queue = await planQueue(action.planPath, project, tiers, skills, runOpenCode, hooks);
      emit(`planned ${state.queue.tasks.length} tasks`);
      return;
    }
    if (action.kind === "build-queue") {
      state.queue = await executeQueue(state.queue ?? await readQueue(project), tiers, runOpenCode, hooks);
      return;
    }
    if (action.kind === "build-text") {
      const queue = oneTaskQueue(project, action.title, action.prompt);
      state.queue = queue;
      await saveQueue(queue);
      refresh();
      state.queue = await executeQueue(queue, tiers, runOpenCode, hooks);
      return;
    }
    if (action.kind === "build-file") {
      state.queue = await planQueue(action.planPath, project, tiers, skills, runOpenCode, hooks);
      refresh();
      state.queue = await executeQueue(state.queue, tiers, runOpenCode, hooks);
    }
  }

  async function onSubmit(text: string, mode: DeskMode) {
    if (setupStep >= 0) {
      const result = takeSetupAnswer(setupStep, text, desk, answers);
      if (result.error) {
        emit(result.error);
        return;
      }
      answers = result.answers;
      setupStep = result.step;
      if (!result.config) {
        view.setPlaceholder(SETUP_QUESTIONS[setupStep] ?? SETUP_QUESTIONS[0]);
        return;
      }
      desk = result.config;
      await saveDesk(desk);
      state.name = desk.name;
      state.projects = await discoverProjects(desk.projectRoots);
      state.greeting = welcomeLine(desk.name, 0);
      view.setWelcome(state.greeting);
      view.setPlaceholder("plan a change, then enter");
      setupStep = -1;
      emit("setup saved");
      refresh();
      startCli();
      return;
    }
    if (busy) {
      emit("busy");
      return;
    }
    const project = projectOf();
    if (!project) {
      emit("Open a project: forge <directory>");
      return;
    }
    const action = interpretPrompt(text, mode, project);
    if (action.kind === "ignore") return;
    busy = true;
    try {
      await runAction(project, action, text);
    } catch (error) {
      emit(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      busy = false;
      refresh();
    }
  }

  view = await startDesk(state, {
    motion: desk.motion && !process.env.NO_COLOR && process.env.TERM !== "dumb",
    onSubmit,
    onQuit: () => {
      if (welcomeTimer) clearInterval(welcomeTimer);
      stopAllRuns();
      resolveQuit();
    },
  });
  if (setupStep === 0) view.setPlaceholder(SETUP_QUESTIONS[0]);
  let welcomeIndex = 0;
  welcomeTimer = setInterval(() => {
    if (setupStep >= 0) return;
    welcomeIndex++;
    state.greeting = welcomeLine(desk.name, welcomeIndex);
    view.setWelcome(state.greeting);
  }, 8_000);
  refresh();
  startCli();
  await quit;
  if (welcomeTimer) clearInterval(welcomeTimer);
  stopAllRuns();
  await cli;
  view.destroy();
}

await main();
