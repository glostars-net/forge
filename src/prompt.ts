import { isAbsolute, join, resolve } from "node:path";
import type { PlanQueue } from "./queue";

export type PromptAction =
  | { kind: "ignore" }
  | { kind: "plan"; planPath: string }
  | { kind: "build-queue" }
  | { kind: "build-text"; title: string; prompt: string }
  | { kind: "build-file"; planPath: string };

export function interpretPrompt(text: string, mode: "plan" | "build", project: string): PromptAction {
  const trimmed = text.trim();
  if (!trimmed) return mode === "build" ? { kind: "build-queue" } : { kind: "ignore" };
  if (mode === "plan") return { kind: "plan", planPath: join(project, ".opencode", "forge", "inbox.md") };
  if (trimmed.endsWith(".md")) return { kind: "build-file", planPath: isAbsolute(trimmed) ? trimmed : resolve(project, trimmed) };
  return { kind: "build-text", title: trimmed.slice(0, 60), prompt: trimmed };
}

export function oneTaskQueue(project: string, title: string, prompt: string): PlanQueue {
  return {
    version: 1,
    project,
    plan: join(project, ".opencode", "forge", "inbox.md"),
    createdAt: new Date().toISOString(),
    tasks: [{ id: "ask", title, seat: "smith", files: [], prompt, dependsOn: [], status: "queued" }],
  };
}
