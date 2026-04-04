<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Contracts Repository Instructions

These instructions are self-contained for the `contracts` repository at runtime.
Do not assume instructions from sibling repositories or comment-based inheritance are loaded.

## Always-On Rules

- Run `git status --short --branch` before any write action. Never start implementation on local `main`,
  and stop if a dirty non-`main` branch contains unrelated work.
- TDD and contract-first discipline are mandatory. Update the smallest relevant failing contract, example,
  or validation FIRST, then implement downstream changes and refactor with validation green.
- Quality first. Do not trade correctness, review depth, validation depth, or issue tracking for speed.
- Keep one topic per change. 1 topic = 1 PR = 1 branch. Do not mix unrelated
  fixes, features, refactors, docs, or governance cleanup.
- Never use bypasses such as `--no-verify` or force-push.
- Update `CHANGELOG.md` in the same change set for real fixes, features, and breaking changes.
- Create a GitHub issue immediately for every real out-of-scope bug, technical debt, missing test,
  documentation gap, warning, audit finding, or deprecation you cannot fix now. Do not leave untracked
  `TODO`, `FIXME`, or follow-up work.
- Use EPIC plus sub-issues before implementation whenever work will span more than one PR; if in doubt,
  choose EPIC plus sub-issues.
- Keep GitHub-facing communication in English and reference files and lines instead of pasting large code blocks.
- Treat warnings, audit findings, and deprecations as actionable. Fix them in scope or track them immediately.
- Never reply to Copilot review comments with GitHub comment tools. Fix the code, push,
  and resolve threads through the approved non-comment workflow.
- Keep `SPDX-FileCopyrightText` years current in edited files or companion `.license` sidecars.
- Domain policy is strict: `secpal.app` for the public homepage and real email addresses,
  `api.secpal.dev` for the API, `app.secpal.dev` for the PWA/frontend, `secpal.dev` for dev,
  staging, testing, and examples, and `app.secpal` only as the Android application identifier.

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
- the local 4-pass review was completed, including DRY, KISS, YAGNI, SOLID,
  quality-first, and issue-management checks
- no bypass was used

## Repository Conventions

- This repository is the contract-first source of truth for the SecPal API.
- Use OpenAPI 3.1 only and keep the primary specification in `docs/openapi.yaml`
  unless there is an explicit reason to split it.
- Reuse schemas with `$ref`, keep security schemes and error responses consistent,
  and treat breaking changes as versioned API changes.
- Run the relevant validation for every change and keep examples, naming, and reusable components coherent.

## Scope Notes

- Prefer minimal schema changes that preserve backwards compatibility.
