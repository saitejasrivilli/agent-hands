// Locked at V0 (BUILD_PLAN.md). Nothing after V0 changes these shapes —
// only adds implementations/callers around them.

export type ActionType = "click" | "type" | "navigate" | "waitFor" | "extract" | "done";

export interface LocatorStrategy {
  kind: "testid" | "role" | "text" | "cssPath" | "axPath" | "coordinates";
  value: string;
  meta?: Record<string, string>;
}

export interface StepTarget {
  strategies: LocatorStrategy[];
}

export interface Step {
  index: number;
  action: ActionType;
  target?: StepTarget;
  valueTemplate?: string;
  extractAs?: string;
  timeoutMs: number;
  retry: { max: number; backoffMs: number };
}

export interface Checkpoint {
  kind: "elementVisible" | "elementText" | "urlMatches";
  target?: StepTarget;
  expected?: string;
}

export interface RecoveryRule {
  matchCondition: Checkpoint;
  action: "dismiss" | "retryStep" | "reloadAndRetry";
  maxApplications: number;
}

export type FieldType = "string" | "number" | "boolean";

export interface Artifact {
  capabilityId: string;
  version: number;
  description: string;
  inputSchema: Record<string, FieldType>;
  outputSchema: Record<string, FieldType>;
  steps: Step[];
  successCondition: Checkpoint;
  recoveryRules: RecoveryRule[];
  allowlistScope: { domains: string[]; actions: ActionType[] };
  createdFrom: { discoveryRunId: string; timestamp: string };
}

// What replay (and discovery) always returns. Never a bare exception.
export type Result =
  | { kind: "success"; outputs: Record<string, unknown>; evidenceId: string }
  | { kind: "businessOutcome"; code: string; detail: string; evidenceId: string }
  | {
      kind: "failure";
      step: number;
      expected: string;
      observed: string;
      evidenceId: string;
    };
