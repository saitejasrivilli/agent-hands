# Production Best Practices — Computer-Use / RPA-style Automation Systems

Reference notes from real-world patterns (Playwright/Selenium engineering guides, RPA vendors
like UiPath/Automation Anywhere, browser-agent frameworks like Browser-Use/Anthropic
computer-use, and general resilient-automation literature). Use as a checklist against the build.

## 1. Locator / selector strategy (drives replay determinism)
- **Priority order** (most→least stable): explicit test IDs > accessibility role+name (ARIA) >
  semantic HTML attributes (label/for, name) > visible text content > structural CSS path >
  absolute XPath/coordinates. Absolute XPath and pixel coordinates are last resort — they break
  on any layout shift.
- **Multi-strategy fallback chain**: store 2-3 locator strategies per element in the artifact
  (e.g. primary=role+name, fallback=text-match, fallback2=relative-DOM-path). Try in order at
  replay time; log which one hit — surfaces silent drift before it becomes a hard failure.
  This is standard in "self-healing" RPA locators (UiPath's "Fuzzy Selector", Testim/Mabl's
  auto-heal). Even without ML self-healing, storing 2-3 static strategies is baseline practice.
- **Prefer accessibility tree over raw DOM** when the surface has no test IDs — legacy web/
  desktop apps often keep a more stable AX tree than markup (matches interface.ai brief's own
  hint under "heterogeneous surfaces").
- **Scope locators to a stable ancestor/region** where possible instead of global page queries —
  reduces false-positive matches on pages with repeated components.
- **Never encode brittle full-page XPath from record-and-playback tools without editing** —
  known #1 cause of RPA bot fragility in industry postmortems.

## 2. Waiting / synchronization
- **Never use fixed `sleep(n)`.** Always wait on explicit conditions: element visible+enabled,
  network idle for the specific relevant request, DOM mutation settled, or a business-state signal
  (e.g. a "balance" field actually populated, not just present).
- **Bounded retry with backoff** for transient conditions (slow load, flaky network) — cap retry
  count and total time budget; convert to explicit timeout failure after budget exhausted, don't
  hang silently.
- **Distinguish "waiting for UI" vs "waiting for business process"** — some banking-style ops are
  async server-side (e.g. batch job); poll a status field/checkpoint, don't assume synchronous.

## 3. Checkpoints / assertions
- Assert **positive proof of state**, not absence of error — e.g. confirm "confirmation screen"
  by checking a specific success marker (confirmation number rendered), not just "no error
  dialog appeared."
- Checkpoints should be **typed and declarative** in the artifact (a condition object), not
  imperative code buried in a step — keeps the artifact reviewable by non-engineers (a hard
  requirement in this brief).
- Every step that mutates state should have a **post-condition check** before proceeding —
  catches partial failures early instead of compounding errors downstream.

## 4. Error taxonomy (industry-standard 3-way split, matches brief's glossary point directly)
- **Business/domain outcome**: modeled as a typed result variant, not an exception. E.g. gRPC/
  REST APIs model "not found" as a 404 + typed body, not a 500. Same discipline applies here.
- **Recoverable/transient**: known dismissible interstitials (cookie banners, "session about to
  expire" nags), transient network blips. Handle via declared recovery rules in the artifact
  (e.g. "if dialog matching X appears, dismiss and retry step"), log the recovery, continue.
- **Hard failure**: anything unclassified. Fail fast, attach maximum debug context (screenshot +
  DOM/AX snapshot + last N actions + expected vs observed), and stop — do not guess/improvise
  at replay time (that's what discovery/LLM was for).
- Common anti-pattern to avoid: catching every exception and returning a generic "failed" —
  destroys the caller's ability to distinguish "no such member" from "session timed out" from
  "our selector broke."

## 5. Idempotency & safe replay
- Design capabilities to be **idempotent or explicitly non-idempotent-flagged**. Financial
  mutating actions (transfers, account creation) must have a checkpoint that first verifies
  the action wasn't already applied (e.g. check for existing confirmation number) before
  re-attempting after a partial failure/retry — classic "double-submit" bug class in payment UIs.
- Irreversible actions get **stricter gating**: require an explicit confirmation step in the replay
  contract itself (not just an LLM judgment call) — e.g. two-phase "propose then commit."

## 6. Secrets / sensitive data handling
- **Never let credentials or session tokens flow into the artifact.** Artifacts store the *shape*
  of the flow, not runtime secrets — auth is injected at replay time from a secrets store/vault,
  referenced by name only.
- **Redact PII in logs at the point of capture**, not after — logging raw screenshots/DOM with
  account numbers/SSNs is a common real compliance failure (PCI/GLBA-relevant here since it's
  explicitly framed as regulated financial data). Use field-level redaction rules keyed by known
  sensitive field names/patterns (account #, SSN, DOB) rather than trying to scrub after the fact.
- Evidence artifacts (screenshots on failure) should go through the same redaction pass before
  persisting — a screenshot is just as much a data-leak vector as a log line.

## 7. Allowlist / guardrail enforcement
- Enforce allowlist **at the action-execution boundary**, not just at planning time — an LLM can
  decide to do something out-of-policy; the executor must independently refuse it regardless of
  what the model asked for (defense in depth, don't trust the planner).
- Allowlist should cover both **where** (domain/route patterns) and **what** (action-type: read
  vs click vs type vs navigate vs submit) — a capability scoped to "read balance" shouldn't be
  able to click a "close account" button even if the route matches.

## 8. Human-in-the-loop / session handoff
- **Single source of truth for "who controls the session"** — a control-state field the automation
  checks before every action; must be explicit (not inferred), otherwise race between automation
  and human.
- Preserve the **live session/context across handoff** (cookies, page state, in-flight
  navigation) — spinning up a fresh session for the human defeats the purpose and can even
  invalidate the in-progress transaction.
- Log **what the human did** during manual control with the same structured-log format as
  automated steps — needed for audit trail in a regulated environment, and useful to later
  extend the artifact/recording.
- Intervention request payload should be self-sufficient for a human to act without re-deriving
  context: goal, current step, current state/screenshot, and specific reason it stopped.

## 9. Artifact design / schema hygiene
- **Version every artifact** (schema version + capability version) — replay engine must reject
  or safely migrate artifacts from incompatible schema versions rather than best-effort parsing.
- Keep the artifact **decoupled from the raw agent transcript** — the transcript is discovery-time
  evidence, the artifact is the compiled reusable contract. Mixing them defeats "reviewable."
- Treat the artifact as an **API contract**: typed inputs, typed outputs, explicit success
  condition — same discipline as designing a public API, since an AI agent is literally the
  caller.

## 10. Multi-tenant / cross-instance reuse (design-level, from RPA-at-scale practice)
- **Canonicalize concrete values into parameters** at recording time (e.g. `/member/12345` →
  `/member/{memberId}`) so one artifact generalizes across accounts/tenants automatically.
- **Separate "base capability" from "tenant overrides"** — store a shared base artifact plus a
  small per-tenant diff/override layer (branding, minor field renames, extra required step) rather
  than forking full copies. This mirrors how vendor-configurable enterprise software is usually
  patched per customer (feature flags / config layering) rather than re-implemented.
- **Detect drift automatically**: track locator-hit-rate per artifact per tenant; falling hit-rate on
  a previously-reliable locator is an early signal of app version drift — surface it before it
  becomes a hard failure in production.

## 11. Observability
- Structured (JSON) logs per step: timestamp, step id, action, target-locator-used,
  outcome, latency. Enables both human debugging and automated flakiness/drift metrics later.
- On any non-success outcome, capture a **richer snapshot** (screenshot + AX/DOM tree) at the
  point of failure, not before — the value is in the exact failing state.
- Keep discovery-run evidence and replay-run evidence in the same structured format so they're
  diffable — helps spot exactly where replay diverges from the original discovery.
