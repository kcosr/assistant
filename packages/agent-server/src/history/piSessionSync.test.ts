// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { Message as PiSdkMessage } from '@mariozechner/pi-ai';

import type { ChatCompletionMessage } from '../chatCompletionTypes';
import {
  attachPiSdkMessageToLastAssistant,
  buildMessagesForPiSync,
  resolveInterruptedPiSyncMessages,
} from './piSessionSync';

describe('attachPiSdkMessageToLastAssistant', () => {
  it('attaches piSdkMessage to the last assistant message', () => {
    const messages: ChatCompletionMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
    ];
    const piSdkMessage = { role: 'assistant', content: [] } as unknown as PiSdkMessage;

    const result = attachPiSdkMessageToLastAssistant({ messages, piSdkMessage });

    expect(result).not.toBe(messages);
    expect(result[1]).toMatchObject({ role: 'assistant', content: 'ok', piSdkMessage });
  });

  it('returns the original list if piSdkMessage is missing', () => {
    const messages: ChatCompletionMessage[] = [{ role: 'assistant', content: 'ok' }];

    const result = attachPiSdkMessageToLastAssistant({ messages });

    expect(result).toBe(messages);
  });

  it('returns the original list when the last assistant already has piSdkMessage', () => {
    const existing = { role: 'assistant', content: [] } as unknown as PiSdkMessage;
    const messages: ChatCompletionMessage[] = [
      { role: 'assistant', content: 'ok', piSdkMessage: existing },
    ];
    const piSdkMessage = { role: 'assistant', content: [] } as unknown as PiSdkMessage;

    const result = attachPiSdkMessageToLastAssistant({ messages, piSdkMessage });

    expect(result).toBe(messages);
  });

  it('returns the original list when no assistant message exists', () => {
    const messages: ChatCompletionMessage[] = [{ role: 'user', content: 'hi' }];
    const piSdkMessage = { role: 'assistant', content: [] } as unknown as PiSdkMessage;

    const result = attachPiSdkMessageToLastAssistant({ messages, piSdkMessage });

    expect(result).toBe(messages);
  });
});

describe('buildMessagesForPiSync', () => {
  it('does not append the final assistant again when replay messages alias state messages', () => {
    const assistant = { role: 'assistant', content: 'done' } as const;
    const stateMessages: ChatCompletionMessage[] = [
      { role: 'user', content: 'hi' },
      assistant,
    ];

    const result = buildMessagesForPiSync({
      stateMessages,
      replayMessages: stateMessages,
      finalAssistantMessage: assistant,
    });

    expect(result).toBe(stateMessages);
    expect(result).toHaveLength(2);
  });

  it('appends the final assistant when replay messages are separate from state messages', () => {
    const finalAssistant = { role: 'assistant', content: 'done' } as const;
    const stateMessages: ChatCompletionMessage[] = [
      { role: 'user', content: 'hi' },
      finalAssistant,
    ];
    const replayMessages: ChatCompletionMessage[] = [{ role: 'user', content: 'hi' }];

    const result = buildMessagesForPiSync({
      stateMessages,
      replayMessages,
      finalAssistantMessage: finalAssistant,
    });

    expect(result).toEqual([...replayMessages, finalAssistant]);
  });
});

describe('resolveInterruptedPiSyncMessages', () => {
  it('drops a late aborted replay tail and appends only the final interrupted assistant', () => {
    const baseMessages: ChatCompletionMessage[] = [{ role: 'user', content: 'again' }];
    const replayMessages: ChatCompletionMessage[] = [
      ...baseMessages,
      { role: 'assistant', content: '', tool_calls: [] },
      { role: 'tool', tool_call_id: 'tool-1', content: 'Command aborted' },
    ];
    const finalAssistant = { role: 'assistant', content: 'Interrupted answer' } as const;

    const result = resolveInterruptedPiSyncMessages({
      baseMessages,
      replayMessages,
      finalAssistantMessage: finalAssistant,
    });

    expect(result.messages).toEqual([...baseMessages, finalAssistant]);
    expect(result.droppedMessages).toEqual(replayMessages.slice(1));
  });

  it('keeps replay messages when they do not extend the base prefix', () => {
    const baseMessages: ChatCompletionMessage[] = [{ role: 'user', content: 'again' }];
    const replayMessages: ChatCompletionMessage[] = [{ role: 'user', content: 'different' }];

    const result = resolveInterruptedPiSyncMessages({
      baseMessages,
      replayMessages,
    });

    expect(result.messages).toBe(replayMessages);
    expect(result.droppedMessages).toEqual([]);
  });
});
