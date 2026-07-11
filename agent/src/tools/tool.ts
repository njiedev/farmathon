import type { z } from "zod";

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  execute(input: unknown): Promise<unknown>;
}

export interface Tool<Input, Output> extends ToolDefinition {
  readonly inputSchema: z.ZodType<Input>;
  execute(input: Input): Promise<Output>;
}
