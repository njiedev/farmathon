import { z } from "zod";

import type {
  Message,
  Tool as AnthropicTool,
  ToolUseBlock
} from "@anthropic-ai/sdk/resources/messages/messages";
import type { MessageClient } from "./message-client.js";
import type { ToolDefinition } from "../tools/tool.js";

export interface ValidatedToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface InvalidToolCall {
  id: string;
  name: string;
  input: unknown;
  error: "unknown_tool" | "invalid_input";
  details?: z.core.$ZodIssue[];
}

export interface InspectedTurn {
  response: Message;
  toolCalls: ValidatedToolCall[];
  invalidToolCalls: InvalidToolCall[];
}

export function toAnthropicTool(tool: ToolDefinition): AnthropicTool {
  const inputSchema = z.toJSONSchema(tool.inputSchema, {
    target: "draft-2020-12"
  });

  if (inputSchema.type !== "object") {
    throw new Error(`Tool ${tool.name} must use an object input schema.`);
  }

  const anthropicInputSchema: AnthropicTool["input_schema"] = {
    ...inputSchema,
    type: "object"
  };

  return {
    name: tool.name,
    description: tool.description,
    input_schema: anthropicInputSchema
  };
}

function validateToolCall(
  call: ToolUseBlock,
  toolsByName: ReadonlyMap<string, ToolDefinition>
): ValidatedToolCall | InvalidToolCall {
  const tool = toolsByName.get(call.name);

  if (tool === undefined) {
    return {
      id: call.id,
      name: call.name,
      input: call.input,
      error: "unknown_tool"
    };
  }

  const result = tool.inputSchema.safeParse(call.input);
  if (!result.success) {
    return {
      id: call.id,
      name: call.name,
      input: call.input,
      error: "invalid_input",
      details: result.error.issues
    };
  }

  return {
    id: call.id,
    name: call.name,
    input: result.data
  };
}

export function inspectTurn(
  response: Message,
  tools: readonly ToolDefinition[]
): InspectedTurn {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const requestedCalls = response.content.filter(
    (block): block is ToolUseBlock => block.type === "tool_use"
  );
  const inspectedCalls = requestedCalls.map((call) =>
    validateToolCall(call, toolsByName)
  );

  return {
    response,
    toolCalls: inspectedCalls.filter(
      (call): call is ValidatedToolCall => !("error" in call)
    ),
    invalidToolCalls: inspectedCalls.filter(
      (call): call is InvalidToolCall => "error" in call
    )
  };
}

export async function requestAndInspectTurn(
  client: MessageClient,
  model: string,
  userMessage: string,
  tools: readonly ToolDefinition[]
): Promise<InspectedTurn> {
  const response = await client.createMessage({
    model,
    max_tokens: 1024,
    messages: [{ role: "user", content: userMessage }],
    tools: tools.map(toAnthropicTool)
  });

  return inspectTurn(response, tools);
}
