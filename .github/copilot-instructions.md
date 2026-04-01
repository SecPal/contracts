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
- Keep one topic per change, fail fast, and never use bypasses such as `--no-verify` or force-push.
- Update `CHANGELOG.md` in the same change set for real fixes, features, and breaking changes.
- Create a GitHub issue immediately for out-of-scope bugs, technical debt, missing tests,
  documentation gaps, and actionable warnings you cannot fix now.
- Keep GitHub-facing communication in English and reference files and lines instead of pasting large code blocks.
- Treat warnings, audit findings, and deprecations as actionable. Fix them in scope or track them immediately.
- Never reply to Copilot review comments with GitHub comment tools. Fix the code, push,
  and resolve threads through the approved non-comment workflow.
- Use EPIC plus sub-issues before starting work that will span more than one PR.
- Keep `SPDX-FileCopyrightText` years current in edited files or companion `.license` sidecars.
- Domain policy is strict: `secpal.app` for the public homepage and real email addresses,
  `api.secpal.dev` for the API, `app.secpal.dev` for the PWA/frontend, `secpal.dev` for dev,
  staging, testing, and examples, and `app.secpal.app` only as the Android application identifier.

## Required Validation

Before any commit, PR, or merge, announce the checklist you are executing and stop on the first failed item.
At minimum verify:

- the relevant contract validation passed, including `npm run lint` and formatting when needed
- `CHANGELOG.md` was updated for real changes
- commits are GPG-signed
- REUSE compliance was checked when changed files require it
- the local 4-pass review was completed
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
