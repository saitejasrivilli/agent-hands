// Aggregates the per-step drift.jsonl signal (src/artifact/drift.ts) across
// every replay evidence directory. drift.ts records one line per step per
// replay ("did the primary locator strategy resolve, or did we fall
// through?"); nothing previously read that back across runs. This closes
// that gap: a per-capability fallback/miss rate, so a rising rate is a
// concrete "this artifact is starting to drift, go re-record it" signal
// instead of a claim in REPORT.md that the hook exists but nothing consumes
// it. Deliberately a script, not a service — the brief asks us not to build
// aggregation infrastructure, just to have a real signal.
//
// Usage: npx tsx scripts/drift-report.ts [evidenceRoot=evidence]

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface DriftSample {
  ts: string;
  capabilityId: string;
  step: number;
  strategyIndex: number;
  strategyKind: string;
  outcome: "primary" | "fallback" | "miss";
}

interface Stats {
  total: number;
  primary: number;
  fallback: number;
  miss: number;
  runs: Set<string>;
}

function main() {
  const evidenceRoot = process.argv[2] ?? "evidence";
  const byCapability = new Map<string, Stats>();

  const dirs = readdirSync(evidenceRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("replay-"))
    .map((d) => d.name);

  for (const dir of dirs) {
    const driftPath = join(evidenceRoot, dir, "drift.jsonl");
    if (!existsSync(driftPath)) continue;

    const lines = readFileSync(driftPath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      const sample: DriftSample = JSON.parse(line);
      let stats = byCapability.get(sample.capabilityId);
      if (!stats) {
        stats = { total: 0, primary: 0, fallback: 0, miss: 0, runs: new Set() };
        byCapability.set(sample.capabilityId, stats);
      }
      stats.total++;
      stats[sample.outcome]++;
      stats.runs.add(dir);
    }
  }

  if (byCapability.size === 0) {
    console.log(`No drift.jsonl files found under ${evidenceRoot}/replay-*/. Run a replay first.`);
    return;
  }

  console.log(`Drift report — ${evidenceRoot}/replay-*/drift.jsonl\n`);
  console.log(
    "capability".padEnd(36) +
      "runs".padStart(6) +
      "steps".padStart(7) +
      "primary%".padStart(10) +
      "fallback%".padStart(11) +
      "miss%".padStart(8)
  );

  const sorted = [...byCapability.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [capabilityId, s] of sorted) {
    const pct = (n: number) => ((n / s.total) * 100).toFixed(1);
    console.log(
      capabilityId.padEnd(36) +
        String(s.runs.size).padStart(6) +
        String(s.total).padStart(7) +
        pct(s.primary).padStart(10) +
        pct(s.fallback).padStart(11) +
        pct(s.miss).padStart(8)
    );
    if (s.fallback + s.miss > 0) {
      console.log(
        `  -> ${capabilityId}: ${s.fallback} fallback + ${s.miss} miss out of ${s.total} step-observations. ` +
          `Non-zero fallback/miss rate is the signal to re-record or add a locator override.`
      );
    }
  }
}

main();
