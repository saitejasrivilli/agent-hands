import type { Artifact, Step, StepTarget } from "./types.js";

// Cross-tenant reuse (stretch goal, brief Section 3.7/8): represent an
// artifact once, on a "base" tenant, and reuse it against another tenant
// running the same underlying vendor product by applying a small override
// object — not by re-recording the whole capability. The override only
// touches what actually differs (here: one button's locator strategies);
// everything else in the base Artifact (schema, other steps, checkpoint,
// allowlist) is shared unchanged.

export interface TenantOverride {
  tenantId: string;
  description: string;
  // Keyed by step index. Only `target` is override-able for now — that's
  // the field that actually varies per tenant's branding/labels in practice.
  stepTargetOverrides: Record<number, StepTarget>;
}

export function applyTenantOverride(base: Artifact, override: TenantOverride): Artifact {
  const steps: Step[] = base.steps.map((step) => {
    const overrideTarget = override.stepTargetOverrides[step.index];
    if (!overrideTarget) return step;
    return { ...step, target: overrideTarget };
  });
  return {
    ...base,
    capabilityId: `${base.capabilityId}+${override.tenantId}`,
    description: `${base.description} [tenant override: ${override.description}]`,
    steps,
  };
}
