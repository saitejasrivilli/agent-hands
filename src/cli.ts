import { readFileSync, writeFileSync } from "node:fs";
import { replay } from "./replay/replayer.js";
import { runDiscovery } from "./agent/loop.js";
import { compileFromTranscriptFile } from "./artifact/compiler.js";
import { applyTenantOverride, type TenantOverride } from "./artifact/tenant-override.js";
import type { Artifact } from "./artifact/types.js";

const TARGET_URL = process.env.TARGET_URL ?? "http://localhost:4000";
const EVIDENCE_ROOT = process.env.EVIDENCE_ROOT ?? "evidence";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === "replay") {
    const artifactPath = arg("artifact");
    const inputJson = arg("input") ?? "{}";
    const enableEscalation = process.argv.includes("--escalate");
    const operatorPort = arg("operator-port") ? Number(arg("operator-port")) : undefined;
    const escalationTimeoutMs = arg("escalation-timeout-ms") ? Number(arg("escalation-timeout-ms")) : undefined;
    if (!artifactPath) {
      console.error("usage: replay --artifact <path> --input '<json>' [--escalate] [--operator-port <n>]");
      process.exit(1);
    }
    let artifact: Artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
    const tenantOverridePath = arg("tenant-override");
    if (tenantOverridePath) {
      const override: TenantOverride = JSON.parse(readFileSync(tenantOverridePath, "utf-8"));
      artifact = applyTenantOverride(artifact, override);
    }
    const inputs = JSON.parse(inputJson);
    const result = await replay(artifact, inputs, TARGET_URL, EVIDENCE_ROOT, {
      enableEscalation,
      operatorPort,
      escalationTimeoutMs,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.kind === "success" || result.kind === "businessOutcome" ? 0 : 1);
  } else if (cmd === "run-agent") {
    const goal = arg("goal");
    const target = arg("target") ?? TARGET_URL;
    const enableEscalation = process.argv.includes("--escalate");
    const operatorPort = arg("operator-port") ? Number(arg("operator-port")) : undefined;
    const escalationTimeoutMs = arg("escalation-timeout-ms") ? Number(arg("escalation-timeout-ms")) : undefined;
    const allowedDomains = arg("allowed-domains")?.split(",");
    if (!goal) {
      console.error(
        "usage: run-agent --goal '...' --target <url> [--escalate] [--operator-port <n>] [--allowed-domains a,b]"
      );
      process.exit(1);
    }
    const result = await runDiscovery(goal, target, EVIDENCE_ROOT, {
      enableEscalation,
      operatorPort,
      escalationTimeoutMs,
      allowedDomains,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.kind === "success" ? 0 : 1);
  } else if (cmd === "compile") {
    const transcriptPath = arg("transcript");
    const capabilityId = arg("capability-id");
    const description = arg("description") ?? "";
    const goal = arg("goal") ?? "";
    const target = arg("target") ?? TARGET_URL;
    const discoveryRunId = arg("discovery-run-id") ?? "unknown";
    const out = arg("out");
    if (!transcriptPath || !capabilityId || !out) {
      console.error(
        "usage: compile --transcript <path> --capability-id <id> --description '...' --goal '...' --target <url> --discovery-run-id <id> --out <path>"
      );
      process.exit(1);
    }
    const artifact = compileFromTranscriptFile(transcriptPath, {
      capabilityId,
      description,
      goal,
      targetUrl: target,
      discoveryRunId,
    });
    writeFileSync(out, JSON.stringify(artifact, null, 2));
    console.log(`Compiled artifact written to ${out}`);
    console.log(JSON.stringify(artifact, null, 2));
  } else {
    console.error(
      "usage: run-agent --goal '...' --target <url>  |  compile --transcript <path> --capability-id <id> --out <path>  |  replay --artifact <path> --input '<json>'"
    );
    process.exit(1);
  }
}

main();
