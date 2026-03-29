import { describe, expect, it } from 'vitest';

import {
  findQuestionnaireSchemaIssue,
  mergeQuestionnaireInitialValues,
  validateQuestionnaireInput,
} from './questionnaireUtils';

describe('questionnaireUtils', () => {
  it('merges field defaults into initial values without overwriting explicit values', () => {
    const schema = mergeQuestionnaireInitialValues({
      title: 'Profile',
      initialValues: { role: 'design' },
      fields: [
        { id: 'name', type: 'text', label: 'Name', defaultValue: 'Ada' },
        {
          id: 'role',
          type: 'select',
          label: 'Role',
          defaultValue: 'dev',
          options: [
            { label: 'Developer', value: 'dev' },
            { label: 'Designer', value: 'design' },
          ],
        },
      ],
    });

    expect(schema.initialValues).toEqual({ name: 'Ada', role: 'design' });
  });

  it('reports duplicate field ids as schema issues', () => {
    const issue = findQuestionnaireSchemaIssue({
      title: 'Profile',
      fields: [
        { id: 'name', type: 'text', label: 'Name' },
        { id: 'name', type: 'text', label: 'Display Name' },
      ],
    });

    expect(issue).toBe('Duplicate field id: name');
  });

  it('validates required fields and option values', () => {
    const errors = validateQuestionnaireInput(
      {
        title: 'Profile',
        fields: [
          { id: 'name', type: 'text', label: 'Name', required: true },
          {
            id: 'role',
            type: 'select',
            label: 'Role',
            required: true,
            options: [
              { label: 'Developer', value: 'dev' },
              { label: 'Designer', value: 'design' },
            ],
          },
        ],
      },
      { name: '', role: 'ops' },
    );

    expect(errors).toEqual({
      name: 'This field is required.',
      role: 'Select a valid option.',
    });
  });
});
