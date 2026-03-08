<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Contracts Repository Instructions

These instructions are self-contained for the `contracts` repository at runtime.
Do not assume instructions from sibling repositories or comment-based inheritance are loaded.

## Always-On Rules

- Apply SecPal core rules on every task: fail fast, no bypass, one topic per
  change, and create a GitHub issue immediately for findings that cannot be
  fixed in the current scope.
- Before any commit, PR, or merge, announce and verify the required checklist. Stop on the first failed check.
- Update `CHANGELOG.md` in the same change set for real fixes, features, or breaking changes.
- Keep GitHub-facing communication in English.
- Domain policy is strict: use only `secpal.app` and `secpal.dev`.

## Required Checklist

Before any commit, PR, or merge, announce and verify at least:

- the relevant contract validation passed for the affected area, including `npm run lint` and formatting when needed
- `CHANGELOG.md` was updated in the same change set for real changes
- no bypass was used, including `--no-verify` or force-push
- repo-local instructions remain self-contained and do not rely on cross-repo inheritance
- out-of-scope findings were turned into GitHub issues immediately

## Repository Purpose

- This repository is the contract-first source of truth for the SecPal API.
- Design and validate the API contract here before backend or frontend implementation.

## OpenAPI Rules

- Use OpenAPI 3.1 only.
- Keep the primary specification in `docs/openapi.yaml` until there is an explicit reason to split it.
- Reuse schemas with `$ref` instead of inline duplication.
- Define standard error responses and security schemes consistently.
- Treat breaking changes as versioned API changes. Use a new versioned path
  such as `/api/v2/` and document the migration in `CHANGELOG.md`.

## Validation Rules

- Run the relevant validation for every change: `npm run lint` and formatting where needed.
- Ensure examples, response codes, naming, and reusable components stay consistent with the rest of the spec.
- Keep the spec complete: servers, security, schemas, responses, parameters, and examples must remain coherent.

## Scope Notes

- Prefer minimal schema changes that preserve backwards compatibility.
- Treat this file as the runtime baseline for the repo. Repo-specific `.instructions.md` files add detail for matching files.
