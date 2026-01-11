export interface TtsStreamingSession {
  appendText(chunk: string): Promise<void>;
  finish(): Promise<void>;
  hasOutput(): boolean;
  cancel(): Promise<void>;
}

export interface TtsBackendFactory {
  isEnabled(): boolean;
  createSession(options: {
    sessionId: string;
    responseId: string;
    abortSignal: AbortSignal;
  }): TtsStreamingSession | null;
}
