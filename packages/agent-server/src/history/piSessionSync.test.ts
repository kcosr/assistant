// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { Message as PiSdkMessage } from '@mariozechner/pi-ai';

import type { ChatCompletionMessage } from '../chatCompletionTypes';
import { attachPiSdkMessageToLastAssistant } from './piSessionSync';

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
