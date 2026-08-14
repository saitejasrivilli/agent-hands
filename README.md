# agent-hands

Computer-use automation system: an LLM discovers how to complete a task inside a real UI
(no API), the successful run is recorded as a typed, versioned, reusable **capability**, and
that capability replays deterministically afterward with no model in the loop.

Status: **V6+ — complete, plus two stretch goals.** All core requirements (Section 3) are
real: discovery, artifact compilation, deterministic replay with error taxonomy, safety
guardrails, and human-in-the-loop escalation with live-session handoff — with escalation now
wired into discovery as well as replay. Plus a concrete, verified cross-tenant reuse demo
(Section 4/8's stretch goal). See `REPORT.md` for the design write-up, `BUILD_PLAN.md` for the
full versioned roadmap, `HLD.md` / `LLD.md` for design, and `DECISIONS.md` for the running
decision log.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env   # then fill in ANTHROPIC_API_KEY (required for run-agent)
```

`.env` is gitignored — never commit real keys. `replay` does not need any key (no LLM
involved in replay, by design).

## Run the target app (sample legacy-style member-services console)

```bash
npm run target-app
# serves on http://localhost:4000
```

## Demo path

**1. Discovery run — real LLM drives the live app:**
```bash
node --env-file=.env node_modules/.bin/tsx src/cli.ts run-agent \
  --goal "look up member 12345 and read their current savings balance" \
  --target "http://localhost:4000/"
```
Expected: `"kind": "success"`, `outputs.savings_balance` containing the balance, and a
transcript + screenshot written to `/evidence/discovery-<id>/`.

**2. Compile that discovery run into a reusable capability:**
```bash
npx tsx src/cli.ts compile \
  --transcript evidence/discovery-<id>/transcript.json \
  --capability-id lookup-savings-balance-compiled \
  --description "Look up a member by ID and read their current savings balance." \
  --goal "look up member 12345 and read their current savings balance" \
  --target "http://localhost:4000/" \
  --discovery-run-id discovery-<id> \
  --out capabilities/lookup-savings-balance-compiled.json
```
A hand-written equivalent (`capabilities/lookup-savings-balance.json`) is also kept for
comparison — it's what V0 proved the Replayer against before any compiler existed.

**3. Replay the compiled capability — deterministic, no LLM, works on data never seen during
discovery:**
```bash
TARGET_URL="http://localhost:4000/" npx tsx src/cli.ts replay \
  --artifact capabilities/lookup-savings-balance-compiled.json \
  --input '{"memberId":"67890"}'
```
Expected: `"kind": "success"` with member 67890's balance — even though discovery only ever
saw member 12345. Evidence written to `/evidence/replay-<id>/`.

**4. See all three non-happy-path `Result` kinds for real:**
```bash
# business outcome — member doesn't exist, typed result, not a crash
TARGET_URL="http://localhost:4000/" npx tsx src/cli.ts replay \
  --artifact capabilities/lookup-savings-balance.json --input '{"memberId":"99999"}'
# -> { "kind": "businessOutcome", "code": "member_not_found", ... }

# recoverable — a dismissible "session expiring" interstitial, handled automatically
TARGET_URL="http://localhost:4000/" npx tsx src/cli.ts replay \
  --artifact capabilities/lookup-savings-balance-recoverable.json --input '{"memberId":"55555"}'
# -> { "kind": "success", ... } after a logged recovery_triggered/recovery_applied pair

# hard failure — invalid input, short-circuits before any browser launch
TARGET_URL="http://localhost:4000/" npx tsx src/cli.ts replay \
  --artifact capabilities/lookup-savings-balance.json --input '{}'
# -> { "kind": "businessOutcome", "code": "invalid_input", ... }
```

**5. Safety guardrails — allowlist + risky-action confirmation:**
```bash
# risky step blocked without explicit confirmation
TARGET_URL="http://localhost:4000/" npx tsx src/cli.ts replay \
  --artifact capabilities/lookup-savings-balance-risky-demo.json --input '{"memberId":"12345"}'
# -> { "kind": "failure", "observed": "blocked by guardrail: step 1 ... requires explicit confirmation ..." }

# same artifact, with confirmation — proceeds
TARGET_URL="http://localhost:4000/" npx tsx src/cli.ts replay \
  --artifact capabilities/lookup-savings-balance-risky-demo.json --input '{"memberId":"12345","confirm":true}'
# -> { "kind": "success", ... }
```

**6. Redaction — sensitive data never persists to evidence, even under an innocuous key:**
```bash
npx tsx scripts/redaction-demo.ts
cat evidence/redaction-demo/steps.log.jsonl
# an SSN-shaped value under a "note" field comes back "[REDACTED-SSN]";
# an "accountToken" field comes back "[REDACTED]" by key-name match
```

**7. Escalation & handoff — human takes over the SAME live session, then hands back:**
```bash
# terminal A — start a replay against an artifact with a deliberately broken
# locator, with escalation enabled
TARGET_URL="http://localhost:4000/" npx tsx src/cli.ts replay \
  --artifact capabilities/lookup-savings-balance-escalation-demo.json \
  --input '{"memberId":"12345"}' \
  --escalate --operator-port 4100

# it will block and print:
#   Operator console listening on http://localhost:4100 (waiting for human)
# open that URL in a browser — you'll see the live screenshot, the exact
# reason it's stuck, and a form to perform one manual action, e.g.:
#   actionType=extract, role=cell, name="4820.55 USD", extractAs=balance
# then click "Resume automation"
```
Expected: the replay (terminal A) completes with `"kind": "success"` using the value the
human just extracted, and `/evidence/replay-<id>/` contains `intervention.json` plus an
interleaved `system`/`human` log showing exactly what the human did.

Without `--escalate`, the same broken artifact just fails immediately (no server, no hang) —
escalation is strictly opt-in.

**8. Cross-tenant reuse — one artifact, two tenants, a small override (not a re-recording):**
```bash
# start a second target-app instance as "tenant B" (same vendor product, different config —
# its search control is a differently-labeled <button> instead of <input type=submit>)
PORT=4001 TENANT=vendorB npx tsx target-app/server.ts &

# the base artifact, UNMODIFIED, genuinely fails against tenant B
TARGET_URL="http://localhost:4001/" npx tsx src/cli.ts replay \
  --artifact capabilities/lookup-savings-balance.json --input '{"memberId":"12345"}'
# -> { "kind": "failure", "observed": "No locator strategy resolved uniquely: ..." }

# the SAME base artifact + a 6-line override succeeds against tenant B
TARGET_URL="http://localhost:4001/" npx tsx src/cli.ts replay \
  --artifact capabilities/lookup-savings-balance.json \
  --tenant-override capabilities/tenant-overrides/vendorB.json \
  --input '{"memberId":"12345"}'
# -> { "kind": "success", "outputs": { "balance": "4820.55 USD" } }
```

**9. Escalation from a stuck discovery run, not just a broken replay:**
```bash
# force discovery to hit max-steps quickly to demo escalation without waiting a full run
AGENT_MAX_STEPS=1 node --env-file=.env node_modules/.bin/tsx src/cli.ts run-agent \
  --goal "look up member 12345 and read their current savings balance" \
  --target "http://localhost:4000/" \
  --escalate --operator-port 4103
# open http://localhost:4103, perform the remaining steps manually (click Search, then
# extract the balance), click "Resume automation"
```
Expected: discovery completes with `"kind": "success"` and a summary noting it was
`"Resolved via human escalation"`, with the automated step(s) and the human's manual
actions both in the same evidence log.

## What's built so far

**V0 — skeleton + deterministic replay**
- Sample target app: server-rendered, table-based layout, deliberately missing test IDs on
  several controls (legacy-surface stand-in — see brief Section 1).
- `SurfaceAdapter` (Playwright-backed): observe/act/snapshot.
- Multi-strategy locator resolver with ordered fallback (role/AX-name → text → CSS).
- `Artifact` / `Result` types locked per `LLD.md` — unchanged for the rest of the project.
- Deterministic `Replayer`: executes a hand-authored artifact, verifies a checkpoint, returns
  a typed `Result`, writes structured evidence.

**V1 — real LLM discovery loop**
- `run-agent` CLI command: observe → decide → act loop, Claude (Anthropic Messages API,
  tool-calling, `tool_choice: any` forces exactly one action per turn) drives the same
  `SurfaceAdapter` used by replay.
- Stop conditions: max steps (default 8), wall-clock timeout (default 120s).
- Structured transcript + step log + final screenshot/AX-snapshot evidence, same format as
  replay evidence for easy diffing later.
- Verified for real: Claude completed "look up member 12345 and read their current savings
  balance" in 3 steps (type → click → extract) with zero human intervention, output matched
  the actual page value exactly.

**V2 — artifact compiler**
- `compile` CLI command: turns a discovery transcript into a typed `Artifact`, decoupled from
  the raw transcript.
- Input parameterization: a typed value is promoted to a named input parameter only if it
  appears in the original goal text (vs. a constant) — e.g. `"12345"` → `{{memberId}}`.
- Locator robustness: doesn't copy discovery's locators verbatim. For `extract` steps
  (where discovery often anchors on the literal data value, which won't generalize), the
  compiler derives a value-independent fallback by finding the adjacent label in the
  accessibility snapshot (`tr:has-text('Savings Balance')`), so the artifact resolves data it
  never saw during discovery.
- Verified for real: compiled the actual V1 transcript with zero manual edits, replayed
  successfully against both the original member and a different one never seen in discovery.

**V3 — error taxonomy**
- Business-outcome detection now runs before every step (and once more after the loop) —
  fixes the V0/V1 known gap where a not-found result used to surface as a hard failure instead
  of a typed outcome.
- `recoveryRules`: checked before each step, bounded by `maxApplications` per rule.
  `dismiss` clicks the matched element (e.g. a "Continue" link on an interstitial);
  `reloadAndRetry` reloads the page. Added a second target-app member (`55555`) with a real
  dismissible "session expiring" interstitial to exercise this for real, not simulated.
- Verified all three non-happy-path `Result` kinds with real replay runs (see demo path
  above), plus regression-checked V0's and V2's existing artifacts still replay correctly.

**V4 — safety & guardrails**
- `enforceGuardrails`: single choke point called before every step's action, checking domain
  allowlist, action-type allowlist, and risky-action confirmation — independent of what the
  artifact/LLM requested (defense in depth). A violation returns a distinct `Result.failure`
  with a clear `"blocked by guardrail: ..."` reason, not a generic error.
- `Step.risky` (optional, backward-compatible): a risky step is blocked unless the caller
  passes `inputs.confirm === true`. Deliberately blunt — no partial confirmation, no scoring.
- Redaction fixed and hardened: `writeResult`/`writeJson` used to bypass redaction entirely
  (only `log()` was covered) — now all three go through the same recursive redaction pass.
  Added value-pattern matching (SSN-shaped values) so sensitive data under an innocuous key
  name still gets caught, not just fields whose name says "password"/"token"/etc.
- Verified all three for real: domain violation blocked, risky step blocked-then-allowed with
  confirmation, and a fake SSN/API-token redacted from persisted evidence (see demo path
  above and `scripts/redaction-demo.ts`).

**V5 — escalation & handoff**
- On a hard failure (locator resolution), if `--escalate` is passed, the Replayer raises an
  `InterventionRequest` and starts a small local operator console bound to the SAME
  `PlaywrightAdapter`/`Page` the paused replay was using — the human operates the live
  session, not a fresh one.
- Operator console (bare/mock per the brief's own scope note): shows the live screenshot +
  exact stuck reason, exposes a manual-action form, and a "Resume" button. Human actions are
  logged in the same structured format as automated steps (`actor: "human"`).
- Escalation is opt-in (`--escalate`, default off) — V0-V4's verified automated behavior is
  completely unchanged without it; confirmed by regression test (same broken artifact fails
  immediately, no hang, when the flag isn't passed).
- On resume, replay continues at the next step (trusts the human completed the failed step's
  intent manually) rather than blindly retrying the same broken locator.
- Verified for real, full loop: broken artifact → escalate → manual fix via the operator
  console → resume → `Result.success` using the human-provided value, with full evidence
  trail (`intervention.json` + interleaved system/human log + before/after screenshots).

**Post-V6 stretch goals**
- **Cross-tenant reuse via override** (`src/artifact/tenant-override.ts`): a base `Artifact`
  plus a small per-step override merges into a tenant-specific artifact, sharing everything
  else. Demonstrated against a genuinely different second target-app tenant, not a toy
  example — verified the base artifact actually fails unmodified, actually succeeds with the
  override, and the base tenant is unaffected either way.
- **Escalation wired into discovery**, not just replay: `runDiscovery` takes the same opt-in
  `enableEscalation` option as `replay`. On any stuck exit, escalates against the same live
  discovery browser session; the human's actions get merged into the discovery outputs.
  Found and fixed a real bug while verifying this (see DECISIONS.md): the stuck-path return
  wasn't awaited before a `finally` block closed the browser, crashing mid-escalation.

## Known limitations (tracked, not accidental)
- `run-agent`'s locator strategy is role/accessible-name only (no fallback chain yet) — the
  Replayer's multi-strategy fallback is not used during discovery, only during replay.
- `retryStep` recovery action is a declared no-op (the step loop naturally retries on its next
  pass) — only `dismiss` and `reloadAndRetry` perform an explicit action.
- `lookup-savings-balance-risky-demo.json` marks a harmless step risky purely to exercise the
  gate mechanism — no real mutating/irreversible capability (e.g. submit-new-subaccount) has
  been built yet to carry a risky flag naturally.
- Operator console's manual-action form only supports `role`+`name` locator strategy (not the
  full locator fallback chain) — sufficient to prove the handoff mechanism, but a real
  operator UI would likely offer more targeting options.
- Escalation currently only triggers on `LocatorResolutionError` during replay, not on
  discovery getting stuck (max-steps/timeout) — the mechanism (`escalate()`) is
  surface-agnostic and could be wired into the Agent Loop too, but wasn't required for V5's
  definition of done.

**V6 — write-up**
- `REPORT.md`: the 7 required sections (Architecture, Artifact schema, Determinism & error
  handling, Heterogeneity & multi-tenant, Escalation & handoff, Safety, Cuts), drawn from the
  decisions logged throughout V0-V5 rather than reconstructed after the fact.

**Post-V6 hardening**
- Fixed the compiled-artifact output-shape inconsistency flagged in REPORT.md's original Cuts
  list: the compiler's derived fallback locator matched a whole `<tr>` (label+value
  concatenated) instead of just the value cell. Fixed in both the compiler (future compiled
  artifacts) and the existing hand-authored capability files (`td:nth-child(2)` scoping).
  Re-verified all 4 affected artifacts — consistent bare-value output regardless of which
  locator strategy resolves; business-outcome and escalation paths regression-checked.

## Deliverables checklist (per the brief's Section 6)
- `/README.md` — this file: setup, exact demo commands, what's built.
- `/REPORT.md` — design write-up, 7 required headings.
- `/evidence/` — real discovery run, real replay runs covering all 3 `Result` kinds, a
  guardrail-block example, a redaction example, and a full escalation/handoff run.

## Roadmap
See `BUILD_PLAN.md` for the full versioned build history. See `REPORT.md` §7 ("Cuts") for
what's deliberately left out and what would come next with more time.
