import type { Tool } from './types';

export interface ChatCompletionToolSpec {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

export function mapToolsToChatCompletionSpecs(tools: Tool[]): ChatCompletionToolSpec[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? {},
    },
  }));
}
