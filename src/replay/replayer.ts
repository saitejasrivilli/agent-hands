import type { Artifact, Result, Step } from "../artifact/types.js";
import { PlaywrightAdapter, LocatorResolutionError } from "../adapters/playwright-adapter.js";
import { EvidenceLogger } from "../evidence/logger.js";
import { resolveLocator } from "./locator-resolver.js";

function fillTemplate(template: string, inputs: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(inputs[key] ?? ""));
}

function validateInputs(artifact: Artifact, inputs: Record<string, unknown>): string | null {
  for (const [key, type] of Object.entries(artifact.inputSchema)) {
    if (!(key in inputs)) return `missing required input "${key}"`;
    const v = inputs[key];
    if (type === "string" && typeof v !== "string") return `input "${key}" expected string`;
    if (type === "number" && typeof v !== "number") return `input "${key}" expected number`;
    if (type === "boolean" && typeof v !== "boolean") return `input "${key}" expected boolean`;
  }
  return null;
}

export async function replay(
  artifact: Artifact,
  inputs: Record<string, unknown>,
  startUrl: string,
  evidenceRoot: string
): Promise<Result> {
  const runId = `replay-${artifact.capabilityId}-${Date.now()}`;
  const logger = new EvidenceLogger(evidenceRoot, runId);
  logger.writeJson("input.json", inputs);
  logger.log("system", "replay_started", { capabilityId: artifact.capabilityId, inputs });

  const invalid = validateInputs(artifact, inputs);
  if (invalid) {
    const result: Result = { kind: "businessOutcome", code: "invalid_input", detail: invalid, evidenceId: runId };
    logger.log("system", "business_outcome", { code: result.code, detail: result.detail });
    logger.writeResult(result);
    return result;
  }

  const adapter = await PlaywrightAdapter.launch(startUrl);
  const outputs: Record<string, unknown> = {};

  try {
    for (const step of artifact.steps) {
      logger.log("system", "step_start", { index: step.index, action: step.action });
      try {
        await executeStep(adapter, step, inputs, outputs);
        logger.log("system", "step_ok", { index: step.index });
      } catch (err) {
        if (err instanceof LocatorResolutionError) {
          const snap = await adapter.snapshot(logger.dir, `failure-step-${step.index}`);
          logger.log("system", "step_failed", { index: step.index, reason: "locator_resolution", ...snap });
          const result: Result = {
            kind: "failure",
            step: step.index,
            expected: `element resolvable via one of ${step.target?.strategies.length ?? 0} strategies`,
            observed: err.message,
            evidenceId: runId,
          };
          logger.writeResult(result);
          return result;
        }
        throw err;
      }
    }

    // Business-outcome check: known "not found" marker present on page.
    const state = await adapter.observe();
    if (/no member found/i.test(state.domSummary)) {
      const result: Result = {
        kind: "businessOutcome",
        code: "member_not_found",
        detail: "target app reported no matching member",
        evidenceId: runId,
      };
      logger.log("system", "business_outcome", { code: result.code });
      logger.writeResult(result);
      return result;
    }

    // Success condition check
    const ok = await checkSuccessCondition(adapter, artifact);
    if (!ok) {
      const snap = await adapter.snapshot(logger.dir, "failure-checkpoint");
      const result: Result = {
        kind: "failure",
        step: artifact.steps.length,
        expected: `success condition (${artifact.successCondition.kind}) satisfied`,
        observed: "checkpoint not met",
        evidenceId: runId,
      };
      logger.log("system", "checkpoint_failed", snap);
      logger.writeResult(result);
      return result;
    }

    const result: Result = { kind: "success", outputs, evidenceId: runId };
    logger.log("system", "replay_success", { outputs });
    logger.writeResult(result);
    return result;
  } finally {
    await adapter.close();
  }
}

async function executeStep(
  adapter: PlaywrightAdapter,
  step: Step,
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown>
) {
  const value = step.valueTemplate ? fillTemplate(step.valueTemplate, inputs) : undefined;
  const extracted = await adapter.act({
    type: step.action as any,
    target: step.target?.strategies,
    value,
  });
  if (step.action === "extract" && step.extractAs) {
    outputs[step.extractAs] = extracted;
  }
}

async function checkSuccessCondition(adapter: PlaywrightAdapter, artifact: Artifact): Promise<boolean> {
  const cp = artifact.successCondition;
  if (cp.kind === "urlMatches") {
    return new RegExp(cp.expected ?? "").test(adapter.page().url());
  }
  if (cp.kind === "elementVisible" && cp.target) {
    try {
      const r = await resolveLocator(adapter.page(), cp.target.strategies);
      return await r.locator.isVisible();
    } catch {
      return false;
    }
  }
  if (cp.kind === "elementText" && cp.target) {
    try {
      const r = await resolveLocator(adapter.page(), cp.target.strategies);
      const text = await r.locator.textContent();
      return cp.expected ? new RegExp(cp.expected).test(text ?? "") : !!text;
    } catch {
      return false;
    }
  }
  return false;
}
