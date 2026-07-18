export type VoiceConversationId = string;
export type VoiceSessionId = string;

export type VoiceSessionState =
  | 'created'
  | 'connecting'
  | 'connected'
  | 'closing'
  | 'closed'
  | 'failed';

export interface VoiceJournalEntry {
  id: string;
  atMs: number;
  kind: 'user_transcript' | 'assistant_transcript' | 'tool_request' | 'tool_result' | 'error' | 'system';
  text?: string;
  toolName?: string;
  toolCallId?: string;
  payload?: unknown;
}

export interface VoiceConversationRecord {
  id: VoiceConversationId;
  createdAtMs: number;
  updatedAtMs: number;
  title: string;
  listsInstanceId: string;
  journal: VoiceJournalEntry[];
  activeSessionId: VoiceSessionId | null;
}

export interface VoiceSessionRecord {
  id: VoiceSessionId;
  conversationId: VoiceConversationId;
  createdAtMs: number;
  updatedAtMs: number;
  state: VoiceSessionState;
  muted: boolean;
  listsInstanceId: string;
  providerCallId: string | null;
  lastError: string | null;
  sequence: number;
  events: VoiceClientEvent[];
}

export type VoiceClientEvent =
  | { sequence: number; type: 'session_state'; state: VoiceSessionState; message?: string }
  | { sequence: number; type: 'transcript'; role: 'user' | 'assistant'; text: string; final: boolean }
  | { sequence: number; type: 'tool'; name: string; status: 'started' | 'completed' | 'failed'; detail?: string }
  | { sequence: number; type: 'error'; code: string; message: string }
  | { sequence: number; type: 'closed'; reason: string };

export interface VoiceCapabilities {
  agentRealtime: {
    status: 'ready' | 'not-configured' | 'disabled';
    model: string;
    voice: string;
  };
}

export interface RealtimeSessionConfig {
  model: string;
  voice: string;
  instructions: string;
  tools: RealtimeFunctionTool[];
}

export interface RealtimeFunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
