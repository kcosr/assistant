import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface StoredAttachmentRecord {
  attachmentId: string;
  sessionId: string;
  turnId: string;
  toolCallId: string;
  fileName: string;
  title?: string;
  contentType: string;
  size: number;
  createdAt: string;
  storageFileName: string;
}

type SessionAttachmentIndex = {
  attachments: StoredAttachmentRecord[];
};

export class AttachmentStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async createAttachment(options: {
    sessionId: string;
    turnId: string;
    toolCallId: string;
    fileName: string;
    title?: string;
    contentType: string;
    bytes: Buffer;
    now?: Date;
  }): Promise<StoredAttachmentRecord> {
    const sessionId = normalizeRequired(options.sessionId, 'sessionId');
    const turnId = normalizeRequired(options.turnId, 'turnId');
    const toolCallId = normalizeRequired(options.toolCallId, 'toolCallId');
    const fileName = normalizeRequired(options.fileName, 'fileName');
    const contentType = normalizeRequired(options.contentType, 'contentType');
    const createdAt = (options.now ?? new Date()).toISOString();
    const attachmentId = randomUUID();
    const sessionDir = this.getSessionDir(sessionId);
    const filesDir = path.join(sessionDir, 'files');
    const storageFileName = attachmentId;
    const metadataPath = this.getMetadataPath(sessionId);

    await fs.mkdir(filesDir, { recursive: true });
    const index = await this.readIndex(sessionId);
    if (index.attachments.some((record) => record.toolCallId === toolCallId)) {
      throw new Error(`Attachment already exists for tool call: ${toolCallId}`);
    }

    const record: StoredAttachmentRecord = {
      attachmentId,
      sessionId,
      turnId,
      toolCallId,
      fileName,
      ...(options.title ? { title: options.title } : {}),
      contentType,
      size: options.bytes.byteLength,
      createdAt,
      storageFileName,
    };

    const filePath = path.join(filesDir, storageFileName);
    await fs.writeFile(filePath, options.bytes);
    index.attachments.push(record);
    await fs.writeFile(metadataPath, JSON.stringify(index, null, 2), 'utf8');
    return record;
  }

  async getAttachment(sessionId: string, attachmentId: string): Promise<StoredAttachmentRecord | null> {
    const index = await this.readIndex(sessionId);
    return (
      index.attachments.find((record) => record.attachmentId === normalizeRequired(attachmentId, 'attachmentId')) ??
      null
    );
  }

  async getAttachmentFile(sessionId: string, attachmentId: string): Promise<{
    attachment: StoredAttachmentRecord;
    content: Buffer;
  } | null> {
    const attachment = await this.getAttachment(sessionId, attachmentId);
    if (!attachment) {
      return null;
    }
    const filePath = path.join(this.getSessionDir(sessionId), 'files', attachment.storageFileName);
    try {
      const content = await fs.readFile(filePath);
      return { attachment, content };
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async deleteAttachment(sessionId: string, attachmentId: string): Promise<boolean> {
    const normalizedSessionId = normalizeRequired(sessionId, 'sessionId');
    const normalizedAttachmentId = normalizeRequired(attachmentId, 'attachmentId');
    const index = await this.readIndex(normalizedSessionId);
    const record = index.attachments.find((item) => item.attachmentId === normalizedAttachmentId);
    if (!record) {
      return false;
    }
    await this.deleteStoredFile(normalizedSessionId, record.storageFileName);
    index.attachments = index.attachments.filter((item) => item.attachmentId !== normalizedAttachmentId);
    await this.writeOrDeleteIndex(normalizedSessionId, index);
    return true;
  }

  async deleteByTurnIds(sessionId: string, turnIds: string[]): Promise<number> {
    const normalizedSessionId = normalizeRequired(sessionId, 'sessionId');
    const normalizedTurnIds = new Set(
      turnIds.map((turnId) => normalizeRequired(turnId, 'turnId')).filter((turnId) => turnId.length > 0),
    );
    if (normalizedTurnIds.size === 0) {
      return 0;
    }
    const index = await this.readIndex(normalizedSessionId);
    const toDelete = index.attachments.filter((record) => normalizedTurnIds.has(record.turnId));
    if (toDelete.length === 0) {
      return 0;
    }
    for (const record of toDelete) {
      await this.deleteStoredFile(normalizedSessionId, record.storageFileName);
    }
    index.attachments = index.attachments.filter((record) => !normalizedTurnIds.has(record.turnId));
    await this.writeOrDeleteIndex(normalizedSessionId, index);
    return toDelete.length;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const normalizedSessionId = normalizeRequired(sessionId, 'sessionId');
    try {
      await fs.rm(this.getSessionDir(normalizedSessionId), { recursive: true, force: true });
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  private getSessionDir(sessionId: string): string {
    return path.join(this.baseDir, sessionId);
  }

  private getMetadataPath(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), 'metadata.json');
  }

  private async readIndex(sessionId: string): Promise<SessionAttachmentIndex> {
    const metadataPath = this.getMetadataPath(normalizeRequired(sessionId, 'sessionId'));
    try {
      const raw = await fs.readFile(metadataPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SessionAttachmentIndex> | null;
      if (!parsed || !Array.isArray(parsed.attachments)) {
        return { attachments: [] };
      }
      return {
        attachments: parsed.attachments.filter(isStoredAttachmentRecord),
      };
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        return { attachments: [] };
      }
      throw err;
    }
  }

  private async writeOrDeleteIndex(sessionId: string, index: SessionAttachmentIndex): Promise<void> {
    const metadataPath = this.getMetadataPath(sessionId);
    if (index.attachments.length === 0) {
      try {
        await fs.unlink(metadataPath);
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code !== 'ENOENT') {
          throw err;
        }
      }
      return;
    }
    await fs.mkdir(this.getSessionDir(sessionId), { recursive: true });
    await fs.writeFile(metadataPath, JSON.stringify(index, null, 2), 'utf8');
  }

  private async deleteStoredFile(sessionId: string, storageFileName: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.getSessionDir(sessionId), 'files', storageFileName));
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        throw err;
      }
    }
  }
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} must not be empty`);
  }
  return trimmed;
}

function isStoredAttachmentRecord(value: unknown): value is StoredAttachmentRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['attachmentId'] === 'string' &&
    typeof record['sessionId'] === 'string' &&
    typeof record['turnId'] === 'string' &&
    typeof record['toolCallId'] === 'string' &&
    typeof record['fileName'] === 'string' &&
    typeof record['contentType'] === 'string' &&
    typeof record['size'] === 'number' &&
    Number.isFinite(record['size']) &&
    typeof record['createdAt'] === 'string' &&
    typeof record['storageFileName'] === 'string'
  );
}
