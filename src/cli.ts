import { readFileSync } from "node:fs";
import { replay } from "./replay/replayer.js";
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
    if (!artifactPath) {
      console.error("usage: replay --artifact <path> --input '<json>'");
      process.exit(1);
    }
    const artifact: Artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
    const inputs = JSON.parse(inputJson);
    const result = await replay(artifact, inputs, TARGET_URL, EVIDENCE_ROOT);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.kind === "success" || result.kind === "businessOutcome" ? 0 : 1);
  } else if (cmd === "run-agent") {
    console.error("run-agent is implemented in V1 (see BUILD_PLAN.md).");
    process.exit(1);
  } else {
    console.error("usage: run-agent --goal '...' --target <url>  |  replay --artifact <path> --input '<json>'");
    process.exit(1);
  }
}

main();
