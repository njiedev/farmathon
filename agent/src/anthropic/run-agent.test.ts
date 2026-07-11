import assert from "node:assert/strict";
import test from "node:test";

import type {
  ContentBlock,
  Message,
  MessageCreateParamsNonStreaming
} from "@anthropic-ai/sdk/resources/messages/messages";
import type { MessageClient } from "./message-client.js";
import { runAgent } from "./run-agent.js";
import { cropLookupTool } from "../tools/crop-lookup.js";

function message(content: ContentBlock[], stopReason: Message["stop_reason"]): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "test-model",
    content,
    stop_reason: stopReason,
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

class SequenceMessageClient implements MessageClient {
  readonly requests: MessageCreateParamsNonStreaming[] = [];

  constructor(private readonly responses: Message[]) {}

  async createMessage(
    params: MessageCreateParamsNonStreaming
  ): Promise<Message> {
    this.requests.push(params);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("Fake client has no response remaining.");
    }
    return response;
  }
}

test("executes a tool, returns its result to Claude, and returns the final message", async () => {
  const toolRequest = message(
    [
      {
        type: "tool_use",
        id: "toolu_test",
        name: "lookup_crop",
        input: { crop: "corn" },
        caller: { type: "direct" }
      }
    ],
    "tool_use"
  );
  const finalResponse = message(
    [{ type: "text", text: "Corn prefers a soil pH between 5.8 and 7.0.", citations: null }],
    "end_turn"
  );
  const client = new SequenceMessageClient([toolRequest, finalResponse]);

  const result = await runAgent(client, {
    model: "test-model",
    userMessage: "What soil pH does corn need?",
    tools: [cropLookupTool]
  });

  assert.equal(result, finalResponse);
  assert.equal(client.requests.length, 2);
  const followUpMessages = client.requests[1]?.messages;
  assert.equal(followUpMessages?.[1]?.role, "assistant");
  assert.equal(followUpMessages?.[2]?.role, "user");

  const toolResultMessage = followUpMessages?.[2];
  assert.ok(Array.isArray(toolResultMessage?.content));
  const toolResult = toolResultMessage.content[0];
  assert.equal(toolResult?.type, "tool_result");
  if (toolResult?.type === "tool_result") {
    assert.equal(toolResult.tool_use_id, "toolu_test");
    assert.match(String(toolResult.content), /"soilPhMin":5.8/);
  }
});
