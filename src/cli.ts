import { resolve } from "node:path";
import { statSync } from "node:fs";

export type CliOptions = {
  plan?: string;
  project?: string;
  headless: boolean;
  resume: boolean;
  help: boolean;
};

export function parseArgs(args: string[], cwd: string): CliOptions {
  const options: CliOptions = { plan: undefined, project: undefined, headless: false, resume: false, help: false };
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--headless") options.headless = true;
    else if (arg === "--resume") options.resume = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--project") {
      const project = args[++index];
      if (!project) throw new Error("--project needs a path");
      options.project = resolve(cwd, project);
    } else if (arg.startsWith("-")) throw new Error(`Unknown flag: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 1) throw new Error("Give one plan or project directory");
  if (positional[0]) {
    const path = resolve(cwd, positional[0]);
    let directory = false;
    try {
      directory = statSync(path).isDirectory();
    } catch {
      // A plan can be created after argument parsing.
    }
    if (directory) options.project = path;
    else options.plan = path;
  }
  if (options.plan && options.resume) throw new Error("Use a plan or --resume, not both");
  return options;
}
