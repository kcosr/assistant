import type { RealtimeFunctionTool } from './types';

/** Canonical lists plugin ops exposed to Realtime (title-lookup friendly). */
export const REALTIME_LISTS_TOOL_NAMES = [
  'lists_list',
  'lists_get',
  'lists_items_list',
  'lists_items_search',
  'lists_item_get',
  'lists_item_add',
  'lists_item_update',
  'lists_item_remove',
  'lists_item_tags_add',
  'lists_item_tags_remove',
] as const;

export type RealtimeListsToolName = (typeof REALTIME_LISTS_TOOL_NAMES)[number];

const TOOL_TO_PLUGIN_OP: Record<RealtimeListsToolName, string> = {
  lists_list: 'lists_list',
  lists_get: 'lists_get',
  lists_items_list: 'lists_items_list',
  lists_items_search: 'lists_items_search',
  lists_item_get: 'lists_item_get',
  lists_item_add: 'lists_item_add',
  lists_item_update: 'lists_item_update',
  lists_item_remove: 'lists_item_remove',
  lists_item_tags_add: 'lists_item_tags_add',
  lists_item_tags_remove: 'lists_item_tags_remove',
};

export function isRealtimeListsTool(name: string): name is RealtimeListsToolName {
  return (REALTIME_LISTS_TOOL_NAMES as readonly string[]).includes(name);
}

export function pluginToolNameForRealtime(name: RealtimeListsToolName): string {
  return TOOL_TO_PLUGIN_OP[name];
}

export function buildRealtimeListsTools(): RealtimeFunctionTool[] {
  const instance = {
    type: 'string',
    description: 'Lists plugin instance id (default "default").',
  };
  return [
    {
      type: 'function',
      name: 'lists_list',
      description: 'List all lists, optionally filtered by tags.',
      parameters: {
        type: 'object',
        properties: {
          instance_id: instance,
          tags: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'lists_get',
      description: 'Get a list by id.',
      parameters: {
        type: 'object',
        properties: {
          instance_id: instance,
          id: { type: 'string', description: 'List id.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'lists_items_list',
      description: 'List items in a list.',
      parameters: {
        type: 'object',
        properties: {
          instance_id: instance,
          listId: { type: 'string' },
        },
        required: ['listId'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'lists_items_search',
      description: 'Search list items by query and optional list/tags filters.',
      parameters: {
        type: 'object',
        properties: {
          instance_id: instance,
          query: { type: 'string' },
          listId: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'lists_item_get',
      description: 'Get one list item by id.',
      parameters: {
        type: 'object',
        properties: {
          instance_id: instance,
          listId: { type: 'string' },
          id: { type: 'string' },
        },
        required: ['listId', 'id'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'lists_item_add',
      description: 'Add an item to a list. Prefer list title lookup when id is unknown.',
      parameters: {
        type: 'object',
        properties: {
          instance_id: instance,
          listId: { type: 'string' },
          listTitle: { type: 'string', description: 'Optional list title lookup if listId unknown.' },
          title: { type: 'string' },
          notes: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'lists_item_update',
      description:
        'Update a list item. Prefer lookupTitle when the item id is unknown from conversation.',
      parameters: {
        type: 'object',
        properties: {
          instance_id: instance,
          listId: { type: 'string' },
          id: { type: 'string' },
          lookupTitle: { type: 'string' },
          title: { type: 'string' },
          notes: { type: 'string' },
          completed: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'lists_item_remove',
      description: 'Remove a list item by id or title.',
      parameters: {
        type: 'object',
        properties: {
          instance_id: instance,
          listId: { type: 'string' },
          id: { type: 'string' },
          title: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'lists_item_tags_add',
      description: 'Add tags to a list item.',
      parameters: {
        type: 'object',
        properties: {
          instance_id: instance,
          listId: { type: 'string' },
          id: { type: 'string' },
          lookupTitle: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['tags'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'lists_item_tags_remove',
      description: 'Remove tags from a list item.',
      parameters: {
        type: 'object',
        properties: {
          instance_id: instance,
          listId: { type: 'string' },
          id: { type: 'string' },
          lookupTitle: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['tags'],
        additionalProperties: false,
      },
    },
  ];
}

export function buildRealtimeInstructions(contextBlock: string): string {
  return [
    'You are the Assistant realtime voice agent.',
    'Speak concisely. Prefer short confirmations after list mutations.',
    'You may only use the provided lists tools. Never invent tool names.',
    'Prefer title lookup fields when the user refers to items by name.',
    'Do not claim you can control Thread voice, notifications, or coding agents.',
    contextBlock.trim().length > 0
      ? `Recent conversation context:\n${contextBlock.trim()}`
      : 'No prior conversation context.',
  ].join('\n');
}
