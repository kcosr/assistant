export interface SessionCoreAttributes {
  workingDir?: string;
  activeBranch?: string;
  lastActiveAt?: string;
  autoTitle?: string;
}

export interface SessionAgentAttributes {
  skills?: string[];
}

export interface SessionConfig {
  model?: string;
  thinking?: string;
  workingDir?: string;
  skills?: string[];
  sessionTitle?: string;
}

export interface SessionAttributes {
  core?: SessionCoreAttributes;
  agent?: SessionAgentAttributes;
  [key: string]: unknown;
}

export type SessionAttributesPatch = Record<string, unknown>;

export interface SessionContext {
  sessionId: string;
  attributes: SessionAttributes;
}
