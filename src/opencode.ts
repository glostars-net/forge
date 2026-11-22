import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentRequest, AgentResult } from "./runner";

export type TokenUsage = {
  input: number;
  output: number;
  reasoning?: number;
};

export type RunOutput = {
  sessionID?: string;
  text: string;
  tokens?: TokenUsage;
  error?: string;
};

export function retryFailure(event: any): { failure: "hard-limit" | "context" | "unavailable"; error: string; resetAt?: number } | null {
  if (event?.type !== "retry") return null;
  const error = event.error?.data?.message ?? event.error?.message ?? JSON.stringify(event.error ?? event);
  const failure = classifyFailure(`${event.error?.type ?? ""} ${error}`);
  if (!failure) return null;
  return {
    failure,
    error,
    resetAt: typeof event.nextRetryAt === "number" ? event.nextRetryAt : extractResetAt(error, Date.now()),
  };
}

export function parseRunOutput(stdout: string): RunOutput {
  const texts: string[] = [];
  let sessionID: string | undefined;
  let tokens: TokenUsage | undefined;
  let error: string | undefined;

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    sessionID ??= event.sessionID ?? event.part?.sessionID;
    if (event.type === "text" && typeof event.part?.text === "string") texts.push(event.part.text);
    if (event.type === "step_finish" && event.part?.tokens) tokens = event.part.tokens;
    const retry = retryFailure(event);
    if (retry) error = retry.error;
    if (event.type === "error") {
      error = event.error?.data?.message ?? event.error?.message ?? event.part?.text ?? JSON.stringify(event.error ?? event);
    }
  }

  return { sessionID, text: texts.join("\n"), tokens, error };
}

export function classifyFailure(text: string): "hard-limit" | "context" | "unavailable" | null {
  if (/maximum context|context (?:window|length|limit).*(?:full|exceed|too long)|prompt is too long|too many tokens/i.test(text)) return "context";
  if (/\b429\b|rate.?limit|usage.?limit|quota|insufficient.*(?:credit|quota)|credits.*(?:exhaust|deplet)/i.test(text)) return "hard-limit";
  if (/model.*(?:not found|unavailable|unknown)|provider.*(?:unavailable|not configured)|does not exist|end of life|no longer available|\b410\b/i.test(text)) return "unavailable";
  return null;
}

export function extractResetAt(text: string, now: number): number | undefined {
  const relative = text.match(/(?:try again in|retry after)\s+(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds|m|min|minutes)/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    const multiplier = unit === "ms" ? 1 : unit.startsWith("m") && unit !== "ms" ? 60_000 : 1_000;
    return now + amount * multiplier;
  }
  const absolute = text.match(/resets?\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/i);
  if (absolute) {
    const timestamp = Date.parse(absolute[1]!);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return undefined;
}

export function quotaPercent(payload: unknown): number | undefined {
  const values: number[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if ("percentRemaining" in value && typeof value.percentRemaining === "number") values.push(value.percentRemaining);
    for (const child of Object.values(value)) visit(child);
  }
  visit(payload);
  return values.length ? Math.min(...values) : undefined;
}

const activeRuns = new Set<ReturnType<typeof Bun.spawn>>();

export function stopAllRuns() {
  for (const child of activeRuns) child.kill();
  activeRuns.clear();
}

export function openCodeArgs(request: AgentRequest) {
  return [
    "run", "--standalone",
    "--agent", request.seat,
    "--model", request.model,
    "--format", "json",
    request.prompt,
  ];
}

export async function runOpenCode(request: AgentRequest): Promise<AgentResult> {
  const child = Bun.spawn(["opencode", ...openCodeArgs(request)], {
    cwd: request.project,
    env: { ...process.env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  activeRuns.add(child);
  try {
    const stderrPromise = new Response(child.stderr).text();
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    let buffer = "";
    let aborted: ReturnType<typeof retryFailure> = null;
    const timeoutMs = request.timeoutMs ?? Number(process.env.FORGE_IDLE_TIMEOUT_MS ?? 120_000);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      if (timeoutMs <= 0) return;
      watchdog = setTimeout(() => {
        aborted = { failure: "unavailable", error: `${request.model} inactive for ${timeoutMs}ms` };
        child.kill();
        void reader.cancel();
      }, timeoutMs);
    };
    armWatchdog();
    const maxDurationMs = request.maxDurationMs ?? Number(process.env.FORGE_MAX_STAGE_MS ?? 300_000);
    const hardCap = maxDurationMs > 0 ? setTimeout(() => {
      aborted = { failure: "unavailable", error: `${request.model} exceeded the ${maxDurationMs}ms stage cap` };
      child.kill();
      void reader.cancel();
    }, maxDurationMs) : undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armWatchdog();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        stdout += `${line}\n`;
        if (process.env.FORGE_DEBUG === "1" && line.trim()) console.error(line);
        if (aborted || !line.trim()) continue;
        try {
          const retry = retryFailure(JSON.parse(line));
          if (retry) {
            aborted = retry;
            child.kill();
          }
        } catch {
          // Non-JSON output is preserved for the final error report.
        }
      }
    }
    if (watchdog) clearTimeout(watchdog);
    if (hardCap) clearTimeout(hardCap);
    stdout += buffer;
    const [stderr, exitCode] = aborted
      ? await Promise.all([
          Promise.race([stderrPromise, Bun.sleep(1_000).then(() => "")]),
          Promise.race([child.exited, Bun.sleep(1_000).then(() => 143)]),
        ])
      : await Promise.all([stderrPromise, child.exited]);
    const parsed = parseRunOutput(stdout);
    const error = aborted?.error ?? parsed.error ?? (exitCode === 0 ? undefined : stderr.trim() || parsed.text || `opencode exited ${exitCode}`);
    return {
      ok: exitCode === 0 && !aborted && !parsed.error,
      text: parsed.text || stderr.trim(),
      sessionID: parsed.sessionID,
      error,
      failure: aborted?.failure ?? (error ? classifyFailure(error) ?? undefined : undefined),
      resetAt: aborted?.resetAt ?? (error ? extractResetAt(error, Date.now()) : undefined),
    };
  } finally {
    activeRuns.delete(child);
  }
}

export function compactArgs(sessionID: string) {
  return ["api", "--standalone", "post", `/api/session/${sessionID}/compact`, "--data", "{}"];
}

export async function compactSession(sessionID: string, cwd: string) {
  const child = Bun.spawn(["opencode", ...compactArgs(sessionID)], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`Compaction failed: ${stderr.trim() || exitCode}`);
}

async function findQuotaBin() {
  if (process.env.FORGE_QUOTA_BIN) return process.env.FORGE_QUOTA_BIN;
  const root = join(homedir(), ".cache", "opencode", "npm");
  const glob = new Bun.Glob("@slkiser/opencode-quota@*/**/node_modules/@slkiser/opencode-quota/dist/bin/opencode-quota.js");
  for await (const path of glob.scan({ cwd: root, absolute: true })) return path;
  return undefined;
}

export function createQuotaReader() {
  let bin: string | undefined;
  const cache = new Map<string, { at: number; value: number | undefined }>();
  return async (model: string): Promise<number | undefined> => {
    const provider = model.split("/")[0];
    if (provider !== "xai") return undefined;
    const cached = cache.get(provider);
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    bin ??= await findQuotaBin();
    if (!bin) return undefined;
    let value: number | undefined;
    try {
      const child = Bun.spawn(["bun", bin, "show", "--provider", provider, "--json"], { stdout: "pipe", stderr: "ignore" });
      const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
      if (exitCode === 0) value = quotaPercent(JSON.parse(stdout));
    } catch {
      value = undefined;
    }
    cache.set(provider, { at: Date.now(), value });
    return value;
  };
}
