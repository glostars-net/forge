import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export type SkillEntry = {
  id: string;
  description: string;
  path: string;
  manual: boolean;
};

function unquote(value: string) {
  return value.trim().replace(/^(['"])(.*)\1$/, "$2");
}

function frontmatterValue(source: string, key: string) {
  const match = source.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!match) return "";
  const value = match[1]!.trim();
  if (value === ">" || value === "|" || value === ">-" || value === "|-") {
    const rest = source.slice((match.index ?? 0) + match[0].length);
    return rest.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  }
  return unquote(value);
}

export async function discoverSkillRoots(configured: string[], cacheRoot = join(homedir(), ".cache", "opencode", "npm")) {
  const roots = [...configured];
  for (const pattern of [
    "git-superpowers-*/**/node_modules/superpowers/skills",
    "@dietrichgebert/ponytail@*/**/node_modules/@dietrichgebert/ponytail/skills",
  ]) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan({ cwd: cacheRoot, absolute: true, onlyFiles: false })) roots.push(path);
  }
  return [...new Set(roots)];
}

export async function indexSkills(roots: string[]): Promise<SkillEntry[]> {
  const byId = new Map<string, SkillEntry>();
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || byId.has(entry.name)) continue;
      const path = join(root, entry.name, "SKILL.md");
      let source: string;
      try {
        source = await readFile(path, "utf8");
      } catch {
        continue;
      }
      const id = frontmatterValue(source, "name") || entry.name;
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        description: frontmatterValue(source, "description") || "No description",
        path,
        manual: id.startsWith("higgsfield"),
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
