## Development guidelines

- For any new feature or behavior change, add or update tests and run the relevant test suite before opening a PR.
- For any new feature or behavior change, update documentation appropriately (see README.md and docs/).
- Keep changes scoped and avoid unrelated refactors.

## Changelog

Location: `CHANGELOG.md` (root)

### Format

Use these sections under `## [Unreleased]`:
- `### Breaking Changes` - API changes requiring migration
- `### Added` - New features
- `### Changed` - Changes to existing functionality
- `### Fixed` - Bug fixes
- `### Removed` - Removed features

### Rules

- New entries ALWAYS go under `## [Unreleased]`
- Append to existing subsections (e.g., `### Fixed`), do not create duplicates
- NEVER modify already-released version sections (e.g., `## [0.0.3]`)
- Use inline PR links: `([#123](<pr-url>))`

### Attribution

- Internal changes: `Fixed foo bar ([#123](<pr-url>))`
- External contributions: `Added feature X ([#456](<pr-url>) by [@user](https://github.com/user))`

## Releasing

### During Development

When preparing PRs for main, open the PR first to get the PR number, then update `CHANGELOG.md` under `## [Unreleased]` with that PR number and push a follow-up commit.

### When Ready to Release

1. Checkout and update main:
   ```bash
   git checkout main && git pull
   ```
2. Verify `## [Unreleased]` in `CHANGELOG.md` includes all changes.
3. Run the release script:
   ```bash
   node scripts/release.mjs patch
   node scripts/release.mjs minor
   node scripts/release.mjs major
   ```

Notes:
- Requires the `gh` CLI and an authenticated GitHub session.
- Script expects a clean working tree, bumps `VERSION`, updates `CHANGELOG.md`, tags `vX.Y.Z`, pushes, and creates a prerelease.
- `scripts/bump-version.mjs` keeps `VERSION`, all `package.json` versions, and `package-lock.json` in sync.
