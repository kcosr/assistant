const TTS_MARKDOWN_ARTIFACTS_RE = /[`*_~]/g;
const TTS_URL_PROTOCOL_RE = /\bhttps?:\/\//gi;

// Remove basic markdown formatting markers that read poorly in TTS.
export function sanitizeTtsText(input: string): string {
  return input.replace(TTS_URL_PROTOCOL_RE, '').replace(TTS_MARKDOWN_ARTIFACTS_RE, '');
}
