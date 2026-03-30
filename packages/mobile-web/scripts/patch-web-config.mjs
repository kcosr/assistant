#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const INLINE_API_HOST_MARKER = 'data-assistant-api-host-inline';

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

function upsertInlineApiHostScript(contents, hostValue) {
  const scriptTag = `<script ${INLINE_API_HOST_MARKER}>window.ASSISTANT_API_HOST = ${JSON.stringify(hostValue)};</script>`;
  const existingRe = new RegExp(
    `<script\\s+${INLINE_API_HOST_MARKER}[^>]*>.*?<\\/script>`,
    's',
  );
  if (existingRe.test(contents)) {
    return contents.replace(existingRe, scriptTag);
  }
  const configScript = '<script src="config.js"></script>';
  if (contents.includes(configScript)) {
    return contents.replace(configScript, `${configScript}\n    ${scriptTag}`);
  }
  const clientScript = '<script type="module" src="client.js"></script>';
  if (contents.includes(clientScript)) {
    return contents.replace(clientScript, `    ${scriptTag}\n    ${clientScript}`);
  }
  return contents.replace('</head>', `    ${scriptTag}\n  </head>`);
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
    defaultApiHost = 'https://assistant',
    insecure,
    wsPort,
    preserveExistingHost = true,
  } = {},
) {
  let updated = contents;
  const normalizedHost = typeof apiHost === 'string' ? apiHost.trim() : '';
  const hasActiveHost = /^\s*window\.ASSISTANT_API_HOST\s*=/m.test(updated);
  const hasLegacyDefaultHost =
    !normalizedHost &&
    defaultApiHost !== 'assistant' &&
    /^\s*window\.ASSISTANT_API_HOST\s*=\s*["']assistant["'];?$/m.test(updated);
  const shouldWriteHost =
    !!normalizedHost || !hasActiveHost || !preserveExistingHost || hasLegacyDefaultHost;
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

export function applyHtmlOverrides(
  contents,
  {
    apiHost,
    defaultApiHost = 'https://assistant',
  } = {},
) {
  const normalizedHost = typeof apiHost === 'string' ? apiHost.trim() : '';
  const hostValue = normalizedHost || defaultApiHost;
  if (!hostValue) {
    return { contents, changed: false };
  }
  const updated = upsertInlineApiHostScript(contents, hostValue);
  return { contents: updated, changed: updated !== contents };
}

function loadFlavorDefaultApiHost(mobileDir) {
  const capConfigPath = path.resolve(mobileDir, 'capacitor.config.json');
  const flavorsPath = path.resolve(mobileDir, 'flavors.json');
  try {
    const capConfig = JSON.parse(fs.readFileSync(capConfigPath, 'utf8'));
    const flavors = JSON.parse(fs.readFileSync(flavorsPath, 'utf8'));
    const appId = typeof capConfig?.appId === 'string' ? capConfig.appId.trim() : '';
    if (!appId || !flavors || typeof flavors !== 'object') {
      return 'https://assistant';
    }
    for (const flavor of Object.values(flavors)) {
      const record = flavor && typeof flavor === 'object' ? flavor : null;
      const flavorAppId = typeof record?.appId === 'string' ? record.appId.trim() : '';
      const apiHost = typeof record?.apiHost === 'string' ? record.apiHost.trim() : '';
      if (flavorAppId === appId && apiHost) {
        return apiHost;
      }
    }
  } catch {
    // Fall back to the default host when flavor metadata is unavailable.
  }
  return 'https://assistant';
}

function run() {
  const scriptPath = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(scriptPath);
  const mobileDir = path.resolve(scriptDir, '..');
  const defaultApiHost = loadFlavorDefaultApiHost(mobileDir);
  const targets = [
    {
      platform: 'android',
      configPath: path.resolve(
        mobileDir,
        'android',
        'app',
        'src',
        'main',
        'assets',
        'public',
        'config.js',
      ),
      htmlPath: path.resolve(
        mobileDir,
        'android',
        'app',
        'src',
        'main',
        'assets',
        'public',
        'index.html',
      ),
    },
    {
      platform: 'ios',
      configPath: path.resolve(mobileDir, 'ios', 'App', 'App', 'public', 'config.js'),
      htmlPath: path.resolve(mobileDir, 'ios', 'App', 'App', 'public', 'index.html'),
    },
  ];

  const apiHost = process.env.ASSISTANT_API_HOST ?? '';
  const insecure = parseEnvBoolean(process.env.ASSISTANT_INSECURE);
  const wsPort = parseEnvNumber(process.env.ASSISTANT_WS_PORT);

  let patchedAny = false;
  let foundAny = false;

  for (const target of targets) {
    if (!fs.existsSync(target.configPath)) {
      continue;
    }
    foundAny = true;
    let contents;
    try {
      contents = fs.readFileSync(target.configPath, 'utf8');
    } catch (err) {
      console.error(`[patch-web-config] Failed to read ${target.platform} config.js:`, err);
      process.exit(1);
    }

    const result = applyConfigOverrides(contents, {
      apiHost,
      insecure,
      wsPort,
      defaultApiHost,
      preserveExistingHost: true,
    });

    if (result.changed) {
      fs.writeFileSync(target.configPath, result.contents, 'utf8');
      const relativePath = path.relative(process.cwd(), target.configPath);
      const hostLabel = apiHost.trim() ? apiHost.trim() : defaultApiHost;
      console.log(
        `[patch-web-config] Updated ${relativePath} (ASSISTANT_API_HOST=${hostLabel})`,
      );
      patchedAny = true;
    } else {
      console.log(`[patch-web-config] No config updates needed (${target.platform}).`);
    }

    if (!target.htmlPath || !fs.existsSync(target.htmlPath)) {
      continue;
    }

    const htmlContents = fs.readFileSync(target.htmlPath, 'utf8');
    const htmlResult = applyHtmlOverrides(htmlContents, {
      apiHost,
      defaultApiHost,
    });
    if (!htmlResult.changed) {
      continue;
    }
    fs.writeFileSync(target.htmlPath, htmlResult.contents, 'utf8');
    const relativeHtmlPath = path.relative(process.cwd(), target.htmlPath);
    console.log(
      `[patch-web-config] Updated ${relativeHtmlPath} (inline ASSISTANT_API_HOST=${apiHost.trim() || defaultApiHost})`,
    );
  }

  if (!foundAny) {
    console.log(
      '[patch-web-config] No generated config.js found. Run android:add or ios:add first.',
    );
    return;
  }

  if (!patchedAny) {
    return;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
