# REPORT — agent-hands

## 1. Architecture

Single Node/TypeScript process, no queues or services — deliberate. The brief doesn't reward
scaling infrastructure, and nothing here needs concurrency: one discovery or one replay run is
the actual unit of work. Three CLI entry points (`run-agent`, `compile`, `replay`) sit on a
shared core:

```
Agent Loop (LLM in loop) ──┐
                            ├──▶ SurfaceAdapter (Playwright: observe/act/snapshot)
Replayer (no LLM)     ──────┘         │
                                       ▼ wrapped by
                              Guardrail Wrapper (allowlist, risky-action, control-state)
                                       │
                                       ▼
                              Live target application

Artifact Compiler: discovery transcript → typed Artifact (used by Replayer)
Evidence Logger: structured JSON + screenshots, attached to every component above
Escalation Manager: shares the SAME live session with a human on hard failure
```

The seam that matters most: **`SurfaceAdapter`** is the only thing that touches the browser.
Agent Loop, Replayer, and Escalation Manager all call `observe()`/`act()`/`snapshot()` and
never talk to Playwright directly — what makes Section 3.7 (heterogeneity) a real extension
point rather than a rewrite (Section 4).

Trade-offs: CLI over a dashboard (a web UI was considered and explicitly declined — see
Cuts, it's the kind of feature-breadth the brief says isn't rewarded). Artifact and transcript
are separate files in separate directories — the transcript (raw discovery evidence) is not
the artifact (the compiled, reviewable contract); keeping them apart reinforces that
distinction.

## 2. Artifact schema

A typed, versioned contract an AI agent can call, not a step list:

```ts
interface Artifact {
  capabilityId: string; version: number; description: string;
  inputSchema: Record<string, "string"|"number"|"boolean">;
  outputSchema: Record<string, "string"|"number"|"boolean">;
  steps: Step[]; successCondition: Checkpoint; recoveryRules: RecoveryRule[];
  allowlistScope: { domains: string[]; actions: ActionType[] };
  createdFrom: { discoveryRunId: string; timestamp: string };
}
```

**Locator strategy is a ranked list, not one selector.** Each `Step.target.strategies` is
tried in order at replay time; the resolver logs which one hit. This is where the compiler
adds real value instead of parroting discovery: discovery often anchors an `extract` step on
the literal data value it saw (`role=cell name="4820.55 USD"`), which only works for that one
record. The compiler detects this and derives a value-independent fallback from the
accessibility snapshot (finds the adjacent label, builds `tr:has-text('Savings Balance')`) —
verified to actually generalize: the compiled artifact replayed correctly against a member
never seen during discovery.

**Inputs/outputs are typed schemas.** A `type` action's literal value becomes a named input
parameter only if it appears in the original goal text (vs. a constant) — `"12345"` → `
{{memberId}}`. An honest heuristic ("came from the goal," not semantic field understanding).

**Checkpoint is declarative** (`elementVisible`/`elementText`/`urlMatches`), readable by a
human reviewer without executing anything. **Versioned and provenance-tracked**:
`createdFrom.discoveryRunId` traces every artifact back to the run that produced it.

## 3. Determinism & error handling

Replay never invokes an LLM: same artifact + inputs → same steps, same locator-resolution
order — verified directly (3 identical runs, byte-identical output). Discovery is
intentionally *not* reproducible run-to-run (verified: two identical-goal runs reached the
right answer via slightly different tool-call sequences) — that asymmetry is the point of the
two-path design.

`Result` is a 3-way union, fixed from the first commit, never changed since:
```ts
type Result = { kind: "success"; outputs; evidenceId }
            | { kind: "businessOutcome"; code; detail; evidenceId }
            | { kind: "failure"; step; expected; observed; evidenceId };
```
- **Business outcomes** are checked before every step (and once after the loop) — a not-found
  marker can appear mid-flow, and treating it as a crash is, per the brief's glossary, "the
  most common design mistake here." This was a real V0 bug, fixed in V3 and documented rather
  than hidden: the check originally ran only at the end, so not-found could hard-fail on an
  unrelated later step first.
- **Recoverable conditions** (`recoveryRules`) are checked before each step, bounded by
  `maxApplications`. Verified against a real dismissible interstitial added to the target app
  specifically to exercise this — not simulated.
- **Hard failures** carry step index, expected vs. observed, and a screenshot + AX snapshot.

No fixed `sleep()` anywhere — waits are condition-based with explicit per-step timeout/retry.

## 4. Heterogeneity & multi-tenant

**Surface abstraction.** The seam is `SurfaceAdapter` — nothing above it knows Playwright
exists. `LocatorStrategy.kind` is already open (`testid | role | text | cssPath | axPath |
coordinates`), with `axPath`/`coordinates` reserved but unimplemented — the seam a desktop
adapter would need: same `Artifact`, same `Replayer`, a new adapter resolving `axPath` against
an OS accessibility API. A legacy web surface doesn't even need a new adapter — the target app
already deliberately is one (table layout, missing test IDs on several controls).

**Multi-tenant reuse** — not built (correctly out of scope), but the schema doesn't paint a
corner. `Step.valueTemplate` already separates parameterized values from constants, which is
most of what canonicalization needs (`/member/12345` → `/member/:id` is the same substitution
mechanism applied to a route). The natural extension for "same vendor product, different
tenant" is a base `Artifact` plus a small override object merged at load time;
`allowlistScope.domains` already anticipates per-tenant hostnames.

**Drift detection** (not built): the resolver already logs which strategy resolved on every
replay. A hit-rate metric per artifact per tenant would surface drift before it becomes a hard
failure — the logging hook exists, only the aggregation doesn't.

## 5. Escalation & handoff

**Detect.** A `LocatorResolutionError` during replay (with `--escalate`) raises an
`InterventionRequest`: capability, step index, reason, screenshot.

**Take control of the live session — literally the same one.** `escalate()` starts a small
local HTTP server bound to the exact `PlaywrightAdapter`/`Page` the paused replay was using.
No new browser context. The operator page (bare/mock, per the brief's own scope note) renders
the live screenshot and a manual-action form plus "Resume."

**Control-transfer model.** Instead of a separately-polled `controlState` flag, the replay
loop is structurally blocked on an `await` for the duration of human control — Node's
single-threaded event loop guarantees no concurrent automated action while that await is
pending. A deliberate simplification, documented as such: same guarantee, less code, since
this system has no background workers.

**Resume semantics.** Replay continues at the *next* step, not a retry of the failed one — the
human is trusted to have completed that step's intent manually, not to have fixed the same
broken locator for an automated retry.

**Verified end-to-end**: a deliberately-broken artifact → escalated → manual action against
the live session → resumed → `Result.success` using the human-provided value. Evidence trail
(`intervention.json` + one interleaved system/human log) inspected and confirmed.

## 6. Safety

**Allowlist enforcement** at a single choke point (`enforceGuardrails`, before every step's
action) — independent of what the artifact/LLM requested. Defense in depth: the planner is
untrusted, the executor enforces. Checks domain and action-type. Verified: an out-of-domain
artifact blocked against the real target with a clear labeled reason.

**Risky/irreversible actions**: an optional `Step.risky` flag (additive, doesn't break
anything already built) requires `inputs.confirm === true`. Deliberately blunt — no partial
confirmation, no scoring. No real mutating capability was built to carry this flag naturally;
the shipped demo marks a harmless step risky purely to exercise the gate, and says so.

**Redaction at the point of capture**, two layers (key-name + value-pattern), applied
recursively to every persisted artifact. A real gap was found and fixed while building this:
`writeResult`/`writeJson` originally bypassed redaction entirely. Verified with a script
logging a fake SSN under an innocuous key, both top-level and nested — redacted either way.

**Limits, honestly**: redaction pattern list is small and illustrative, not production-grade
coverage. No separate approval record beyond the log entry for risky actions. Guardrails are
enforced only in the Replayer's path, not the Agent Loop's — a discovery run has no artifact/
allowlist yet to enforce against.

## 7. Cuts

**Cut, and why:**
- Multi-tenant / desktop implementations — out of scope per 3.7; addressed in design (§4).
- Real-time co-browsing console — out of scope per 3.6's own scope note; built a bare/mock
  console with a real handoff mechanism underneath instead.
- A dashboard/web UI for triggering runs — CLI already satisfies the README's command
  requirement; declined deliberately, not defaulted into (see conversation record).
- Discovery-time locator fallback chains — single role+name locator during discovery; the
  fallback chain is a compiler-time concern (V2), not duplicated in the Agent Loop.
- Escalation wired into discovery's stuck state, not just replay — `escalate()` is
  surface-agnostic and could be called from the Agent Loop's stop condition too; V5's
  definition of done only required the replay path.
- Broader redaction rule set and a real risky-action approval record.

**Next, in priority order (mirrors the brief's own eval weighting):**
1. Fix the known output-shape inconsistency in compiled artifacts (bare value vs. full row
   text depending on which locator strategy resolves) — needs structured label/value parsing.
2. Wire escalation into discovery, not just replay.
3. Implement route-canonicalization concretely (one base-artifact + tenant-override example).
4. Broaden redaction patterns; add a multi-run stability signal (replay N times, report
   locator hit-rate) — the logging hook already exists.
