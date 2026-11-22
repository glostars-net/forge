import { BoxRenderable, InputRenderable, TextRenderable, createCliRenderer, type CliRenderer } from "@opentui/core";
import { collabFrame, starMark } from "./ascii";
import { projectLines, queueLines, type DeskViewState } from "./view";

export const THEME = {
  bg: "#000000",
  panel: "#111111",
  text: "#e8e8e8",
  dim: "#777777",
} as const;

export type DeskMode = "plan" | "build";

export type DeskOptions = {
  motion: boolean;
  onQuit?: () => void;
  onSubmit?: (text: string, mode: DeskMode) => void;
};

export function buildDesk(renderer: CliRenderer, initial: DeskViewState, options: DeskOptions) {
  let state = initial;
  let mode: DeskMode = "plan";
  let tick = 0;
  const root = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "column", backgroundColor: THEME.bg });
  const header = new BoxRenderable(renderer, { height: 10, flexDirection: "column", paddingLeft: 1, backgroundColor: THEME.bg });
  const star = new TextRenderable(renderer, { content: starMark(), fg: THEME.text });
  const greeting = new TextRenderable(renderer, { content: "", fg: THEME.text });
  const field = new TextRenderable(renderer, { content: collabFrame(state.active, 0, options.motion), fg: THEME.dim });
  header.add(star);
  header.add(greeting);
  header.add(field);

  const body = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: "row", minHeight: 0 });
  const projectsPanel = new BoxRenderable(renderer, { width: 26, flexDirection: "column", padding: 1, backgroundColor: THEME.panel });
  const queuePanel = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: "column", padding: 1, backgroundColor: THEME.panel });
  const activePanel = new BoxRenderable(renderer, { width: 52, flexDirection: "column", padding: 1, backgroundColor: THEME.panel });
  const projects = new TextRenderable(renderer, { content: "", fg: THEME.text });
  const queue = new TextRenderable(renderer, { content: "", fg: THEME.text });
  const active = new TextRenderable(renderer, { content: "", fg: THEME.text });
  projectsPanel.add(new TextRenderable(renderer, { content: "Projects", fg: THEME.dim }));
  projectsPanel.add(projects);
  queuePanel.add(new TextRenderable(renderer, { content: "Queue", fg: THEME.dim }));
  queuePanel.add(queue);
  activePanel.add(new TextRenderable(renderer, { content: "Workers", fg: THEME.dim }));
  activePanel.add(active);
  body.add(projectsPanel);
  body.add(queuePanel);
  body.add(activePanel);

  const footer = new BoxRenderable(renderer, { height: 12, flexDirection: "column", padding: 1, backgroundColor: THEME.bg });
  const modeLine = new TextRenderable(renderer, { content: "PLAN", fg: THEME.text });
  const input = new InputRenderable(renderer, { placeholder: "plan a change, then enter", width: "100%", textColor: THEME.text, focusedTextColor: THEME.text, backgroundColor: THEME.panel, focusedBackgroundColor: THEME.panel });
  const logs = new TextRenderable(renderer, { content: "", fg: THEME.dim });
  footer.add(modeLine);
  footer.add(input);
  footer.add(new TextRenderable(renderer, { content: "tab mode · esc clears · ctrl-c quits", fg: THEME.dim }));
  footer.add(logs);
  root.add(header);
  root.add(body);
  root.add(footer);
  renderer.root.add(root);
  input.focus();

  function paint() {
    greeting.content = `${state.greeting}${state.activeProject ? ` · ${state.activeProject}` : ""}  ${state.skillCount} skills`;
    field.content = collabFrame(state.active, tick, options.motion && state.active.length > 0);
    projects.content = projectLines(state.projects).join("\n");
    queue.content = queueLines(state.queue).join("\n");
    active.content = state.active.length ? state.active.join("\n") : "idle";
    logs.content = state.logs.slice(-7).join("\n");
    modeLine.content = mode === "plan" ? "PLAN" : "BUILD";
  }

  function update(next: DeskViewState) {
    state = next;
    paint();
  }

  input.on("enter", (value: string) => {
    input.value = "";
    options.onSubmit?.(value, mode);
  });
  renderer.keyInput.on("keypress", (key) => {
    if (key.ctrl && key.name === "c") {
      options.onQuit?.();
    } else if (key.name === "tab") {
      mode = mode === "plan" ? "build" : "plan";
      input.value = input.value.replaceAll("\t", "");
      paint();
    } else if (key.name === "escape") {
      input.value = "";
    }
  });

  paint();
  return {
    update,
    mode: () => mode,
    setWelcome(line: string) {
      state = { ...state, greeting: line };
      paint();
    },
    setPlaceholder(text: string) {
      input.placeholder = text;
    },
    tick() {
      if (!options.motion || state.active.length === 0) return;
      tick++;
      paint();
    },
  };
}

export async function startDesk(initial: DeskViewState, options: DeskOptions) {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, backgroundColor: THEME.bg });
  const desk = buildDesk(renderer, initial, options);
  const stopField = renderer.onAnimationTick(12, () => desk.tick());
  let destroyed = false;
  return {
    update: desk.update,
    mode: desk.mode,
    setWelcome: desk.setWelcome,
    setPlaceholder: desk.setPlaceholder,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopField();
      renderer.destroy();
    },
  };
}
