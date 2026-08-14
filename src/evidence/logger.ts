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

// Redaction applied at the point of capture (BEST_PRACTICES.md §6), before
// anything touches disk — never redacted-after-the-fact. Two layers, since
// either one alone misses real cases:
//  - key-name match: catches known-sensitive fields regardless of value shape
//  - value-pattern match: catches sensitive-shaped values under an innocuous
//    key name (e.g. an SSN accidentally captured under a generic "note" key)
const SENSITIVE_KEY_PATTERN = /ssn|password|token|secret|credential|apikey|social.?security/i;
const SSN_VALUE_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;

function redactString(value: string): string {
  return value.replace(SSN_VALUE_PATTERN, "[REDACTED-SSN]");
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
    const entry: LogEntry = { ts: new Date().toISOString(), actor, event, detail: redact(detail) as Record<string, unknown> | undefined };
    appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
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
