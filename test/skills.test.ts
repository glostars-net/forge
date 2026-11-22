import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverSkillRoots, indexSkills } from "../src/skills";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(process.cwd(), ".test-tmp-skills-"));
  temporary.push(root);
  return root;
}

describe("skill index", () => {
  test("reads frontmatter ids and first-line descriptions", async () => {
    const root = await fixture();
    await mkdir(join(root, "animate"));
    await writeFile(join(root, "animate", "SKILL.md"), "---\nname: animate\ndescription: Build motion.\nSecond line ignored.\n---\nBody");
    await mkdir(join(root, "plain"));
    await writeFile(join(root, "plain", "SKILL.md"), "---\ndescription: Plain skill\n---\nBody");
    const skills = await indexSkills([root]);
    expect(skills).toEqual([
      { id: "animate", description: "Build motion.", path: join(root, "animate", "SKILL.md"), manual: false },
      { id: "plain", description: "Plain skill", path: join(root, "plain", "SKILL.md"), manual: false },
    ]);
  });

  test("marks Higgsfield skills manual and keeps first-root precedence", async () => {
    const first = await fixture();
    const second = await fixture();
    for (const [root, description] of [[first, "preferred"], [second, "ignored"]] as const) {
      await mkdir(join(root, "higgsfield-generate"));
      await writeFile(join(root, "higgsfield-generate", "SKILL.md"), `---\ndescription: ${description}\n---\n`);
    }
    const skills = await indexSkills([first, second]);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ id: "higgsfield-generate", description: "preferred", manual: true });
  });

  test("reads the first line of a folded description", async () => {
    const root = await fixture();
    await mkdir(join(root, "folded"));
    await writeFile(join(root, "folded", "SKILL.md"), "---\ndescription: >-\n  Build careful things\n  across many lines\n---\n");
    expect((await indexSkills([root]))[0]?.description).toBe("Build careful things");
  });

  test("discovers Superpowers and Ponytail skill roots in the plugin cache", async () => {
    const cache = await fixture();
    const superpowers = join(cache, "git-superpowers-abc", "1", "node_modules", "superpowers", "skills");
    const ponytail = join(cache, "@dietrichgebert", "ponytail@latest", "1", "node_modules", "@dietrichgebert", "ponytail", "skills");
    await mkdir(superpowers, { recursive: true });
    await mkdir(ponytail, { recursive: true });
    expect(await discoverSkillRoots([], cache)).toEqual([superpowers, ponytail]);
  });

  test("ignores missing roots", async () => {
    expect(await indexSkills(["/definitely/not/a/forge/root"])).toEqual([]);
  });
});
