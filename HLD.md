# High-Level Design

## 1. Goals / non-goals
**Goals:** goal→LLM discovery→typed artifact→deterministic replay→escalation, all real, single
process, single surface (web target app). Design (not code) must generalize to legacy web/
desktop and multi-tenant.
**Non-goals:** multi-tenant impl, desktop impl, real-time co-browse console, queues/services/
horizontal scale, framework breadth.

## 2. System context

```
                 ┌─────────────────────────────────────────┐
   NL goal ─────▶│              Orchestrator (CLI)          │
                 │  run-agent --goal ... --target ...       │
                 │  replay     --artifact ... --input ...   │
                 └───────────────┬───────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
      ┌───────────────┐  ┌──────────────┐   ┌─────────────────┐
      │  Agent Loop    │  │  Replayer     │   │  Escalation      │
      │ (LLM in loop)  │  │ (no LLM)      │   │  Manager         │
      └───────┬────────┘  └──────┬────────┘   └────────┬─────────┘
              │  observe/act     │ observe/act          │ pause/resume
              ▼                  ▼                      ▼
      ┌─────────────────────────────────────────────────────────┐
      │              SurfaceAdapter (Playwright)                 │
      │   AX-tree + DOM + screenshot | action execution           │
      └───────────────────────┬───────────────────────────────────┘
                              │ wrapped by
                    ┌─────────┴─────────┐
                    │ Guardrail Wrapper  │  allowlist check, redaction,
                    │ (allowlist/redact) │  control-state check
                    └─────────┬─────────┘
                              ▼
                     Live target application
                     (sample bank-like app)

      Artifact Compiler: transcript (from Agent Loop) → Artifact (used by Replayer)
      Evidence Logger: structured JSON + screenshots, attached to every component above
      Operator Surface: mock page, attaches to same live SurfaceAdapter session on escalation
```

## 3. Component responsibilities
| Component | Responsibility | Talks to |
|---|---|---|
| Agent Loop | LLM observe→decide→act until goal/stop-condition | SurfaceAdapter, Evidence Logger |
| Artifact Compiler | Transcript → typed, versioned Artifact | Agent Loop output, Artifact store |
| Replayer | Execute Artifact with params, no LLM, classify Result | SurfaceAdapter, Artifact store, Evidence Logger |
| Guardrail Wrapper | Allowlist enforcement, redaction, control-state gate | Wraps every SurfaceAdapter.act() call |
| Escalation Manager | Detect stuck, raise intervention, control handoff | Guardrail Wrapper (control-state), Operator Surface |
| Operator Surface | Mock UI for human to take over live session | Same SurfaceAdapter instance (shared session) |
| Evidence Logger | Structured logs + screenshots for both run types | All components |

## 4. Key architectural decisions (see DECISIONS.md for full log)
- **Single process, synchronous** — no services/queues. Justified: brief says "simpler is fine",
  scaling infra explicitly not rewarded, single discovery/replay run doesn't need concurrency.
- **Guardrail enforced at the adapter boundary, not in the LLM prompt** — defense in depth;
  planner (LLM) is untrusted, executor is the enforcement point.
- **Artifact decoupled from transcript** — transcript is discovery-time evidence only; Artifact is
  the compiled, reviewable, versioned contract. Never mix the two.
- **Result is a 3-way discriminated union from day one** — success / businessOutcome / failure.
  Never a bare exception. This shape is fixed at V0 and never changes (see BUILD_PLAN.md).
- **SurfaceAdapter is the sole seam for surface heterogeneity** — Agent Loop, Replayer, and
  Escalation Manager only ever call `observe/act/snapshot`; swapping web→legacy-web→desktop
  means writing a new adapter, zero change to Artifact schema or callers. This is the answer to
  Section 3.7 (design-only requirement).
- **One live session shared across automation and human** — Escalation Manager doesn't spin
  up a new browser context; it exposes the existing Playwright `Page`/`BrowserContext` handle
  to the Operator Surface. Control-state flag (`automation | human`) gates the Guardrail Wrapper.

## 5. Data flow — the required end-to-end thread
1. `run-agent --goal "..." --target http://localhost:PORT` → Agent Loop drives adapter, logs to
   `/evidence/discovery-<id>/`.
2. On success, transcript → Artifact Compiler → `capabilities/<id>.json`.
3. `replay --artifact capabilities/<id>.json --input '{"memberId":"123"}'` → Replayer executes,
   no LLM, returns typed Result, logs to `/evidence/replay-<id>/`.
4. If Replayer/Agent Loop hits unrecoverable state → Escalation Manager raises intervention,
   Operator Surface shows it, human takes control of same session, resumes, Replayer/Agent
   Loop continues from control-state flip.

## 6. Failure/extension points made explicit for the write-up
- Multi-tenant: Artifact gets a canonicalization pass (concrete route/value → parameterized
  pattern) + optional tenant-override layer sitting beside the base Artifact — doesn't change
  Replayer.
- Desktop: new `SurfaceAdapter` implementation using OS accessibility APIs instead of
  Playwright — Artifact schema's locator "strategies" list already models multiple
  identification kinds generically enough to add an `axPath`/`win32Handle` strategy kind later.
