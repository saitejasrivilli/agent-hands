// Minimal Anthropic Messages API client via fetch. Shape is intentionally
// provider-agnostic (ChatResult/ToolCall) so the agent loop doesn't care
// which LLM provider is behind it.

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResult {
  toolCall: ToolCall | null;
  assistantText: string | null;
}

export async function callAnthropicWithTools(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
}): Promise<ChatResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const body = {
    model: params.model,
    max_tokens: 1024,
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userPrompt }],
    tools: params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    })),
    tool_choice: { type: "any" },
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const toolUseBlock = (json.content ?? []).find((b: any) => b.type === "tool_use");
  const textBlock = (json.content ?? []).find((b: any) => b.type === "text");

  if (!toolUseBlock) {
    return { toolCall: null, assistantText: textBlock?.text ?? null };
  }

  return {
    toolCall: { id: toolUseBlock.id, name: toolUseBlock.name, arguments: toolUseBlock.input ?? {} },
    assistantText: textBlock?.text ?? null,
  };
}
