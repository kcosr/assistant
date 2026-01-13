#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function insertAfterHeader(contents, line) {
  const headerEnd = contents.indexOf('*/');
  if (headerEnd === -1) {
    return `${line}\n${contents}`;
  }
  const insertAt = contents.indexOf('\n', headerEnd);
  if (insertAt === -1) {
    return `${contents}\n${line}\n`;
  }
  return `${contents.slice(0, insertAt + 1)}\n${line}\n${contents.slice(insertAt + 1)}`;
}

function upsertConfigLine(contents, key, valueLiteral) {
  const line = `window.${key} = ${valueLiteral};`;
  const assignmentRe = new RegExp(`^\\s*window\\.${key}\\s*=.*$`, 'm');
  if (assignmentRe.test(contents)) {
    return contents.replace(assignmentRe, line);
  }
  const commentedRe = new RegExp(`^\\s*//\\s*window\\.${key}\\s*=.*$`, 'm');
  if (commentedRe.test(contents)) {
    return contents.replace(commentedRe, line);
  }
  return insertAfterHeader(contents, line);
}

function parseEnvBoolean(value) {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseEnvNumber(value) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export function applyConfigOverrides(
  contents,
  {
    apiHost,
    defaultApiHost = 'assistant',
    insecure,
    wsPort,
    preserveExistingHost = true,
  } = {},
) {
  let updated = contents;
  const normalizedHost = typeof apiHost === 'string' ? apiHost.trim() : '';
  const hasActiveHost = /^\s*window\.ASSISTANT_API_HOST\s*=/m.test(updated);
  const shouldWriteHost = !!normalizedHost || !hasActiveHost || !preserveExistingHost;
  if (shouldWriteHost) {
    const hostValue = normalizedHost || defaultApiHost;
    if (hostValue) {
      updated = upsertConfigLine(updated, 'ASSISTANT_API_HOST', JSON.stringify(hostValue));
    }
  }

  if (typeof insecure === 'boolean') {
    updated = upsertConfigLine(updated, 'ASSISTANT_INSECURE', insecure ? 'true' : 'false');
  }

  if (typeof wsPort === 'number' && Number.isFinite(wsPort) && wsPort > 0) {
    updated = upsertConfigLine(
      updated,
      'ASSISTANT_WS_PORT',
      String(Math.round(wsPort)),
    );
  }

  return { contents: updated, changed: updated !== contents };
}

function run() {
  const scriptPath = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(scriptPath);
  const mobileDir = path.resolve(scriptDir, '..');
  const configPath = path.resolve(mobileDir, '..', 'web-client', 'public', 'config.js');

  let contents;
  try {
    contents = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    console.error('[patch-web-config] Failed to read config.js:', err);
    process.exit(1);
  }

  const apiHost = process.env.ASSISTANT_API_HOST ?? '';
  const insecure = parseEnvBoolean(process.env.ASSISTANT_INSECURE);
  const wsPort = parseEnvNumber(process.env.ASSISTANT_WS_PORT);

  const result = applyConfigOverrides(contents, {
    apiHost,
    insecure,
    wsPort,
    defaultApiHost: 'assistant',
    preserveExistingHost: true,
  });

  if (!result.changed) {
    console.log('[patch-web-config] No config updates needed.');
    return;
  }

  fs.writeFileSync(configPath, result.contents, 'utf8');
  const relativePath = path.relative(process.cwd(), configPath);
  const hostLabel = apiHost.trim() ? apiHost.trim() : 'assistant';
  console.log(`[patch-web-config] Updated ${relativePath} (ASSISTANT_API_HOST=${hostLabel})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
