import type { Message as PiSdkMessage } from '@mariozechner/pi-ai';

export interface ChatCompletionToolCallState {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface ChatCompletionToolCallMessageToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type ChatCompletionMessage =
  | {
      role: 'system' | 'user';
      content: string;
    }
  | {
      role: 'assistant';
      content: string;
      tool_calls?: ChatCompletionToolCallMessageToolCall[];
      /**
       * Optional Pi SDK message payload (includes thinking/toolcall signatures).
       * Used only by the Pi SDK provider to preserve reasoning items across turns.
       */
      piSdkMessage?: PiSdkMessage;
    }
  | {
      role: 'tool';
      tool_call_id: string;
      content: string;
    };
