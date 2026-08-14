# interface.ai Take-Home — Context & Decisions Log

Running log of key context and decisions for the "Computer-Use Automation System" take-home
(Senior Software Engineer application, interface.ai). Update as decisions get made.

## Assignment source
- Brief: `Assignment A — Computer-Use Automation System.pdf` (in ~/Downloads)
- Sender verified legit: content matches PDF, domain matches interface.ai official site, no phishing indicators.
- Role: Senior Software Engineer, interface.ai (SF, in-person 5x/week). Stack per JD: TypeScript/Python backend, JS frontend, AWS/GCP, LLM/agentic AI integration (applied, not research).
- No starter repo/codebase provided — build from scratch, own stack, public GitHub repo, email link to assignments@interface.ai. No deadline.

## What's being graded (in weight order)
1. System design — artifact schema + replay contract are central
2. Correctness of core loop — agent completes real goal, replay verifies deterministically
3. Robustness/error handling — expected outcome vs recoverable vs hard failure taxonomy
4. Human-in-the-loop escalation — real control-transfer mechanism, not a TODO
5. Generalization design (heterogeneity + multi-tenant) — write-up only, not built
6. Safety & data handling — allowlist, risky-action policy, redaction
7. Code quality
8. Communication (REPORT.md)

Explicitly NOT rewarded: feature breadth, framework name-dropping, building scaling infra (queues/clusters/multi-tenant plumbing).

## Required deliverables (exact paths)
- `/README.md` — setup/run instructions + exact demo command(s): run agent on goal → replay artifact
- `/REPORT.md` (~1-3 pages), exactly these 7 headings: Architecture / Artifact schema / Determinism & error handling / Heterogeneity & multi-tenant / Escalation & handoff / Safety / Cuts
- `/evidence/` — real LLM discovery run logs + saved artifact + replay run logs (ideally one replay hitting an error/exceptional state)

## Non-negotiable
- At least one genuine LLM-driven discovery run against a live surface — must be real, not described. Evidence required.

## Decisions made so far
- **Stack**: TypeScript + Playwright (matches interface.ai JD stack; Playwright gives AX-tree + DOM + screenshot under one API).
- **LLM**: Claude or GPT-4o, tool-calling style loop (observe=snapshot, act=structured tool call).
- **Target app**: self-hosted sample bank-like app (search member → detail → new sub-account form → confirmation), deliberately table-layout/no-test-IDs on some fields to force the "no clean DOM" problem without ToS/rate-limit risk of a public site.
- **Architecture**: single process, synchronous, CLI-driven (`run-agent`, `replay`). No queues/services — justified by "simpler is fine" + scaling infra explicitly not rewarded.
- **Core types locked at V0, never changed after** (see LLD.md §1): `SurfaceAdapter` (observe/act/snapshot), `Artifact` (typed capability contract w/ multi-strategy locators, versioned), `Result` (discriminated union: success | businessOutcome | failure). All later versions (V1-V6 in BUILD_PLAN.md) only add behavior around these three, never break their shape.
- **Locator strategy**: ordered fallback list per element (testid > role/AX > text > cssPath > coordinates), resolved in order, log which strategy hit — cheap drift-detection hook for later.
- **Guardrails enforced at the adapter boundary** (single choke point wrapping every `act()` call), not trusted to the LLM/artifact — defense in depth.
- **Escalation shares the live session**: Operator Surface attaches to the same Playwright `BrowserContext`/`Page`, gated by a `controlState` flag (`automation | human`) checked before every guarded action — no fresh session spun up for the human.
- **Artifact stays decoupled from raw transcript**: transcript is discovery-time evidence only (`/evidence/discovery-<id>/`), Artifact Compiler produces the reviewable versioned contract separately.
- **Build order mirrors eval weight**: schema+replay+error-taxonomy (V0-V3) before escalation (V5) before design-only breadth (V6) — see BUILD_PLAN.md for full phased plan and definition-of-done per version.
- **HLD/LLD docs**: `HLD.md` (components, data flow, architectural decisions) and `LLD.md` (exact types, algorithms, file layout) written up front, before implementation — kept in sync as source of truth for REPORT.md later.

- **Workflow model**: parallel-within-version, serial-across-versions. Each V(n) has independent
  sub-tracks buildable concurrently (only depend on locked interfaces, not each other). V(n+1)
  never starts until V(n) passes its Definition-of-Done with a real evidence-producing test run
  AND is committed+pushed to GitHub (branch-per-version: `v0-skeleton`...`v6-writeup`, tag on
  merge: `v0`...`v6`). Every tag is independently checkoutable and demoable at that scope. See
  BUILD_PLAN.md "Workflow rule" section + per-version Parallel tracks/Verify/Ship lines.

- **V0 known gap (by design, not a bug)**: the `lookup-savings-balance` artifact's extract step
  hard-fails on a not-found member (no "Savings Balance" row exists to extract) instead of
  reaching the business-outcome check, which currently only runs after all steps complete.
  Acceptable for V0 (only proves the happy-path executor). V3 fixes this properly by adding
  mid-flow business-outcome detection (check for "no member found" marker before attempting
  extract, not only at the end) — tracked as V3 scope, not deferred accidentally.

- **LLM provider switched OpenAI → Anthropic (Claude) for V1**: the env's `OPENAI_API_KEY`
  returned 401 (invalid/rotated). User supplied several fresh keys via a local `.env`
  (gitignored, verified untracked/never committed before use — confirmed via `git check-ignore`
  + `git log --all -- .env` before touching it, since keys couldn't be rotated). Tested each
  key's validity by HTTP status code only (never printed key values or full response bodies).
  Anthropic/Groq/Gemini/Cohere all valid; picked Anthropic since it matches the brief's own
  encouraged tooling (Claude Code) and interface.ai's JD. `AGENT_MODEL` env var makes the
  choice swappable without code changes.
- **Secrets handling for local dev**: `.env.example` (committed, placeholder values only) +
  `.env` (gitignored, real keys) using Node 25's native `--env-file` flag — no `dotenv`
  dependency added, keeps V0's minimal dependency footprint.
- **Real finding, not a bug**: my own `layout()` HTML wrapper in the target app nested the
  entire page body inside an outer `<table>`, which made every `role=cell` locator ambiguous
  (the outer wrapping `<td>`'s accessible name concatenates all descendant text, so any
  substring match on inner cell text also hit the outer cell). This surfaced for real during
  the first genuine LLM discovery run — Claude picked a reasonable `cell`+text locator, the
  resolver correctly refused the ambiguous match rather than guessing (per BEST_PRACTICES.md
  §1), and the run went `stuck` after retrying for `max_steps`. Fixed by removing the
  redundant outer table from `layout()` (kept the real per-field data table, which is the
  actual "legacy surface" being tested) — not a workaround, a correction of self-inflicted
  over-legacy-ness that wasn't part of the intended design. V0's replay artifact was
  re-verified unaffected after the fix.
- **V1 discovery loop uses only `role`+accessible-name locators** (no multi-strategy fallback
  during discovery) — intentionally simpler than the Replayer's fallback chain; discovery's
  job is to produce a transcript, robustness/fallback strategy generation happens in V2's
  artifact compiler, not duplicated in the agent loop itself.
- **Stop conditions**: max 8 steps, 120s wall-clock timeout, both env-overridable
  (`AGENT_MAX_STEPS`, `AGENT_TIMEOUT_MS`). Chosen as generous-but-bounded defaults for a
  3-5 step flow; not tuned further since V1's only requirement was one genuine successful run.

- **Verified reproducibility is intentionally asymmetric**: ran discovery twice with identical
  goal/target — both reached the correct answer but used slightly different tool-call phrasing
  (one run's model added an extra output key `current_savings_balance` alongside
  `savings_balance`). This is expected LLM non-determinism, not a bug — it's the reason
  discovery and replay are separate paths. Ran replay 3x with identical input — byte-identical
  output every time, confirming the Replayer itself is deterministic as designed. This
  asymmetry (discovery varies, replay doesn't) is a good REPORT.md talking point for
  "Determinism & error handling."

- **V2 artifact compiler design**: transcript's own locators are data-specific (the LLM
  identified the balance cell by its literal value, e.g. `role=cell name="4820.55 USD"` —
  only correct for one member). The compiler doesn't just copy discovery's locator verbatim;
  for `extract` steps it derives a value-independent fallback (`tr:has-text('<label>')`) by
  scanning the accessibility snapshot for the label cell adjacent to the extracted value.
  Input parameterization: a `type` action's value is promoted to a named input parameter only
  if that literal value appears in the original goal text (heuristic — "came from the goal"
  vs "constant"), named via camelCase of the control's accessible name (`"Member ID"` →
  `memberId`).
- **Verified V2 for real**: compiled `capabilities/lookup-savings-balance-compiled.json` from
  the actual V1 discovery transcript (`discovery-1786735865567`), replayed it with **zero
  manual edits** against (a) the same member (12345, matches discovery) and (b) a **different**
  member (67890, never seen during discovery) — both succeeded. Member 67890's run correctly
  fell through to the compiler-derived fallback locator (the primary value-specific strategy
  correctly failed to match), proving the fallback-chain design actually generalizes, not just
  in theory.
- **V2 output-shape inconsistency — found, documented, then fixed post-V6**: which locator
  strategy resolved used to determine the extracted string's shape — the primary
  (role+exact-value) strategy returned the bare value (`"4820.55 USD"`), while the label-based
  cssPath fallback returned the whole row's concatenated text (`"Savings Balance132.10 USD"`).
  Root cause: the fallback locator (`tr:has-text('<label>')`) matched the entire `<tr>`, not
  just the value cell. Fix: scope the fallback to the row's second cell
  (`... tr:has-text('<label>') td:nth-child(2)`), in both the compiler (so future compiled
  artifacts get this automatically) and the existing hand-authored capability files. Verified:
  re-ran all 4 affected artifacts (V0's hand-written, V2's compiled against both the seen and
  unseen member, V3's recoverable flow) — all now return the bare value regardless of which
  strategy resolves; business-outcome and escalation paths regression-checked unaffected.

- **V3 error taxonomy — fixed the V0 known gap for real**: business-outcome detection now
  runs before every step (and once more after the loop), not just at the end — a not-found
  marker appearing mid-flow is now correctly classified as `businessOutcome` instead of
  falling through to a locator-resolution `failure`. Added a second target-app member
  (`55555`) with a deliberate dismissible "session expiring" interstitial to exercise the
  recoverable-condition path for real (not simulated) — `recoveryRules` are checked before
  each step, bounded by `maxApplications` per rule, and only `dismiss` (click the matched
  element) and `reloadAndRetry` (page reload) are implemented; `retryStep` is a no-op marker
  since the step loop naturally retries on its next pass.
- **Verified all 3 `Result` variants for real, same session**: success (member 12345,
  regression-checked, unaffected), businessOutcome (member 99999 → `member_not_found`, no
  longer a hard failure), recoverable-then-success (member 55555 → interstitial dismissed,
  confirmed via `recovery_triggered`/`recovery_applied` log events firing at the expected
  point in the sequence, not just a lucky pass). Also regression-checked V2's compiled
  artifact still replays correctly after the shared Replayer changes — no breakage.

- **V4 guardrail wrapper**: single choke point (`enforceGuardrails`, called before every
  step's action in the Replayer) checking domain allowlist, action-type allowlist, and
  risky-action confirmation — independent of what the artifact/LLM requested, not trusted to
  either (defense in depth per BEST_PRACTICES.md §7). A violation returns a distinct,
  clearly-labeled `Result.failure` (`observed: "blocked by guardrail: ..."`) rather than being
  swallowed into a generic locator/timeout error.
- **Risky-action policy**: added an optional `Step.risky` flag (backward-compatible addition
  to the "locked" V0 types — existing artifacts parse unchanged since it's optional). A risky
  step is blocked unless the caller passes `inputs.confirm === true`. This is a blunt
  mechanism deliberately: no partial/implicit confirmation, no risk-scoring — matches
  BEST_PRACTICES.md §5's "handle the risky class conservatively" guidance. Real risky actions
  in this domain would be mutating/irreversible ones (e.g. submitting the new-subaccount
  form); the shipped demo (`lookup-savings-balance-risky-demo.json`) marks a harmless step
  risky purely to exercise the gate mechanism honestly, and says so in its own description.
- **Redaction made recursive + value-pattern based**: the V0-era redaction only checked
  top-level key names on `log()` calls. V4 fixes two real gaps found while building this:
  (1) `writeResult`/`writeJson` bypassed redaction entirely — fixed, now redacted like `log()`.
  (2) redaction was shallow — a sensitive value nested inside an object (e.g. inside
  `outputs`) wasn't touched. Now recursive, and adds an SSN-shaped value-pattern check
  (`\d{3}-\d{2}-\d{4}`) so a sensitive value under an innocuous key name (e.g. a "note" field)
  still gets redacted, not just fields whose name obviously says "ssn"/"password"/etc.
- **Verified all three V4 mechanisms for real**: (1) domain-allowlist violation — an artifact
  copy with `allowlistScope.domains: ["evil.example.com"]` correctly blocked against the real
  localhost target, clear reason logged. (2) risky-action gate — blocked without
  `inputs.confirm`, proceeded and succeeded with it. (3) redaction — a script logging a fake
  SSN under a generic "note" key (both top-level and nested inside a result's `outputs`) came
  back `[REDACTED-SSN]` in the persisted evidence file; a fake API token under `accountToken`
  came back `[REDACTED]` by key-name match. See `scripts/redaction-demo.ts`.

- **V5 escalation/handoff mechanism**: on a `LocatorResolutionError`, if `--escalate` is
  passed, the Replayer raises an `InterventionRequest` (capability, step index, reason,
  screenshot) and starts a small local HTTP server (`src/escalation/manager.ts`) bound to the
  SAME `PlaywrightAdapter`/`Page` instance the paused replay was using — the human operates
  the live session, not a fresh one, satisfying the brief's explicit requirement. The
  operator page (bare/mock per Section 3.6's scope note) shows the live screenshot + context
  and exposes a manual-action form (role/name/value/extractAs) plus a "Resume" button. Human
  actions are logged via the same `EvidenceLogger` in the same format as automated steps
  (`actor: "human"` vs `"system"`), preserving one unified audit trail across the handoff.
- **Escalation is opt-in** (`enableEscalation` option, default `false`): V0-V4's already-
  verified automated behavior (hard failure → immediate `Result.failure`) is completely
  unchanged unless a caller explicitly passes `--escalate`. Verified: the same broken artifact
  fails immediately (no server started, no hang) without the flag, and escalates correctly
  with it — confirmed by regression-testing both paths.
- **Control-transfer model**: rather than a separately-checked `controlState` flag polled by
  concurrent automation code, the replay loop itself is structurally blocked (an `await` on
  the resume signal) for the whole duration of human control — Node's single-threaded event
  loop means there is no concurrent automation action possible while that await is pending.
  Documented as a deliberate simplification: it achieves the same guarantee (automation
  cannot act while a human has control) with less code than an explicitly-polled flag, given
  this system has no background workers. A multi-worker design would need the explicit flag.
- **On resume, replay continues at the NEXT step, not a retry of the failed one**: the human
  is assumed to have completed the failed step's intent manually (e.g. performed the extract
  themselves) rather than "unstuck" the exact same broken locator for an automated retry —
  matches real operator behavior (a human fixes the outcome, not the selector).
- **Verified for real, full loop**: built a deliberately-broken artifact (extract step's only
  locator strategy guaranteed to never match), ran replay with `--escalate`, confirmed the
  operator console rendered the live screenshot + exact failure reason, POSTed a manual
  extract action against the SAME session (simulating a human clicking the form — a real
  person could use the identical page instead of curl), confirmed the control-state update,
  resumed, and the run completed with `Result.success` using the human-provided value. Full
  evidence trail (`intervention.json` + interleaved system/human log entries + before/after
  screenshots) inspected and confirmed correct.

- **V6 — REPORT.md written from the decision log, not reconstructed from memory**: every
  claim in REPORT.md traces to something actually built and verified in V0-V5 (this file).
  Trimmed from an initial ~2100-word draft to ~1460 words to fit the brief's "~1-3 pages"
  guidance without losing any verified claim — cut redundant restatement, not substance.
- **Dashboard/web UI explicitly declined** (see conversation record, user asked "how to
  approach V4/UI" earlier in the project): recommended CLI-only, deferred a mock operator
  console to V5 rather than building a general dashboard — matches the brief's "no feature
  breadth" guidance and was a judgment call made and confirmed mid-project, not a default.
- **Project complete at V6**: all 6 core requirements from Section 3 are real and verified;
  all 3 required deliverables (README, REPORT.md, /evidence/) are in place. Remaining items
  are documented as future work in REPORT.md §7, not silently missing.

- **Stretch: tenant-override / cross-tenant reuse implemented concretely**, not left
  design-only. Added a second target-app "tenant" (`TENANT=vendorB` env var) that renders the
  search control as a `<button>` with a different label instead of `<input type=submit
  value="Search">` — a realistic same-vendor-product, different-institution config
  difference, chosen specifically so the base artifact's *existing* generic CSS fallback
  (`input[type=submit]`, which survives a label-only rename) would still genuinely break, so
  the override is actually necessary rather than coincidentally optional. Built
  `applyTenantOverride(base, override)` (`src/artifact/tenant-override.ts`): merges a small
  per-step target override onto a base `Artifact`, leaving everything else (schema, other
  steps, checkpoint, allowlist) shared. Verified for real, three ways: (1) base artifact
  unmodified against tenant B → `Result.failure` (locator resolution, both strategies miss);
  (2) base artifact + `capabilities/tenant-overrides/vendorB.json` against tenant B →
  `Result.success`; (3) base artifact unmodified against the base tenant → still succeeds,
  unaffected. This is the brief's own stretch-goal language delivered literally: "one artifact
  recorded on a base app being applied to a second, slightly different variant... with
  per-variant overrides."
- **Escalation wired into discovery, not just replay** (was listed as future work in
  REPORT.md's original Cuts list, now done). `runDiscovery` takes the same opt-in
  `DiscoveryOptions` shape as `ReplayOptions` (`enableEscalation`, default off). On any stuck
  exit (timeout / no tool call / max-steps), if enabled, calls the same `escalate()` used by
  the Replayer against the same live discovery browser session. If the human performs at
  least one action, discovery returns `DiscoveryResult.success` with a summary noting human
  resolution and the human's outputs merged in; otherwise falls back to the original `stuck`
  result. **Found and fixed a real bug while verifying this**: `return stuckOrEscalate(...)`
  inside a `try` block does not implicitly await the returned promise before the wrapping
  `finally { adapter.close() }` runs — so the browser was being closed out from under the
  in-progress escalation, crashing mid-run (`page.screenshot: Target page ... has been
  closed`). Fixed by awaiting explicitly (`return await stuckOrEscalate(...)`) at all three
  call sites. Verified for real after the fix: forced a stuck state (`AGENT_MAX_STEPS=1`),
  escalated, performed the two remaining steps manually via the operator console, resumed,
  discovery completed with the correct value and a full system/human evidence trail.
  Regression-checked both without the flag (unchanged stuck behavior, confirms the fix didn't
  just paper over the crash) and the Replayer's own escalation path (unaffected, since both
  now share the same `escalate()` implementation).

- **V8 — strict self-review, then fixed every finding rather than just noting it.** Asked for
  a grading pass against the brief's own weighted eval criteria; every "weak point" the review
  surfaced was closed and independently re-verified, not just annotated:
  - Removed dead code: `src/agent/openai-client.ts` (superseded by Anthropic in V1, never
    deleted — updated the one stray comment in `anthropic-client.ts` that referenced it).
  - Built a real mutating capability, `capabilities/open-new-subaccount.json` (fills the
    account-type/deposit form, submits, creates a sub-account, returns a confirmation
    number). Its submit step carries `risky: true` for real, not as a harness. Retired the
    old `lookup-savings-balance-risky-demo.json` (harmless step marked risky purely to
    exercise the gate). Verified blocked without confirmation and succeeding — with a real
    confirmation number (`SA-100001`) — with it.
  - Split business-outcome markers into `src/replay/business-outcomes.ts` (policy, separate
    from the replay mechanism) and added a genuinely distinct second entry
    (`permission_denied`), backed by a real restricted-member (`40404`) scenario added to the
    target app — proves the taxonomy is a real set of policies, not one regex.
  - Split redaction patterns into `src/evidence/redaction-patterns.ts` (config, separate from
    the logger mechanism) and broadened value-pattern coverage (card, email, phone) plus
    key-name coverage (DOB, account/routing numbers, PIN). **Caught a real bug before
    shipping**: an initial card-number pattern (`\b(?:\d[ -]?){13,19}\b`) matched bare
    13-19-digit runs — which would have redacted every `evidenceId` (a 13-digit `Date.now()`
    timestamp) as a false positive. Verified the collision directly (`'1786737312169'.match(...)`
    returned a match), then fixed by requiring visible digit-grouping
    (`\d{4}[ -]\d{4}[ -]\d{4}(?:[ -]?\d{1,4})?`), re-verified the fix doesn't match the
    evidenceId shape but still matches formatted card numbers, and added a regression test.
  - Broadened the operator console's manual-action form to support `navigate`, not just
    `role`+`name` locator-based actions — addresses the "can only fix locator failures, not
    wrong-page failures" limitation.
  - **Added an automated test suite** (`tests/`, run via `npm test` — Node's built-in test
    runner + `tsx`, no new dependency): 16 tests, genuine integration tests (real spawned
    target-app child process per suite, real Playwright), covering all 3 `Result` kinds
    (including both business-outcome codes), both guardrail mechanisms (allowlist + the real
    risky-action gate), redaction (4 value patterns + key-name match + the evidenceId
    false-positive regression), and the tenant-override merge (fast, no browser needed for
    this one). Confirmed self-contained: no leftover evidence dirs or orphaned processes
    after a full run.
  - This was, by the review's own assessment, the single biggest gap: every prior
    verification in the project (V0-V7) was a manual CLI run reproduced by hand: correct, but
    with nothing to catch a future regression except remembering to re-run things.

- **V9 — closed the remaining gaps from a second strict review, one push-back**. Pushed back
  on building a real `axPath`/desktop locator adapter: the brief explicitly says desktop
  support isn't expected, and there's no real desktop target in this project to verify an
  adapter against — building it would be unverified speculative code, the exact thing this
  hardening effort was meant to eliminate elsewhere. Fixed everything else:
  - **Found a real latent bug while planning the organic-escalation fix**: the Replayer's step
    loop only caught `LocatorResolutionError` specifically; any other thrown error (a genuine
    Playwright timeout, a network error) would propagate uncaught and crash the whole process
    instead of returning a typed `Result.failure`. Broadened the catch to `err instanceof
    Error` generally, distinguishing `locator_resolution` vs `unexpected_error` reasons in the
    result/log.
  - **Organic escalation, verified for real**: added target-app member `88888` with a genuine
    `responseDelayMs` (7000ms) simulating a slow legacy backend — no artifact anywhere is
    hand-broken. First attempt to reproduce a failure didn't work: Playwright's `locator.click()`
    absorbed the full delay internally before returning, so the run just succeeded slowly
    (confirmed by timing the run at ~8.2s). Fix required `page.setDefaultTimeout()` (governs
    locator actions like click/fill) — NOT `setDefaultNavigationTimeout()` (only governs
    explicit `goto`/`waitForNavigation`), which was my first, wrong attempt and also produced
    a silent full-delay success. Verified the real fix produces a genuine
    `"Timeout 5000ms exceeded"` error against the unmodified base artifact, and that
    `--escalate` resolves it via the operator console exactly like the engineered demos.
  - **Found a second real bug via the above**: `Step.timeoutMs`/`retry` had been declared on
    the artifact schema since V0 but were never actually read anywhere in execution — a step
    either resolved on one immediate `.count()` check or failed, no retry/backoff despite the
    schema and REPORT.md both implying otherwise. Implemented `resolveLocatorWithBudget`
    (condition-based polling bounded by the declared timeout/retry, no fixed `sleep()`),
    wired through `ActFor`/`PlaywrightAdapter.act()`/`executeStep`. Regression-verified the
    full suite unaffected.
  - **Generic route canonicalization** (`src/artifact/route-canonicalization.ts`,
    `canonicalizeRoute()`): normalizes numeric path segments and query values to `:param`
    placeholders, independent of `tenant-override.ts`'s per-step editing. Wired into the
    compiler as an additive `Artifact.canonicalRoutes` field; verified on the real committed
    discovery transcript (`/member?memberId=12345` → `/member?memberId=:memberId`).
    Unit-tested, no browser needed.
  - **Distinct risky-action approval record**: `EvidenceLogger.recordApproval()` writes to a
    separate `approvals.jsonl`, called from `checkRiskyConfirmed` only when a risky step
    actually passes its confirmation gate. Verified: a real confirmed run of
    `open-new-subaccount.json` produced a correct, separate approval entry.
  - **Discovery-path guardrails**: `runDiscovery` now takes `allowedDomains` (default: the
    target's own hostname) and calls the same `checkDomainAllowed` the Replayer uses, before
    every action. A `GuardrailViolation` here stops the run immediately (`stuck`, reason
    `guardrail_blocked`) rather than escalating — deliberately not escalatable, since letting
    a human simply wave through an out-of-policy domain would defeat the point of the
    allowlist existing at all. Verified: a deliberately restrictive `--allowed-domains` value
    blocks a real discovery run immediately, distinct from a retryable act failure.
  - Redaction broadened further (DOB, IPv4 value patterns), verified they don't false-positive
    on ordinary currency-shaped or version-shaped strings.
  - Added pure-logic unit tests (`route-canonicalization.test.ts`, extended
    `redaction.test.ts`) alongside the integration suite — `redaction.test.ts` and
    `tenant-override.test.ts` were already effectively unit tests (no browser dependency),
    which the round-1 "no fast unit-test layer" framing had understated.
  - Full regression: 21/21 automated tests pass after every change in this round.

## Decisions pending (resolved / consciously left as future work — see REPORT.md §7)
- ~~Exact stop-condition thresholds~~ — resolved: max 8 steps / 120s, env-overridable (V1).
- ~~Risky/irreversible action gating~~ — resolved: `Step.risky` + `inputs.confirm` (V4). No
  real mutating capability built to carry it naturally — left as future work.
- ~~Redaction field-pattern list~~ — resolved: key-name + SSN value-pattern (V4). Left as
  future work: broaden beyond this illustrative set for production use.
- Route-canonicalization stretch — left fully design-only (REPORT.md §4); not implemented.
- ~~Mock Operator Surface~~ — resolved: bare HTML page, screenshot embedded directly (V5).
