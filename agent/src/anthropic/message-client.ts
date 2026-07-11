import Anthropic from "@anthropic-ai/sdk";

import type {
  Message,
  MessageCreateParamsNonStreaming
} from "@anthropic-ai/sdk/resources/messages/messages";

export interface MessageClient {
  createMessage(params: MessageCreateParamsNonStreaming): Promise<Message>;
}

export function createAnthropicMessageClient(apiKey?: string): MessageClient {
  const anthropic = new Anthropic({ apiKey });

  return {
    createMessage(params) {
      return anthropic.messages.create(params);
    }
  };
}

