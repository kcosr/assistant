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
      role: 'system' | 'user' | 'assistant';
      content: string;
      tool_calls?: ChatCompletionToolCallMessageToolCall[];
    }
  | {
      role: 'tool';
      tool_call_id: string;
      content: string;
    };
