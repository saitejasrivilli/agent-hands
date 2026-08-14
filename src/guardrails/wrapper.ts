import type { Artifact, Step } from "../artifact/types.js";
import type { PlaywrightAdapter } from "../adapters/playwright-adapter.js";
import type { EvidenceLogger } from "../evidence/logger.js";

// Single choke point enforcing the allowlist + risky-action policy,
// independent of what the artifact/LLM requested — defense in depth per
// BEST_PRACTICES.md §7. Every mutating action goes through here, not just
// the ones the artifact author remembered to gate.

export class GuardrailViolation extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

export function checkDomainAllowed(currentUrl: string, allowlist: Artifact["allowlistScope"]): void {
  const hostname = new URL(currentUrl).hostname;
  if (!allowlist.domains.includes(hostname)) {
    throw new GuardrailViolation(`domain "${hostname}" is not in allowlistScope.domains [${allowlist.domains.join(", ")}]`);
  }
}

export function checkActionAllowed(step: Step, allowlist: Artifact["allowlistScope"]): void {
  if (!allowlist.actions.includes(step.action)) {
    throw new GuardrailViolation(`action "${step.action}" is not in allowlistScope.actions [${allowlist.actions.join(", ")}]`);
  }
}

export function checkRiskyConfirmed(
  step: Step,
  inputs: Record<string, unknown>,
  capabilityId: string,
  logger?: EvidenceLogger
): void {
  if (!step.risky) return;
  if (inputs.confirm !== true) {
    throw new GuardrailViolation(
      `step ${step.index} (${step.action}) is marked risky and requires explicit confirmation (inputs.confirm === true), none given`
    );
  }
  // A risky action passing the gate is a distinct, separately-auditable
  // event from ordinary step execution — recorded in its own artifact
  // (approvals.jsonl), not just interleaved into the general step log,
  // so an auditor can find every confirmed risky action in one place
  // without scanning the full run log.
  logger?.recordApproval({ capabilityId, step: step.index, action: step.action });
}

// Called once before every step's action executes. Throws GuardrailViolation
// on any violation — callers must not swallow this into a generic failure,
// it needs to surface as a distinct, clearly-labeled block, not a mystery
// locator/timeout error.
export function enforceGuardrails(
  adapter: PlaywrightAdapter,
  step: Step,
  inputs: Record<string, unknown>,
  allowlist: Artifact["allowlistScope"],
  capabilityId: string,
  logger?: EvidenceLogger
): void {
  checkDomainAllowed(adapter.page().url(), allowlist);
  checkActionAllowed(step, allowlist);
  checkRiskyConfirmed(step, inputs, capabilityId, logger);
}
