import { PlaywrightAdapter } from "../adapters/playwright-adapter.js";
import { EvidenceLogger } from "../evidence/logger.js";
import { callAnthropicWithTools } from "./anthropic-client.js";
import { SYSTEM_PROMPT, userPromptFor, AGENT_TOOLS } from "./prompts.js";
import type { LocatorStrategy } from "../artifact/types.js";

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

export async function runDiscovery(goal: string, targetUrl: string, evidenceRoot: string): Promise<DiscoveryResult> {
  const runId = `discovery-${Date.now()}`;
  const logger = new EvidenceLogger(evidenceRoot, runId);
  logger.log("system", "discovery_started", { goal, targetUrl });

  const adapter = await PlaywrightAdapter.launch(targetUrl, true);
  const transcript: TranscriptEntry[] = [];
  const outputs: Record<string, unknown> = {};
  const historyLines: string[] = [];
  const startedAt = Date.now();

  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      if (Date.now() - startedAt > TIMEOUT_MS) {
        logger.log("system", "discovery_stuck", { reason: "timeout" });
        return { kind: "stuck", transcript, reason: "timeout", runId };
      }

      const state = await adapter.observe();
      const prompt = userPromptFor(goal, state.url, state.axTree as string, state.domSummary, historyLines);
      logger.log("agent", "observe", { url: state.url });

      const { toolCall } = await callAnthropicWithTools({
        model: MODEL,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: prompt,
        tools: AGENT_TOOLS,
      });

      if (!toolCall) {
        logger.log("system", "discovery_stuck", { reason: "no_tool_call" });
        return { kind: "stuck", transcript, reason: "model_returned_no_tool_call", runId };
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
        logger.log("agent", "act_failed", { tool: toolCall.name, error: (err as Error).message });
        historyLines.push(`${toolCall.name} FAILED: ${(err as Error).message}`);
      }

      transcript.push({
        index: i,
        observation: { url: state.url, ax: state.axTree as string },
        action: { name: toolCall.name, args: toolCall.arguments },
      });
    }

    logger.log("system", "discovery_stuck", { reason: "max_steps" });
    return { kind: "stuck", transcript, reason: "max_steps_exceeded", runId };
  } finally {
    logger.writeJson("transcript.json", transcript);
    await adapter.close();
  }
}
