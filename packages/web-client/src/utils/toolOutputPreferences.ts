/**
 * Manages tool output preferences for the chat panel.
 * Persists to the server preferences store.
 */

import { apiFetch } from './api';

const SHOW_PREF_KEY = 'showToolOutput';
const EXPAND_PREF_KEY = 'expandToolOutput';

interface PreferencesResponse {
  [SHOW_PREF_KEY]?: boolean;
  [EXPAND_PREF_KEY]?: boolean;
}

export class ToolOutputPreferencesClient {
  private showToolOutput = true;
  private expandToolOutput = false;

  async load(): Promise<void> {
    try {
      const response = await apiFetch('/preferences');
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as PreferencesResponse;
      if (typeof data[SHOW_PREF_KEY] === 'boolean') {
        this.showToolOutput = data[SHOW_PREF_KEY];
      }
      if (typeof data[EXPAND_PREF_KEY] === 'boolean') {
        this.expandToolOutput = data[EXPAND_PREF_KEY];
      }
    } catch {
      // Ignore network errors when loading preferences.
    }
  }

  getShowToolOutput(): boolean {
    return this.showToolOutput;
  }

  async setShowToolOutput(value: boolean): Promise<void> {
    this.showToolOutput = value;
    try {
      await apiFetch('/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [SHOW_PREF_KEY]: value }),
      });
    } catch {
      // Ignore network errors while updating preferences; local state remains.
    }
  }

  async toggleShowToolOutput(): Promise<boolean> {
    const newValue = !this.showToolOutput;
    await this.setShowToolOutput(newValue);
    return newValue;
  }

  getExpandToolOutput(): boolean {
    return this.expandToolOutput;
  }

  async setExpandToolOutput(value: boolean): Promise<void> {
    this.expandToolOutput = value;
    try {
      await apiFetch('/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [EXPAND_PREF_KEY]: value }),
      });
    } catch {
      // Ignore network errors while updating preferences; local state remains.
    }
  }

  async toggleExpandToolOutput(): Promise<boolean> {
    const newValue = !this.expandToolOutput;
    await this.setExpandToolOutput(newValue);
    return newValue;
  }
}
