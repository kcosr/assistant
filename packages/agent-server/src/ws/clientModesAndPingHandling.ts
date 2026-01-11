import type {
  ClientControlMessage,
  ClientPingMessage,
  ClientSetModesMessage,
  InputMode,
  OutputMode,
  ServerMessage,
  ServerModesUpdatedMessage,
} from '@assistant/shared';

export interface SessionModesState {
  inputMode: InputMode;
  outputMode: OutputMode;
}

export function applyClientSetModes(
  current: SessionModesState,
  message: ClientSetModesMessage,
): { next: SessionModesState; modesUpdated?: ServerModesUpdatedMessage } {
  let updated = false;
  let inputMode = current.inputMode;
  let outputMode = current.outputMode;

  if (message.inputMode && message.inputMode !== inputMode) {
    inputMode = message.inputMode;
    updated = true;
  }

  if (message.outputMode && message.outputMode !== outputMode) {
    outputMode = message.outputMode;
    updated = true;
  }

  if (!updated) {
    return { next: current };
  }

  return {
    next: { inputMode, outputMode },
    modesUpdated: {
      type: 'modes_updated',
      inputMode,
      outputMode,
    },
  };
}

export function buildPongMessage(message: ClientPingMessage, timestampMs: number): ServerMessage {
  return {
    type: 'pong',
    nonce: message.nonce,
    timestampMs,
  };
}

export function isOutputCancelControl(message: ClientControlMessage): boolean {
  return message.target === 'output' && message.action === 'cancel';
}
