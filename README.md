# agent-hands

Computer-use automation system: an LLM discovers how to complete a task inside a real UI
(no API), the successful run is recorded as a typed, versioned, reusable **capability**, and
that capability replays deterministically afterward with no model in the loop.

Status: **V2** (discovery transcript compiles into a replayable capability — the full
discover-once/replay-forever loop is closed). See
`BUILD_PLAN.md` for the full versioned roadmap, `HLD.md` / `LLD.md` for design, and
`DECISIONS.md` for the running decision log.

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

## Known limitations (tracked, not accidental)
- The not-found business-outcome path currently hard-fails mid-flow instead of being
  classified as a business outcome — intentionally deferred to V3's error-taxonomy work.
- `run-agent`'s locator strategy is role/accessible-name only (no fallback chain yet) — the
  Replayer's multi-strategy fallback is not used during discovery, only during replay.
- Compiled artifacts' extracted output shape isn't stable across which locator strategy
  resolves (bare value vs. full row text) — see DECISIONS.md. Not a correctness bug (both are
  truthy successful extractions), but worth a real fix (structured label/value parsing) if
  time allows.

## Roadmap
See `BUILD_PLAN.md`. Next: V3 — error taxonomy (business outcome / recoverable / hard failure).
