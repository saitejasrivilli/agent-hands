# agent-hands

Computer-use automation system: an LLM discovers how to complete a task inside a real UI
(no API), the successful run is recorded as a typed, versioned, reusable **capability**, and
that capability replays deterministically afterward with no model in the loop.

Status: **V0** (skeleton + deterministic replay proven against a hand-written capability). See
`BUILD_PLAN.md` for the full versioned roadmap, `HLD.md` / `LLD.md` for design, and
`DECISIONS.md` for the running decision log.

## Setup

```bash
npm install
npx playwright install chromium
```

## Run the target app (sample legacy-style member-services console)

```bash
npm run target-app
# serves on http://localhost:4000
```

## Replay a capability (V0: no LLM involved yet — see V1 for the discovery loop)

```bash
TARGET_URL="http://localhost:4000/" \
  npx tsx src/cli.ts replay \
  --artifact capabilities/lookup-savings-balance.json \
  --input '{"memberId":"12345"}'
```

Expected output: a `Result` object with `"kind": "success"` and the extracted balance.
Evidence (structured step log + result) is written to `/evidence/replay-<id>/`.

## What's built so far (V0)
- Sample target app: server-rendered, table-based layout, deliberately missing test IDs on
  several controls (legacy-surface stand-in — see brief Section 1).
- `SurfaceAdapter` (Playwright-backed): observe/act/snapshot.
- Multi-strategy locator resolver with ordered fallback (role/AX-name → text → CSS).
- `Artifact` / `Result` types locked per `LLD.md` — unchanged for the rest of the project.
- Deterministic `Replayer`: executes a hand-authored artifact, verifies a checkpoint, returns
  a typed `Result`, writes structured evidence.

## Known V0 limitation (tracked, not accidental)
The not-found business-outcome path currently hard-fails mid-flow instead of being classified
as a business outcome — this is intentionally deferred to V3's error-taxonomy work (see
`BUILD_PLAN.md` V3 and `DECISIONS.md`).

## Roadmap
See `BUILD_PLAN.md`. Next: V1 adds the real LLM-driven discovery loop.
