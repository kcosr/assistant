import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ArtifactMetadata {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

interface MetadataIndex {
  artifacts: ArtifactMetadata[];
}

const DEFAULT_MAX_FILE_SIZE_MB = 64;

export class ArtifactsStore {
  private metadataPath: string;
  private filesDir: string;
  private maxFileSizeBytes: number;
  private metadata: MetadataIndex = { artifacts: [] };
  private loaded = false;

  constructor(
    private readonly dataDir: string,
    maxFileSizeMb: number = DEFAULT_MAX_FILE_SIZE_MB,
  ) {
    this.metadataPath = path.join(dataDir, 'metadata.json');
    this.filesDir = path.join(dataDir, 'files');
    this.maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await mkdir(this.filesDir, { recursive: true });
    try {
      const content = await readFile(this.metadataPath, 'utf-8');
      const parsed = JSON.parse(content) as MetadataIndex;
      if (Array.isArray(parsed.artifacts)) {
        this.metadata = parsed;
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        throw err;
      }
      // File doesn't exist, use empty metadata
    }
    this.loaded = true;
  }

  private async saveMetadata(): Promise<void> {
    await writeFile(this.metadataPath, JSON.stringify(this.metadata, null, 2), 'utf-8');
  }

  private getFilePath(id: string, filename: string): string {
    const ext = path.extname(filename);
    return path.join(this.filesDir, `${id}${ext}`);
  }

  private generateId(): string {
    return crypto.randomUUID();
  }

  async list(): Promise<ArtifactMetadata[]> {
    await this.ensureLoaded();
    // Return sorted by date (newest first)
    return [...this.metadata.artifacts].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async get(id: string): Promise<ArtifactMetadata | null> {
    await this.ensureLoaded();
    return this.metadata.artifacts.find((a) => a.id === id) ?? null;
  }

  async upload(options: {
    title: string;
    filename: string;
    content: Buffer;
    mimeType?: string;
  }): Promise<ArtifactMetadata> {
    await this.ensureLoaded();

    const { title, filename, content, mimeType } = options;

    if (content.length > this.maxFileSizeBytes) {
      const maxMb = this.maxFileSizeBytes / (1024 * 1024);
      throw new Error(`File size exceeds maximum allowed size of ${maxMb}MB`);
    }

    const id = this.generateId();
    const now = new Date().toISOString();
    const resolvedMimeType = mimeType || this.guessMimeType(filename);

    const filePath = this.getFilePath(id, filename);
    await writeFile(filePath, content);

    const artifact: ArtifactMetadata = {
      id,
      title,
      filename,
      mimeType: resolvedMimeType,
      size: content.length,
      createdAt: now,
      updatedAt: now,
    };

    this.metadata.artifacts.push(artifact);
    await this.saveMetadata();

    return artifact;
  }

  async update(
    id: string,
    options: {
      filename: string;
      content: Buffer;
      mimeType?: string;
    },
  ): Promise<ArtifactMetadata> {
    await this.ensureLoaded();

    const { filename, content, mimeType } = options;

    if (content.length > this.maxFileSizeBytes) {
      const maxMb = this.maxFileSizeBytes / (1024 * 1024);
      throw new Error(`File size exceeds maximum allowed size of ${maxMb}MB`);
    }

    const index = this.metadata.artifacts.findIndex((a) => a.id === id);
    if (index === -1) {
      throw new Error(`Artifact not found: ${id}`);
    }

    const existing = this.metadata.artifacts[index];

    // Remove old file
    const oldFilePath = this.getFilePath(id, existing.filename);
    try {
      await unlink(oldFilePath);
    } catch {
      // Ignore if file doesn't exist
    }

    // Write new file
    const newFilePath = this.getFilePath(id, filename);
    await writeFile(newFilePath, content);

    const resolvedMimeType = mimeType || this.guessMimeType(filename);
    const updated: ArtifactMetadata = {
      ...existing,
      filename,
      mimeType: resolvedMimeType,
      size: content.length,
      updatedAt: new Date().toISOString(),
    };

    this.metadata.artifacts[index] = updated;
    await this.saveMetadata();

    return updated;
  }

  async rename(id: string, title: string): Promise<ArtifactMetadata> {
    await this.ensureLoaded();

    const index = this.metadata.artifacts.findIndex((a) => a.id === id);
    if (index === -1) {
      throw new Error(`Artifact not found: ${id}`);
    }

    const updated: ArtifactMetadata = {
      ...this.metadata.artifacts[index],
      title,
      updatedAt: new Date().toISOString(),
    };

    this.metadata.artifacts[index] = updated;
    await this.saveMetadata();

    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.ensureLoaded();

    const index = this.metadata.artifacts.findIndex((a) => a.id === id);
    if (index === -1) {
      throw new Error(`Artifact not found: ${id}`);
    }

    const artifact = this.metadata.artifacts[index];
    const filePath = this.getFilePath(id, artifact.filename);

    try {
      await unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }

    this.metadata.artifacts.splice(index, 1);
    await this.saveMetadata();
  }

  async getFileContent(id: string): Promise<{ content: Buffer; artifact: ArtifactMetadata }> {
    await this.ensureLoaded();

    const artifact = this.metadata.artifacts.find((a) => a.id === id);
    if (!artifact) {
      throw new Error(`Artifact not found: ${id}`);
    }

    const filePath = this.getFilePath(id, artifact.filename);
    const content = await readFile(filePath);

    return { content, artifact };
  }

  getFilesDir(): string {
    return this.filesDir;
  }

  getFilePathForArtifact(artifact: ArtifactMetadata): string {
    return this.getFilePath(artifact.id, artifact.filename);
  }

  private guessMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.htm': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.pdf': 'application/pdf',
      '.zip': 'application/zip',
      '.gz': 'application/gzip',
      '.tar': 'application/x-tar',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.md': 'text/markdown',
      '.csv': 'text/csv',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}
