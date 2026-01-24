import type { CombinedPluginManifest } from '@assistant/shared';

import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import type { PluginModule } from '../../../../agent-server/src/plugins/types';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

type ApprovalRequestArgs = {
  prompt: string;
  approvalScopes?: Array<'once' | 'session' | 'always'>;
};

type QuestionnaireArgs = {
  title?: string;
  prompt?: string;
  includeRole?: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function parseApprovalArgs(raw: unknown): ApprovalRequestArgs {
  const obj = asObject(raw);
  const promptRaw = obj['prompt'];
  if (typeof promptRaw !== 'string' || promptRaw.trim().length === 0) {
    throw new ToolError('invalid_arguments', 'prompt is required and must be a string');
  }
  const scopesRaw = obj['approvalScopes'];
  const approvalScopes = Array.isArray(scopesRaw)
    ? scopesRaw.filter(
        (scope): scope is 'once' | 'session' | 'always' =>
          scope === 'once' || scope === 'session' || scope === 'always',
      )
    : undefined;
  return { prompt: promptRaw.trim(), approvalScopes };
}

function parseQuestionnaireArgs(raw: unknown): QuestionnaireArgs {
  const obj = asObject(raw);
  const titleRaw = obj['title'];
  const promptRaw = obj['prompt'];
  const includeRoleRaw = obj['includeRole'];
  return {
    ...(typeof titleRaw === 'string' ? { title: titleRaw } : {}),
    ...(typeof promptRaw === 'string' ? { prompt: promptRaw } : {}),
    ...(typeof includeRoleRaw === 'boolean' ? { includeRole: includeRoleRaw } : {}),
  };
}

function requireInteraction(ctx: ToolContext): (request: Parameters<NonNullable<ToolContext['requestInteraction']>>[0]) => Promise<unknown> {
  if (!ctx.requestInteraction) {
    throw new ToolError(
      'interaction_unavailable',
      'Interactive tools are not available in this environment.',
    );
  }
  return ctx.requestInteraction;
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    operations: {
      approval_request: async (args, ctx) => {
        const parsed = parseApprovalArgs(args);
        const requestInteraction = requireInteraction(ctx);

        return requestInteraction({
          type: 'approval',
          prompt: parsed.prompt,
          ...(parsed.approvalScopes ? { approvalScopes: parsed.approvalScopes } : {}),
          onResponse: (response) => {
            if (response.action === 'deny') {
              return {
                complete: {
                  ok: false,
                  denied: true,
                  ...(response.reason ? { reason: response.reason } : {}),
                },
              };
            }
            if (response.action === 'approve') {
              return {
                complete: {
                  ok: true,
                  scope: response.approvalScope ?? 'once',
                },
              };
            }
            return { complete: { ok: false, error: 'Unexpected response action' } };
          },
        });
      },
      questionnaire_request: async (args, ctx) => {
        const parsed = parseQuestionnaireArgs(args);
        const requestInteraction = requireInteraction(ctx);

        return requestInteraction({
          type: 'input',
          presentation: 'questionnaire',
          ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
          inputSchema: {
            title: parsed.title ?? 'Sample questionnaire',
            description: 'Provide a few details so the tool can proceed.',
            fields: [
              { id: 'name', type: 'text', label: 'Name', required: true },
              { id: 'email', type: 'text', label: 'Email', required: true },
              ...(parsed.includeRole
                ? [
                    {
                      id: 'role',
                      type: 'select',
                      label: 'Role',
                      options: [
                        { label: 'Developer', value: 'dev' },
                        { label: 'Designer', value: 'design' },
                        { label: 'Operator', value: 'ops' },
                      ],
                    },
                  ]
                : []),
              { id: 'subscribe', type: 'boolean', label: 'Subscribe to updates?' },
            ],
            submitLabel: 'Send',
            cancelLabel: 'Cancel',
          },
          onResponse: (response) => {
            if (response.action === 'cancel') {
              return { complete: { ok: false, cancelled: true } };
            }

            const input = response.input ?? {};
            const name = typeof input['name'] === 'string' ? input['name'].trim() : '';
            const email = typeof input['email'] === 'string' ? input['email'].trim() : '';

            const fieldErrors: Record<string, string> = {};
            if (!name) {
              fieldErrors['name'] = 'Name is required.';
            }
            if (!email || !email.includes('@')) {
              fieldErrors['email'] = 'Enter a valid email address.';
            }

            if (Object.keys(fieldErrors).length > 0) {
              return {
                reprompt: {
                  type: 'input',
                  presentation: 'questionnaire',
                  ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
                  inputSchema: {
                    title: parsed.title ?? 'Fix the errors',
                    description: 'Please correct the highlighted fields.',
                    fields: [
                      { id: 'name', type: 'text', label: 'Name', required: true },
                      { id: 'email', type: 'text', label: 'Email', required: true },
                      ...(parsed.includeRole
                        ? [
                            {
                              id: 'role',
                              type: 'select',
                              label: 'Role',
                              options: [
                                { label: 'Developer', value: 'dev' },
                                { label: 'Designer', value: 'design' },
                                { label: 'Operator', value: 'ops' },
                              ],
                            },
                          ]
                        : []),
                      { id: 'subscribe', type: 'boolean', label: 'Subscribe to updates?' },
                    ],
                    submitLabel: 'Send',
                    cancelLabel: 'Cancel',
                    initialValues: input,
                  },
                  errorSummary: 'Please correct the highlighted fields.',
                  fieldErrors,
                },
              };
            }

            return {
              complete: {
                ok: true,
                answers: input,
              },
            };
          },
        });
      },
    },
  };
}
