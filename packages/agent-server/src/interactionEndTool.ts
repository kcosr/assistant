export const INTERACTION_END_TOOL_NAME = 'interaction_end';

export const INTERACTION_END_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    reason: {
      type: 'string',
      description: 'Optional short reason (for example user_request or done).',
    },
  },
  additionalProperties: false,
};

export function isInteractionEndTool(name: string): boolean {
  return name === INTERACTION_END_TOOL_NAME;
}
