/**
 * Audio input mode for voice sessions.
 *
 * - `server_vad`: Server-side voice activity detection automatically
 *   detects speech boundaries and triggers responses.
 * - `manual`: Client controls when speech input starts and stops
 *   (push-to-talk style).
 */
export type AudioInputMode = 'server_vad' | 'manual';
