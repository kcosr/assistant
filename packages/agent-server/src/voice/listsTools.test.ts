import { describe, expect, it } from 'vitest';

import type { Tool } from '../tools';

import {
  buildRealtimeInstructions,
  filterToolsForVoiceRealtime,
  isToolAllowedForVoiceRealtime,
  toRealtimeFunctionTools,
} from './listsTools';

const sampleTools: Tool[] = [
  { name: 'lists_list', description: 'List lists', parameters: { type: 'object' } },
  { name: 'lists_item_move', description: 'Move item', parameters: { type: 'object' } },
  { name: 'notes_list', description: 'List notes', parameters: { type: 'object' } },
  { name: 'bash', description: 'Shell', parameters: { type: 'object' } },
];

describe('filterToolsForVoiceRealtime', () => {
  it('defaults to no tools when allowlist is missing', () => {
    expect(filterToolsForVoiceRealtime(sampleTools, undefined, undefined)).toEqual([]);
  });

  it('defaults to no tools when allowlist is empty', () => {
    expect(filterToolsForVoiceRealtime(sampleTools, [], undefined)).toEqual([]);
  });

  it('matches globs and applies denylist', () => {
    const filtered = filterToolsForVoiceRealtime(sampleTools, ['lists_*'], ['lists_item_move']);
    expect(filtered.map((t) => t.name)).toEqual(['lists_list']);
  });

  it('supports exact names and star', () => {
    expect(filterToolsForVoiceRealtime(sampleTools, ['bash'], undefined).map((t) => t.name)).toEqual([
      'bash',
    ]);
    expect(filterToolsForVoiceRealtime(sampleTools, ['*'], ['bash', 'notes_*']).map((t) => t.name)).toEqual([
      'lists_list',
      'lists_item_move',
    ]);
  });
});

describe('isToolAllowedForVoiceRealtime', () => {
  it('denies when allowlist omitted', () => {
    expect(isToolAllowedForVoiceRealtime('lists_list', undefined, undefined)).toBe(false);
  });

  it('allows matching names and honors denylist', () => {
    expect(isToolAllowedForVoiceRealtime('lists_item_move', ['lists_*'], undefined)).toBe(true);
    expect(isToolAllowedForVoiceRealtime('lists_item_move', ['lists_*'], ['lists_item_move'])).toBe(
      false,
    );
    expect(isToolAllowedForVoiceRealtime('notes_list', ['lists_*'], undefined)).toBe(false);
  });
});

describe('toRealtimeFunctionTools', () => {
  it('maps host tools into realtime function shape', () => {
    const tools = toRealtimeFunctionTools([sampleTools[0]!]);
    expect(tools).toEqual([
      {
        type: 'function',
        name: 'lists_list',
        description: 'List lists',
        parameters: { type: 'object' },
      },
    ]);
  });
});

describe('buildRealtimeInstructions', () => {
  it('uses override when provided', () => {
    const text = buildRealtimeInstructions('ctx', 'Custom voice agent.');
    expect(text).toContain('Custom voice agent.');
    expect(text).toContain('Recent conversation context:\nctx');
  });

  it('uses default prompt when override omitted', () => {
    const text = buildRealtimeInstructions('');
    expect(text).toContain('Assistant realtime voice agent');
    expect(text).toContain('No prior conversation context.');
  });
});
