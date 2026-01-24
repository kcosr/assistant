import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createTwoFilesPatch } from 'diff';

import type { Note, NoteMetadata, NoteSearchResult } from './types';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter';
import { NotePathResolver } from './notePaths';
import { hasAllTags, normalizeTags } from '@assistant/shared';

const DEFAULT_SEARCH_LIMIT = 20;

export class NotesStore {
  private readonly baseDir: string;
  private readonly paths: NotePathResolver;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.paths = new NotePathResolver(baseDir);
  }

  // Legacy private helpers (kept for tests and compatibility)

  private slugify(title: string): string {
    return this.paths.slugify(title);
  }

  private titleFromSlug(slug: string): string {
    return this.paths.titleFromSlug(slug);
  }

  private validateSlug(slug: string): void {
    this.paths.validateSlug(slug);
  }

  private resolvePath(title: string): string {
    return this.paths.resolvePath(title).filePath;
  }

  // Public API

  async list(params?: { tags?: string[] }): Promise<NoteMetadata[]> {
    const notes: NoteMetadata[] = [];

    let entries: { name: string; isFile(): boolean }[] = [];
    try {
      const dirEntries = await readdir(this.baseDir, { withFileTypes: true });
      entries = dirEntries.map((entry) => ({
        name: entry.name,
        isFile: () => entry.isFile(),
      }));
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }

      const slug = entry.name.slice(0, -3);
      try {
        this.paths.validateSlug(slug);
      } catch {
        continue;
      }

      const filePath = path.join(this.baseDir, entry.name);
      let fileContent: string;
      try {
        fileContent = await readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      const { metadata } = parseFrontmatter(fileContent);

      let created = metadata.created;
      let updated = metadata.updated;
      if (!created || !updated) {
        try {
          const stats = await stat(filePath);
          const time = stats.mtime.toISOString();
          created = created ?? time;
          updated = updated ?? time;
        } catch {
          const now = new Date().toISOString();
          created = created ?? now;
          updated = updated ?? now;
        }
      }

      const tags = normalizeTags(metadata.tags);
      const description =
        typeof metadata.description === 'string' && metadata.description.trim().length > 0
          ? metadata.description
          : undefined;
      const noteMeta: NoteMetadata = {
        title: metadata.title ?? this.paths.titleFromSlug(slug),
        tags,
        created,
        updated,
        ...(description ? { description } : {}),
      };

      if (!hasAllTags(noteMeta.tags, params?.tags)) {
        continue;
      }

      notes.push(noteMeta);
    }

    return notes;
  }

  async read(title: string): Promise<Note> {
    const { filePath, slug } = this.paths.resolvePath(title);

    const fileContent = await readFile(filePath, 'utf-8');
    const { metadata, content } = parseFrontmatter(fileContent);

    const tags = normalizeTags(metadata.tags);
    const created = metadata.created ?? new Date().toISOString();
    const updated = metadata.updated ?? created;
    const description =
      typeof metadata.description === 'string' && metadata.description.trim().length > 0
        ? metadata.description
        : undefined;

    return {
      title: metadata.title ?? title ?? this.paths.titleFromSlug(slug),
      tags,
      created,
      updated,
      ...(description ? { description } : {}),
      content,
    };
  }

  async write(params: {
    title: string;
    content: string;
    tags?: string[];
    description?: string;
  }): Promise<NoteMetadata> {
    const { title, content } = params;
    const { filePath } = this.paths.resolvePath(title);

    let existingMetadata: Partial<NoteMetadata> | undefined;
    try {
      const existingContent = await readFile(filePath, 'utf-8');
      const parsed = parseFrontmatter(existingContent);
      existingMetadata = parsed.metadata;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        throw err;
      }
    }

    const now = new Date().toISOString();
    const created = existingMetadata?.created ?? now;
    const tags = params.tags ?? existingMetadata?.tags ?? [];
    let description: string | undefined;
    if (params.description !== undefined) {
      const trimmed = params.description.trim();
      description = trimmed ? params.description : undefined;
    } else if (typeof existingMetadata?.description === 'string') {
      description = existingMetadata.description;
    }

    const metadata: NoteMetadata = {
      title,
      tags: normalizeTags(tags),
      created,
      updated: now,
      ...(description ? { description } : {}),
    };

    const serialized = serializeFrontmatter(metadata, content);
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(filePath, serialized, 'utf-8');
    return metadata;
  }

  async writeWithMetadata(note: Note): Promise<NoteMetadata> {
    const { filePath } = this.paths.resolvePath(note.title);
    const now = new Date().toISOString();
    const metadata: NoteMetadata = {
      title: note.title,
      tags: normalizeTags(note.tags ?? []),
      created: note.created || now,
      updated: note.updated || now,
      ...(note.description && note.description.trim() ? { description: note.description } : {}),
    };

    const serialized = serializeFrontmatter(metadata, note.content);
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(filePath, serialized, 'utf-8');
    return metadata;
  }

  async rename(params: {
    title: string;
    newTitle: string;
    overwrite?: boolean;
  }): Promise<NoteMetadata> {
    const { title, newTitle, overwrite } = params;
    const source = this.paths.resolvePath(title);
    const target = this.paths.resolvePath(newTitle);
    const fileContent = await readFile(source.filePath, 'utf-8');
    const { metadata, content } = parseFrontmatter(fileContent);

    const now = new Date().toISOString();
    const created = metadata.created ?? now;
    const tags = normalizeTags(metadata.tags);
    const description =
      typeof metadata.description === 'string' && metadata.description.trim().length > 0
        ? metadata.description
        : undefined;
    const updated = now;

    const newMetadata: NoteMetadata = {
      title: newTitle,
      tags,
      created,
      updated,
      ...(description ? { description } : {}),
    };

    const serialized = serializeFrontmatter(newMetadata, content);
    await mkdir(this.baseDir, { recursive: true });

    if (source.slug === target.slug) {
      await writeFile(source.filePath, serialized, 'utf-8');
      return newMetadata;
    }

    if (!overwrite) {
      try {
        await readFile(target.filePath, 'utf-8');
        const existsError = new Error(`Note already exists: ${newTitle}`) as NodeJS.ErrnoException;
        existsError.code = 'EEXIST';
        throw existsError;
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code !== 'ENOENT') {
          throw err;
        }
      }
    }

    await writeFile(target.filePath, serialized, 'utf-8');
    await this.delete(title);
    return newMetadata;
  }

  async append(title: string, content: string): Promise<NoteMetadata> {
    const { filePath } = this.paths.resolvePath(title);

    const existingContent = await readFile(filePath, 'utf-8');
    const { metadata, content: body } = parseFrontmatter(existingContent);

    const now = new Date().toISOString();
    const created = metadata.created ?? now;
    const tags = normalizeTags(metadata.tags);
    const description =
      typeof metadata.description === 'string' && metadata.description.trim().length > 0
        ? metadata.description
        : undefined;
    const updatedBody = body.length > 0 ? `${body}\n${content}` : content;

    const newMetadata: NoteMetadata = {
      title: metadata.title ?? title,
      tags,
      created,
      updated: now,
      ...(description ? { description } : {}),
    };

    const serialized = serializeFrontmatter(newMetadata, updatedBody);
    await writeFile(filePath, serialized, 'utf-8');
    return newMetadata;
  }

  async addTags(title: string, tagsToAdd: string[]): Promise<NoteMetadata> {
    const { filePath, slug } = this.paths.resolvePath(title);

    let fileContent: string;
    try {
      fileContent = await readFile(filePath, 'utf-8');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        throw err;
      }
      throw err;
    }

    const { metadata, content } = parseFrontmatter(fileContent);

    const now = new Date().toISOString();
    const created = metadata.created ?? now;
    const existingTags = normalizeTags(metadata.tags);
    const description =
      typeof metadata.description === 'string' && metadata.description.trim().length > 0
        ? metadata.description
        : undefined;
    const combinedTags = normalizeTags([...existingTags, ...tagsToAdd]);

    const newMetadata: NoteMetadata = {
      title: metadata.title ?? title ?? this.paths.titleFromSlug(slug),
      tags: combinedTags,
      created,
      updated: now,
      ...(description ? { description } : {}),
    };

    const serialized = serializeFrontmatter(newMetadata, content);
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(filePath, serialized, 'utf-8');
    return newMetadata;
  }

  async removeTags(title: string, tagsToRemove: string[]): Promise<NoteMetadata> {
    const { filePath, slug } = this.paths.resolvePath(title);

    let fileContent: string;
    try {
      fileContent = await readFile(filePath, 'utf-8');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        throw err;
      }
      throw err;
    }

    const { metadata, content } = parseFrontmatter(fileContent);

    const now = new Date().toISOString();
    const created = metadata.created ?? now;
    const existingTags = normalizeTags(metadata.tags);
    const description =
      typeof metadata.description === 'string' && metadata.description.trim().length > 0
        ? metadata.description
        : undefined;
    const removeNormalized = normalizeTags(tagsToRemove);
    const remainingTags = existingTags.filter((tag) => !removeNormalized.includes(tag));

    const newMetadata: NoteMetadata = {
      title: metadata.title ?? title ?? this.paths.titleFromSlug(slug),
      tags: remainingTags,
      created,
      updated: now,
      ...(description ? { description } : {}),
    };

    const serialized = serializeFrontmatter(newMetadata, content);
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(filePath, serialized, 'utf-8');
    return newMetadata;
  }

  async delete(title: string): Promise<void> {
    const { filePath } = this.paths.resolvePath(title);
    await unlink(filePath);
  }

  async search(params: {
    query: string;
    tags?: string[];
    limit?: number;
  }): Promise<NoteSearchResult[]> {
    const query = params.query.trim().toLowerCase();
    if (!query) {
      return [];
    }

    let entries: { name: string; isFile(): boolean }[] = [];
    try {
      const dirEntries = await readdir(this.baseDir, { withFileTypes: true });
      entries = dirEntries.map((entry) => ({
        name: entry.name,
        isFile: () => entry.isFile(),
      }));
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    const results: NoteSearchResult[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }

      const slug = entry.name.slice(0, -3);
      try {
        this.paths.validateSlug(slug);
      } catch {
        continue;
      }

      const filePath = path.join(this.baseDir, entry.name);
      let fileContent: string;
      try {
        fileContent = await readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      const { metadata, content } = parseFrontmatter(fileContent);
      const tags = normalizeTags(metadata.tags);

      if (!hasAllTags(tags, params.tags)) {
        continue;
      }

      const title = metadata.title ?? this.paths.titleFromSlug(slug);
      const lowerTitle = title.toLowerCase();
      const lowerContent = content.toLowerCase();
      const description =
        typeof metadata.description === 'string' && metadata.description.trim().length > 0
          ? metadata.description
          : '';
      const lowerDescription = description.toLowerCase();

      // Check if query matches title, content, or description
      const titleMatches = lowerTitle.includes(query);
      const contentIndex = lowerContent.indexOf(query);
      const contentMatches = contentIndex !== -1;
      const descriptionIndex = description ? lowerDescription.indexOf(query) : -1;
      const descriptionMatches = descriptionIndex !== -1;

      if (!titleMatches && !contentMatches && !descriptionMatches) {
        continue;
      }

      let snippet: string | undefined;
      const buildSnippet = (source: string, matchIndex: number): string => {
        const context = 40;
        const start = Math.max(0, matchIndex - context);
        const end = Math.min(source.length, matchIndex + query.length + context);
        let snippetText = source.slice(start, end).replace(/\s+/g, ' ').trim();
        if (start > 0) {
          snippetText = `…${snippetText}`;
        }
        if (end < source.length) {
          snippetText = `${snippetText}…`;
        }
        return snippetText;
      };
      if (contentMatches) {
        snippet = buildSnippet(content, contentIndex);
      } else if (descriptionMatches) {
        snippet = buildSnippet(description, descriptionIndex);
      }

      results.push({
        title,
        tags,
        ...(description ? { description } : {}),
        ...(snippet ? { snippet } : {}),
      });
    }

    const limit = params.limit ?? DEFAULT_SEARCH_LIMIT;
    if (limit > 0 && results.length > limit) {
      return results.slice(0, limit);
    }

    return results;
  }

  async previewWrite(title: string, content: string): Promise<string> {
    const { filePath, slug } = this.paths.resolvePath(title);

    let oldBodyContent = '';
    try {
      const fileContent = await readFile(filePath, 'utf-8');
      const parsed = parseFrontmatter(fileContent);
      oldBodyContent = parsed.content;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        throw err;
      }
      // File doesn't exist - old content is empty
    }

    // Diff only the body content, not the frontmatter
    return createTwoFilesPatch(`${slug}.md`, `${slug}.md`, oldBodyContent, content);
  }
}
