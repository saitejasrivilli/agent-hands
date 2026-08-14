import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Every run (discovery, replay, escalation) gets its own evidence dir with a
// structured JSONL step log + a result.json, so both humans and later tooling
// can diff/debug runs. This is what Section 3.5 (evidence/observability) and
// the /evidence/ deliverable are built on top of, from V0 onward.

export interface LogEntry {
  ts: string;
  actor: "system" | "agent" | "human";
  event: string;
  detail?: Record<string, unknown>;
}

// Minimal redaction: field-name pattern match, applied at the point of
// capture (BEST_PRACTICES.md §6). Extended in V4 with a fuller rule set.
const SENSITIVE_KEY_PATTERN = /ssn|password|token|secret|credential|apikey/i;

function redact(detail?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!detail) return detail;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    out[k] = SENSITIVE_KEY_PATTERN.test(k) ? "[REDACTED]" : v;
  }
  return out;
}

export class EvidenceLogger {
  readonly dir: string;
  private logPath: string;

  constructor(evidenceRoot: string, runId: string) {
    this.dir = join(evidenceRoot, runId);
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(join(this.dir, "screenshots"), { recursive: true });
    this.logPath = join(this.dir, "steps.log.jsonl");
    if (!existsSync(this.logPath)) writeFileSync(this.logPath, "");
  }

  log(actor: LogEntry["actor"], event: string, detail?: Record<string, unknown>) {
    const entry: LogEntry = { ts: new Date().toISOString(), actor, event, detail: redact(detail) };
    appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
  }

  writeResult(result: unknown) {
    writeFileSync(join(this.dir, "result.json"), JSON.stringify(result, null, 2));
  }

  writeJson(name: string, data: unknown) {
    writeFileSync(join(this.dir, name), JSON.stringify(data, null, 2));
  }

  screenshotPath(label: string): string {
    return join(this.dir, "screenshots", `${label}.png`);
  }
}
