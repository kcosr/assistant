# Pi model upgrade

Upgrade Assistant's Pi SDK and coding-agent dependencies from 1.0.1 to the current 1.5.2 release so `openai-codex/gpt-6.1-terra` resolves through the canonical Pi registry.

1. Review upstream API, model catalogue, authentication, streaming, history, and coding-tool compatibility in parallel.
2. Upgrade both dependency declarations and lockfile; adapt only integrations affected by the upgrade and document the change.
3. Verify Terra resolution using the installed SDK, run relevant tests, lint, and a full build.
4. Run the Keel `iterative-review` saved workflow with `claude-default`; apply agreed scoped findings and repeat until clean.
5. Commit, push, open a PR, and add the required Unreleased changelog entry with the PR link. Do not merge.
6. Deploy the tested worktree to the dev checkout, run its full build, restart `assistant.service`, and verify startup and Terra model resolution.
