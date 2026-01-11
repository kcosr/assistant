import type { Tool } from './tools';
import type { ConversationLogRecord } from './conversationStore';
import type { AgentRegistry } from './agents';
import { buildSystemPrompt } from './systemPrompt';
import type { ChatCompletionMessage } from './chatCompletionTypes';

export function buildChatMessagesFromTranscript(
  records: ConversationLogRecord[],
  agentRegistry: AgentRegistry,
  agentId: string | undefined,
  tools?: Tool[],
  sessionId?: string,
): ChatCompletionMessage[] {
  const promptOptions = {
    agentRegistry,
    agentId,
    ...(tools !== undefined ? { tools } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
  const messages: ChatCompletionMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(promptOptions),
    },
  ];

  // Collect tool_call records to group them into assistant messages
  // Key: timestamp of the first tool call in a group
  const toolCallGroups = new Map<string, Array<{ id: string; name: string; arguments: string }>>();

  // First pass: collect tool calls into groups
  for (const record of records) {
    if (record.type === 'tool_call') {
      // Group tool calls by timestamp
      const groupKey = record.timestamp;
      if (!toolCallGroups.has(groupKey)) {
        toolCallGroups.set(groupKey, []);
      }
      toolCallGroups.get(groupKey)!.push({
        id: record.callId,
        name: record.toolName,
        arguments: record.argsJson,
      });
    }
  }

  // Second pass: build messages
  for (const record of records) {
    if (record.type === 'user_message') {
      const text = typeof record.text === 'string' ? record.text.trim() : '';
      if (!text) {
        continue;
      }
      messages.push({
        role: 'user',
        content: text,
      });
    } else if (record.type === 'assistant_message') {
      const text = typeof record.text === 'string' ? record.text.trim() : '';
      if (!text) {
        continue;
      }
      messages.push({
        role: 'assistant',
        content: text,
      });
    } else if (record.type === 'agent_message' || record.type === 'agent_callback') {
      const text = record.text.trim();
      if (!text) {
        continue;
      }
      messages.push({
        role: 'user',
        content: text,
      });
    } else if (record.type === 'tool_call') {
      // Create an assistant message with tool_calls
      const toolCalls = toolCallGroups.get(record.timestamp);
      if (toolCalls && toolCalls.length > 0) {
        // Only add once per group (first tool call in the group triggers this)
        const firstCall = toolCalls[0];
        if (firstCall && firstCall.id === record.callId) {
          messages.push({
            role: 'assistant',
            content: '',
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: tc.arguments,
              },
            })),
          });
        }
      }
    } else if (record.type === 'tool_result') {
      const content = JSON.stringify({
        ok: record.ok,
        result: record.result,
        error: record.error,
      });
      messages.push({
        role: 'tool',
        tool_call_id: record.callId,
        content,
      });
    }
  }

  return messages;
}
