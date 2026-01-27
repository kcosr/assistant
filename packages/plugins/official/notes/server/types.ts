export interface NoteMetadata {
  title: string;
  tags: string[];
  favorite?: boolean;
  created: string; // ISO 8601
  updated: string; // ISO 8601
  description?: string;
}

export interface Note extends NoteMetadata {
  content: string;
}

export interface NoteSearchResult {
  title: string;
  tags: string[];
  snippet: string; // Content snippet with match
  description?: string;
}
