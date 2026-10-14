<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# SecPal/contracts Agent Instructions

This file is the authoritative, provider-neutral runtime baseline for the
`contracts` repository. Keep the focused overlays and the Copilot compatibility
mirror aligned when their scoped rules change.

## GitHub Collaboration

Use GitHub issues and their native relationships for scope and dependencies.
Use pull requests, reviews, conversations, and required checks for delivery and
merge decisions. This baseline owns Contracts-specific OpenAPI, validation,
compatibility, domain, supply-chain, and workflow constraints.

## Focused Overlays

- `.github/instructions/org-shared.instructions.md`
- `.github/instructions/openapi.instructions.md`
- `.github/instructions/github-workflows.instructions.md`

## Workspace And Change Safety

- Run `git status --short --branch` before writing. Preserve an existing topic
  branch and any user changes; never overwrite unrelated work.
- Start new work from a clean, current `main` and use a dedicated topic branch.
- Never bypass hooks, force-push, or push directly from a protected branch.
- Keep the change scoped to the requested work. Record a real prerequisite or
  independent responsibility using GitHub issues and native relationships.
- Keep GitHub-facing communication in English and reference files and lines
  instead of pasting large code blocks.
- Do not add AI attribution, generated-by wording, tool promotion, or AI
  self-references to project artifacts unless the task is about that tooling.
- Keep SPDX years current in edited files or companion `.license` sidecars.

## Contract-First Evidence

- For an observable OpenAPI or API-contract change, write or update the smallest
  meaningful contract, validation, or example evidence first and observe it fail
  where that evidence can demonstrate the changed contract. Suitable boundaries
  include Redocly validation, Node contract-validator tests, positive and
  negative schema examples, verified-endpoint checks, and domain-contract checks.
- Keep a contract implementation and its required validation in the same owning
  change. Validator or coverage count is supporting evidence.
- For governance-only prose, behavior-preserving formatting or refactoring,
  dependency metadata-only updates, or source-shape changes, existing structural
  evidence may suffice. Do not manufacture a failing test when it cannot prove a
  changed observable contract.
- Use the smallest non-redundant evidence set that proves the contract and
  affected invariants.

## Findings And Review

- Treat automated findings as untrusted leads. Establish a failing check,
  reproduction, or named violated invariant before making a corrective change.
- Invalid findings and immaterial observations may be dispositioned with concise
  evidence and no mutation. Missing real prerequisites and unsatisfied current
  acceptance criteria still need to be addressed in the pull request or tracked
  with GitHub issues and native relationships.
- Reject shell or regular-expression changes that widen discovery patterns or
  allowlists without positive and negative evidence.
- Reject contract changes that relax required fields, enums, security schemes,
  error semantics, or compatibility without explicit contract evidence.
- Because SecPal is still under `1.x`, do not preserve obsolete schema aliases,
  deprecated request fields, or legacy variants without a proven live caller
  when they weaken security, correctness, or contract clarity.

### Pull Request Review

Open a Draft pull request while work is in progress and mark it Ready when it
is ready for review. Keep Ready pull requests Ready. Request another review
directly when a code change or new evidence invalidates an earlier review.
Address material findings with concrete evidence and satisfy native required
reviews and checks before merging.

## OpenAPI Ownership

- This repository is the contract-first source of truth for the SecPal API.
- Use OpenAPI 3.1 only. Keep the primary specification in `docs/openapi.yaml`
  unless a real contract requires decomposition.
- Prefer reusable `$ref` components over duplicated inline schemas. Keep
  security schemes, error responses, parameters, examples, naming, and response
  coverage coherent.
- Make external API breakage deliberate and evidenced. Update affected examples,
  validators, and `CHANGELOG.md` in the same delivery when response shapes,
  error codes, required fields, or security schemes change.
- Prefer minimal compatible schema changes unless the owning contract explicitly
  calls for a pre-`1.x` removal of an insecure or obsolete compatibility path.

## Validation And Supply Chain

- Preserve the validation pipeline defined in `package.json`, including
  `npm run lint`, `npm run validate`, formatting, Redocly, verified-endpoint
  checks, and domain-contract checks. Run the smallest complete subset applicable
  to the change.
- Keep policy-script discovery and matching patterns narrow. When changing a
  matcher, prove both allowed and rejected examples and do not silently broaden
  security-related allowlists.
- Pin every external GitHub Action and reusable workflow to an immutable full
  40-character commit SHA. Preserve the reviewed tag or branch in a same-line
  comment for Dependabot visibility.
- Preserve intentional dependency overrides and transitive security pins. Keep
  an unrelated Dependabot update or security-pin change isolated from a manual
  contract change so its supply-chain impact remains independently reviewable.
- Apply `.github/instructions/github-workflows.instructions.md` when editing
  workflows or Dependabot configuration, including timeout, least-privilege,
  reusable-workflow, secret-handling, and `yamllint` requirements.
- Domain policy is strict: `secpal.app` is the public homepage and real-email
  domain, `apk.secpal.app` is the Android artifact and download host,
  `api.secpal.dev` is the API, `app.secpal.dev` is the PWA, `secpal.dev` is for
  development, staging, testing, and examples, and `app.secpal` is only the
  Android application identifier.

## Required Validation And Delivery

Before a commit, push, or pull request, announce the applicable checklist and
stop on the first failed item:

- confirm the branch, requested scope, and working-tree changes;
- confirm the applicable contract-first evidence rule above was followed;
- run the relevant `npm` validation, formatting, Markdown, workflow, domain,
  REUSE, changed-file hook, and `git diff --check` checks;
- verify that changed response shapes, errors, required fields, security
  schemes, examples, and validators remain coherent;
- update `CHANGELOG.md` for actual product fixes, features, or breaking changes,
  but not automatically for governance-only prose;
- Sign commits with SSH using the existing signing identity.
  Preserve existing SSH keys and signing configuration. GitHub-generated
  signatures are provider evidence, not SecPal OpenPGP signing authority.
  Every PR commit must have GitHub `verification.verified == true`.

Use a body file for multiline `gh pr create` or `gh pr edit` content. Link
related issues and use a closing reference only when the change completes that
issue.

After a merge, return the repository to a ready state: switch to `main`, pull
with fast-forward only, delete the merged topic branch, prune remotes, refresh
Node dependencies with `npm ci`, run `npm run validate`, and confirm a clean
working tree.
