import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SENSITIVE_KEY_PATTERN, VALUE_PATTERNS } from "./redaction-patterns.js";

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

// Redaction applied at the point of capture (BEST_PRACTICES.md §6), before
// anything touches disk — never redacted-after-the-fact. See
// redaction-patterns.ts for what counts as sensitive; this file only
// implements how the redaction pass is applied.
function redactString(value: string): string {
  return VALUE_PATTERNS.reduce((acc, p) => acc.replace(p.pattern, p.replacement), value);
}

// Recursive so nested objects/arrays (e.g. an artifact's `outputs`, or a
// discovery transcript's action args) get the same treatment as top-level
// log fields — a shallow pass would miss anything one level deep.
function redact(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

export interface ApprovalRecord {
  ts: string;
  capabilityId: string;
  step: number;
  action: string;
}

export class EvidenceLogger {
  readonly dir: string;
  private logPath: string;
  private approvalsPath: string;
  private driftPath: string;

  constructor(evidenceRoot: string, runId: string) {
    this.dir = join(evidenceRoot, runId);
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(join(this.dir, "screenshots"), { recursive: true });
    this.logPath = join(this.dir, "steps.log.jsonl");
    if (!existsSync(this.logPath)) writeFileSync(this.logPath, "");
    this.approvalsPath = join(this.dir, "approvals.jsonl");
    this.driftPath = join(this.dir, "drift.jsonl");
  }

  log(actor: LogEntry["actor"], event: string, detail?: Record<string, unknown>) {
    const entry: LogEntry = { ts: new Date().toISOString(), actor, event, detail: redact(detail) as Record<string, unknown> | undefined };
    appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
  }

  // Distinct from the general step log: one line per risky action that
  // actually passed the confirmation gate, so an auditor can answer "what
  // mutating actions happened in this run, and were they confirmed?" without
  // scanning the full interleaved log. Addresses REPORT.md §6's "no separate
  // approval record beyond the log entry" limitation.
  recordApproval(record: Omit<ApprovalRecord, "ts">) {
    const entry: ApprovalRecord = { ts: new Date().toISOString(), ...record };
    appendFileSync(this.approvalsPath, JSON.stringify(entry) + "\n");
  }

  // Distinct from the general step log: one line per step's locator
  // resolution outcome (primary/fallback/miss), so drift (a strategy
  // starting to fall through more often than it used to) can be tracked
  // across many replays without scanning the full interleaved log.
  recordDrift(sample: Record<string, unknown>) {
    appendFileSync(this.driftPath, JSON.stringify(sample) + "\n");
  }

  writeResult(result: unknown) {
    writeFileSync(join(this.dir, "result.json"), JSON.stringify(redact(result), null, 2));
  }

  writeJson(name: string, data: unknown) {
    writeFileSync(join(this.dir, name), JSON.stringify(redact(data), null, 2));
  }

  screenshotPath(label: string): string {
    return join(this.dir, "screenshots", `${label}.png`);
  }
}
