import { statSync } from "node:fs";
import type { DeskConfig } from "./config";

const LINES = [
  (name: string) => `${name}, the desk is listening.`,
  (name: string) => `${name}, plan it or build it.`,
  (name: string) => `Ready when you are, ${name}.`,
  (name: string) => `${name}, two workers, one queue.`,
];

export function needsSetup(config: DeskConfig) {
  return config.setup !== true;
}

export const SETUP_QUESTIONS = [
  "What should Forge call you?",
  "Main projects directory?",
  "Other project directories, comma-separated? Enter skips.",
] as const;

export function welcomeLine(name: string, index: number) {
  return LINES[Math.abs(index) % LINES.length]!(name);
}

export function takeSetupAnswer(
  step: number,
  text: string,
  config: DeskConfig,
  answers: { name: string; main: string },
): { step: number; answers: { name: string; main: string }; config?: DeskConfig; error?: string } {
  const trimmed = text.trim();
  if (step <= 0) {
    if (!trimmed) return { step: 0, answers, error: "Name is required" };
    return { step: 1, answers: { name: trimmed, main: answers.main } };
  }
  if (step === 1) {
    try {
      applySetup(config, { name: answers.name || config.name, main: trimmed, extras: "" });
    } catch (error) {
      return { step: 1, answers, error: error instanceof Error ? error.message : String(error) };
    }
    return { step: 2, answers: { ...answers, main: trimmed } };
  }
  try {
    return { step: 3, answers, config: applySetup(config, { name: answers.name, main: answers.main, extras: text }) };
  } catch (error) {
    return { step: 2, answers, error: error instanceof Error ? error.message : String(error) };
  }
}

export function applySetup(config: DeskConfig, answers: { name: string; main: string; extras: string }): DeskConfig {
  let mainIsDirectory = false;
  try {
    mainIsDirectory = statSync(answers.main).isDirectory();
  } catch {
    mainIsDirectory = false;
  }
  if (!mainIsDirectory) throw new Error("Main projects path must be a directory");
  const extras = answers.extras.split(",").map((item) => item.trim()).filter(Boolean);
  for (const extra of extras) {
    let ok = false;
    try {
      ok = statSync(extra).isDirectory();
    } catch {
      ok = false;
    }
    if (!ok) throw new Error(`${extra} must be a directory`);
  }
  return { ...config, setup: true, name: answers.name.trim() || config.name, projectRoots: [answers.main, ...extras] };
}
