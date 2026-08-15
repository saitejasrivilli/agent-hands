import { test } from "node:test";
import assert from "node:assert/strict";
import { explainReason } from "../src/escalation/plain-language.js";

test("explainReason: locator resolution failure gets a plain-English explanation", () => {
  assert.match(
    explainReason("locator resolution failed: No locator strategy resolved uniquely: [...]"),
    /couldn't find a button or field/i
  );
});

test("explainReason: timeout gets a plain-English explanation", () => {
  assert.match(explainReason("unexpected_error: Timeout 5000ms exceeded."), /took too long to respond/i);
});

test("explainReason: guardrail block gets a plain-English explanation", () => {
  assert.match(explainReason("guardrail_blocked: domain not in allowlist"), /blocked by a safety rule/i);
});

test("explainReason: unrecognized reason still returns a non-empty, actionable sentence", () => {
  const result = explainReason("something totally novel");
  assert.ok(result.length > 0);
  assert.match(result, /needs a person/i);
});
