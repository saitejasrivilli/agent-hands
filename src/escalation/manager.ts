import express from "express";
import type { Server } from "node:http";
import { PlaywrightAdapter } from "../adapters/playwright-adapter.js";
import { EvidenceLogger } from "../evidence/logger.js";
import type { LocatorStrategy } from "../artifact/types.js";

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

  logger.log("system", "intervention_raised", { ...context });
  logger.writeJson("intervention.json", context);

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
    res.send(`
      <html><body>
        <h2>Operator Console (mock)</h2>
        <p><b>Capability:</b> ${context.capabilityId}</p>
        <p><b>Stuck at step:</b> ${context.stepIndex}</p>
        <p><b>Reason:</b> ${context.reason}</p>
        <p><b>Control state:</b> ${controlState}</p>
        ${screenshotB64 ? `<img src="data:image/png;base64,${screenshotB64}" style="max-width:600px;border:1px solid #ccc" />` : ""}
        <h3>Perform a manual action on the live session</h3>
        <form method="POST" action="/action">
          <select name="actionType">
            <option value="click">click</option>
            <option value="type">type</option>
            <option value="extract">extract</option>
          </select>
          role: <input name="role" /> name: <input name="name" /> value: <input name="value" /> extractAs: <input name="extractAs" />
          <input type="submit" value="Run action" />
        </form>
        <h3>Done fixing it manually?</h3>
        <form method="POST" action="/resume"><input type="submit" value="Resume automation" /></form>
      </body></html>
    `);
  });

  app.post("/action", async (req, res) => {
    const { actionType, role, name, value, extractAs } = req.body;
    const target: LocatorStrategy[] = [{ kind: "role", value: role, meta: { name } }];
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
    res.send("Resumed. You can close this tab.");
    resolveResume();
  });

  const server: Server = app.listen(port, () => {
    console.log(`Operator console listening on http://localhost:${port} (waiting for human)`);
  });

  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([resumeSignal, timeout]);

  if (controlState === "human") {
    logger.log("system", "escalation_timed_out", { timeoutMs });
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));

  return { outputs, humanActionsCount };
}
