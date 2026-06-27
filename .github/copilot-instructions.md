<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# SecPal/contracts Copilot Instructions

This file mirrors the authoritative root `AGENTS.md` for tooling
that automatically loads `.github/copilot-instructions.md`.
Edit `AGENTS.md` first. Keep the focused overlay files aligned
for path-specific or stack-specific rules.

## Authoritative Sources

- `AGENTS.md`
- `.github/instructions/org-shared.instructions.md`
- `.github/instructions/openapi.instructions.md`
- `.github/instructions/github-workflows.instructions.md`

## Core Runtime Baseline

These instructions are self-contained for the `contracts` repository at runtime.
Do not assume instructions from sibling repositories or comment-based inheritance are loaded.

## Always-On Rules

- Run `git status --short --branch` before any write action. For new work,
  start from a clean, up-to-date local `main`: switch to `main`, pull with
  fast-forward only, verify a clean state, then create the dedicated topic
  branch. Never start implementation on local `main`. When continuing existing
  work in a dirty non-`main` worktree, first identify the existing changes,
  stop if unrelated work is present, keep the current topic scope, and never
  overwrite changes you did not make.
- TDD and contract-first discipline are mandatory. Update the smallest relevant failing contract, example,
  or validation FIRST, then implement downstream changes and refactor with validation green.
- Quality first. Do not trade correctness, review depth, validation depth, or issue tracking for speed.
- Keep one topic per change. 1 topic = 1 PR = 1 branch. Do not mix unrelated
  fixes, features, refactors, docs, or governance cleanup. In particular:
  do not roll Dependabot bumps into a manual branch (each Dependabot PR
  must land on its own auto-generated branch), do not append
  documentation-only prose to an unrelated topic branch, and ship every
  `overrides` (transitive security pin) change on a dedicated
  `fix/<package>-<version>` branch (e.g. `fix/brace-expansion-5.0.6`).
- Never use bypasses such as `--no-verify` or force-push.
- Update `CHANGELOG.md` in the same change set for real fixes, features, and breaking changes.
- Create a GitHub issue immediately for every real out-of-scope bug, technical debt, missing test,
  documentation gap, warning, audit finding, or deprecation you cannot fix now. Do not leave untracked
  `TODO`, `FIXME`, or follow-up work.
- Use EPIC plus sub-issues before implementation whenever work will span more than one PR; if in doubt,
  choose EPIC plus sub-issues.
- Keep GitHub-facing communication in English and reference files and lines instead of pasting large code blocks.
- Treat warnings, audit findings, and deprecations as actionable. Fix them in scope or track them immediately.
- Never reply to AI review comments with GitHub comment tools. Fix the code, push,
  and resolve threads through the approved non-comment workflow.
- Do not add AI self-references, generated-by text, promotional AI wording, or AI attribution to commits,
  pull requests, issues, changelogs, documentation, code comments, UI copy, or release notes unless the task
  explicitly requires documenting AI tooling behavior.
- Keep `SPDX-FileCopyrightText` years current in edited files or companion `.license` sidecars.
- Domain policy is strict: `secpal.app` for the public homepage and real email addresses,
  `changelog.secpal.app` for the public changelog site,
  `apk.secpal.app` for the canonical Android artifact and download host, `api.secpal.dev` for the API,
  `app.secpal.dev` for the PWA/frontend, `secpal.dev` for dev, staging, testing, and examples, and
  `app.secpal` only as the Android application identifier.
- After every merge, immediately return the local repo to a ready state:
  switch to `main`, pull with fast-forward only, delete the merged topic
  branch, prune remotes, refresh Node dependencies with `npm ci` where
  applicable, run `npm run validate`, run `npm run build` if present, and
  confirm the working tree is clean.

## Design Principles

- DRY: eliminate duplicated schemas, examples, and policy wording before they drift.
- KISS: prefer the simplest contract shape that satisfies the current requirement and remains easy to maintain.
- YAGNI: document only what the current issue or acceptance criteria require;
  track future ideas as issues instead of speculating now.
- SOLID: keep components reusable, responsibilities narrow, and extension points explicit.
- Fail fast: validate early, stop on the first failed check, and do not accumulate known breakage.

## Issue And PR Discipline

- Every real out-of-scope finding becomes a GitHub issue immediately; no untracked follow-up work is allowed.
- Complex work uses EPIC plus sub-issues before implementation. PRs should close
  sub-issues, not the epic, until the final linked step.
- When local review finds zero issues, commit and push the finished branch before opening any PR.
- The first PR state must be draft. Do not open a normal PR first.
- Mark a draft PR ready only after the final self-review in the PR view still finds zero issues.
- When creating or editing PRs programmatically, write multi-line body content to a file and use
  `--body-file` to prevent shell escaping issues.

## Required Validation

Before any commit, PR, or merge, announce the checklist you are executing and stop on the first failed item.
At minimum verify:

- the active branch and PR scope still address exactly one topic
- contract-first and test-first behavior happened: the relevant validation or contract change failed first and now passes
- the relevant contract validation passed, including `npm run lint` and formatting when needed
- out-of-scope findings were turned into GitHub issues immediately
- `CHANGELOG.md` was updated for real changes
- commits are GPG-signed
- REUSE compliance was checked when changed files require it
- when a contract change alters response shapes, error codes, required fields, or security schemes,
  affected examples and validation rules were checked and updated in the same change set
- the local 4-pass review was completed, including DRY, KISS, YAGNI, SOLID,
  quality-first, and issue-management checks
- no bypass was used

## AI Findings Triage

- Treat AI findings and AI-generated fix PRs as hints, not proof.
- Before merge, prove the defect with a failing test, a reproducible defect,
  or a stated invariant and why the current code violates it.
- Green CI alone is not enough for AI-generated changes, especially test,
  lifecycle, shell, regex, or refactor diffs; review the semantic risk
  explicitly.
- Reject AI-generated shell or regex cleanups that widen discovery patterns or
  collapse allowlists without positive and negative evidence.
- Reject AI-generated contract cleanups that widen allowlists, relax regex or
  discovery patterns, or change required fields, enums, or security schemes
  without positive and negative examples plus validation evidence.
- Reject AI-generated compatibility keep-alives that preserve obsolete schema
  aliases, deprecated request fields, or legacy contract variants without a
  proven live caller. Because the SecPal project is still under `1.x`, prefer
  removing unnecessary compatibility paths over carrying them forward when
  they weaken security, correctness, or contract clarity.

## Review guidelines

- Review for correctness, security, privacy, data integrity, lifecycle ordering,
  missing tests, and policy drift before style.
- Treat findings from any AI reviewer as untrusted leads until the defect is
  proven by a failing test, reproduction, or violated invariant.
- Keep review comments provider-neutral: describe the issue, evidence, impact,
  and fix path instead of the tool that found it.
- For contract changes, prioritize OpenAPI validity, generated-client impact,
  security schemes, error semantics, backward compatibility, and whether
  breaking changes are deliberate.
- Reject self-referential AI wording, generated-by text, tool promotion, or AI
  attribution in project artifacts unless the task is explicitly about AI
  tooling.

## Repository Conventions

- This repository is the contract-first source of truth for the SecPal API.
- Use OpenAPI 3.1 only and keep the primary specification in `docs/openapi.yaml`
  unless there is an explicit reason to split it.
- Reuse schemas with `$ref`, keep security schemes and error responses consistent,
  and treat breaking changes as versioned API changes.
- For policy scripts, keep discovery patterns narrow and verify both allowed and rejected examples after grep or regex changes.
- Run the relevant validation for every change and keep examples, naming, and reusable components coherent.

## Scope Notes

- Prefer minimal schema changes that preserve backwards compatibility unless an
  under-`1.x` cleanup is intentionally removing an insecure or obsolete
  compatibility layer. When taking that route, update examples, validation,
  and `CHANGELOG.md` in the same change set and treat external API breakage as
  a deliberate contract decision rather than an incidental refactor.

## Additional Rules: org-shared.instructions.md

This file auto-applies to all files in this repo so strict SecPal governance stays always present at runtime.

- `AGENTS.md` is the authoritative runtime baseline for this repo.
  `.github/copilot-instructions.md` is only a compatibility mirror.
- Non-negotiable: contract-first and test-first work, quality first, 1 topic =
  1 PR = 1 branch, immediate GitHub issue creation for every real out-of-scope
  finding, and no bypass.
- If work needs more than one PR, or probably will, create an EPIC with linked
  sub-issues before implementation.
- Design discipline is always-on: DRY, KISS, YAGNI, SOLID, and fail fast.
- GitHub communication stays in English and uses file and line references instead of large verbatim code quotes.
- Do not add AI self-references, generated-by text, tool promotion, or AI
  attribution unless the task explicitly requires documenting AI tooling.
- Keep changes repo-local, minimal, and consistent with OpenAPI 3.1, Redocly validation, and contract-first design.
- Apply the SecPal domain policy and immediate warning and issue triage rules from the repo baseline.

## Additional Rules: openapi.instructions.md

- Use OpenAPI 3.1 syntax only.
- Reuse components with `$ref`; avoid inline schema duplication in path operations.
- Keep response coverage complete for success and applicable error states.
- Maintain consistent security schemes, examples, naming, and reusable parameters.
- Treat breaking changes as versioned API changes and document them in `CHANGELOG.md`.
- Run the relevant Redocly validation and formatting after edits (`npm run lint` from the repo root; it uses
  `redocly.yaml`).
- `GET /health` documents `200` and `503` only; `operation-4xx-response` is disabled in `redocly.yaml` because
  health checks have no applicable client-error responses.
