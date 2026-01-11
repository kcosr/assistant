import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { NoteMetadata } from './types';
import { normalizeTags } from '@assistant/shared';

export function parseFrontmatter(fileContent: string): {
  metadata: Partial<NoteMetadata>;
  content: string;
} {
  const trimmed = fileContent.trimStart();
  if (!trimmed.startsWith('---')) {
    return { metadata: {}, content: fileContent };
  }

  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/m.exec(trimmed);
  if (!frontmatterMatch) {
    return { metadata: {}, content: fileContent };
  }

  const yamlText = frontmatterMatch[1] ?? '';
  const body = frontmatterMatch[2] ?? '';
  const cleanedBody = body.replace(/^\r?\n/, '');
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText) ?? {};
  } catch {
    return { metadata: {}, content: cleanedBody };
  }

  const meta: Partial<NoteMetadata> = {};
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as {
      title?: unknown;
      tags?: unknown;
      created?: unknown;
      updated?: unknown;
    };

    if (typeof obj.title === 'string') {
      meta.title = obj.title;
    }

    if (Array.isArray(obj.tags)) {
      const rawTags = obj.tags.filter((t): t is string => typeof t === 'string');
      meta.tags = normalizeTags(rawTags);
    }

    if (typeof obj.created === 'string') {
      meta.created = obj.created;
    }

    if (typeof obj.updated === 'string') {
      meta.updated = obj.updated;
    }
  }

  return { metadata: meta, content: cleanedBody };
}

export function serializeFrontmatter(metadata: NoteMetadata, content: string): string {
  const frontmatter = {
    title: metadata.title,
    tags: normalizeTags(metadata.tags),
    created: metadata.created,
    updated: metadata.updated,
  };

  const yamlText = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yamlText}\n---\n\n${content}`;
}
