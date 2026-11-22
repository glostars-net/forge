import { describe, expect, test } from "bun:test";
import { executeQueue, type AgentRequest, type AgentResult } from "../src/runner";
import { validateQueue, type PlanQueue } from "../src/queue";
import type { ModelTier } from "../src/schedule";

const kimi: ModelTier = { model: "nvidia/moonshotai/kimi-k3.1-pro", efforts: ["max", "high", "low"], preferred: "high" };
const grokBuild: ModelTier = { model: "xai/grok-build-0.1", efforts: [], preferred: null };
const grok: ModelTier = { model: "xai/grok-4.7", efforts: ["xhigh", "high", "medium", "low"], preferred: "high" };
const tiers = { forge: [kimi, grok], smith: [kimi, grokBuild, grok], atelier: [kimi, grok], critic: [{ ...grok, preferred: "xhigh" }, { ...kimi, preferred: "max" }], scout: [kimi, grok], prover: [kimi, grokBuild], scribe: [kimi, grok] };

function queue(seat = "smith", verify = "bun test"): PlanQueue {
  return validateQueue({
    version: 1,
    project: "/work/repo",
    plan: "/work/repo/plan.md",
    createdAt: "2026-11-19T00:00:00.000Z",
    tasks: [{ id: "one", title: "One", seat, files: ["src/a.ts"], prompt: "implement one", verify, dependsOn: [], skill: "ponytail" }],
  }, "/work/repo");
}

function ok(text = "done"): AgentResult {
  return { ok: true, text, sessionID: "ses_test" };
}

function setup(respond: (request: AgentRequest, call: number) => AgentResult | Promise<AgentResult>) {
  const requests: AgentRequest[] = [];
  const compacted: string[] = [];
  const executor = async (request: AgentRequest) => {
    requests.push(request);
    return respond(request, requests.filter((item) => item.seat === request.seat).length);
  };
  return {
    requests,
    compacted,
    executor,
    hooks: {
      log: () => {},
      update: async () => {},
      compact: async (sessionID: string) => { compacted.push(sessionID); },
      quota: async () => undefined,
      sleep: async () => {},
      timeoutMs: 123,
      verify: async () => ({ ok: true, output: "pass" }),
    },
  };
}

describe("queue runner", () => {
  test("runs implement, prove, and other-family review, and loads the named skill", async () => {
    const state = setup((request) => {
      if (request.seat === "prover") return ok("FORGE_PROVER: PASS");
      if (request.seat === "critic") return ok("FORGE_CRITIC: CLEAN");
      return ok();
    });
    const result = await executeQueue(queue(), tiers, state.executor, state.hooks);
    expect(result.tasks[0]?.status).toBe("done");
    expect(state.requests.map((request) => request.seat)).toEqual(["smith", "critic"]);
    expect(state.requests[0]?.model).toBe("nvidia/moonshotai/kimi-k3.1-pro#high");
    expect(state.requests[0]?.prompt).toContain("Load skill: ponytail");
    expect(state.requests[1]?.model).toBe("xai/grok-4.7#xhigh");
    expect(state.requests[0]?.timeoutMs).toBe(123);
    expect(state.requests[1]?.prompt).toContain("not a git repository");
  });

  test("repairs once after a failed verification", async () => {
    let checks = 0;
    const state = setup((request) => request.seat === "critic" ? ok("FORGE_CRITIC: CLEAN") : ok());
    state.hooks.verify = async () => ({ ok: ++checks > 1, output: checks === 1 ? "exit 1" : "pass" });
    const result = await executeQueue(queue(), tiers, state.executor, state.hooks);
    expect(result.tasks[0]?.status).toBe("done");
    expect(state.requests.filter((request) => request.seat === "smith")).toHaveLength(2);
    expect(state.requests[1]?.prompt).toContain("exit 1");
  });

  test("repairs once after a blocking review", async () => {
    const state = setup((request, call) => {
      if (request.seat === "critic") return ok(call === 1 ? "FORGE_CRITIC: BLOCKING" : "FORGE_CRITIC: CLEAN");
      return ok();
    });
    const result = await executeQueue(queue(), tiers, state.executor, state.hooks);
    expect(result.tasks[0]?.status).toBe("done");
    expect(state.requests.filter((request) => request.seat === "critic")).toHaveLength(2);
  });

  test("keeps a verified task when every reviewer model is unavailable", async () => {
    const state = setup((request) => request.seat === "critic" ? { ok: false, text: "", error: "no usable model remains" } : ok());
    const result = await executeQueue(queue(), tiers, state.executor, state.hooks);
    expect(result.tasks[0]?.status).toBe("done");
  });

  test("stops the queue after a second failed verification", async () => {
    const state = setup(() => ok());
    state.hooks.verify = async () => ({ ok: false, output: "still failing" });
    const result = await executeQueue(queue(), tiers, state.executor, state.hooks);
    expect(result.tasks[0]?.status).toBe("blocked");
    expect(state.requests.some((request) => request.seat === "critic")).toBe(false);
  });

  test("switches models on a hard limit", async () => {
    const state = setup((request, call) => {
      if (request.seat === "smith" && call === 1) return { ok: false, text: "", error: "429 quota", failure: "hard-limit" };
      if (request.seat === "critic") return ok("FORGE_CRITIC: CLEAN");
      return ok();
    });
    const result = await executeQueue(queue(), tiers, state.executor, state.hooks);
    expect(result.tasks[0]?.status).toBe("done");
    expect(state.requests[1]?.model).toBe("xai/grok-build-0.1");
  });

  test("compacts and retries a context-limited session", async () => {
    const state = setup((request, call) => {
      if (request.seat === "smith" && call === 1) return { ok: false, text: "", sessionID: "ses_full", error: "context full", failure: "context" };
      if (request.seat === "critic") return ok("FORGE_CRITIC: CLEAN");
      return ok();
    });
    const result = await executeQueue(queue(), tiers, state.executor, state.hooks);
    expect(result.tasks[0]?.status).toBe("done");
    expect(state.compacted).toEqual(["ses_full"]);
  });

  test("runs independent scout tasks concurrently but serializes shared files", async () => {
    const independent = validateQueue({
      version: 1,
      project: "/work/repo",
      plan: "/work/repo/plan.md",
      createdAt: "2026-11-19T00:00:00.000Z",
      tasks: [
        { id: "one", title: "One", seat: "scout", files: ["src/a.ts"], prompt: "find a", dependsOn: [] },
        { id: "two", title: "Two", seat: "scout", files: ["src/b.ts"], prompt: "find b", dependsOn: [] },
      ],
    }, "/work/repo");
    let active = 0;
    let maximum = 0;
    const state = setup(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await Bun.sleep(10);
      active--;
      return ok();
    });
    await executeQueue(independent, tiers, state.executor, { ...state.hooks, concurrency: 2 });
    expect(maximum).toBe(2);

    independent.tasks.forEach((task) => { task.status = "queued"; task.files = ["src/shared.ts"]; });
    maximum = 0;
    await executeQueue(independent, tiers, state.executor, { ...state.hooks, concurrency: 2 });
    expect(maximum).toBe(1);
  });
});
