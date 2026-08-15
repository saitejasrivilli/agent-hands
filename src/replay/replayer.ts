import type { Artifact, Checkpoint, RecoveryRule, Result, Step } from "../artifact/types.js";
import { PlaywrightAdapter, LocatorResolutionError } from "../adapters/playwright-adapter.js";
import { EvidenceLogger } from "../evidence/logger.js";
import { resolveLocator } from "./locator-resolver.js";
import { enforceGuardrails, GuardrailViolation } from "../guardrails/wrapper.js";
import { escalate } from "../escalation/manager.js";
import { BUSINESS_OUTCOME_MARKERS } from "./business-outcomes.js";
import { recordDrift } from "../artifact/drift.js";

// Business outcomes are checked after every step (not just at the very end)
// — a not-found (or permission-denied, etc.) result can legitimately appear
// partway through a flow, and treating it as a crash rather than a typed
// outcome is "the most common design mistake" per the brief's own glossary.
// The marker list itself lives in business-outcomes.ts (policy, not
// mechanism) — see that file to add a new expected outcome.
async function checkBusinessOutcome(adapter: PlaywrightAdapter): Promise<{ code: string; detail: string } | null> {
  const state = await adapter.observe();
  for (const marker of BUSINESS_OUTCOME_MARKERS) {
    if (marker.pattern.test(state.domSummary)) return { code: marker.code, detail: marker.detail };
  }
  return null;
}

async function checkAndApplyRecoveries(
  adapter: PlaywrightAdapter,
  rules: RecoveryRule[],
  applied: Map<number, number>,
  logger: EvidenceLogger
): Promise<void> {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const count = applied.get(i) ?? 0;
    if (count >= rule.maxApplications) continue;

    const matched = await matchesCondition(adapter, rule.matchCondition);
    if (!matched) continue;

    logger.log("system", "recovery_triggered", { ruleIndex: i, action: rule.action });
    if (rule.action === "dismiss" || rule.action === "retryStep") {
      // "dismiss" resolves the condition's own target and clicks it (e.g. a
      // "Continue" link/button on an interstitial). "retryStep" is a no-op
      // here (the caller retries the step naturally on the next loop pass).
      if (rule.action === "dismiss" && rule.matchCondition.target) {
        const r = await resolveLocator(adapter.page(), rule.matchCondition.target.strategies);
        await r.locator.click();
      }
    } else if (rule.action === "reloadAndRetry") {
      await adapter.page().reload();
    }
    applied.set(i, count + 1);
    logger.log("system", "recovery_applied", { ruleIndex: i });
  }
}

async function matchesCondition(adapter: PlaywrightAdapter, cp: Checkpoint): Promise<boolean> {
  if (cp.kind === "elementVisible" && cp.target) {
    try {
      const r = await resolveLocator(adapter.page(), cp.target.strategies);
      return await r.locator.isVisible();
    } catch {
      return false;
    }
  }
  return false;
}

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

export interface ReplayOptions {
  // Escalation is opt-in: default OFF so V0-V4's already-verified automated
  // behavior (hard failure -> immediate Result.failure) stays unchanged
  // unless a caller explicitly wants a human-in-the-loop run.
  enableEscalation?: boolean;
  operatorPort?: number;
  escalationTimeoutMs?: number;
}

export async function replay(
  artifact: Artifact,
  inputs: Record<string, unknown>,
  startUrl: string,
  evidenceRoot: string,
  options: ReplayOptions = {}
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

  // Launch failure (target app unreachable, bad URL, browser crash) is a
  // real, previously-uncaught gap: it used to propagate straight past the
  // whole typed-Result contract and crash the process. Found via
  // adversarial testing (see DECISIONS.md) — fixed by treating it the same
  // as any other hard failure.
  let adapter: PlaywrightAdapter;
  try {
    adapter = await PlaywrightAdapter.launch(startUrl);
  } catch (err) {
    const result: Result = {
      kind: "failure",
      step: -1,
      expected: "target application reachable and page loads",
      observed: err instanceof Error ? err.message : String(err),
      evidenceId: runId,
    };
    logger.writeResult(result);
    return result;
  }

  const outputs: Record<string, unknown> = {};
  const recoveriesApplied = new Map<number, number>();
  let escalatedOnceForStep = -1;

  try {
    for (const step of artifact.steps) {
      // Recoverable conditions (e.g. a dismissible interstitial) can appear
      // before a step that would otherwise fail to resolve its target —
      // check and resolve them proactively, bounded by maxApplications.
      await checkAndApplyRecoveries(adapter, artifact.recoveryRules, recoveriesApplied, logger);

      // Business outcomes (e.g. "no such member") can legitimately appear
      // mid-flow, not just at the end — check before every step so a
      // downstream step never mistakes a legitimate outcome for a crash.
      const outcome = await checkBusinessOutcome(adapter);
      if (outcome) {
        const result: Result = { kind: "businessOutcome", ...outcome, evidenceId: runId };
        logger.log("system", "business_outcome", outcome);
        logger.writeResult(result);
        return result;
      }

      logger.log("system", "step_start", { index: step.index, action: step.action });
      try {
        enforceGuardrails(adapter, step, inputs, artifact.allowlistScope, artifact.capabilityId, logger);
        await executeStep(adapter, step, inputs, outputs);
        logger.log("system", "step_ok", { index: step.index });
        if (step.target) {
          recordDrift(logger, artifact.capabilityId, step.index, adapter.getLastStrategyHit());
        }
      } catch (err) {
        if (err instanceof GuardrailViolation) {
          logger.log("system", "guardrail_blocked", { index: step.index, reason: err.reason });
          const result: Result = {
            kind: "failure",
            step: step.index,
            expected: "action permitted by allowlist/risky-action policy",
            observed: `blocked by guardrail: ${err.reason}`,
            evidenceId: runId,
          };
          logger.writeResult(result);
          return result;
        }
        // Any other error (a real Playwright timeout from a slow backend, a
        // network error, etc.) — not just LocatorResolutionError — is a hard
        // failure, not a reason to crash the whole process. This was a real
        // gap: previously only LocatorResolutionError was caught here, so an
        // organic failure like a genuine navigation timeout would propagate
        // uncaught and kill the CLI instead of returning a typed Result.
        if (err instanceof Error) {
          const isLocatorFailure = err instanceof LocatorResolutionError;
          const snap = await adapter.snapshot(logger.dir, `failure-step-${step.index}`);
          const reason = isLocatorFailure ? "locator_resolution" : "unexpected_error";
          logger.log("system", "step_failed", { index: step.index, reason, ...snap });

          if (options.enableEscalation && escalatedOnceForStep !== step.index) {
            escalatedOnceForStep = step.index;
            const escalation = await escalate(
              adapter,
              {
                capabilityId: artifact.capabilityId,
                stepIndex: step.index,
                reason: `${reason}: ${err.message}`,
                screenshotPath: snap.screenshotPath,
              },
              logger,
              { port: options.operatorPort, timeoutMs: options.escalationTimeoutMs }
            );
            Object.assign(outputs, escalation.outputs);
            if (escalation.humanActionsCount > 0) {
              // Human performed the step manually — trust their outcome and
              // move on to the next step, rather than blindly retrying the
              // same (already-proven-broken) locator.
              logger.log("system", "escalation_resolved", { humanActionsCount: escalation.humanActionsCount });
              continue;
            }
            // No manual action taken (e.g. timed out) — fall through to a
            // real, clearly-labeled failure below.
          }

          const result: Result = {
            kind: "failure",
            step: step.index,
            expected: isLocatorFailure
              ? `element resolvable via one of ${step.target?.strategies.length ?? 0} strategies`
              : "step to complete without error",
            observed: err.message,
            evidenceId: runId,
          };
          logger.writeResult(result);
          return result;
        }
        throw err;
      }
    }

    // Final business-outcome check (covers outcomes only visible after the
    // last step, e.g. a checkpoint page revealing "not found").
    const finalOutcome = await checkBusinessOutcome(adapter);
    if (finalOutcome) {
      const result: Result = { kind: "businessOutcome", ...finalOutcome, evidenceId: runId };
      logger.log("system", "business_outcome", finalOutcome);
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
  } catch (err) {
    // Catch-all for anything NOT already handled above: checkBusinessOutcome/
    // checkAndApplyRecoveries throwing (e.g. an oversized page causing a
    // Playwright timeout during an AX snapshot), a malformed artifact shape
    // (e.g. `steps` missing/not an array), or any other genuinely unexpected
    // error. Found via adversarial testing, not theoretical: every one of
    // these used to crash the process instead of returning a typed Result.
    const result: Result = {
      kind: "failure",
      step: -1,
      expected: "replay to execute without an unexpected error",
      observed: err instanceof Error ? err.message : String(err),
      evidenceId: runId,
    };
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
    timeoutMs: step.timeoutMs,
    retry: step.retry,
  });
  if (step.action === "extract" && step.extractAs) {
    outputs[step.extractAs] = extracted;
  }
}

async function checkSuccessCondition(adapter: PlaywrightAdapter, artifact: Artifact): Promise<boolean> {
  const cp = artifact.successCondition;
  if (cp.kind === "urlMatches") {
    try {
      return new RegExp(cp.expected ?? "").test(adapter.page().url());
    } catch {
      return false;
    }
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
