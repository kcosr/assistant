import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { Note, NoteMetadata, NoteSearchResult } from './types';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter';
import { NotePathResolver } from './notePaths';
import { hasAllTags, normalizeTags } from '@assistant/shared';

import {
  InvalidNotePatchError,
  NotesConflictError,
  atomicWrite,
  checkRevision,
  noteRevision,
  patchNoteBody,
  withNoteLocks,
  type NoteEdit,
} from './noteMutations';
export { NotesConflictError, InvalidNotePatchError } from './noteMutations';

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
      const favorite = metadata.favorite === true;
      const noteMeta: NoteMetadata = {
        title: metadata.title ?? this.paths.titleFromSlug(slug),
        tags,
        ...(favorite ? { favorite: true } : {}),
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

    const favorite = metadata.favorite === true;
    return {
      title: metadata.title ?? title ?? this.paths.titleFromSlug(slug),
      tags,
      ...(favorite ? { favorite: true } : {}),
      created,
      updated,
      ...(description ? { description } : {}),
      content,
      revision: noteRevision(fileContent),
    };
  }

  private async raw(file: string): Promise<string | undefined> {
    try {
      return await readFile(file, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async save(file: string, metadata: NoteMetadata, content: string): Promise<NoteMetadata> {
    const raw = serializeFrontmatter(metadata, content);
    await atomicWrite(file, raw);
    return { ...metadata, revision: noteRevision(raw) };
  }

  async write(params: {
    title: string;
    content: string;
    tags?: string[];
    description?: string;
    favorite?: boolean;
    expectedRevision?: string;
  }): Promise<NoteMetadata> {
    const { filePath } = this.paths.resolvePath(params.title);
    return withNoteLocks([filePath], async () => {
      const raw = await this.raw(filePath);
      checkRevision(raw, params.expectedRevision);
      const existing = raw === undefined ? {} : parseFrontmatter(raw).metadata;
      const now = new Date().toISOString();
      const description = params.description ?? existing.description;
      const metadata: NoteMetadata = {
        title: params.title,
        tags: normalizeTags(params.tags ?? existing.tags ?? []),
        created: existing.created ?? now,
        updated: now,
        ...((params.favorite ?? existing.favorite) === true ? { favorite: true } : {}),
        ...(description?.trim() ? { description } : {}),
      };
      return this.save(filePath, metadata, params.content);
    });
  }

  async patch(params: {
    title: string;
    expectedRevision: string;
    edits: NoteEdit[];
  }): Promise<NoteMetadata> {
    if (typeof params.expectedRevision !== 'string' || !params.expectedRevision) {
      throw new InvalidNotePatchError(
        'expectedRevision is required. Read the note before patching.',
      );
    }
    const { filePath } = this.paths.resolvePath(params.title);
    return withNoteLocks([filePath], async () => {
      const raw = await this.raw(filePath);
      checkRevision(raw, params.expectedRevision);
      const note = await this.read(params.title);
      const content = patchNoteBody(note.content, params.edits);
      const { content: _body, revision: _revision, ...metadata } = note;
      if (content === note.content) return { ...metadata, revision: note.revision };
      return this.save(filePath, { ...metadata, updated: new Date().toISOString() }, content);
    });
  }

  async rename(params: {
    title: string;
    newTitle: string;
    overwrite?: boolean;
    expectedRevision?: string;
  }): Promise<NoteMetadata> {
    return this.transfer(
      this,
      params.title,
      params.newTitle,
      params.overwrite,
      params.expectedRevision,
      true,
    );
  }

  async moveTo(
    target: NotesStore,
    params: {
      title: string;
      overwrite?: boolean;
      expectedRevision?: string;
    },
  ): Promise<NoteMetadata> {
    return this.transfer(
      target,
      params.title,
      params.title,
      params.overwrite,
      params.expectedRevision,
      false,
    );
  }

  private async transfer(
    targetStore: NotesStore,
    title: string,
    newTitle: string,
    overwrite: boolean | undefined,
    expectedRevision: string | undefined,
    renameTitle: boolean,
  ): Promise<NoteMetadata> {
    const source = this.paths.resolvePath(title).filePath;
    const target = targetStore.paths.resolvePath(newTitle).filePath;
    return withNoteLocks([source, target], async () => {
      if (expectedRevision !== undefined) checkRevision(await this.raw(source), expectedRevision);
      const note = await this.read(title);
      if (source !== target && !overwrite && (await this.raw(target)) !== undefined) {
        const error = new Error(`Note already exists: ${newTitle}`) as NodeJS.ErrnoException;
        error.code = 'EEXIST';
        throw error;
      }
      const { content, revision: _revision, ...metadata } = note;
      const result = await targetStore.save(
        target,
        {
          ...metadata,
          ...(renameTitle ? { title: newTitle, updated: new Date().toISOString() } : {}),
        },
        content,
      );
      if (source !== target) await unlink(source);
      return result;
    });
  }

  private async update(title: string, transform: (note: Note) => void): Promise<NoteMetadata> {
    const { filePath } = this.paths.resolvePath(title);
    return withNoteLocks([filePath], async () => {
      const note = await this.read(title);
      transform(note);
      const { content, revision: _revision, ...metadata } = note;
      return this.save(filePath, { ...metadata, updated: new Date().toISOString() }, content);
    });
  }

  async append(params: {
    title: string;
    text: string;
    expectedRevision?: string;
  }): Promise<NoteMetadata> {
    const { filePath } = this.paths.resolvePath(params.title);
    return withNoteLocks([filePath], async () => {
      const note = await this.read(params.title);
      if (params.expectedRevision !== undefined && params.expectedRevision !== note.revision) {
        throw new NotesConflictError('Note changed. Read the note and reconcile before appending.');
      }
      const { content, revision, ...metadata } = note;
      if (params.text.length === 0) return { ...metadata, revision };
      return this.save(
        filePath,
        { ...metadata, updated: new Date().toISOString() },
        content + params.text,
      );
    });
  }

  async addTags(title: string, tags: string[]): Promise<NoteMetadata> {
    return this.update(title, (note) => {
      note.tags = normalizeTags([...note.tags, ...tags]);
    });
  }

  async removeTags(title: string, tags: string[]): Promise<NoteMetadata> {
    const removing = normalizeTags(tags);
    return this.update(title, (note) => {
      note.tags = note.tags.filter((tag) => !removing.includes(tag));
    });
  }

  async delete(title: string): Promise<void> {
    const { filePath } = this.paths.resolvePath(title);
    await withNoteLocks([filePath], () => unlink(filePath));
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
}
