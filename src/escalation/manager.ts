import express from "express";
import type { Server } from "node:http";
import { PlaywrightAdapter } from "../adapters/playwright-adapter.js";
import { EvidenceLogger } from "../evidence/logger.js";
import type { LocatorStrategy } from "../artifact/types.js";
import { explainReason } from "./plain-language.js";

// Real handoff mechanism: the automation pauses, a human takes control of the
// SAME live Playwright session (not a fresh one), performs manual steps, and
// hands control back. Scope note honored: this is a bare/mock operator
// surface (plain server-rendered HTML, no real-time co-browsing), but the
// control-transfer model itself is real — see DECISIONS.md / HLD.md §6.

export interface InterventionContext {
  capabilityId: string;
  stepIndex: number;
  reason: string;
  screenshotPath: string;
}

export type ControlState = "automation" | "human";

export interface EscalationResult {
  outputs: Record<string, unknown>;
  humanActionsCount: number;
}

// Blocks until a human visits the operator page and clicks "Resume" (or the
// timeout elapses). Runs a tiny local HTTP server bound to the SAME
// PlaywrightAdapter instance the paused replay was using — the human is
// operating the live session, not a description of it.
export async function escalate(
  adapter: PlaywrightAdapter,
  context: InterventionContext,
  logger: EvidenceLogger,
  opts: { port?: number; timeoutMs?: number } = {}
): Promise<EscalationResult> {
  const port = opts.port ?? 4100;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const raisedAt = Date.now();

  logger.log("system", "intervention_raised", { ...context, timeoutMs });
  logger.writeJson("intervention.json", context);

  // SLA heartbeat: a periodic "still waiting" signal while an intervention
  // is unresolved — real production HITL practice (see DECISIONS.md), not
  // just a silent timeout. Interval is a fraction of the total budget so at
  // least a couple of heartbeats land even on short demo timeouts.
  const heartbeatMs = Math.max(5_000, Math.floor(timeoutMs / 4));
  const heartbeat = setInterval(() => {
    logger.log("system", "escalation_pending", { elapsedMs: Date.now() - raisedAt, timeoutMs });
  }, heartbeatMs);

  let controlState: ControlState = "human";
  const outputs: Record<string, unknown> = {};
  let humanActionsCount = 0;

  const app = express();
  app.use(express.urlencoded({ extended: true }));

  app.get("/", async (_req, res) => {
    const screenshotB64 = await adapter
      .page()
      .screenshot()
      .then((buf) => buf.toString("base64"))
      .catch(() => "");
    res.send(renderConsolePage(context, controlState, screenshotB64));
  });

  app.post("/action", async (req, res) => {
    const { actionType, role, name, value, extractAs } = req.body;
    const target: LocatorStrategy[] | undefined =
      actionType === "navigate" ? undefined : [{ kind: "role", value: role, meta: { name } }];
    try {
      const result = await adapter.act({ type: actionType, target, value });
      humanActionsCount++;
      logger.log("human", "manual_action", { actionType, role, name, value });
      if (actionType === "extract" && extractAs) {
        outputs[extractAs] = result;
        logger.log("human", "manual_extract", { extractAs, value: result });
      }
      res.redirect("/");
    } catch (err) {
      logger.log("human", "manual_action_failed", { actionType, role, name, error: (err as Error).message });
      res.redirect("/");
    }
  });

  let resolveResume: () => void;
  const resumeSignal = new Promise<void>((resolve) => {
    resolveResume = resolve;
  });

  app.post("/resume", (_req, res) => {
    controlState = "automation";
    logger.log("system", "control_resumed", { humanActionsCount });
    res.send(`
      <html><body style="font-family:-apple-system,sans-serif;max-width:480px;margin:80px auto;text-align:center">
        <h2 style="color:#1a7f43">▶ Resumed</h2>
        <p>The automation is continuing on its own. You can close this tab.</p>
      </body></html>
    `);
    resolveResume();
  });

  // A port already in use (a stale process still holding it, or two
  // escalations racing on the same default port) is a realistic production
  // failure, not just a test artifact — found via adversarial testing.
  // http.Server emits 'error' asynchronously; without this handler, an
  // EADDRINUSE crashes the whole process uncaught regardless of any
  // try/catch around escalate() itself (event-emitter errors aren't caught
  // by synchronous try/catch).
  const server: Server = app.listen(port, () => {
    console.log(`Operator console listening on http://localhost:${port} (waiting for human)`);
  });
  const listenError = new Promise<never>((_, reject) => {
    server.once("error", (err) => reject(err));
  });

  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  try {
    await Promise.race([resumeSignal, timeout, listenError]);
  } catch (err) {
    clearInterval(heartbeat);
    logger.log("system", "escalation_port_error", { port, error: err instanceof Error ? err.message : String(err) });
    throw new Error(`operator console failed to start on port ${port}: ${err instanceof Error ? err.message : String(err)}`);
  }
  clearInterval(heartbeat);

  const elapsedMs = Date.now() - raisedAt;
  const breached = controlState === "human"; // still "human" means resume never came
  if (breached) {
    logger.log("system", "escalation_timed_out", { timeoutMs, elapsedMs });
  }
  logger.recordSla({
    capabilityId: context.capabilityId,
    stepIndex: context.stepIndex,
    timeoutMs,
    elapsedMs,
    breached,
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));

  return { outputs, humanActionsCount };
}

// Bare/mock per the brief's own scope note (Section 3.6: "a full real-time
// co-browsing operator console is out of scope... mock the operator UI if
// needed") — but designed so a non-technical bank staff member and an
// engineer debugging the same run both get what they need from one page:
// a plain-English explanation up top (what/why/what-to-do), the exact
// technical detail available right below it for whoever wants it, and the
// live screenshot so nobody has to imagine the page state.
function renderConsolePage(context: InterventionContext, controlState: ControlState, screenshotB64: string): string {
  const plainReason = explainReason(context.reason);
  const isPaused = controlState === "human";
  return `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Member Services — Operator Console</title>
<style>
  :root { --navy:#0f2a4a; --blue:#2f6fed; --amber:#9a6700; --amber-bg:#fff3d6; --green:#1a7f43; --green-bg:#e6f4ea; --border:#dfe3ea; --gray:#5a6472; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin:0; background:#f6f7f9; color:#1a1f28; }
  header { background: var(--navy); color:white; padding:14px 24px; font-size:18px; font-weight:600; }
  header span { font-weight:400; opacity:0.75; font-size:14px; margin-left:8px; }
  main { max-width: 720px; margin: 24px auto; padding: 0 16px; }
  .banner { display:flex; align-items:center; gap:10px; padding:14px 18px; border-radius:10px; margin-bottom:18px; font-size:15px; font-weight:600; }
  .banner.paused { background: var(--amber-bg); color: var(--amber); }
  .banner.resumed { background: var(--green-bg); color: var(--green); }
  .card { background:white; border:1px solid var(--border); border-radius:10px; padding:20px 24px; margin-bottom:16px; }
  .card h2 { margin-top:0; font-size:16px; color:var(--navy); }
  .plain { font-size:16px; line-height:1.5; margin: 4px 0 14px; }
  details { font-size:13px; color:var(--gray); margin-top:10px; }
  details summary { cursor:pointer; font-weight:600; }
  .kv { font-size:13px; color:var(--gray); margin:2px 0; }
  .kv b { color:#1a1f28; }
  img.screenshot { max-width:100%; border:1px solid var(--border); border-radius:8px; margin-top:10px; }
  label { display:block; margin:12px 0 4px; font-size:13px; font-weight:600; color:var(--navy); }
  .hint { font-size:12px; color:var(--gray); margin-top:2px; }
  select, input[type=text] { width:100%; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-size:14px; }
  .row { display:flex; gap:10px; }
  .row > div { flex:1; }
  button { margin-top:14px; padding:10px 18px; border-radius:6px; border:1px solid var(--border); background:white; cursor:pointer; font-size:14px; }
  button.primary { background: var(--blue); color:white; border-color: var(--blue); }
  button.resume { background: var(--green); color:white; border-color: var(--green); }
  form { margin:0; }
</style>
</head>
<body>
<header>🏦 Member Services <span>Operator Console (mock)</span></header>
<main>

  <div class="banner ${isPaused ? "paused" : "resumed"}">
    ${isPaused ? "⏸ Automation is paused — it needs your help to continue." : "▶ Automation has resumed."}
  </div>

  <div class="card">
    <h2>What's happening, in plain terms</h2>
    <p class="plain">${escapeHtml(plainReason)}</p>
    <div class="kv"><b>What it was doing:</b> ${escapeHtml(context.capabilityId)}</div>
    <div class="kv"><b>Where it stopped:</b> step ${context.stepIndex}</div>
    <details>
      <summary>Technical detail</summary>
      <div class="kv">${escapeHtml(context.reason)}</div>
    </details>
  </div>

  <div class="card">
    <h2>What the automation was looking at</h2>
    ${screenshotB64 ? `<img class="screenshot" src="data:image/png;base64,${screenshotB64}" />` : "<p class=\"hint\">No screenshot available.</p>"}
  </div>

  <div class="card">
    <h2>Fix it manually, right here on the live page</h2>
    <p class="hint">Do the one thing the automation couldn't — e.g. click the correct button, or type the correct
      value — then resume below. You don't need to redo the whole task, just the step it got stuck on.</p>
    <form method="POST" action="/action">
      <label>Action</label>
      <select name="actionType">
        <option value="click">Click something</option>
        <option value="type">Type into a field</option>
        <option value="extract">Read a value off the page</option>
        <option value="navigate">Go to a different page (type a URL below)</option>
      </select>
      <div class="row">
        <div>
          <label>Which control? (role, e.g. "button")</label>
          <input type="text" name="role" placeholder="button / textbox / cell / link" />
        </div>
        <div>
          <label>Labeled / named</label>
          <input type="text" name="name" placeholder='e.g. "Search"' />
        </div>
      </div>
      <label>Value to type, or URL to go to</label>
      <input type="text" name="value" placeholder="only needed for type / navigate" />
      <label>If reading a value, save it as</label>
      <input type="text" name="extractAs" placeholder="only needed for read-a-value" />
      <button type="submit" class="primary">Run this action</button>
    </form>
  </div>

  <div class="card">
    <h2>Done fixing it?</h2>
    <p class="hint">This hands control back to the automation so it can finish the task.</p>
    <form method="POST" action="/resume">
      <button type="submit" class="resume">▶ Resume automation</button>
    </form>
  </div>

</main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
