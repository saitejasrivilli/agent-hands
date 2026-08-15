import express from "express";
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDiscovery } from "../agent/loop.js";
import { compileFromTranscriptFile } from "../artifact/compiler.js";
import { replay } from "../replay/replayer.js";
import type { Artifact } from "../artifact/types.js";

// One dashboard covering the whole discover -> compile -> replay -> browse-
// evidence flow, for anyone (technical or not) to drive and understand the
// system without touching a terminal. It does NOT replace the CLI — every
// endpoint here just calls the same runDiscovery/compileFromTranscriptFile/
// replay functions the CLI calls, so both surfaces stay in sync by
// construction, not by being kept manually consistent.
//
// Deliberately scoped OUT: live escalation-in-progress inside the dashboard.
// Escalation blocks on a separate ephemeral operator-console server until a
// human resolves it (see src/escalation/manager.ts) — that mechanism is
// already real and verified via the CLI (`--escalate`). Half-building a
// second, worse version of it inside the dashboard would be exactly the
// kind of unverified, redundant surface this project has spent several
// rounds of review cutting elsewhere. The dashboard links out to the CLI
// instructions for that case instead of pretending to support it inline.

const CAPABILITIES_DIR = "capabilities";
const EVIDENCE_ROOT = "evidence";
const TARGET_URL = process.env.TARGET_URL ?? "http://localhost:4000/";

const app = express();
app.use(express.json());
app.use(express.static(new URL("../../public", import.meta.url).pathname));

function listCapabilityFiles(): string[] {
  return readdirSync(CAPABILITIES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

app.get("/api/capabilities", (_req, res) => {
  const capabilities = listCapabilityFiles().map((file) => {
    const artifact: Artifact = JSON.parse(readFileSync(join(CAPABILITIES_DIR, file), "utf-8"));
    return {
      file,
      capabilityId: artifact.capabilityId,
      description: artifact.description,
      version: artifact.version,
      inputSchema: artifact.inputSchema,
      outputSchema: artifact.outputSchema,
      stepCount: artifact.steps.length,
      riskySteps: artifact.steps.filter((s) => s.risky).map((s) => s.index),
      canonicalRoutes: artifact.canonicalRoutes ?? [],
    };
  });
  res.json(capabilities);
});

function readJsonlSafe(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readJsonSafe(path: string): unknown {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function summarizeRun(id: string) {
  const dir = join(EVIDENCE_ROOT, id);
  const steps = readJsonlSafe(join(dir, "steps.log.jsonl"));
  const isDiscovery = id.startsWith("discovery-");
  const result = readJsonSafe(join(dir, "result.json")) as { kind?: string } | null;

  let kind = "unknown";
  let label = "";
  if (isDiscovery) {
    const success = steps.find((s) => s.event === "discovery_success");
    const stuck = steps.find((s) => s.event === "discovery_stuck");
    const guardrailBlocked = steps.find((s) => s.event === "guardrail_blocked");
    if (success) {
      kind = "success";
      label = String((success.detail as any)?.summary ?? "");
    } else if (guardrailBlocked) {
      kind = "stuck";
      label = "guardrail_blocked: " + String((guardrailBlocked.detail as any)?.reason ?? "");
    } else if (stuck) {
      kind = "stuck";
      label = String((stuck.detail as any)?.reason ?? "");
    }
  } else if (result?.kind) {
    kind = result.kind;
    label = kind === "success" ? "" : String((result as any).code ?? (result as any).observed ?? "");
  }

  const startedEvent = steps.find((s) => s.event === "discovery_started" || s.event === "replay_started");
  const goalOrCapability = isDiscovery
    ? String((startedEvent?.detail as any)?.goal ?? "")
    : String((startedEvent?.detail as any)?.capabilityId ?? "");
  const ts = steps[0]?.ts ?? (existsSync(dir) ? statSync(dir).mtime.toISOString() : "");

  return { id, type: isDiscovery ? "discovery" : "replay", kind, label, goalOrCapability, ts };
}

app.get("/api/evidence", (_req, res) => {
  const dirs = readdirSync(EVIDENCE_ROOT).filter((d) => statSync(join(EVIDENCE_ROOT, d)).isDirectory());
  const runs = dirs
    .filter((d) => d.startsWith("discovery-") || d.startsWith("replay-"))
    .map(summarizeRun)
    .sort((a, b) => (a.ts < b.ts ? 1 : -1));
  res.json(runs);
});

app.get("/api/evidence/:id", (req, res) => {
  const dir = join(EVIDENCE_ROOT, req.params.id);
  if (!existsSync(dir)) return res.status(404).json({ error: "not found" });
  const screenshotsDir = join(dir, "screenshots");
  const screenshots = existsSync(screenshotsDir)
    ? readdirSync(screenshotsDir).filter((f) => f.endsWith(".png"))
    : [];
  res.json({
    id: req.params.id,
    steps: readJsonlSafe(join(dir, "steps.log.jsonl")),
    result: readJsonSafe(join(dir, "result.json")),
    transcript: readJsonSafe(join(dir, "transcript.json")),
    intervention: readJsonSafe(join(dir, "intervention.json")),
    approvals: readJsonlSafe(join(dir, "approvals.jsonl")),
    drift: readJsonlSafe(join(dir, "drift.jsonl")),
    screenshots,
  });
});

app.get("/api/evidence/:id/screenshots/:file", (req, res) => {
  const path = join(EVIDENCE_ROOT, req.params.id, "screenshots", req.params.file);
  if (!existsSync(path)) return res.status(404).end();
  res.sendFile(path, { root: "." });
});

app.post("/api/discover", async (req, res) => {
  const { goal, target } = req.body;
  if (!goal) return res.status(400).json({ error: "goal is required" });
  try {
    const result = await runDiscovery(goal, target || TARGET_URL, EVIDENCE_ROOT);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/compile", (req, res) => {
  const { discoveryRunId, capabilityId, description, goal, target } = req.body;
  if (!discoveryRunId || !capabilityId) {
    return res.status(400).json({ error: "discoveryRunId and capabilityId are required" });
  }
  try {
    const transcriptPath = join(EVIDENCE_ROOT, discoveryRunId, "transcript.json");
    const artifact = compileFromTranscriptFile(transcriptPath, {
      capabilityId,
      description: description || "",
      goal: goal || "",
      targetUrl: target || TARGET_URL,
      discoveryRunId,
    });
    const outFile = `${capabilityId}.json`;
    writeFileSync(join(CAPABILITIES_DIR, outFile), JSON.stringify(artifact, null, 2));
    res.json({ file: outFile, artifact });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/replay", async (req, res) => {
  const { file, inputs } = req.body;
  if (!file) return res.status(400).json({ error: "file is required" });
  try {
    const artifact: Artifact = JSON.parse(readFileSync(join(CAPABILITIES_DIR, file), "utf-8"));
    const result = await replay(artifact, inputs || {}, TARGET_URL, EVIDENCE_ROOT);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const port = Number(process.env.DASHBOARD_PORT ?? 4200);
app.listen(port, () => {
  console.log(`Dashboard listening on http://localhost:${port}`);
});
