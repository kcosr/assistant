export interface NoteMetadata {
  title: string;
  tags: string[];
  created: string; // ISO 8601
  updated: string; // ISO 8601
}

export interface Note extends NoteMetadata {
  content: string;
}

export interface NoteSearchResult {
  title: string;
  tags: string[];
  snippet: string; // Content snippet with match
}
