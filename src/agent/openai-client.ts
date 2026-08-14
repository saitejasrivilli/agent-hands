// Minimal OpenAI chat-completions client via fetch — no SDK dependency, keeps
// V0's dependency footprint (playwright + express) unchanged per BUILD_PLAN.md
// "parallel tracks only depend on locked interfaces" rule.

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResult {
  toolCall: ToolCall | null;
  assistantText: string | null;
}

export async function callOpenAiWithTools(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
}): Promise<ChatResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const body = {
    model: params.model,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
    tools: params.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    tool_choice: "required",
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const message = json.choices?.[0]?.message;
  const rawToolCall = message?.tool_calls?.[0];

  if (!rawToolCall) {
    return { toolCall: null, assistantText: message?.content ?? null };
  }

  return {
    toolCall: {
      id: rawToolCall.id,
      name: rawToolCall.function.name,
      arguments: JSON.parse(rawToolCall.function.arguments || "{}"),
    },
    assistantText: message?.content ?? null,
  };
}
