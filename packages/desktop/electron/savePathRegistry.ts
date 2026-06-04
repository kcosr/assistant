import path from 'node:path';

export class SavePathRegistry {
  private readonly approvedPaths = new Set<string>();

  approve(filePath: string): string {
    const normalizedPath = path.resolve(filePath);
    this.approvedPaths.add(normalizedPath);
    return normalizedPath;
  }

  consume(filePath: string): string {
    const normalizedPath = path.resolve(filePath);
    if (!this.approvedPaths.delete(normalizedPath)) {
      throw new Error('Save path was not approved by the native save dialog');
    }
    return normalizedPath;
  }
}
