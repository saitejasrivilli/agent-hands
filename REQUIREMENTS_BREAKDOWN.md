# Line-by-Line Requirement Breakdown

Every requirement from the brief, restated as concrete build tasks. Use this as build checklist.

## Section 1 — Context
- Backend integration layer = "hands" for AI agent. API always preferred; this system = fallback for no-API legacy UIs.
- LLM used ONCE per flow to discover steps. After that: deterministic replay, no model in loop.
- Output of discovery = reusable, reviewable, parameterized "capability" — not a one-off script.
- Environment properties to design around (not necessarily build):
  - **Stable UI, unstable runtime**: selectors won't drift much, but must handle validation errors/not-found/permission-denied/dialogs/session-timeout/slow-load. Happy-path-only = disqualifying.
  - **Heterogeneous surfaces**: modern web / legacy web (frames, tables, no test IDs) / native desktop. Can't assume clean DOM. Design abstraction seam even if only building one surface.
  - **Multi-tenant at scale**: hundreds of tenants, ~20 apps each, many on same vendor product. Artifact should be reusable/parameterizable across tenant variants, not re-recorded each time.

## Section 2 — The problem (6 capabilities to build)
1. Accept NL goal for a target app.
2. LLM drives real surface: observe → decide → act. Any mechanism (DOM/AX-tree/screenshot+coords/OS-level).
3. Record successful run as typed, versioned artifact — decoupled from raw model transcript (i.e. don't just dump the chat log).
4. Replay artifact with NO LLM, stable targeting, report success/fail.
5. Escalate to human when stuck: intervention request → human takes control of live session → hands back.
6. Safety guardrails: allowlist enforcement + no leaking/persisting sensitive data.

## Section 3 — Core requirements (graded directly)

### 3.1 Goal-driven agent loop
- Input: goal + target (app/URL/entry point).
- Loop: observe→decide→act until goal met or stop condition (max steps / timeout / dead-end).
- Must actually act on real UI (not simulated). Bias toward mechanism that survives "no clean DOM" (accessibility tree or screenshot-based > raw CSS selectors as primary reasoning surface).

### 3.2 Structured artifact — THE central grading focus
Must express, per capability:
- ordered steps/actions
- element/control identification strategy **+ written reasoning about why it's robust** (not just "we used CSS selector X" — justify against drift)
- typed input parameters (schema, e.g. `memberId: string`)
- typed outputs + shape (schema, e.g. `{ balance: number, currency: string }`)
- checkpoint/success condition (assertable, not "we assume it worked")
- versioned (schema version + artifact version)
- reviewable by both human and calling agent — i.e. self-describing, not opaque

### 3.3 Deterministic replay — production execution path
- No LLM in decision loop during replay.
- Stable targeting + explicit checkpoint verification.
- Result contract must distinguish 3 categories explicitly (this is called out as "the most common design mistake" in the glossary — do not conflate):
  1. **Expected business outcome** (e.g. "no such member") — legitimate typed result, not an error.
  2. **Recoverable condition** (dismiss known interstitial, retry transient load) — replay handles automatically, logs that it happened.
  3. **Hard failure** — stop, surface debuggable error: what step, what was expected, what was observed.
- Structured result object always returned: success+outputs | business-outcome | failure+detail.

### 3.4 Safety & policy guardrails
- Explicit configurable allowlist: permitted domains/routes + permitted action types. Enforced, not advisory.
- Classify actions safe/reversible vs risky/irreversible. Risky class handled conservatively — block/require-confirm/flag (your choice, must justify).
- Never persist secrets/tokens/full PII into artifacts or logs. Redact.

### 3.5 Evidence / observability
- Structured log of what agent did + why (reasoning trace, not just actions).
- At least one richer artifact on failure: screenshot, DOM snapshot, or trace.

### 3.6 Human-in-the-loop escalation & handoff
- Detect stuck/blocked state → raise intervention request with context: which capability/goal, current step, current state/screenshot, why stopped.
- Human takes control of the SAME live session (not a fresh one) → performs manual steps → hands control back → run resumes/completes.
- Preserve context/evidence across handoff; record what human did.
- Implies: automation can pause/cede/resume on same session; explicit "who is in control" state.
- Scope: full co-browsing console out of scope. Mock operator UI OK, but handoff mechanism + control-transfer model must be real.

### 3.7 Heterogeneity & scale — DESIGN ONLY, not built
Must address in REPORT.md:
- Surface abstraction: how schema/replay engine extends from your surface → legacy web (frames/tables/no test IDs) and/or desktop. What's the seam between "perceive/act on a surface" vs "the recorded flow" (i.e. separate a Surface Adapter interface from the Artifact model).
- Multi-tenant reuse: how one artifact represents a capability reusable/overridable across tenants on the same vendor product. How drift is detected/managed per tenant/version.
- Not expected to implement — but core abstractions must not "paint into a corner" (i.e. don't hardcode single-tenant/single-surface assumptions into the schema).

## Section 4 — Your call (defend, don't guess)
- Language/runtime/framework — free choice.
- LLM provider/model + prompting/loop structure — free choice.
- Computer-use tech (Playwright/Puppeteer/Selenium/CUA SDK/screenshot-coords/AX API/OS automation) — free choice.
- Target app — proxy for the real thing. Must have non-trivial multi-step flow (search→detail→action, or multi-field form+confirm). Can lean into hostile-legacy surface for extra realism. If public site: respect ToS/rate limits, no real creds/PII.
- Artifact schema + storage/serialization — free choice.
- Determinism mechanism (locator strategy, fallbacks, waiting) — free choice.
- Architecture/boundaries (monolith vs services, sync vs queued) — free choice, simpler justified is fine.
- **NOT optional**: discovery run must be genuinely LLM-driven against a live surface, with evidence in `/evidence/`. Can't fake or describe it.
- Everywhere else (operator console, desktop surface, etc.) — clean documented mock is fine.

## Section 5 — Scope & expectations
- AI-assisted dev assumed/encouraged — own everything, defend every part.
- Depth over breadth: don't skip whole capabilities, but OK to keep pieces thin/mocked if documented.
- Explicitly say what was cut and why + what's next.

## Deliverables (exact paths — don't deviate)
1. Public repo, `/README.md`: setup+run instructions (keys/config, no-live-services mode if applicable), exact demo command sequence (run agent on goal → replay artifact).
2. `/REPORT.md` (~1–3 pages), exactly 7 headings in this order:
   1. Architecture
   2. Artifact schema
   3. Determinism & error handling
   4. Heterogeneity & multi-tenant
   5. Escalation & handoff
   6. Safety
   7. Cuts
3. `/evidence/`: saved example artifact + logs from a discovery run AND a replay run. Ideally one replay showing an error/exceptional-state result. Screen recording optional.

## Evaluation weight order (design/build effort should mirror this)
1. System design (artifact schema + replay contract central)
2. Correctness of core loop
3. Robustness & error handling
4. Human-in-the-loop escalation
5. Generalization design (heterogeneity/multi-tenant)
6. Safety & data handling
7. Code quality
8. Communication (write-up)

Not rewarded: feature breadth, framework name-dropping, premature scaling infra (queues/clusters/multi-tenant plumbing).
