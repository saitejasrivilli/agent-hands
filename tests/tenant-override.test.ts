import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyTenantOverride, type TenantOverride } from "../src/artifact/tenant-override.js";
import type { Artifact } from "../src/artifact/types.js";

function loadArtifact(path: string): Artifact {
  return JSON.parse(readFileSync(path, "utf-8"));
}

test("tenant-override: merges only the overridden step, leaves the rest identical", () => {
  const base = loadArtifact("capabilities/lookup-savings-balance.json");
  const override: TenantOverride = JSON.parse(
    readFileSync("capabilities/tenant-overrides/vendorB.json", "utf-8")
  );
  const merged = applyTenantOverride(base, override);

  assert.equal(merged.steps.length, base.steps.length);
  assert.deepEqual(merged.steps[0], base.steps[0], "untouched steps must be unchanged");
  assert.deepEqual(merged.steps[2], base.steps[2], "untouched steps must be unchanged");
  assert.notDeepEqual(merged.steps[1], base.steps[1], "the overridden step must actually differ");
  assert.equal(merged.steps[1].target?.strategies[0].meta?.name, "Find Member");
  assert.equal(merged.capabilityId, `${base.capabilityId}+vendorB`);
  assert.equal(merged.inputSchema, base.inputSchema, "unrelated fields pass through unchanged");
});
