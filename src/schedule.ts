export type ModelTier = {
  model: string;
  efforts: string[];
  preferred: string | null;
};

export type SeatState = {
  modelIndex: number;
  effortIndex: number;
  limited: boolean[];
  resetAt: Array<number | undefined>;
};

export type ScheduleEvent =
  | { type: "soft-limit"; resetAt?: number }
  | { type: "hard-limit"; resetAt?: number }
  | { type: "unavailable"; resetAt?: number }
  | { type: "context" }
  | { type: "quota"; remainingPercent: number; resetAt?: number };

export type Decision = {
  seat: SeatState;
  action: "dispatch" | "compact" | "wait" | "stop";
  model: string;
  effort: string | null;
  waitUntil?: number;
  reason: string;
};

const preferredIndex = (tier: ModelTier) => {
  if (!tier.preferred) return 0;
  const index = tier.efforts.indexOf(tier.preferred);
  return index < 0 ? 0 : index;
};

export function initialSeat(tiers: ModelTier[]): SeatState {
  if (tiers.length === 0) throw new Error("A seat needs at least one model");
  return {
    modelIndex: 0,
    effortIndex: preferredIndex(tiers[0]!),
    limited: tiers.map(() => false),
    resetAt: tiers.map(() => undefined),
  };
}

export function criticSeat(tiers: ModelTier[], authorModel: string): SeatState {
  const authorProvider = authorModel.split("/")[0];
  const index = tiers.findIndex((tier) => tier.model.split("/")[0] !== authorProvider);
  const state = initialSeat(tiers);
  if (index > 0) {
    state.modelIndex = index;
    state.effortIndex = preferredIndex(tiers[index]!);
  }
  return state;
}

export function modelRef(decision: Pick<Decision, "model" | "effort">) {
  return decision.effort ? `${decision.model}#${decision.effort}` : decision.model;
}

function decision(tiers: ModelTier[], seat: SeatState, action: Decision["action"], reason: string, waitUntil?: number): Decision {
  const tier = tiers[seat.modelIndex]!;
  return {
    seat: {
      ...seat,
      limited: [...seat.limited],
      resetAt: [...seat.resetAt],
    },
    action,
    model: tier.model,
    effort: tier.efforts[seat.effortIndex] ?? null,
    reason,
    ...(waitUntil === undefined ? {} : { waitUntil }),
  };
}

function nextAvailable(tiers: ModelTier[], seat: SeatState, now: number, reason: string, terminal: "wait" | "stop"): Decision {
  for (let offset = 1; offset <= tiers.length; offset++) {
    const index = (seat.modelIndex + offset) % tiers.length;
    if (seat.limited[index]) continue;
    seat.modelIndex = index;
    seat.effortIndex = preferredIndex(tiers[index]!);
    return decision(tiers, seat, "dispatch", reason);
  }

  if (terminal === "stop") return decision(tiers, seat, "stop", "no usable model remains");
  const knownResets = seat.resetAt.filter((value): value is number => value !== undefined && value > now);
  const waitUntil = knownResets.length > 0 ? Math.min(...knownResets) : now + 300_000;
  return decision(tiers, seat, "wait", "every model is limited", waitUntil);
}

export function choose(tiers: ModelTier[], current: SeatState, event: ScheduleEvent, now: number): Decision {
  const seat: SeatState = {
    ...current,
    limited: [...current.limited],
    resetAt: [...current.resetAt],
  };
  const tier = tiers[seat.modelIndex]!;

  if (event.type === "context") {
    return decision(tiers, seat, "compact", "context window is full");
  }

  const soft = event.type === "soft-limit" || (event.type === "quota" && event.remainingPercent < 15);
  if (soft && seat.effortIndex + 1 < tier.efforts.length) {
    seat.effortIndex++;
    return decision(tiers, seat, "dispatch", "soft limit: lowered effort");
  }

  if (event.type === "quota" && event.remainingPercent >= 15) {
    return decision(tiers, seat, "dispatch", "quota available");
  }

  if (soft || event.type === "hard-limit" || event.type === "unavailable") {
    seat.limited[seat.modelIndex] = true;
    if (event.resetAt !== undefined) seat.resetAt[seat.modelIndex] = event.resetAt;
    return nextAvailable(tiers, seat, now, `${event.type}: switched model`, event.type === "unavailable" ? "stop" : "wait");
  }

  return decision(tiers, seat, "dispatch", "continue");
}
