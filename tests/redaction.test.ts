import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EvidenceLogger } from "../src/evidence/logger.js";
import { cleanEvidenceDir } from "./helpers.js";

const EVIDENCE_ROOT = "test-evidence-redaction";

after(() => cleanEvidenceDir(EVIDENCE_ROOT));

test("redaction: key-name match redacts regardless of value shape", () => {
  const logger = new EvidenceLogger(EVIDENCE_ROOT, "key-match");
  logger.log("system", "e", { accountToken: "sk-live-anything-at-all" });
  const line = readFileSync(join(EVIDENCE_ROOT, "key-match", "steps.log.jsonl"), "utf-8");
  assert.ok(line.includes('"accountToken":"[REDACTED]"'));
});

test("redaction: value-pattern match catches sensitive data under an innocuous key", () => {
  const logger = new EvidenceLogger(EVIDENCE_ROOT, "value-match");
  logger.log("system", "e", { note: "SSN 123-45-6789, card 4111-1111-1111-1111, x@y.com, 555-123-4567" });
  const line = readFileSync(join(EVIDENCE_ROOT, "value-match", "steps.log.jsonl"), "utf-8");
  assert.ok(line.includes("[REDACTED-SSN]"));
  assert.ok(line.includes("[REDACTED-CARD]"));
  assert.ok(line.includes("[REDACTED-EMAIL]"));
  assert.ok(line.includes("[REDACTED-PHONE]"));
  assert.ok(!line.includes("123-45-6789"), "raw SSN must not appear in persisted evidence");
});

test("redaction: does not false-positive on a bare evidenceId-shaped timestamp", () => {
  const logger = new EvidenceLogger(EVIDENCE_ROOT, "no-false-positive");
  logger.writeResult({ kind: "success", outputs: {}, evidenceId: "replay-foo-1786737312169" });
  const result = readFileSync(join(EVIDENCE_ROOT, "no-false-positive", "result.json"), "utf-8");
  assert.ok(result.includes("1786737312169"), "bare numeric IDs must survive redaction unchanged");
});

test("redaction: recurses into nested objects (e.g. a Result's outputs)", () => {
  const logger = new EvidenceLogger(EVIDENCE_ROOT, "nested");
  logger.writeResult({ kind: "success", outputs: { note: "SSN on file: 987-65-4321" }, evidenceId: "nested" });
  const result = readFileSync(join(EVIDENCE_ROOT, "nested", "result.json"), "utf-8");
  assert.ok(result.includes("[REDACTED-SSN]"));
  assert.ok(!result.includes("987-65-4321"));
});
