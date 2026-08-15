// Aggregates the per-intervention sla.jsonl signal (src/evidence/logger.ts's
// recordSla) across every evidence directory (discovery and replay both
// escalate through the same escalate() function). Real production HITL
// practice tracks SLA/timeout-based escalation, not just a silent per-run
// timeout (see DECISIONS.md) — this closes that gap into a real,
// cross-run signal: how often interventions breach their timeout
// unattended, and how long they typically take to resolve. Deliberately a
// script, not a service — the brief asks us not to build aggregation
// infrastructure, just to have a real signal.
//
// Usage: npx tsx scripts/sla-report.ts [evidenceRoot=evidence]

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface SlaRecord {
  ts: string;
  capabilityId: string;
  stepIndex: number;
  timeoutMs: number;
  elapsedMs: number;
  breached: boolean;
}

interface Stats {
  total: number;
  breached: number;
  totalElapsedMs: number;
}

function main() {
  const evidenceRoot = process.argv[2] ?? "evidence";
  const byCapability = new Map<string, Stats>();

  const dirs = readdirSync(evidenceRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const dir of dirs) {
    const slaPath = join(evidenceRoot, dir, "sla.jsonl");
    if (!existsSync(slaPath)) continue;

    const lines = readFileSync(slaPath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      const record: SlaRecord = JSON.parse(line);
      let stats = byCapability.get(record.capabilityId);
      if (!stats) {
        stats = { total: 0, breached: 0, totalElapsedMs: 0 };
        byCapability.set(record.capabilityId, stats);
      }
      stats.total++;
      if (record.breached) stats.breached++;
      stats.totalElapsedMs += record.elapsedMs;
    }
  }

  if (byCapability.size === 0) {
    console.log(`No sla.jsonl files found under ${evidenceRoot}/. Trigger an escalation first (--escalate).`);
    return;
  }

  console.log(`SLA report — ${evidenceRoot}/*/sla.jsonl\n`);
  console.log(
    "capability/goal".padEnd(48) + "interventions".padStart(15) + "breached%".padStart(11) + "avg resolve".padStart(14)
  );

  const sorted = [...byCapability.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [capabilityId, s] of sorted) {
    const breachPct = ((s.breached / s.total) * 100).toFixed(1);
    const avgSeconds = (s.totalElapsedMs / s.total / 1000).toFixed(1);
    console.log(
      capabilityId.padEnd(48) + String(s.total).padStart(15) + breachPct.padStart(11) + (avgSeconds + "s").padStart(14)
    );
    if (s.breached > 0) {
      console.log(
        `  -> ${capabilityId}: ${s.breached}/${s.total} interventions went unresolved past their timeout. ` +
          `Rising breach rate is the signal to shorten the timeout (fail faster) or widen who's watching the ` +
          `operator console.`
      );
    }
  }
}

main();
