import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getOAuthApiKey, type OAuthCredentials } from '@mariozechner/pi-ai';

type StoredOAuthCredential = { type: 'oauth' } & OAuthCredentials & Record<string, unknown>;
type StoredApiKeyCredential = { type: 'api_key'; key: string };
type StoredCredential = StoredOAuthCredential | StoredApiKeyCredential;

type AuthFileData = Record<string, StoredCredential>;

function expandHomeDir(input: string): string {
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function getPiAgentDir(): string {
  // Matches pi-mono coding agent convention.
  // See: pi-mono/packages/coding-agent/src/config.ts (ENV_AGENT_DIR = PI_CODING_AGENT_DIR)
  const envDir = process.env['PI_CODING_AGENT_DIR'];
  if (envDir) {
    return expandHomeDir(envDir);
  }
  return path.join(os.homedir(), '.pi', 'agent');
}

async function readAuthFile(authPath: string): Promise<AuthFileData | null> {
  let raw: string;
  try {
    raw = await fs.readFile(authPath, 'utf8');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return null;
    }
    throw err;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as AuthFileData;
  } catch {
    return null;
  }
}

async function writeAuthFile(authPath: string, data: AuthFileData): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(authPath, json, 'utf8');
  // Keep consistent with pi-mono defaults.
  await fs.chmod(authPath, 0o600);
}

function findProviderKey(data: AuthFileData, providerId: string): string | null {
  if (providerId in data) {
    return providerId;
  }
  const lower = providerId.toLowerCase();
  const match = Object.keys(data).find((key) => key.toLowerCase() === lower);
  return match ?? null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Resolve an API key/token for the given Pi provider id by reading ~/.pi/agent/auth.json.
 *
 * Intended specifically for OAuth-backed providers such as:
 * - anthropic (Claude Pro/Max OAuth)
 * - openai-codex (ChatGPT Plus/Pro OAuth)
 *
 * If the stored OAuth token is expired, this will refresh and persist the new token.
 */
export async function resolvePiAgentAuthApiKey(options: {
  providerId: string;
  log?: (...args: unknown[]) => void;
}): Promise<string | undefined> {
  const { providerId, log } = options;

  // Only attempt to load auth.json for the providers we explicitly support.
  // (Avoid surprising behavior for other providers.)
  const providerLower = providerId.toLowerCase();
  if (providerLower !== 'anthropic' && providerLower !== 'openai-codex') {
    return undefined;
  }

  const agentDir = getPiAgentDir();
  const authPath = path.join(agentDir, 'auth.json');

  const data = await readAuthFile(authPath);
  if (!data) {
    return undefined;
  }

  const providerKey = findProviderKey(data, providerId);
  if (!providerKey) {
    return undefined;
  }

  const credential = data[providerKey];
  if (!credential || typeof credential !== 'object') {
    return undefined;
  }

  if (credential.type === 'api_key') {
    return isNonEmptyString(credential.key) ? credential.key : undefined;
  }

  if (credential.type !== 'oauth') {
    return undefined;
  }

  const { type: _type, ...oauthCred } = credential;
  const credsByProvider: Record<string, OAuthCredentials> = {
    [providerKey]: oauthCred as OAuthCredentials,
  };

  try {
    const resolved = await getOAuthApiKey(providerKey as any, credsByProvider as any);
    if (!resolved) {
      return undefined;
    }

    const { apiKey, newCredentials } = resolved;

    // If credentials changed (e.g., refresh), persist back to auth.json.
    // Preserve extra metadata keys (e.g., openai-codex accountId) if present.
    const merged: Record<string, unknown> = { ...credential, ...newCredentials, type: 'oauth' };
    data[providerKey] = merged as StoredOAuthCredential;
    await writeAuthFile(authPath, data);

    return apiKey;
  } catch (err) {
    log?.('[pi-auth] Failed to resolve OAuth api key', {
      providerId: providerKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
