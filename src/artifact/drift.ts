import type { EvidenceLogger } from "../evidence/logger.js";

// Drift-detection signal (REPORT.md §4: "the logging hook exists, only the
// aggregation doesn't" — this is that hook made real, not just a comment).
// Per BEST_PRACTICES.md §10: tracking which locator strategy resolves on
// every replay surfaces drift (a previously-first-choice strategy starting
// to fall through to its fallback) before it becomes a hard failure. This
// doesn't build the full aggregation service the brief says not to build —
// it's the minimal real signal: one line per step, per replay, appended to
// a durable file a later process (or a human) can read across many runs.

export interface DriftSample {
  ts: string;
  capabilityId: string;
  step: number;
  strategyIndex: number;
  strategyKind: string;
  outcome: "primary" | "fallback" | "miss";
}

export function recordDrift(
  logger: EvidenceLogger,
  capabilityId: string,
  step: number,
  hit: { kind: string; index: number } | null
): void {
  const sample: DriftSample = {
    ts: new Date().toISOString(),
    capabilityId,
    step,
    strategyIndex: hit?.index ?? -1,
    strategyKind: hit?.kind ?? "none",
    outcome: hit === null ? "miss" : hit.index === 0 ? "primary" : "fallback",
  };
  logger.recordDrift(sample as unknown as Record<string, unknown>);
}
