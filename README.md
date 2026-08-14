# agent-hands

Computer-use automation system: an LLM discovers how to complete a task inside a real UI
(no API), the successful run is recorded as a typed, versioned, reusable **capability**, and
that capability replays deterministically afterward with no model in the loop.

Status: **V1** (real LLM discovery loop + deterministic replay both proven). See
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

**2. Replay — the hand-written equivalent capability, deterministic, no LLM:**
```bash
TARGET_URL="http://localhost:4000/" \
  npx tsx src/cli.ts replay \
  --artifact capabilities/lookup-savings-balance.json \
  --input '{"memberId":"12345"}'
```
Expected: `"kind": "success"` with the same balance. Evidence written to
`/evidence/replay-<id>/`.

(V2 will compile the discovery transcript directly into a replayable artifact, closing the
loop fully — currently the artifact is hand-authored, matching V0's scope.)

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

## Known limitations (tracked, not accidental)
- The not-found business-outcome path currently hard-fails mid-flow instead of being
  classified as a business outcome — intentionally deferred to V3's error-taxonomy work.
- Discovery transcripts are not yet compiled into artifacts automatically (V2).
- `run-agent`'s locator strategy is role/accessible-name only (no fallback chain yet) — the
  Replayer's multi-strategy fallback is not used during discovery, only during replay.

## Roadmap
See `BUILD_PLAN.md`. Next: V2 — compile a V1 discovery transcript into a replayable artifact.
