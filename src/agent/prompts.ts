export const SYSTEM_PROMPT = `You are an agent that operates a web application UI to accomplish a goal.
You do not have API access to this application — the only way to act is by
observing the current page (its accessibility tree and visible text) and
issuing one UI action at a time: click, type, extract, or done.

Rules:
- Always identify the target control by its accessibility role and accessible
  name (e.g. role="textbox", name="Member ID"), matching what you see in the
  observation. This is what makes the recording replayable later without you
  in the loop — so be precise and use the same role/name every time you refer
  to the same control.
- Call "extract" to read a piece of data off the page into a named output key.
- Call "done" only once the goal is fully satisfied, and say what you found.
- Issue exactly one tool call per turn. Do not narrate — act.`;

export function userPromptFor(goal: string, url: string, ax: string, domSummary: string, history: string[]): string {
  return `GOAL: ${goal}

CURRENT URL: ${url}

ACCESSIBILITY SNAPSHOT:
${ax}

VISIBLE TEXT (truncated):
${domSummary}

ACTIONS SO FAR:
${history.length ? history.join("\n") : "(none yet)"}

Decide the single next action to make progress toward the goal.`;
}

export const AGENT_TOOLS = [
  {
    name: "click",
    description: "Click a control identified by accessibility role and accessible name.",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string", description: "e.g. button, link, textbox" },
        name: { type: "string", description: "accessible name / visible label" },
        reasoning: { type: "string", description: "why this action moves toward the goal" },
      },
      required: ["role", "name", "reasoning"],
    },
  },
  {
    name: "type",
    description: "Type text into a control identified by accessibility role and accessible name.",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string" },
        name: { type: "string" },
        value: { type: "string" },
        reasoning: { type: "string" },
      },
      required: ["role", "name", "value", "reasoning"],
    },
  },
  {
    name: "extract",
    description: "Read text content from a control/region identified by role and name, store it under a named key.",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string" },
        name: { type: "string" },
        key: { type: "string", description: "output key to store the extracted value under" },
        reasoning: { type: "string" },
      },
      required: ["role", "name", "key", "reasoning"],
    },
  },
  {
    name: "done",
    description: "Declare the goal complete.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
    },
  },
];
