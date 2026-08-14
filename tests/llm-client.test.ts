import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { callAnthropicWithTools } from "../src/agent/anthropic-client.js";

// Fixture captured from the shape of a real Anthropic Messages API response
// (see evidence/discovery-*/steps.log.jsonl for genuine response ids/usage
// from actual calls this project made). Mocking fetch here makes the
// "does parsing actually work" claim machine-checked on every test run,
// without spending a real API call or requiring network access in CI.
const FIXTURE_RESPONSE = {
  id: "msg_01Abc123RealShapedId",
  model: "claude-haiku-4-5-20251001",
  content: [
    { type: "text", text: "I'll click the search button." },
    {
      type: "tool_use",
      id: "toolu_01XyzRealShapedId",
      name: "click",
      input: { role: "button", name: "Search", reasoning: "proceed" },
    },
  ],
  usage: { input_tokens: 512, output_tokens: 37 },
};

let originalFetch: typeof fetch;

before(() => {
  originalFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(FIXTURE_RESPONSE), { status: 200 })) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

test("callAnthropicWithTools: parses model, responseId, usage, and toolCall correctly", async () => {
  const result = await callAnthropicWithTools({
    model: "claude-haiku-4-5-20251001",
    systemPrompt: "sys",
    userPrompt: "user",
    tools: [{ name: "click", description: "click something", parameters: {} }],
  });

  assert.equal(result.model, "claude-haiku-4-5-20251001");
  assert.equal(result.responseId, "msg_01Abc123RealShapedId");
  assert.deepEqual(result.usage, { input_tokens: 512, output_tokens: 37 });
  assert.equal(result.assistantText, "I'll click the search button.");
  assert.ok(result.toolCall);
  assert.equal(result.toolCall?.name, "click");
  assert.deepEqual(result.toolCall?.arguments, { role: "button", name: "Search", reasoning: "proceed" });
});

test("callAnthropicWithTools: still surfaces model/responseId/usage when no tool_use block present", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ ...FIXTURE_RESPONSE, content: [{ type: "text", text: "just thinking out loud" }] }),
      { status: 200 }
    )) as typeof fetch;

  const result = await callAnthropicWithTools({
    model: "claude-haiku-4-5-20251001",
    systemPrompt: "sys",
    userPrompt: "user",
    tools: [],
  });

  assert.equal(result.toolCall, null);
  assert.equal(result.model, "claude-haiku-4-5-20251001");
  assert.equal(result.responseId, "msg_01Abc123RealShapedId");
});
