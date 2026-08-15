import { randomUUID } from "node:crypto";
import { PlaywrightAdapter } from "../adapters/playwright-adapter.js";
import { EvidenceLogger } from "../evidence/logger.js";
import { callAnthropicWithTools } from "./anthropic-client.js";
import { SYSTEM_PROMPT, userPromptFor, AGENT_TOOLS } from "./prompts.js";
import type { LocatorStrategy } from "../artifact/types.js";
import { escalate } from "../escalation/manager.js";
import { checkDomainAllowed, GuardrailViolation } from "../guardrails/wrapper.js";

export interface TranscriptEntry {
  index: number;
  observation: { url: string; ax: string };
  action: { name: string; args: Record<string, unknown> };
}

export type DiscoveryResult =
  | { kind: "success"; transcript: TranscriptEntry[]; outputs: Record<string, unknown>; summary: string; runId: string }
  | { kind: "stuck"; transcript: TranscriptEntry[]; reason: string; runId: string };

const MODEL = process.env.AGENT_MODEL ?? "claude-haiku-4-5-20251001";
const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS ?? 8);
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 120_000);

export interface DiscoveryOptions {
  // Same opt-in pattern as Replayer (see replayer.ts ReplayOptions):
  // default OFF so V1's already-verified automated behavior (stuck ->
  // immediate DiscoveryResult.stuck) is unchanged unless requested.
  enableEscalation?: boolean;
  operatorPort?: number;
  escalationTimeoutMs?: number;
  // Discovery has no Artifact yet to carry an allowlistScope, so this fills
  // the same role directly: domains the agent is permitted to act on.
  // Defaults to just the target's own hostname — an LLM-driven discovery
  // run should not be free to wander/act outside the app it was pointed at,
  // any more than a compiled artifact's replay is (see guardrails/wrapper.ts
  // — this reuses the exact same check, closing a real gap: previously only
  // the Replayer's path enforced any domain allowlist at all).
  allowedDomains?: string[];
}

export async function runDiscovery(
  goal: string,
  targetUrl: string,
  evidenceRoot: string,
  options: DiscoveryOptions = {}
): Promise<DiscoveryResult> {
  // Same fix as replayer.ts's runId — Date.now() alone collides under
  // concurrency (two discovery runs starting in the same millisecond).
  const runId = `discovery-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const logger = new EvidenceLogger(evidenceRoot, runId);
  logger.log("system", "discovery_started", { goal, targetUrl });

  // Launch failure (target unreachable, bad URL) used to propagate straight
  // past DiscoveryResult's typed shape and reject the whole promise instead
  // of returning a clean "stuck" — found via adversarial testing (see
  // DECISIONS.md), fixed the same way as the equivalent gap in replayer.ts.
  let adapter: PlaywrightAdapter;
  try {
    adapter = await PlaywrightAdapter.launch(targetUrl, true);
  } catch (err) {
    logger.log("system", "discovery_stuck", { reason: "adapter_launch_failed" });
    return {
      kind: "stuck",
      transcript: [],
      reason: `adapter_launch_failed: ${err instanceof Error ? err.message : String(err)}`,
      runId,
    };
  }

  const transcript: TranscriptEntry[] = [];
  const outputs: Record<string, unknown> = {};
  const historyLines: string[] = [];
  const startedAt = Date.now();
  const allowedDomains = options.allowedDomains ?? [new URL(targetUrl).hostname];

  // Shared by every "stuck" exit below — tries escalation first if enabled,
  // falls back to the plain stuck result if the human doesn't act (or
  // escalation is disabled), so behavior matches V1 exactly by default.
  const stuckOrEscalate = async (reason: string): Promise<DiscoveryResult> => {
    logger.log("system", "discovery_stuck", { reason });
    if (!options.enableEscalation) {
      return { kind: "stuck", transcript, reason, runId };
    }
    const snap = await adapter.snapshot(logger.dir, "stuck");
    const escalation = await escalate(
      adapter,
      { capabilityId: `discovery:${goal}`, stepIndex: transcript.length, reason, screenshotPath: snap.screenshotPath },
      logger,
      { port: options.operatorPort, timeoutMs: options.escalationTimeoutMs }
    );
    if (escalation.humanActionsCount > 0) {
      Object.assign(outputs, escalation.outputs);
      logger.log("system", "escalation_resolved", { humanActionsCount: escalation.humanActionsCount });
      return { kind: "success", transcript, outputs, summary: `Resolved via human escalation (${reason})`, runId };
    }
    return { kind: "stuck", transcript, reason, runId };
  };

  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      if (Date.now() - startedAt > TIMEOUT_MS) {
        return await stuckOrEscalate("timeout");
      }

      const state = await adapter.observe();
      const prompt = userPromptFor(goal, state.url, state.axTree as string, state.domSummary, historyLines);
      logger.log("agent", "observe", { url: state.url });

      const { toolCall, model, responseId, usage } = await callAnthropicWithTools({
        model: MODEL,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: prompt,
        tools: AGENT_TOOLS,
      });
      // Real, unforgeable proof this step was a genuine API call, not a
      // canned transcript — Anthropic's own response id + actual model +
      // token usage, logged per step.
      logger.log("agent", "llm_response", { model, responseId, usage });

      if (!toolCall) {
        return await stuckOrEscalate("model_returned_no_tool_call");
      }

      logger.log("agent", "decide", { tool: toolCall.name, args: toolCall.arguments });

      if (toolCall.name === "done") {
        await adapter.snapshot(logger.dir, `final-step-${i}`);
        const summary = String(toolCall.arguments.summary ?? "");
        logger.log("system", "discovery_success", { summary, outputs });
        return { kind: "success", transcript, outputs, summary, runId };
      }

      const target: LocatorStrategy[] = [
        { kind: "role", value: String(toolCall.arguments.role), meta: { name: String(toolCall.arguments.name) } },
      ];

      try {
        checkDomainAllowed(adapter.page().url(), { domains: allowedDomains, actions: [] });
        if (toolCall.name === "click") {
          await adapter.act({ type: "click", target });
          historyLines.push(`click role=${toolCall.arguments.role} name="${toolCall.arguments.name}"`);
        } else if (toolCall.name === "type") {
          const value = String(toolCall.arguments.value ?? "");
          await adapter.act({ type: "type", target, value });
          historyLines.push(`type role=${toolCall.arguments.role} name="${toolCall.arguments.name}" value="${value}"`);
        } else if (toolCall.name === "extract") {
          const value = await adapter.act({ type: "extract", target });
          const key = String(toolCall.arguments.key ?? `field${i}`);
          outputs[key] = value;
          historyLines.push(`extract role=${toolCall.arguments.role} name="${toolCall.arguments.name}" -> ${key}="${value}"`);
        }
        logger.log("agent", "act_ok", { tool: toolCall.name });
      } catch (err) {
        if (err instanceof GuardrailViolation) {
          // Unlike a locator/timeout failure (which the model can try to
          // work around next turn), a guardrail violation is a policy
          // decision, not a retryable mistake — stop immediately, the same
          // way the Replayer treats it, rather than escalating (escalation
          // implies a human might just wave it through, which defeats the
          // point of an allowlist the LLM itself doesn't get to override).
          logger.log("system", "guardrail_blocked", { index: i, reason: err.reason });
          return { kind: "stuck", transcript, reason: `guardrail_blocked: ${err.reason}`, runId };
        }
        logger.log("agent", "act_failed", { tool: toolCall.name, error: (err as Error).message });
        historyLines.push(`${toolCall.name} FAILED: ${(err as Error).message}`);
      }

      transcript.push({
        index: i,
        observation: { url: state.url, ax: state.axTree as string },
        action: { name: toolCall.name, args: toolCall.arguments },
      });
    }

    return await stuckOrEscalate("max_steps_exceeded");
  } catch (err) {
    // Catch-all for anything not already handled above: adapter.observe()
    // throwing on a pathological page, callAnthropicWithTools throwing on a
    // network error mid-run, etc. Same principle as replayer.ts's catch-all
    // — an unexpected error becomes a typed "stuck" result, not a rejected
    // promise that crashes whatever's driving the CLI/dashboard.
    logger.log("system", "discovery_stuck", { reason: "unexpected_error" });
    return {
      kind: "stuck",
      transcript,
      reason: `unexpected_error: ${err instanceof Error ? err.message : String(err)}`,
      runId,
    };
  } finally {
    logger.writeJson("transcript.json", transcript);
    await adapter.close();
  }
}
