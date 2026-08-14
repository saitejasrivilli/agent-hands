import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import { replay } from "../src/replay/replayer.js";
import type { Artifact } from "../src/artifact/types.js";
import { startTargetApp, stopTargetApp, cleanEvidenceDir } from "./helpers.js";

const PORT = 4500;
const TARGET_URL = `http://localhost:${PORT}/`;
const EVIDENCE_ROOT = "test-evidence";

function loadArtifact(path: string): Artifact {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let app: ChildProcess;

before(async () => {
  app = await startTargetApp(PORT);
});

after(() => {
  stopTargetApp(app);
  cleanEvidenceDir(EVIDENCE_ROOT);
});

test("replay: success path returns correct balance, deterministically", async () => {
  const artifact = loadArtifact("capabilities/lookup-savings-balance.json");
  const r1 = await replay(artifact, { memberId: "12345" }, TARGET_URL, EVIDENCE_ROOT);
  const r2 = await replay(artifact, { memberId: "12345" }, TARGET_URL, EVIDENCE_ROOT);
  assert.equal(r1.kind, "success");
  assert.equal(r2.kind, "success");
  if (r1.kind === "success" && r2.kind === "success") {
    assert.equal(r1.outputs.balance, "4820.55 USD");
    assert.deepEqual(r1.outputs, r2.outputs, "replay must be deterministic across runs");
  }
});

test("replay: success path generalizes to a different member", async () => {
  const artifact = loadArtifact("capabilities/lookup-savings-balance.json");
  const result = await replay(artifact, { memberId: "67890" }, TARGET_URL, EVIDENCE_ROOT);
  assert.equal(result.kind, "success");
  if (result.kind === "success") assert.equal(result.outputs.balance, "132.10 USD");
});

test("replay: businessOutcome for a non-existent member (not a crash)", async () => {
  const artifact = loadArtifact("capabilities/lookup-savings-balance.json");
  const result = await replay(artifact, { memberId: "99999" }, TARGET_URL, EVIDENCE_ROOT);
  assert.equal(result.kind, "businessOutcome");
  if (result.kind === "businessOutcome") assert.equal(result.code, "member_not_found");
});

test("replay: businessOutcome for a restricted member is distinct from not-found", async () => {
  const artifact = loadArtifact("capabilities/lookup-savings-balance.json");
  const result = await replay(artifact, { memberId: "40404" }, TARGET_URL, EVIDENCE_ROOT);
  assert.equal(result.kind, "businessOutcome");
  if (result.kind === "businessOutcome") assert.equal(result.code, "permission_denied");
});

test("replay: businessOutcome for invalid input, no browser needed", async () => {
  const artifact = loadArtifact("capabilities/lookup-savings-balance.json");
  const result = await replay(artifact, {}, TARGET_URL, EVIDENCE_ROOT);
  assert.equal(result.kind, "businessOutcome");
  if (result.kind === "businessOutcome") assert.equal(result.code, "invalid_input");
});

test("replay: hard failure surfaces step/expected/observed, not a bare exception", async () => {
  const artifact = loadArtifact("capabilities/lookup-savings-balance-escalation-demo.json");
  const result = await replay(artifact, { memberId: "12345" }, TARGET_URL, EVIDENCE_ROOT);
  assert.equal(result.kind, "failure");
  if (result.kind === "failure") {
    assert.equal(result.step, 2);
    assert.ok(result.observed.includes("No locator strategy resolved"));
  }
});

test("replay: recoverable interstitial is dismissed automatically, run still succeeds", async () => {
  const artifact = loadArtifact("capabilities/lookup-savings-balance-recoverable.json");
  const result = await replay(artifact, { memberId: "55555" }, TARGET_URL, EVIDENCE_ROOT);
  assert.equal(result.kind, "success");
  if (result.kind === "success") assert.equal(result.outputs.balance, "950.00 USD");
});

test("replay: compiled artifact (V2) replays correctly on data never seen during discovery", async () => {
  const artifact = loadArtifact("capabilities/lookup-savings-balance-compiled.json");
  const result = await replay(artifact, { memberId: "67890" }, TARGET_URL, EVIDENCE_ROOT);
  assert.equal(result.kind, "success");
  if (result.kind === "success") assert.equal(result.outputs.savings_balance, "132.10 USD");
});

test("replay: drift signal distinguishes primary vs fallback locator resolution", async () => {
  const artifact = loadArtifact("capabilities/lookup-savings-balance-compiled.json");
  const result = await replay(artifact, { memberId: "67890" }, TARGET_URL, EVIDENCE_ROOT);
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  const drift = readFileSync(`${EVIDENCE_ROOT}/${result.evidenceId}/drift.jsonl`, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const extractStep = drift.find((d: { step: number }) => d.step === 2);
  assert.equal(
    extractStep.outcome,
    "fallback",
    "the value-specific primary strategy should miss for a member never seen during discovery"
  );
});
