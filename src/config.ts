import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelTier } from "./schedule";
import type { Tiers } from "./runner";

export const FORGE_HOME = join(homedir(), ".config", "opencode", "forge");
export const TIERS_PATH = join(FORGE_HOME, "tiers.json");
export const DESK_PATH = join(FORGE_HOME, "desk.json");

const kimi = (preferred = "high"): ModelTier => ({ model: "nvidia/moonshotai/kimi-k3.1-pro", efforts: ["max", "high", "low"], preferred });
const grok = (preferred = "high"): ModelTier => ({ model: "xai/grok-4.7", efforts: ["xhigh", "high", "medium", "low"], preferred });
const grokBuild: ModelTier = { model: "xai/grok-build-0.1", efforts: [], preferred: null };

export const DEFAULT_TIERS: Tiers = {
  forge: [kimi(), grok()],
  smith: [kimi(), grokBuild, grok()],
  atelier: [kimi(), grok()],
  critic: [grok("xhigh"), kimi("max")],
  scout: [
    { model: "nvidia/nvidia/nemotron-3.5-lightning-30b-a3b", efforts: [], preferred: null },
    { model: "nvidia/minimaxai/minimax-m3.1-flash", efforts: [], preferred: null },
  ],
  prover: [kimi(), grok()],
  scribe: [kimi("low"), grok("low")],
};

export type DeskConfig = {
  setup?: boolean;
  name: string;
  greeting: string;
  motion: boolean;
  concurrency: number;
  idleTimeoutMs: number;
  maxStageMs: number;
  projectRoots: string[];
  skillRoots: string[];
};

export const DEFAULT_DESK: DeskConfig = {
  name: "aj",
  greeting: "Forge is ready.",
  motion: true,
  concurrency: 2,
  idleTimeoutMs: 120_000,
  maxStageMs: 300_000,
  projectRoots: [
    join(homedir(), "Developer", "projects"),
    join(homedir(), "Developer", "glostars"),
    join(homedir(), "Developer", "Apps"),
    join(homedir(), "Developer", "Mobile"),
    join(homedir(), "Developer", "git clones"),
  ],
  skillRoots: [join(homedir(), ".agents", "skills"), join(homedir(), ".config", "opencode", "skills")],
};

export function validateTiers(input: unknown): Tiers {
  const tiers = input as Tiers;
  for (const seat of ["forge", "smith", "atelier", "critic", "scout", "prover", "scribe"] as const) {
    const models = tiers?.[seat];
    if (!Array.isArray(models) || models.length === 0) throw new Error(`Invalid tiers: ${seat} needs a model`);
    for (const model of models) {
      if (!/^(nvidia|xai)\//.test(model.model) || model.model.includes("grok-4.20-multi-agent")) throw new Error(`Invalid tiers: provider for ${model.model}`);
      if (!Array.isArray(model.efforts) || model.efforts.some((effort) => typeof effort !== "string")) throw new Error(`Invalid tiers: efforts for ${model.model}`);
      if (model.preferred !== null && !model.efforts.includes(model.preferred)) throw new Error(`Invalid tiers: preferred effort for ${model.model}`);
    }
  }
  return tiers;
}

async function writeIfMissing(path: string, value: unknown) {
  try {
    await readFile(path, "utf8");
  } catch {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }
}

export async function loadConfig() {
  await mkdir(FORGE_HOME, { recursive: true });
  await writeIfMissing(TIERS_PATH, DEFAULT_TIERS);
  await writeIfMissing(DESK_PATH, DEFAULT_DESK);
  const tiers = validateTiers(JSON.parse(await readFile(TIERS_PATH, "utf8")));
  const desk = { ...DEFAULT_DESK, ...JSON.parse(await readFile(DESK_PATH, "utf8")) } as DeskConfig;
  desk.concurrency = Math.max(1, Math.min(6, Math.floor(desk.concurrency)));
  desk.idleTimeoutMs = Math.max(1_000, Math.floor(desk.idleTimeoutMs));
  desk.maxStageMs = Math.max(1_000, Math.floor(desk.maxStageMs));
  return { tiers, desk };
}

export async function saveDesk(config: DeskConfig) {
  await mkdir(FORGE_HOME, { recursive: true });
  await writeFile(DESK_PATH, `${JSON.stringify(config, null, 2)}\n`);
}
