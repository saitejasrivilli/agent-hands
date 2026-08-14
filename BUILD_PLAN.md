# Build Plan — Versioned, Each Layer Buildable on Prior Without Disturbing It

Senior-eng approach: build in vertical increments where V(n) never requires rewriting V(n-1).
Achieved by locking 3 interfaces first (Adapter / Artifact / Result) — everything else plugs into
them. Order below mirrors eval weight: schema+replay+errors first (weighted #1-3), escalation
next (#4), design-only sections last (#5), safety threaded throughout (not bolted on at #6).

## Why this order (re-derived from the brief, not assumed)
Eval weights, in order: system design (schema+replay contract) > core loop correctness >
robustness/error handling > HITL escalation > heterogeneity/multi-tenant design > safety >
code quality > communication. Feature breadth and scaling infra explicitly NOT rewarded.
So: get schema + replay + error taxonomy right before anything else touches them, because
every later version depends on that contract staying stable.

## Locked interfaces (defined once, in V0, never broken after)

```ts
// Surface — how we perceive/act. Swappable per surface type later (3.7).
interface SurfaceAdapter {
  observe(): Promise<SurfaceState>       // AX tree + DOM + screenshot ref
  act(action: Action): Promise<void>     // click/type/navigate/wait
  snapshot(): Promise<Evidence>          // screenshot + DOM/AX dump for logs
}

// Artifact — the capability contract. Pure data, versioned, serializable.
interface Artifact {
  capabilityId: string
  version: number
  inputSchema: JSONSchema
  outputSchema: JSONSchema
  steps: Step[]              // action + locator-strategy-list + optional extract
  successCondition: Checkpoint
  recoveryRules: RecoveryRule[]
  allowlistScope: { domains: string[], actions: ActionType[] }
}

// Result — what replay (and discovery) always returns. 3-way, never a bare exception.
type Result =
  | { kind: "success", outputs: Record<string, unknown> }
  | { kind: "businessOutcome", code: string, detail: string }   // e.g. "member_not_found"
  | { kind: "failure", step: number, expected: string, observed: string, evidence: Evidence }
```

These three types are the spine. Nothing below changes their shape — only adds implementations
and callers around them.

---

## Workflow rule: parallel WITHIN a version, serial ACROSS versions
- **Within V(n):** independent tracks (e.g. target-app pages, adapter locator logic, CLI
  scaffold) can be built/reviewed concurrently — they don't depend on each other's internals,
  only on the locked interfaces from §"Locked interfaces" above. Listed as "Parallel tracks"
  under each version below.
- **Across versions:** strictly serial. V(n+1) does not start until V(n) is (a) verified against
  its Definition of Done with an actual test run producing real evidence, and (b) committed +
  pushed to GitHub as its own commit/tag. No version starts on top of an unverified,
  unpushed prior version.
- **Git convention:** one branch per version (`v0-skeleton`, `v1-discovery`, ... `v6-writeup`),
  PR/merge to `main` only after DoD check passes, tag `v0`, `v1`, ... on merge. Each tag is a
  fully working, demoable state on its own — grader (or you, mid-project) can check out any
  tag and the system works up to that version's scope.
- **Verify-then-ship gate per version** (applies to every V(n) below):
  1. Run the version's Definition of Done check for real (not "should work") — produce actual
     evidence file(s).
  2. Confirm evidence matches expectation (correct Result kind, correct file present, etc).
  3. `git add && git commit -m "V(n): <what>"`.
  4. `git push` (open PR to main if using branch-per-version, merge once green).
  5. Only then branch off for V(n+1).

---

## V0 — Skeleton + target app (foundation, no LLM yet)
**Build:** repo scaffold, TypeScript + Playwright, the sample target app (server-rendered,
table-layout, missing test IDs on purpose, 4 pages: search → member detail → new-sub-account
form → confirmation), `SurfaceAdapter` implemented against Playwright (AX-tree-first locator
resolution with fallback chain), a hand-written (no LLM) artifact for ONE simple flow to prove
the replay engine works before the LLM is anywhere in the picture.
**Definition of done:** hand-authored artifact replays end-to-end against the target app,
returns typed `Result`, checkpoint verified. Zero LLM calls in this version — proves the
executor is correct in isolation, so later LLM-authored artifacts have a trusted target to
replay against.
**Does not touch:** agent loop, escalation, safety allowlist (stub allowlist = allow-all for now).
**Parallel tracks (independent, run concurrently):** (a) target app pages, (b) Playwright
adapter + locator-resolution logic, (c) CLI scaffold + repo/tooling setup, (d) hand-written
artifact JSON for the one test flow. All four only depend on the locked interfaces, not each other.
**Verify:** run `replay --artifact <hand-written>.json` for real, confirm `Result.success` with
correct outputs + evidence file written.
**Ship:** commit + push, tag `v0`.

## V1 — Real LLM discovery loop (Section 3.1 + non-negotiable evidence requirement)
**Build:** observe→decide→act loop, LLM tool-calling (structured actions: click/type/navigate/
extract/done), stop conditions (max steps/timeout/dead-end), structured step-by-step logging
from the start (not bolted on later). Run it for real against the target app, save transcript +
screenshots to `/evidence/discovery-run-1/`.
**Definition of done:** one genuine LLM-driven run completes a real goal, evidence saved.
This satisfies the brief's one non-negotiable item early — de-risk it first, don't leave it for
last when time pressure is highest.
**Builds on V0 without disturbing it:** loop calls the same `SurfaceAdapter.observe/act` V0
already validated; doesn't touch replay engine at all.
**Parallel tracks:** (a) LLM tool-calling prompt/schema design, (b) stop-condition logic
(max-steps/timeout/dead-end), (c) structured transcript logger. Independent of each other,
all consume V0's adapter only.
**Verify:** execute one real discovery run against the target app, confirm goal actually
achieved and `/evidence/discovery-run-1/` contains transcript + screenshots.
**Ship:** commit + push, tag `v1`.

## V2 — Artifact compiler (Section 3.2 — heaviest-weighted piece)
**Build:** transcript-to-artifact compiler: takes the V1 discovery transcript, extracts stable
locator strategies (multi-strategy fallback list per element, ranked per BEST_PRACTICES.md §1),
infers input parameters (values that came from the goal, e.g. member ID) vs constants, defines
output schema from extracted data, defines checkpoint from the final state. Emits `Artifact`
matching the V0 type — decoupled from the raw transcript (transcript stays in evidence, not in
the artifact).
**Definition of done:** artifact compiled from the V1 run replays successfully via the V0
executor with zero manual editing. This is the seam proving "discover once, replay forever."
**Builds on V0+V1 without disturbing them:** consumes V1's transcript, emits V0's `Artifact`
type — no changes to either.
**Parallel tracks:** (a) locator-strategy extraction/ranking, (b) input-param inference
(goal-derived values vs constants), (c) output/checkpoint inference. Independent sub-passes
over the same transcript, merged into one `Artifact` object at the end.
**Verify:** compile artifact from the V1 transcript, replay it via the V0 executor with zero
manual edits, confirm `Result.success` matches V1's actual outcome.
**Ship:** commit + push, tag `v2`.

## V3 — Error taxonomy + recoverable/business-outcome handling (Section 3.3, deep piece)
**Build:** extend replay engine (not rewrite) to detect and classify: inject one deliberate
business-outcome case (search a non-existent member → "member_not_found" typed result,
not a crash) and one recoverable case (a dismissible session-timeout-style interstitial on the
target app, added specifically to exercise this). Add `recoveryRules` execution + explicit
timeout/retry budgets (no fixed sleeps, per BEST_PRACTICES.md §2).
**Definition of done:** three replay runs saved to evidence — one success, one business
outcome, one recoverable-then-success — each returning the correct `Result` variant.
**Builds on V0-V2 without disturbing them:** only adds classification logic inside the existing
executor; `Result` type already had 3 variants from the start (V0), so no type changes.
**Parallel tracks:** (a) target-app additions (not-found case, dismissible interstitial),
(b) recoveryRule execution engine, (c) retry/backoff/timeout logic replacing any fixed waits.
Independent, land in the same executor without conflicting.
**Verify:** run three real replays, confirm each returns the correct `Result` variant
(success / businessOutcome / failure-then-recovered-to-success) with matching evidence.
**Ship:** commit + push, tag `v3`. **(Stop-here-safe checkpoint — top 3 eval weights done.)**

## V4 — Safety & guardrails (Section 3.4, threaded not bolted)
**Build:** allowlist enforcement middleware wrapping `SurfaceAdapter.act()` (checks domain +
action-type before every action, independent of what LLM/artifact requested — defense in
depth per BEST_PRACTICES.md §7), risky-action classification (mutating/irreversible actions
require an explicit confirm step in the artifact itself), redaction pass on logs/evidence for
known sensitive field patterns (account #, SSN-like, DOB) applied at capture time.
**Definition of done:** attempt an out-of-allowlist action in a test → blocked with clear log
entry, not silently ignored. Redacted field confirmed absent from a saved evidence file.
**Builds on V0-V3 without disturbing them:** wraps existing `act()` calls, doesn't change
Artifact/Result shapes (allowlistScope was already in the V0 Artifact type).
**Parallel tracks:** (a) allowlist enforcement logic, (b) risky-action confirm-step gating,
(c) redaction pass (field-pattern rules) for logs/evidence. Independent middleware pieces
composed at the single `act()` choke point.
**Verify:** attempt one out-of-allowlist action in a test → confirm blocked + logged, not
silently swallowed. Confirm a saved evidence file has a known sensitive field redacted.
**Ship:** commit + push, tag `v4`.

## V5 — Escalation & handoff (Section 3.6)
**Build:** stuck-detection (max-steps hit during discovery, or hard-failure during replay) raises
an `InterventionRequest` (goal, step, screenshot, reason). Control-state flag on the session
(`automation | human`) checked before every `act()` call. Minimal mock operator page: shows
pending request, "take control" attaches to the same live Playwright browser context (not a
new session), lets human perform steps manually, "resume" flips control back, logs human
actions in the same structured-log format as automated steps.
**Definition of done:** one full run that hits a hard failure mid-replay, escalates, human
manually completes the step via the mock operator page, resumes, run completes — full
evidence trail of both automated and manual portions saved.
**Builds on V0-V4 without disturbing them:** control-state check added at the top of the
existing `act()` wrapper (same seam as V4's allowlist middleware); doesn't change core types.
**Parallel tracks:** (a) stuck-detection + InterventionRequest raising, (b) control-state flag +
gate logic, (c) mock Operator Surface page (separate small server/static page). Independent;
(c) only needs the shared session handle + control-state flag from (b) to attach to.
**Verify:** force a hard failure mid-replay for real, confirm escalation fires, manually
complete the step via the Operator Surface, confirm resume completes the run, confirm both
automated and human actions are in the evidence log.
**Ship:** commit + push, tag `v5`.

## V6 — Write-up + design-only breadth (Sections 3.7, deliverables)
**Build:** `REPORT.md` with the 7 required headings, written from decisions already logged in
DECISIONS.md throughout V0-V5 (not reconstructed from memory at the end). Heterogeneity/
multi-tenant sections are DESIGN ONLY — describe how `SurfaceAdapter` swaps per surface
type, and how `Artifact` would canonicalize routes/values (`/member/12345`→`/member/:id`)
and layer tenant overrides on a base artifact. Optionally, if time allows, one small stretch:
implement the canonicalization function and show it applied to a second faked "tenant variant"
of the target app page — cheapest credible proof for section 3.7.
**Definition of done:** README with exact run/replay commands, REPORT.md complete,
`/evidence/` contains discovery run + at least 3 replay runs (success/outcome/recoverable) +
one escalation run.
**Parallel tracks:** (a) REPORT.md writing (all 7 sections, drawn from DECISIONS.md), (b)
README setup/demo instructions, (c) optional canonicalization stretch. Independent.
**Verify:** fresh clone + follow README verbatim → demo commands work end-to-end.
**Ship:** commit + push, tag `v6` (final).

---

## Why this ordering survives time pressure
If you stop after V3, you already have: real LLM discovery + artifact + deterministic replay +
correct error taxonomy — the top 3 eval weights, fully real, nothing mocked. V4/V5 add the
remaining required capabilities without touching anything built before. V6 is documentation +
optional polish. Worst case (stop early), cut line is clean and defensible — exactly what
Section 5 asks you to state explicitly if you don't finish everything.

## Explicit non-goals across all versions
- No queues/services/multi-process — single process, sync execution, justified by "simpler is
  fine" (Section 4) and "no scaling infra rewarded" (Section 5/9).
- No real multi-tenant or desktop implementation — design-only per 3.7.
- No full co-browsing console — single mock operator page per Section 3.6 scope note.
