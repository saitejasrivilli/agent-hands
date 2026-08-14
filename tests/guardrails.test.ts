import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import { replay } from "../src/replay/replayer.js";
import type { Artifact } from "../src/artifact/types.js";
import { startTargetApp, stopTargetApp, cleanEvidenceDir } from "./helpers.js";

const PORT = 4501;
const TARGET_URL = `http://localhost:${PORT}/`;
const EVIDENCE_ROOT = "test-evidence-guardrails";

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

test("guardrail: out-of-allowlist domain is blocked, not silently ignored", async () => {
  const artifact = loadArtifact("capabilities/lookup-savings-balance.json");
  artifact.allowlistScope.domains = ["evil.example.com"];
  const result = await replay(artifact, { memberId: "12345" }, TARGET_URL, EVIDENCE_ROOT);
  assert.equal(result.kind, "failure");
  if (result.kind === "failure") assert.ok(result.observed.includes("blocked by guardrail"));
  if (result.kind === "failure") assert.ok(result.observed.includes("allowlistScope.domains"));
});

test("guardrail: real risky step (open-new-subaccount submit) blocked without confirm", async () => {
  const artifact = loadArtifact("capabilities/open-new-subaccount.json");
  const result = await replay(
    artifact,
    { memberId: "12345", initialDeposit: "100.00" },
    TARGET_URL,
    EVIDENCE_ROOT
  );
  assert.equal(result.kind, "failure");
  if (result.kind === "failure") {
    assert.equal(result.step, 4);
    assert.ok(result.observed.includes("requires explicit confirmation"));
  }
});

test("guardrail: same risky step proceeds and succeeds with confirm:true", async () => {
  const artifact = loadArtifact("capabilities/open-new-subaccount.json");
  const result = await replay(
    artifact,
    { memberId: "12345", initialDeposit: "100.00", confirm: true },
    TARGET_URL,
    EVIDENCE_ROOT
  );
  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.match(String(result.outputs.confirmationNumber), /^SA-\d+$/);
  }
});
