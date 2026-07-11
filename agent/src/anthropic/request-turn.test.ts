import assert from "node:assert/strict";
import test from "node:test";

import type {
  Message,
  MessageCreateParamsNonStreaming
} from "@anthropic-ai/sdk/resources/messages/messages";
import type { MessageClient } from "./message-client.js";
import { requestAndInspectTurn } from "./request-turn.js";
import { cropLookupTool } from "../tools/crop-lookup.js";

function messageWithToolInput(input: unknown, name = "lookup_crop"): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name,
        input,
        caller: { type: "direct" }
      }
    ],
    stop_reason: "tool_use",
    stop_details: null,
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null
    },
    container: null
  };
}

class FakeMessageClient implements MessageClient {
  params: MessageCreateParamsNonStreaming | undefined;

  constructor(private readonly response: Message) {}

  async createMessage(
    params: MessageCreateParamsNonStreaming
  ): Promise<Message> {
    this.params = params;
    return this.response;
  }
}

test("sends tool definitions and accepts valid tool input", async () => {
  const client = new FakeMessageClient(messageWithToolInput({ crop: "corn" }));

  const turn = await requestAndInspectTurn(
    client,
    "test-model",
    "What soil pH does corn need?",
    [cropLookupTool]
  );

  assert.equal(client.params?.messages[0]?.content, "What soil pH does corn need?");
  assert.equal(client.params?.tools?.[0]?.name, "lookup_crop");
  assert.equal(client.params?.tools?.[0]?.input_schema.type, "object");
  assert.deepEqual(turn.toolCalls, [
    { id: "toolu_test", name: "lookup_crop", input: { crop: "corn" } }
  ]);
  assert.deepEqual(turn.invalidToolCalls, []);
});

test("rejects malformed input returned by the model", async () => {
  const client = new FakeMessageClient(messageWithToolInput({ crop: 42 }));

  const turn = await requestAndInspectTurn(
    client,
    "test-model",
    "Look up crop 42",
    [cropLookupTool]
  );

  assert.deepEqual(turn.toolCalls, []);
  assert.equal(turn.invalidToolCalls[0]?.error, "invalid_input");
});

test("rejects a tool name that is not registered", async () => {
  const client = new FakeMessageClient(
    messageWithToolInput({ command: "format-drive" }, "dangerous_tool")
  );

  const turn = await requestAndInspectTurn(
    client,
    "test-model",
    "Do something",
    [cropLookupTool]
  );

  assert.deepEqual(turn.toolCalls, []);
  assert.equal(turn.invalidToolCalls[0]?.error, "unknown_tool");
});
