const fs = require('node:fs/promises');
const path = require('node:path');

const { build } = require('esbuild');

const repoRoot = path.resolve(__dirname, '..');
const pluginsRoot = path.join(repoRoot, 'packages', 'plugins');
const distRoot = path.join(repoRoot, 'dist', 'plugins');
const defaultSkillsRoot = path.join(repoRoot, 'dist', 'skills');

function parseSkillsDirs(argv) {
  const dirs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
    if (arg === '--skills-dir') {
      const value = argv[index + 1];
      if (value) {
        dirs.push(value);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--skills-dir=')) {
      const value = arg.slice('--skills-dir='.length);
      if (value) {
        dirs.push(value);
      }
    }
  }
  return dirs;
}

function parseSkillsFilter(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
    if (arg === '--skills') {
      const value = argv[index + 1];
      if (value) {
        return value.split(',').map((s) => s.trim()).filter(Boolean);
      }
      continue;
    }
    if (arg.startsWith('--skills=')) {
      const value = arg.slice('--skills='.length);
      if (value) {
        return value.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
  }
  return null;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(source, destination) {
  if (!(await pathExists(source))) {
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function copyDirIfExists(source, destination) {
  if (!(await pathExists(source))) {
    return;
  }
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true });
}

async function readManifest(manifestPath) {
  const raw = await fs.readFile(manifestPath, 'utf8');
  return JSON.parse(raw);
}

async function readOptionalFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function toTitleCase(value) {
  return value
    .split(/[-_\\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeToolSegment(value) {
  return value.replace(/-/g, '_');
}

function getSkillDirName(pluginId) {
  return pluginId;
}

function getSkillCliName(pluginId) {
  return `${pluginId}-cli`;
}

function normalizeSchemaType(value) {
  if (!value) {
    return null;
  }
  if (value === 'integer') {
    return 'number';
  }
  return value;
}

function schemaTypeLabel(schema, override) {
  if (override?.type) {
    if (override.type === 'json') {
      return 'json';
    }
    return override.type;
  }
  if (!schema || typeof schema !== 'object') {
    return null;
  }
  const rawType = schema.type;
  const types = Array.isArray(rawType) ? rawType : rawType ? [rawType] : [];
  if (types.includes('array')) {
    const items = schema.items;
    const itemType =
      items && typeof items === 'object'
        ? Array.isArray(items.type)
          ? items.type.map(normalizeSchemaType).filter(Boolean)
          : normalizeSchemaType(items.type)
        : null;
    const itemLabel = Array.isArray(itemType) ? itemType.join('|') : itemType || null;
    return itemLabel ? `${itemLabel}[]` : 'array';
  }
  const normalized = types.map(normalizeSchemaType).filter(Boolean);
  if (normalized.length > 0) {
    return normalized.join('|');
  }
  return null;
}

function isArraySchema(schema, override) {
  if (override?.array !== undefined) {
    return Boolean(override.array);
  }
  if (!schema || typeof schema !== 'object') {
    return false;
  }
  const rawType = schema.type;
  const types = Array.isArray(rawType) ? rawType : rawType ? [rawType] : [];
  return types.includes('array');
}

function formatOptionLine({ name, schema, override, required }) {
  const typeLabel = schemaTypeLabel(schema, override);
  const typeSuffix = typeLabel ? ` <${typeLabel}>` : '';
  const requiredSuffix = required ? ' (required)' : '';
  const arraySuffix = isArraySchema(schema, override) ? ' (repeatable)' : '';
  const description = (override?.description ?? schema?.description ?? '').trim();
  const descriptionSuffix = description ? `: ${description}` : '';
  return `- \`--${name}${typeSuffix}\`${requiredSuffix}${arraySuffix}${descriptionSuffix}`;
}

function formatSkillsDocument({ manifest, extra }) {
  const description =
    typeof manifest.description === 'string' && manifest.description.trim().length > 0
      ? manifest.description.trim()
      : manifest.panels?.[0]?.description?.trim() || `Tools for ${manifest.id}`;
  const title = manifest.panels?.[0]?.title?.trim() || toTitleCase(manifest.id);
  const operations = Array.isArray(manifest.operations) ? manifest.operations : [];
  const surfaces = manifest.surfaces || {};
  const cliEnabled = surfaces.cli !== false && surfaces.http !== false;
  const toolsEnabled = surfaces.tool !== false && operations.length > 0;
  const cliName = getSkillCliName(manifest.id);

  const lines = [
    '---',
    `name: ${manifest.id}`,
    `description: ${description}`,
    '---',
    '',
    `# ${title} CLI`,
    '',
  ];

  lines.push('## CLI', '');
  if (!cliEnabled || operations.length === 0) {
    lines.push('No CLI commands are exposed by this plugin.', '');
  } else {
    lines.push(
      `Use \`${cliName}\` to run ${manifest.id} operations. Each command maps to a tool`,
      'when tools are enabled.',
      '',
      `The \`${cliName}\` binary is in this skill's directory. Run it with:`,
      '```',
      `./${cliName} <command> [options]`,
      '```',
      '',
      'Usage:',
      `\`${cliName} <command> [options]\``,
      '',
      'Global options:',
      '- `--session-id <id>`: Session id for session-scoped operations.',
      '- `--json`: Output JSON (default true).',
      '',
    );
  }

  lines.push('## Commands', '');
  if (!cliEnabled || operations.length === 0) {
    lines.push('No commands are exposed by this plugin.', '');
  } else {
    for (const operation of operations) {
      const command = operation.cli?.command || operation.id;
      const summary =
        operation.cli?.description || operation.tool?.description || operation.summary;
      const toolName = `${normalizeToolSegment(manifest.id)}_${normalizeToolSegment(operation.id)}`;
      lines.push(`### ${command}`);
      if (summary) {
        lines.push('', summary);
      }
      if (toolsEnabled) {
        lines.push(`Tool name: \`${toolName}\``);
      }

      const schema = operation.inputSchema || {};
      const properties = schema.properties || {};
      const required = new Set(schema.required || []);
      const overrides = new Map(
        (operation.cli?.options || []).map((option) => [option.name, option]),
      );
      const propertyEntries = Object.entries(properties);
      if (propertyEntries.length === 0) {
        lines.push('', 'Options: none', '');
        continue;
      }
      lines.push('', 'Options:');
      for (const [name, propertySchema] of propertyEntries) {
        const override = overrides.get(name);
        const isRequired = override?.required ?? required.has(name);
        lines.push(
          formatOptionLine({
            name,
            schema: propertySchema,
            override,
            required: isRequired,
          }),
        );
      }
      lines.push('');
    }
  }

  lines.push('## Session Scoping', '');
  lines.push(
    'Use `--session-id` (CLI) or the `x-session-id` HTTP header when a command needs a session.',
    '',
  );

  const trimmedExtra = extra ? extra.trim() : '';
  if (trimmedExtra) {
    lines.push('## Extra', '', trimmedExtra, '');
  }

  return lines.join('\n');
}

async function writeSkillsBundles({ manifest, sourceDir, outputDir, extraSkillsDirs }) {
  const extraPath = path.join(sourceDir, 'skill-extra.md');
  const extra = await readOptionalFile(extraPath);
  const skillsDoc = formatSkillsDocument({ manifest, extra });

  await fs.writeFile(path.join(outputDir, 'SKILL.md'), skillsDoc, 'utf8');
  await fs.mkdir(path.join(outputDir, 'public'), { recursive: true });
  await fs.writeFile(path.join(outputDir, 'public', 'skill.md'), skillsDoc, 'utf8');

  const skillsDirs = [defaultSkillsRoot, ...extraSkillsDirs];
  for (const skillsDir of skillsDirs) {
    const targetRoot = path.resolve(repoRoot, skillsDir, getSkillDirName(manifest.id));
    await fs.mkdir(targetRoot, { recursive: true });
    await fs.rm(path.join(targetRoot, 'bin'), { recursive: true, force: true });
    await fs.writeFile(path.join(targetRoot, 'SKILL.md'), skillsDoc, 'utf8');

    const cliPath = path.join(outputDir, 'bin', getSkillCliName(manifest.id));
    if (await pathExists(cliPath)) {
      const targetCliPath = path.join(targetRoot, getSkillCliName(manifest.id));
      await fs.copyFile(cliPath, targetCliPath);
      await fs.chmod(targetCliPath, 0o755);
    }
  }
}

async function buildWebBundle(entryPath, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await build({
    entryPoints: [entryPath],
    outfile: outputPath,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
  });
}

const SERVER_BUNDLE_EXTERNALS = ['node-pty', 'jsdom', '@mozilla/readability', 'better-sqlite3'];

async function buildServerBundle(entryPath, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await build({
    entryPoints: [entryPath],
    outfile: outputPath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    external: SERVER_BUNDLE_EXTERNALS,
  });
}

async function buildCliBundle(manifest, outputPath) {
  const contents = `
    import { runPluginCli } from './packages/assistant-cli/src/pluginRuntime';
    const manifest = ${JSON.stringify(manifest)};
    void runPluginCli({ manifest, pluginId: manifest.id });
  `;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await build({
    stdin: {
      contents,
      resolveDir: repoRoot,
      sourcefile: `${manifest.id}-cli.ts`,
    },
    outfile: outputPath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  });

  await fs.chmod(outputPath, 0o755);
}

async function buildCustomCliBundle(entryPath, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await build({
    entryPoints: [entryPath],
    outfile: outputPath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  });

  await fs.chmod(outputPath, 0o755);
}

async function buildPlugin({ pluginId, sourceDir }) {
  const extraSkillsDirs = parseSkillsDirs(process.argv.slice(2));

  const manifestPath = path.join(sourceDir, 'manifest.json');
  if (!(await pathExists(manifestPath))) {
    console.warn(`[plugins] Skipping "${pluginId}": missing manifest.json`);
    return;
  }

  const manifest = await readManifest(manifestPath);
  const manifestId = typeof manifest.id === 'string' ? manifest.id.trim() : '';
  if (!manifestId) {
    console.warn(`[plugins] Skipping "${pluginId}": manifest.id is missing`);
    return;
  }
  if (manifestId !== pluginId) {
    console.warn(
      `[plugins] Plugin "${pluginId}" manifest id "${manifestId}" does not match directory name`,
    );
  }
  const outputDir = path.join(distRoot, manifestId);

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  await copyIfExists(manifestPath, path.join(outputDir, 'manifest.json'));
  await copyDirIfExists(path.join(sourceDir, 'public'), path.join(outputDir, 'public'));

  const webEntry = path.join(sourceDir, 'web', 'index.ts');
  if (await pathExists(webEntry)) {
    await buildWebBundle(webEntry, path.join(outputDir, 'public', 'bundle.js'));
  }

  const webStyles = path.join(sourceDir, 'web', 'styles.css');
  await copyIfExists(webStyles, path.join(outputDir, 'public', 'styles.css'));

  const serverEntry = path.join(sourceDir, 'server', 'index.ts');
  if (await pathExists(serverEntry)) {
    await buildServerBundle(serverEntry, path.join(outputDir, 'server.js'));
  }

  const sourceBinDir = path.join(sourceDir, 'bin');
  const outputBinDir = path.join(outputDir, 'bin');
  const sourceBinExists = await pathExists(sourceBinDir);

  // Check for custom CLI entry point (TypeScript)
  const customCliEntry = path.join(sourceDir, 'bin', 'cli.ts');
  const hasCustomCliEntry = await pathExists(customCliEntry);

  if (sourceBinExists) {
    // Copy pre-built bin directory (legacy behavior and auxiliary assets)
    await copyDirIfExists(sourceBinDir, outputBinDir);
  }

  const operations = Array.isArray(manifest.operations) ? manifest.operations : [];
  const surfaces = manifest.surfaces || {};
  const enableCli = surfaces.cli !== false;
  const enableHttp = surfaces.http !== false;

  if (hasCustomCliEntry && enableCli) {
    // Build custom CLI from TypeScript entry
    const cliPath = path.join(outputDir, 'bin', getSkillCliName(manifest.id));
    await buildCustomCliBundle(customCliEntry, cliPath);
  } else {
    const shouldBuildCli = !sourceBinExists && operations.length > 0 && enableCli && enableHttp;
    if (shouldBuildCli) {
      const cliPath = path.join(outputDir, 'bin', getSkillCliName(manifest.id));
      await buildCliBundle(manifest, cliPath);
    }
  }

  await writeSkillsBundles({ manifest, sourceDir, outputDir, extraSkillsDirs });
}

async function findPluginDirectories(rootDir) {
  const results = [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith('.')) {
      continue;
    }
    const entryDir = path.join(rootDir, entry.name);
    const manifestPath = path.join(entryDir, 'manifest.json');
    if (await pathExists(manifestPath)) {
      results.push({ pluginId: entry.name, sourceDir: entryDir });
      continue;
    }
    const childEntries = await fs.readdir(entryDir, { withFileTypes: true });
    for (const child of childEntries) {
      if (!child.isDirectory()) {
        continue;
      }
      if (child.name.startsWith('.')) {
        continue;
      }
      const childDir = path.join(entryDir, child.name);
      const childManifest = path.join(childDir, 'manifest.json');
      if (await pathExists(childManifest)) {
        results.push({ pluginId: child.name, sourceDir: childDir });
      }
    }
  }
  return results;
}

async function main() {
  if (!(await pathExists(pluginsRoot))) {
    console.warn('[plugins] No plugins directory found at packages/plugins');
    return;
  }

  const skillsFilter = parseSkillsFilter(process.argv.slice(2));
  let pluginDirs = await findPluginDirectories(pluginsRoot);
  if (pluginDirs.length === 0) {
    console.warn('[plugins] No plugins found under packages/plugins');
    return;
  }

  if (skillsFilter && skillsFilter.length > 0) {
    const filterSet = new Set(skillsFilter);
    pluginDirs = pluginDirs.filter((p) => filterSet.has(p.pluginId));
    if (pluginDirs.length === 0) {
      console.warn(`[plugins] No plugins matched filter: ${skillsFilter.join(', ')}`);
      return;
    }
  }

  for (const plugin of pluginDirs) {
    await buildPlugin(plugin);
  }
}

main().catch((err) => {
  console.error('[plugins] Failed to build plugins', err);
  process.exitCode = 1;
});
