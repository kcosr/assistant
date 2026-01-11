export interface SessionCoreAttributes {
  workingDir?: string;
  activeBranch?: string;
  lastActiveAt?: string;
}

export interface SessionAttributes {
  core?: SessionCoreAttributes;
  [key: string]: unknown;
}

export type SessionAttributesPatch = Record<string, unknown>;

export interface SessionContext {
  sessionId: string;
  attributes: SessionAttributes;
}
