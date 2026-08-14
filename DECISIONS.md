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
- **Known V2 output-shape inconsistency (documented, not fixed yet)**: which locator strategy
  resolves determines the extracted string's shape — the primary (role+exact-value) strategy
  returns the bare value (`"4820.55 USD"`), while the label-based cssPath fallback returns the
  full row text (`"Savings Balance132.10 USD"`, label+value concatenated with no separator,
  since the row's cells are directly adjacent in the legacy table markup). Both are truthy
  successful extractions (not a correctness bug), but the output contract isn't shape-stable
  across which strategy hit. Left as-is for V2 (scope was proving zero-edit reuse works, which
  it does); a real fix would parse structured label/value pairs instead of raw row text —
  candidate for "Cuts" section of REPORT.md if not addressed later.

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

## Decisions pending
- Exact stop-condition thresholds (max steps, timeout values) for the agent loop
- Exact set of "risky/irreversible" action types requiring explicit confirm step
- Redaction field-pattern list (which field names/regexes trigger redaction)
- Whether to implement the route-canonicalization stretch (multi-tenant credibility) or leave fully design-only
- Mock Operator Surface: bare HTML page vs CLI — leaning HTML page for screenshot-ability in evidence
