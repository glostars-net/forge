import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export type Project = {
  name: string;
  path: string;
  group: string;
  branch: string;
  dirty: boolean;
};

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function git(path: string, args: string[]) {
  const result = Bun.spawnSync(["git", "-C", path, ...args], { stdout: "pipe", stderr: "ignore" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : "";
}

async function inspect(path: string, group: string): Promise<Project> {
  return {
    name: path.split("/").filter(Boolean).at(-1) ?? path,
    path,
    group,
    branch: git(path, ["branch", "--show-current"]) || "unknown",
    dirty: git(path, ["status", "--porcelain"]).length > 0,
  };
}

export async function discoverProjects(roots: string[]): Promise<Project[]> {
  const projects: Project[] = [];
  for (const root of roots) {
    if (await isDirectory(join(root, ".git"))) projects.push(await inspect(root, root));
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const children = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const path = join(root, child.name);
      if (await isDirectory(join(path, ".git"))) projects.push(await inspect(path, root));
    }
  }
  return projects;
}
