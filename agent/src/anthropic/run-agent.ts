import type {
  Message,
  MessageParam,
  ToolResultBlockParam
} from "@anthropic-ai/sdk/resources/messages/messages";
import type { MessageClient } from "./message-client.js";
import {
  inspectTurn,
  toAnthropicTool
} from "./request-turn.js";
import type {
  InvalidToolCall,
  ValidatedToolCall
} from "./request-turn.js";
import { executeToolCall } from "../tools/execute-tool-call.js";
import type { ExecutedToolCall } from "../tools/execute-tool-call.js";
import type { ToolDefinition } from "../tools/tool.js";

export interface RunAgentOptions {
  model: string;
  userMessage: string;
  tools: readonly ToolDefinition[];
  systemPrompt?: string;
  maxToolRounds?: number;
}

function executedCallToResult(call: ExecutedToolCall): ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: call.id,
    content: JSON.stringify(call.output) ?? "null"
  };
}

function invalidCallToResult(call: InvalidToolCall): ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: call.id,
    is_error: true,
    content: JSON.stringify({
      error: call.error,
      details: call.details ?? []
    })
  };
}

async function executeCallToResult(
  call: ValidatedToolCall,
  tools: readonly ToolDefinition[]
): Promise<ToolResultBlockParam> {
  try {
    return executedCallToResult(await executeToolCall(call, tools));
  } catch (error) {
    return {
      type: "tool_result",
      tool_use_id: call.id,
      is_error: true,
      content: JSON.stringify({
        error: "tool_execution_failed",
        tool: call.name,
        message: error instanceof Error ? error.message : "Unknown tool failure"
      })
    };
  }
}

export async function runAgent(
  client: MessageClient,
  options: RunAgentOptions
): Promise<Message> {
  const maxToolRounds = options.maxToolRounds ?? 5;
  const messages: MessageParam[] = [
    { role: "user", content: options.userMessage }
  ];

  for (let round = 0; round <= maxToolRounds; round += 1) {
    const response = await client.createMessage({
      model: options.model,
      max_tokens: 1024,
      messages,
      tools: options.tools.map(toAnthropicTool),
      ...(options.systemPrompt === undefined
        ? {}
        : { system: options.systemPrompt })
    });
    const inspected = inspectTurn(response, options.tools);

    if (
      inspected.toolCalls.length === 0 &&
      inspected.invalidToolCalls.length === 0
    ) {
      return response;
    }

    if (round === maxToolRounds) {
      throw new Error(`Agent exceeded ${maxToolRounds} tool rounds.`);
    }

    const executedResults = await Promise.all(
      inspected.toolCalls.map((call) =>
        executeCallToResult(call, options.tools)
      )
    );
    const toolResults: ToolResultBlockParam[] = [
      ...executedResults,
      ...inspected.invalidToolCalls.map(invalidCallToResult)
    ];

    messages.push(
      { role: "assistant", content: response.content },
      { role: "user", content: toolResults }
    );
  }

  throw new Error("Agent loop ended unexpectedly.");
}
