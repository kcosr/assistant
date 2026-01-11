import path from 'node:path';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class NotePathResolver {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  slugify(title: string): string {
    const normalized = title.normalize('NFKD').toLowerCase();
    const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    this.validateSlug(slug);
    return slug;
  }

  titleFromSlug(slug: string): string {
    return slug
      .split('-')
      .filter((part) => part.length > 0)
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join(' ');
  }

  validateSlug(slug: string): void {
    if (!slug) {
      throw new Error('Invalid slug: must not be empty');
    }

    if (/^[a-zA-Z]:[\\/]/.test(slug)) {
      throw new Error('Path traversal detected');
    }

    if (path.isAbsolute(slug)) {
      throw new Error('Path traversal detected');
    }

    if (slug.includes('..')) {
      throw new Error('Path traversal detected');
    }

    if (slug.includes('/') || slug.includes('\\')) {
      throw new Error('Invalid slug: must not contain path separators');
    }

    if (!SLUG_PATTERN.test(slug)) {
      throw new Error(
        'Invalid slug: must be lowercase alphanumeric with optional hyphens between segments',
      );
    }
  }

  resolvePath(title: string): { slug: string; filePath: string } {
    const slug = this.slugify(title);
    const resolvedBase = path.resolve(this.baseDir);
    const resolved = path.resolve(resolvedBase, `${slug}.md`);
    const expectedPrefix = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;

    if (!resolved.startsWith(expectedPrefix)) {
      throw new Error('Path traversal detected');
    }

    return { slug, filePath: resolved };
  }
}
