# Repository Documentation Guidelines

This document provides a repo-agnostic framework for creating, organizing, and auditing documentation. Use it as a template for building a documentation system and for running periodic documentation reviews.

## Table of Contents

- [Goals](#goals)
- [Core principles](#core-principles)
- [Recommended structure](#recommended-structure)
- [Authoring patterns (high-signal best practices)](#authoring-patterns-high-signal-best-practices)
- [Documentation types and required content](#documentation-types-and-required-content)
- [Documentation audit workflow](#documentation-audit-workflow)
- [Review checklists](#review-checklists)
- [Maintaining the system](#maintaining-the-system)
- [Suggested file templates](#suggested-file-templates)
- [Open questions](#open-questions)

## Goals

- Keep documentation accurate, complete, and easy to navigate.
- Ensure each user-visible feature has a documented purpose, usage, and limitations.
- Make docs discoverable, versioned, and maintained alongside code changes.

## Core principles

- Single source of truth: avoid duplicated instructions across multiple files.
- Proximity: docs live near the system they describe (code, package, or service).
- Traceability: each doc maps to a feature, subsystem, or workflow.
- Verifiability: examples and commands should be runnable or clearly marked as unverified.
- Stability: high-level docs change slowly; operational details change often.
- Layered navigation: root overview, package/service READMEs, then deep dives.

## Recommended structure

### Root-level files (repo top)

Keep these minimal and stable:

- `README.md`: what the repo is, who it is for, quickstart, primary links.
- `LICENSE`: licensing.
- `SECURITY.md`: security reporting policy.
- `CONTRIBUTING.md`: contributor workflow, coding standards, tests.
- `CODE_OF_CONDUCT.md`: expected behavior.
- `CHANGELOG.md`: user-facing changes (optional if release notes exist elsewhere).
  - For released versions, omit empty subsections (keep only headings with entries).

### Documentation tree (docs/)

Use a predictable layout. Example:

- `docs/overview/` - architecture summary, system context, design goals.
- `docs/tutorials/` - step-by-step learning guides.
- `docs/how-to/` - task-focused operational steps.
- `docs/reference/` - API, CLI, config, schema reference.
- `docs/operations/` - deployment, runbooks, on-call, monitoring.
- `docs/decisions/` - ADRs (architecture decision records).
- `docs/troubleshooting/` - common issues, diagnostics, recovery steps.
- `docs/index.md` - optional doc map with top links and ownership.

If a repo is multi-package or multi-service, each package should have its own `README.md` plus a local `docs/` directory that mirrors the same categories where needed.
Keep runnable examples in `examples/` or under each package to avoid bloating tutorials.

### Where things should go

- Architecture and design: `docs/overview/` and `docs/decisions/`.
- How to run/deploy: `docs/operations/`.
- How to use: `docs/tutorials/` and `docs/how-to/`.
- Config and CLI options: `docs/reference/`.
- Common errors and fixes: `docs/troubleshooting/`.
- Contribution rules: `CONTRIBUTING.md`.
- Internal process docs: `docs/operations/` or `docs/how-to/` (avoid cluttering root).

## Authoring patterns (high-signal best practices)

- Include a short tagline at the top of package READMEs to orient readers fast.
- Add a table of contents when a document has 5+ top-level sections.
- For complex behavior, add a "Source files" section linking to key code paths.
- Include a "How it works" section with a step list or diagram for non-trivial flows.
- Use tables for config/flags/providers with defaults, types, and version notes.
- Separate OS- or environment-specific instructions into clearly labeled sections.
- Call out security and policy constraints where users might make mistakes.
- Provide both minimal and full examples when usage is non-obvious.

## Documentation types and required content

### README.md

- Audience and purpose.
- Quickstart (install, configure, run).
- Links to deeper docs.
- Status, maturity, or support policy (if applicable).
- Packages list and links (for monorepos).

### How-to

- Preconditions and environment assumptions.
- Steps with command examples.
- Validation checks.
- Common failure points and recovery.
- Expected output or success criteria.

### Reference

- Full list of options, flags, or config keys.
- Types and defaults.
- Version compatibility notes.
- Tables preferred over prose for options.

### Architecture / design

- System context and component boundaries.
- Data flow and dependencies.
- Rationale for key decisions and constraints.
- "Source files" section for traceability.
- Error paths and operational limits.

### Operations

- Deploy, rollback, monitoring, and alerting.
- Known limits and performance notes.
- Disaster recovery steps.
- Security boundaries and isolation assumptions.

### Feature deep dive (when behavior is nuanced)

- Overview and user-facing behavior.
- "How it works" sequence or diagram.
- Source files and key interfaces.
- Edge cases and error handling.

## Documentation audit workflow

The goal is to verify that docs match the code and that the code has docs. Use a plan, a log, and a coverage matrix to keep the review tight and auditable.

### 1. Create a documentation review plan

Outline scope, milestones, and acceptance criteria.

Example plan template:

```text
Plan: Documentation Review
Scope:
- Products/services/packages:
- Out of scope:

Milestones:
1) Inventory docs and code entry points
2) Build coverage matrix (features -> docs)
3) Review docs for accuracy and completeness
4) Review code for undocumented behavior
5) Fix or log gaps, update docs
6) Final consistency and link check

Definition of done:
- All critical workflows documented
- No stale or contradictory docs
- Coverage matrix updated
- Open doc gaps logged with owners
```

### 2. Build an inventory and coverage matrix

Inventory all docs and map them to features, modules, or workflows.

Example coverage matrix template:

```text
Feature | Doc(s) | Owner | Status | Notes
--------|--------|-------|--------|------
Auth    | docs/how-to/auth.md | team-a | reviewed | Example updated
CLI     | docs/reference/cli.md | team-b | gap | Flags missing
```

### 3. Create an audit log

Use a log to track review status and outcomes. This is useful for multi-day reviews or handoffs.

Example audit log template:

```text
Doc/Area | Reviewed | Issues Found | Action | Verified Against Code | Reviewer | Date
---------|----------|--------------|--------|-----------------------|----------|-----
README.md | yes | missing env var | updated | yes | you | 2025-01-15
docs/how-to/setup.md | no | - | - | - | - | -
```

### 4. Review each document

For each document, verify:

- Accuracy: does it match current behavior?
- Completeness: does it cover required steps and edge cases?
- Clarity: is it written for the intended audience?
- Verifiability: can commands and examples be run?
- Ownership: is it clear who maintains it?
- Traceability: are source file links present for complex behavior?
- Safety: are security constraints and failure modes documented?

Mark the result in the audit log and update the coverage matrix.

### 5. Review source code for undocumented behavior

Work from code to docs:

- Identify entry points (binaries, services, packages, APIs).
- Map public interfaces and configuration to reference docs.
- Walk high-level flows: startup, config load, auth, data flow, error handling.
- Search for flags, config keys, or endpoints without documentation.
- Confirm examples and default values against the source.

Record gaps and assign owners or action items.

### 6. Close gaps and re-verify

- Update docs where the code is authoritative.
- Update code comments or examples if docs are correct but code is wrong.
- Re-run commands or tests where possible.
- Ensure the README and index docs link to new or moved files.

### 7. Consistency and quality checks

- Terminology consistency across docs and code.
- Broken links or outdated paths.
- Version notes align with release branches.
- No duplication that can drift.
- Formatting rules are consistent (headings, code blocks, tables).
- TOC present for long docs.

## Review checklists

### Document checklist

- Purpose and audience stated
- Prerequisites listed
- Steps are ordered and complete
- Examples are current and runnable
- Errors and troubleshooting covered
- Links are correct and up to date

### Code-to-doc checklist

- Public APIs documented
- Config keys documented with defaults
- CLI flags documented with examples
- Non-obvious behavior explained
- Breaking changes noted in changelog/release notes

## Maintaining the system

- Require doc updates in PR templates or review checklists.
- Tag doc owners in code owners or metadata.
- Schedule periodic reviews (quarterly or per release).
- Track doc debt in issues with clear owners and due dates.
- Add per-package changelogs when packages are published independently.

## Suggested file templates

### How-to template

```text
# Title

## Purpose

## Prerequisites

## Steps

## Validate

## Troubleshooting
```

### Feature deep dive template

```text
# Title

## Overview

## How it works

## Source files

## Edge cases

## Troubleshooting
```

### Reference template

```text
# Title

## Overview

## Options

## Defaults

## Examples
```

## Open questions

- Do you prefer a different taxonomy (for example, "guides" instead of "how-to")?
- Do you want the plan and log templates split into separate files?
- Should the audit log be a spreadsheet-friendly CSV format instead of a markdown table?
