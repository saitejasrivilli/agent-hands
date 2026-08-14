# Low-Level Design

## 1. Type definitions (locked at V0, per BUILD_PLAN.md)

```ts
type ActionType = "click" | "type" | "navigate" | "waitFor" | "extract" | "done";

interface LocatorStrategy {
  kind: "testid" | "role" | "text" | "cssPath" | "axPath" | "coordinates";
  value: string;               // selector/text/role-name/serialized path
  meta?: Record<string, string>; // e.g. { role: "textbox", name: "Member ID" }
}

interface Step {
  index: number;
  action: ActionType;
  target?: { strategies: LocatorStrategy[] };   // ordered, try in order
  valueTemplate?: string;       // e.g. "{{memberId}}" — resolved from inputSchema
  extractAs?: string;           // key into outputs, when action === "extract"
  timeoutMs: number;
  retry: { max: number; backoffMs: number };
}

interface Checkpoint {
  kind: "elementVisible" | "elementText" | "urlMatches" | "customPredicateId";
  target?: { strategies: LocatorStrategy[] };
  expected?: string;
}

interface RecoveryRule {
  matchCondition: Checkpoint;    // e.g. dialog with text "session expiring"
  action: "dismiss" | "retryStep" | "reloadAndRetry";
  maxApplications: number;       // don't loop forever recovering
}

interface Artifact {
  capabilityId: string;
  version: number;
  description: string;
  inputSchema: Record<string, "string" | "number" | "boolean">;
  outputSchema: Record<string, "string" | "number" | "boolean">;
  steps: Step[];
  successCondition: Checkpoint;
  recoveryRules: RecoveryRule[];
  allowlistScope: { domains: string[]; actions: ActionType[] };
  createdFrom: { discoveryRunId: string; timestamp: string };  // provenance, not the transcript itself
}

type Result =
  | { kind: "success"; outputs: Record<string, unknown>; evidenceId: string }
  | { kind: "businessOutcome"; code: string; detail: string; evidenceId: string }
  | { kind: "failure"; step: number; expected: string; observed: string; evidenceId: string };

interface SurfaceState {
  url: string;
  axTree: unknown;         // Playwright accessibility snapshot
  domSummary: string;      // trimmed/structured, not raw HTML dump
  screenshotRef: string;   // path in /evidence
}

interface SurfaceAdapter {
  observe(): Promise<SurfaceState>;
  act(action: { type: ActionType; target?: LocatorStrategy[]; value?: string }): Promise<void>;
  snapshot(): Promise<{ screenshotPath: string; axTreePath: string }>;
}
```

## 2. Locator resolution algorithm (Replayer + Agent Loop both use this)
```
resolve(strategies: LocatorStrategy[]) -> ElementHandle | throw LocatorResolutionError
  for strategy in strategies (in given order):
    try resolve via strategy.kind
    if unique match found -> return handle, log which strategy hit (index + kind)
    if zero matches -> continue to next strategy
    if multiple ambiguous matches -> log warning, continue to next strategy (prefer precision over guessing)
  if all strategies exhausted -> throw LocatorResolutionError (caller turns this into Result.failure)
```
Logged "which strategy hit" data feeds the drift-detection idea in BEST_PRACTICES.md §10 (hit-rate
per strategy over many replays would flag drift — noted as future work, not built).

## 3. Replayer execution algorithm
```
replay(artifact, inputs):
  validate inputs against artifact.inputSchema -> if invalid: Result.businessOutcome("invalid_input")
  controlState = "automation"
  for step in artifact.steps:
    if controlState == "human": wait until resumed (Escalation seam)
    try:
      element = resolve(step.target.strategies)   // skip for navigate/waitFor-url
      execute step.action with retry/backoff per step.retry, timeoutMs
      if step.action == "extract": outputs[step.extractAs] = read value
    catch RecoverableMatch as r:
      apply matching recoveryRule (bounded by maxApplications), retry step once
    catch LocatorResolutionError | Timeout as e:
      capture snapshot() -> evidence
      return Result.failure(step.index, expected=describe(step), observed=e.message, evidenceId)
  verify artifact.successCondition
    if fails and matches a known "expected absence" pattern (e.g. not-found marker present)
       -> return Result.businessOutcome(code, detail, evidenceId)
    if fails otherwise -> return Result.failure(...)
  return Result.success(outputs, evidenceId)
```

## 4. Agent Loop algorithm (discovery, LLM in loop)
```
loop(goal, target):
  init SurfaceAdapter at target
  transcript = []
  for i in 1..maxSteps:
    state = adapter.observe()
    action = LLM.decide(goal, state, transcript)   // tool-calling: click/type/navigate/extract/done
    guardrailWrapper.check(action)                 // allowlist + control-state gate
    adapter.act(action)
    transcript.append({state, action, rationale: LLM's stated reasoning})
    if action.type == "done": break
    if timeout exceeded: return DiscoveryResult.stuck(transcript, reason="max_steps")
  return DiscoveryResult.success(transcript)
```
Discovery evidence = transcript + per-step screenshots, saved under `/evidence/discovery-<id>/`.
Artifact Compiler consumes this transcript, never the replayer.

## 5. Guardrail Wrapper (single choke point)
```
guardedAct(action, session):
  if session.controlState != "automation" and caller != OperatorSurface: reject
  if action.target.domain not in allowlistScope.domains: reject, log
  if action.type not in allowlistScope.actions: reject, log
  if action.type in RISKY_ACTIONS (e.g. "submit-irreversible"):
      require artifact-declared confirm step already satisfied, else reject
  redact(action.value) before logging  // field-name pattern match: account#, SSN, DOB
  return adapter.act(action)
```

## 6. Escalation control-transfer sequence
```
1. Agent Loop or Replayer hits stuck/failure -> EscalationManager.raise(context)
2. context = { goal/capabilityId, stepIndex, screenshotPath, reason }
3. controlState := "human"; OperatorSurface polls/display pending intervention
4. Human clicks "take control" -> OperatorSurface attaches to same adapter.session (same
   BrowserContext/Page instance, not a new one)
5. Human performs actions via OperatorSurface -> each action logged via same Evidence Logger
   format as automated steps (action, timestamp, "actor": "human")
6. Human clicks "resume" -> controlState := "automation"; Replayer/Agent Loop continues
   from next step (or re-verifies checkpoint before continuing)
```

## 7. Evidence directory layout
```
/evidence/
  discovery-<id>/
    transcript.json        (steps + rationale, redacted)
    screenshots/step-N.png
    result.json
  replay-<id>/
    input.json
    result.json             (Result union, one of 3 kinds)
    steps.log.json
    screenshots/ (only on failure/businessOutcome, per BEST_PRACTICES.md §11)
  escalation-<id>/
    intervention.json
    human-actions.log.json
    before/after screenshots
```

## 8. File/module layout (repo)
```
/src
  adapters/playwright-adapter.ts
  agent/loop.ts
  agent/prompts.ts
  artifact/types.ts          <- the locked types above
  artifact/compiler.ts
  replay/replayer.ts
  replay/locator-resolver.ts
  guardrails/wrapper.ts
  guardrails/redaction.ts
  escalation/manager.ts
  escalation/operator-surface/ (minimal static page + tiny server)
  evidence/logger.ts
  cli.ts                     <- run-agent / replay commands
/target-app                  <- sample bank-like app under test
/capabilities/*.json          <- saved artifacts
/evidence/                    <- per BUILD_PLAN.md definition-of-done per version
```
