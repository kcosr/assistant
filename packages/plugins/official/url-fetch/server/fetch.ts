import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export interface FetchResult {
  url: string;
  mode: 'extracted' | 'raw' | 'metadata';
  title?: string;
  content?: string;
  description?: string;
  byline?: string;
  siteName?: string;
}

const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; URLFetchBot/1.0)';

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Fetch timed out after 30 seconds: ${url}`);
    }
    throw err;
  }

  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

function extractMetadata(document: Document): {
  title?: string;
  description?: string;
  siteName?: string;
} {
  try {
    const titleTag = document.querySelector('title');
    const titleFromTag = titleTag?.textContent?.trim() || undefined;

    const ogTitleMeta = document.querySelector<HTMLMetaElement>(
      'meta[property="og:title"], meta[name="og:title"]',
    );
    const ogTitle = ogTitleMeta?.content?.trim() || undefined;

    const descriptionMeta = document.querySelector<HTMLMetaElement>(
      'meta[property="og:description"], meta[name="og:description"], meta[name="description"]',
    );
    const description = descriptionMeta?.content?.trim() || undefined;

    const siteNameMeta = document.querySelector<HTMLMetaElement>(
      'meta[property="og:site_name"], meta[name="og:site_name"]',
    );
    const siteName = siteNameMeta?.content?.trim() || undefined;

    const title = ogTitle || titleFromTag;

    return {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(siteName ? { siteName } : {}),
    };
  } catch {
    // Fail gracefully for metadata mode – return empty metadata on any parsing error.
    return {};
  }
}

export async function fetchUrl(
  url: string,
  mode: 'extracted' | 'raw' | 'metadata',
): Promise<FetchResult> {
  const html = await fetchHtml(url);

  if (mode === 'raw') {
    return {
      url,
      mode: 'raw',
      content: html,
    };
  }

  const dom = new JSDOM(html, { url });
  const document = dom.window.document;

  if (mode === 'metadata') {
    const metadata = extractMetadata(document);
    return {
      url,
      mode: 'metadata',
      ...metadata,
    };
  }

  const reader = new Readability(document);
  const article = reader.parse();

  if (!article) {
    throw new Error('Failed to extract readable content from the page');
  }

  const contentDom = new JSDOM(article.content);
  const textContent = contentDom.window.document.body.textContent || '';

  const cleanedContent = textContent
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  const result: FetchResult = {
    url,
    mode: 'extracted',
    title: article.title,
    content: cleanedContent,
  };

  if (article.byline) {
    result.byline = article.byline;
  }
  if (article.siteName) {
    result.siteName = article.siteName;
  }

  return result;
}
