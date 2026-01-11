import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type DiffReviewTarget = 'working' | 'staged';
export type DiffReviewStatus = 'open' | 'resolved';

export type DiffReviewComment = {
  id: string;
  repoRoot: string;
  branch: string;
  path: string;
  target: DiffReviewTarget;
  hunkHash: string;
  header?: string;
  body: string;
  status: DiffReviewStatus;
  createdAt: string;
  updatedAt: string;
};

type ReviewStoreFile = {
  version: 1;
  comments: DiffReviewComment[];
};

const STORE_VERSION = 1;

function normalizeTarget(raw: unknown): DiffReviewTarget {
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === 'staged') {
      return 'staged';
    }
  }
  return 'working';
}

function normalizeStatus(raw: unknown): DiffReviewStatus {
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === 'resolved') {
      return 'resolved';
    }
  }
  return 'open';
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function normalizeComment(raw: unknown): DiffReviewComment | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;

  const idRaw = record['id'];
  const repoRootRaw = record['repoRoot'];
  const branchRaw = record['branch'];
  const pathRaw = record['path'];
  const hunkHashRaw = record['hunkHash'];
  const bodyRaw = record['body'];

  const id = typeof idRaw === 'string' ? idRaw.trim() : '';
  const repoRoot = typeof repoRootRaw === 'string' ? repoRootRaw.trim() : '';
  const branch = typeof branchRaw === 'string' ? branchRaw.trim() : '';
  const filePath = typeof pathRaw === 'string' ? pathRaw.trim() : '';
  const hunkHash = typeof hunkHashRaw === 'string' ? hunkHashRaw.trim() : '';
  const body = typeof bodyRaw === 'string' ? bodyRaw : '';
  if (!id || !repoRoot || !branch || !filePath || !hunkHash || !body.trim()) {
    return null;
  }

  const headerRaw = record['header'];
  const header =
    typeof headerRaw === 'string' && headerRaw.trim().length > 0 ? headerRaw.trim() : undefined;
  const createdAtRaw = record['createdAt'];
  const createdAt =
    typeof createdAtRaw === 'string' && createdAtRaw.trim().length > 0
      ? createdAtRaw.trim()
      : new Date().toISOString();
  const updatedAtRaw = record['updatedAt'];
  const updatedAt =
    typeof updatedAtRaw === 'string' && updatedAtRaw.trim().length > 0
      ? updatedAtRaw.trim()
      : createdAt;

  return {
    id: id,
    repoRoot: repoRoot,
    branch: branch,
    path: toPosixPath(filePath),
    target: normalizeTarget(record['target']),
    hunkHash: hunkHash,
    ...(header ? { header: header } : {}),
    body: body,
    status: normalizeStatus(record['status']),
    createdAt: createdAt,
    updatedAt: updatedAt,
  };
}

export class DiffReviewStore {
  private readonly filePath: string;
  private initialised = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async listComments(filter: {
    repoRoot: string;
    branch?: string;
    path?: string;
    target?: DiffReviewTarget;
  }): Promise<DiffReviewComment[]> {
    const comments = await this.readComments();
    const filtered = comments.filter((comment) => {
      if (comment.repoRoot !== filter.repoRoot) {
        return false;
      }
      if (filter.branch && comment.branch !== filter.branch) {
        return false;
      }
      if (filter.path && comment.path !== filter.path) {
        return false;
      }
      if (filter.target && comment.target !== filter.target) {
        return false;
      }
      return true;
    });

    filtered.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return filtered;
  }

  async createComment(input: {
    repoRoot: string;
    branch: string;
    path: string;
    target: DiffReviewTarget;
    hunkHash: string;
    header?: string;
    body: string;
  }): Promise<DiffReviewComment> {
    const comments = await this.readComments();
    const now = new Date().toISOString();
    const comment: DiffReviewComment = {
      id: randomUUID(),
      repoRoot: input.repoRoot,
      branch: input.branch,
      path: toPosixPath(input.path),
      target: input.target,
      hunkHash: input.hunkHash,
      ...(input.header ? { header: input.header } : {}),
      body: input.body,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };

    comments.push(comment);
    await this.writeComments(comments);
    return comment;
  }

  async updateComment(
    id: string,
    repoRoot: string,
    branch: string,
    patch: { body?: string; status?: DiffReviewStatus },
  ): Promise<DiffReviewComment | null> {
    const comments = await this.readComments();
    const index = comments.findIndex(
      (comment) => comment.id === id && comment.repoRoot === repoRoot && comment.branch === branch,
    );
    if (index < 0) {
      return null;
    }
    const current = comments[index];
    if (!current) {
      return null;
    }

    const updated: DiffReviewComment = {
      ...current,
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      updatedAt: new Date().toISOString(),
    };
    comments[index] = updated;
    await this.writeComments(comments);
    return updated;
  }

  async deleteComment(id: string, repoRoot: string, branch: string): Promise<boolean> {
    const comments = await this.readComments();
    const next = comments.filter(
      (comment) => comment.id !== id || comment.repoRoot !== repoRoot || comment.branch !== branch,
    );
    if (next.length === comments.length) {
      return false;
    }
    await this.writeComments(next);
    return true;
  }

  private async ensureFileDirectory(): Promise<void> {
    if (this.initialised) {
      return;
    }
    this.initialised = true;
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // Best-effort only; failures will surface on write.
    }
  }

  private async readComments(): Promise<DiffReviewComment[]> {
    let content: string;
    try {
      content = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      const anyErr = err as NodeJS.ErrnoException;
      if (anyErr && anyErr.code === 'ENOENT') {
        return [];
      }
      console.error('[diff] Failed to read diff review comments', err);
      return [];
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content) as unknown;
    } catch (err) {
      console.error('[diff] Failed to parse diff review comments', err);
      return [];
    }

    if (!raw || typeof raw !== 'object') {
      return [];
    }
    const record = raw as Record<string, unknown>;
    if (record['version'] !== STORE_VERSION || !Array.isArray(record['comments'])) {
      return [];
    }

    const comments = record['comments']
      .map(normalizeComment)
      .filter((entry): entry is DiffReviewComment => !!entry);
    return comments;
  }

  private async writeComments(comments: DiffReviewComment[]): Promise<void> {
    const payload: ReviewStoreFile = {
      version: STORE_VERSION,
      comments,
    };
    try {
      await this.ensureFileDirectory();
      const json = JSON.stringify(payload, null, 2);
      await fs.writeFile(this.filePath, `${json}\n`, 'utf8');
    } catch (err) {
      console.error('[diff] Failed to write diff review comments', err);
      throw err;
    }
  }
}
