import type { Message as PiSdkMessage } from '@mariozechner/pi-ai';

export interface ChatCompletionToolCallState {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface ChatCompletionMessageMeta {
  /**
   * Provenance information for user messages so history writers can
   * persist special cases (agent-attributed inputs, hidden callback turns).
   */
  source?: 'user' | 'agent' | 'callback';
  fromAgentId?: string;
  fromSessionId?: string;
  visibility?: 'visible' | 'hidden';
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
      role: 'system';
      content: string;
    }
  | {
      role: 'user';
      content: string;
      meta?: ChatCompletionMessageMeta;
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
