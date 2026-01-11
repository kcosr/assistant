/**
 * Manages thinking visibility preferences for the chat panel.
 * Persists to the server preferences store.
 */

import { apiFetch } from './api';

const SHOW_THINKING_PREF_KEY = 'showThinking';

interface PreferencesResponse {
  [SHOW_THINKING_PREF_KEY]?: boolean;
}

export class ThinkingPreferencesClient {
  private showThinking = true;

  async load(): Promise<void> {
    try {
      const response = await apiFetch('/preferences');
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as PreferencesResponse;
      if (typeof data[SHOW_THINKING_PREF_KEY] === 'boolean') {
        this.showThinking = data[SHOW_THINKING_PREF_KEY];
      }
    } catch {
      // Ignore network errors when loading preferences.
    }
  }

  getShowThinking(): boolean {
    return this.showThinking;
  }

  async setShowThinking(value: boolean): Promise<void> {
    this.showThinking = value;
    try {
      await apiFetch('/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [SHOW_THINKING_PREF_KEY]: value }),
      });
    } catch {
      // Ignore network errors while updating preferences; local state remains.
    }
  }

  async toggleShowThinking(): Promise<boolean> {
    const newValue = !this.showThinking;
    await this.setShowThinking(newValue);
    return newValue;
  }
}
