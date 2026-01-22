#!/usr/bin/env node
/**
 * Release script for ai-assistant
 *
 * Usage: node scripts/release.mjs <major|minor|patch>
 *
 * Steps:
 * 1. Check for uncommitted changes
 * 2. Bump VERSION file
 * 3. Update CHANGELOG.md: [Unreleased] -> [version] - date
 * 4. Commit and tag
 * 5. Push to remote
 * 6. Create GitHub release with notes from CHANGELOG
 * 7. Add new [Unreleased] section
 * 8. Commit and push
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const bumpType = process.argv[2];
const releaseBranch = 'main';

if (!['major', 'minor', 'patch'].includes(bumpType)) {
  console.error('Usage: node scripts/release.mjs <major|minor|patch>');
  process.exit(1);
}

function run(command, options = {}) {
  console.log(`$ ${command}`);
  try {
    return execSync(command, {
      encoding: 'utf-8',
      stdio: options.silent ? 'pipe' : 'inherit',
      cwd: root,
      ...options,
    });
  } catch (error) {
    if (!options.ignoreError) {
      console.error(`Command failed: ${command}`);
      process.exit(1);
    }
    return null;
  }
}

function getVersion() {
  return readFileSync(join(root, 'VERSION'), 'utf-8').trim();
}

function getRepoUrl() {
  const remote = run('git remote get-url origin', { silent: true, ignoreError: true });
  if (!remote) {
    return null;
  }
  const url = remote.trim();
  const sshMatch = url.match(/^git@github.com:(.+?)(\.git)?$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }
  const httpsMatch = url.match(/^https?:\/\/github.com\/(.+?)(\.git)?$/);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}`;
  }
  return null;
}

function getCurrentBranch() {
  const branch = run('git rev-parse --abbrev-ref HEAD', { silent: true });
  return branch.trim();
}

function updateChangelogForRelease(version) {
  const changelogPath = join(root, 'CHANGELOG.md');
  const date = new Date().toISOString().split('T')[0];
  let content = readFileSync(changelogPath, 'utf-8');

  if (!content.includes('## [Unreleased]')) {
    console.error('Error: No [Unreleased] section found in CHANGELOG.md');
    process.exit(1);
  }

  const releaseHeading = `## [${version}] - ${date}`;
  content = content.replace(
    /## \[Unreleased\]\n\n_No unreleased changes\._/,
    releaseHeading
  );
  content = content.replace(/## \[Unreleased\]/, releaseHeading);

  content = stripEmptyReleaseSections(content, version);

  writeFileSync(changelogPath, content);
  console.log(`  Updated CHANGELOG.md: [Unreleased] -> [${version}] - ${date}`);
}

function stripEmptyReleaseSections(content, version) {
  const versionEscaped = version.replace(/\./g, '\\.');
  const sectionRegex = new RegExp(
    `(## \\[${versionEscaped}\\][^\\n]*\\n)([\\s\\S]*?)(?=\\n## \\[|$)`
  );
  const match = content.match(sectionRegex);
  if (!match) {
    return content;
  }

  const heading = match[1];
  let body = match[2];
  body = body.replace(/### [^\\n]+\\n(?:\\s*\\n)*(?=###|##|$)/g, '');
  body = body.replace(/\\n{3,}/g, '\\n\\n');
  const trimmed = body.trimEnd();
  const rebuilt = `${heading}${trimmed ? trimmed : ''}`.trimEnd();

  return content.replace(sectionRegex, `${rebuilt}\n\n`);
}

function extractReleaseNotes(version) {
  const changelogPath = join(root, 'CHANGELOG.md');
  const content = readFileSync(changelogPath, 'utf-8');

  const versionEscaped = version.replace(/\./g, '\\.');
  const regex = new RegExp(
    `## \\[${versionEscaped}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`
  );
  const match = content.match(regex);

  if (!match) {
    console.error(`Error: Could not extract release notes for v${version}`);
    process.exit(1);
  }

  return match[1].trim();
}

function addUnreleasedSection() {
  const changelogPath = join(root, 'CHANGELOG.md');
  let content = readFileSync(changelogPath, 'utf-8');

  const unreleasedSection = [
    '## [Unreleased]',
    '',
    '### Breaking Changes',
    '',
    '### Added',
    '',
    '### Changed',
    '',
    '### Fixed',
    '',
    '### Removed',
    '',
    '',
  ].join('\n');

  content = content.replace(/^(# Changelog\n\n)/, `$1${unreleasedSection}`);

  writeFileSync(changelogPath, content);
  console.log('  Added [Unreleased] section to CHANGELOG.md');
}

console.log('\n=== Release Script ===\n');

console.log('Checking for uncommitted changes...');
const status = run('git status --porcelain', { silent: true });
if (status && status.trim()) {
  console.error('Error: Uncommitted changes detected. Commit or stash first.');
  console.error(status);
  process.exit(1);
}
console.log('  Working directory clean\n');

const currentBranch = getCurrentBranch();
if (currentBranch !== releaseBranch) {
  console.error(
    `Error: Release must run from ${releaseBranch} (current branch: ${currentBranch}).`
  );
  process.exit(1);
}

console.log(`Bumping version (${bumpType})...`);
run(`node scripts/bump-version.mjs ${bumpType}`);
const version = getVersion();
console.log(`  New version: ${version}\n`);

console.log('Updating CHANGELOG.md...');
updateChangelogForRelease(version);
console.log();

console.log('Committing and tagging...');
run(
  'git add VERSION CHANGELOG.md package.json package-lock.json packages/*/package.json ' +
    'packages/desktop/src-tauri/Cargo.toml packages/desktop/src-tauri/tauri.conf.json'
);
run(`git commit -m "Release v${version}"`);
run(`git tag v${version}`);
console.log();

console.log('Pushing to remote...');
run(`git push origin ${releaseBranch}`);
run(`git push origin v${version}`);
console.log();

console.log('Creating GitHub release...');
const releaseNotes = extractReleaseNotes(version);
const notesFile = join(root, '.release-notes-tmp.md');
writeFileSync(notesFile, releaseNotes);
run(`gh release create v${version} --prerelease --title "v${version}" --notes-file "${notesFile}"`);
run(`rm "${notesFile}"`);
console.log();

console.log('Adding [Unreleased] section for next cycle...');
addUnreleasedSection();
console.log();

console.log('Committing changelog update...');
run('git add CHANGELOG.md');
run('git commit -m "Prepare for next release"');
run(`git push origin ${releaseBranch}`);
console.log();

const repoUrl = getRepoUrl();
if (repoUrl) {
  console.log(`=== Released v${version} ===`);
  console.log(`${repoUrl}/releases/tag/v${version}`);
} else {
  console.log(`=== Released v${version} ===`);
}
