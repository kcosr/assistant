import fs from 'node:fs/promises';
import path from 'node:path';

interface CodexSessionMapping {
  sessionId: string;
  codexSessionId: string;
  model?: string;
  workdir?: string;
  sandbox?: string;
}

interface CodexSessionMappingFileShape {
  [sessionId: string]: {
    codexSessionId?: unknown;
    model?: unknown;
    workdir?: unknown;
    sandbox?: unknown;
  };
}

class CodexSessionStore {
  private readonly filePath: string;
  private readonly mappings = new Map<string, CodexSessionMapping>();
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async get(sessionId: string): Promise<CodexSessionMapping | undefined> {
    await this.ensureLoaded();
    const mapping = this.mappings.get(sessionId);
    return mapping ? { ...mapping } : undefined;
  }

  async set(mapping: CodexSessionMapping): Promise<void> {
    await this.ensureLoaded();
    this.mappings.set(mapping.sessionId, { ...mapping });
    await this.persist();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    let content: string;
    try {
      content = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      const anyErr = err as NodeJS.ErrnoException;
      if (anyErr && anyErr.code === 'ENOENT') {
        return;
      }

      console.error('Failed to read Codex session mapping file', err);
      return;
    }

    let parsed: CodexSessionMappingFileShape;
    try {
      parsed = JSON.parse(content) as CodexSessionMappingFileShape;
    } catch (err) {
      console.error(
        'Failed to parse Codex session mapping file, starting with empty mappings',
        err,
      );
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      return;
    }

    for (const [sessionId, raw] of Object.entries(parsed)) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }

      const codexSessionIdValue = raw.codexSessionId;
      if (typeof codexSessionIdValue !== 'string' || !codexSessionIdValue.trim()) {
        continue;
      }

      const modelValue = raw.model;
      const workdirValue = raw.workdir;
      const sandboxValue = raw.sandbox;

      const mapping: CodexSessionMapping = {
        sessionId,
        codexSessionId: codexSessionIdValue,
      };

      if (typeof modelValue === 'string' && modelValue.trim()) {
        mapping.model = modelValue.trim();
      }
      if (typeof workdirValue === 'string' && workdirValue.trim()) {
        mapping.workdir = workdirValue.trim();
      }
      if (typeof sandboxValue === 'string' && sandboxValue.trim()) {
        mapping.sandbox = sandboxValue.trim();
      }

      this.mappings.set(sessionId, mapping);
    }
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // Best-effort only; failures will be surfaced on write.
    }

    const fileShape: CodexSessionMappingFileShape = {};
    for (const [sessionId, mapping] of this.mappings.entries()) {
      fileShape[sessionId] = {
        codexSessionId: mapping.codexSessionId,
        ...(mapping.model ? { model: mapping.model } : {}),
        ...(mapping.workdir ? { workdir: mapping.workdir } : {}),
        ...(mapping.sandbox ? { sandbox: mapping.sandbox } : {}),
      };
    }

    try {
      const json = JSON.stringify(fileShape, null, 2);
      await fs.writeFile(this.filePath, json, 'utf8');
    } catch (err) {
      console.error('Failed to write Codex session mapping file', err);
    }
  }
}

const storesByDataDir = new Map<string, CodexSessionStore>();

export function getCodexSessionStore(dataDir: string): CodexSessionStore {
  const key = path.resolve(dataDir);
  const existing = storesByDataDir.get(key);
  if (existing) {
    return existing;
  }

  const store = new CodexSessionStore(path.join(key, 'codex-sessions.json'));
  storesByDataDir.set(key, store);
  return store;
}
