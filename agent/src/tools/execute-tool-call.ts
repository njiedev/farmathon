import type { ValidatedToolCall } from "../anthropic/request-turn.js";
import type { ToolDefinition } from "./tool.js";

export interface ExecutedToolCall {
  id: string;
  name: string;
  output: unknown;
}

export async function executeToolCall(
  call: ValidatedToolCall,
  tools: readonly ToolDefinition[]
): Promise<ExecutedToolCall> {
  const tool = tools.find((candidate) => candidate.name === call.name);

  if (tool === undefined) {
    throw new Error(`Validated tool ${call.name} is no longer registered.`);
  }

  const output = await tool.execute(call.input);

  return {
    id: call.id,
    name: call.name,
    output
  };
}

