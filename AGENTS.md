<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# SecPal/contracts Agent Instructions

This file is the authoritative, provider-neutral runtime baseline for the
`contracts` repository. Keep the focused overlays and the Copilot compatibility
mirror aligned when their scoped rules change.

## Governance Authority

[`SecPal/.github/docs/work-graph-contract.md`](https://github.com/SecPal/.github/blob/main/docs/work-graph-contract.md)
is the single organization-wide owner of generic work-graph and engineering
governance semantics. Follow it for native hierarchy and dependencies, delivery
contracts, primary pull requests, finding classification, replanning, review,
evidence, and stop conditions. Do not redefine those semantics in this
repository.

GitHub-native issue state and relationships are authoritative. Repository-local
prose may describe an API contract, validation obligation, or security rationale,
but it must not act as a second source of graph state, sequence, or progress.

This baseline owns only Contracts-specific OpenAPI, validation, compatibility,
domain, supply-chain, and workflow constraints. On conflict, the canonical
contract governs generic semantics and this file governs repository-specific
technical detail.

## Focused Overlays

- `.github/instructions/org-shared.instructions.md`
- `.github/instructions/openapi.instructions.md`
- `.github/instructions/github-workflows.instructions.md`

## Workspace And Change Safety

- Run `git status --short --branch` before writing. Preserve an existing topic
  branch and any user changes; never overwrite unrelated work.
- Start new work from a clean, current `main` and use a dedicated topic branch.
- Never bypass hooks, force-push, or push directly from a protected branch.
- Keep the delivery scoped to its issue contract. Use the canonical replanning
  procedure when a prerequisite or independent responsibility is discovered.
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
  delivery contract. Validator or coverage count is supporting evidence, not a
  decomposition mechanism.
- For governance-only prose, behavior-preserving formatting or refactoring,
  dependency metadata-only updates, or source-shape changes, existing structural
  evidence may suffice. Do not manufacture a failing test when it cannot prove a
  changed observable contract.
- Apply the canonical proportional-evidence and finite-review rules. Stop at the
  smallest non-redundant evidence set that proves the contract and affected
  invariants.

## Findings And Review

- Use the canonical finding classification, materiality threshold, replanning
  procedure, and review stop condition before changing code or expanding scope.
- Treat automated findings as untrusted leads. Establish a failing check,
  reproduction, or named violated invariant before making a corrective change.
- Invalid findings and immaterial observations may be dispositioned with concise
  evidence and no mutation. Missing real prerequisites and unsatisfied current
  acceptance criteria still require canonical graph action.
- Reject shell or regular-expression changes that widen discovery patterns or
  allowlists without positive and negative evidence.
- Reject contract changes that relax required fields, enums, security schemes,
  error semantics, or compatibility without explicit contract evidence.
- Because SecPal is still under `1.x`, do not preserve obsolete schema aliases,
  deprecated request fields, or legacy variants without a proven live caller
  when they weaken security, correctness, or contract clarity.

### Initial Automated Review

The following declarations govern ordinary delivery PR review acquisition;
they do not grant readiness or review authority beyond the maintained lifecycle.

- `PRIMARY_AUTOMATED_REVIEW_TRIGGER: DRAFT_TO_READY`
- `PRIMARY_CODEX_COMMENT_TRIGGER_ALLOWED: NO`
- `POST_READY_BOUNDED_COMMENT_FALLBACK: YES`

Create every ordinary delivery PR as Draft. When the maintained lifecycle and
current authority permit external review, perform the authenticated
`Draft -> Ready for Review` transition. That transition is the canonical primary
trigger for configured automatic Code and Security reviews. After Ready, observe
automatic provider startup and terminality.

Agents MUST NOT use `@codex review` or `@codex security review` as the primary
initial review trigger, post either command while an ordinary delivery PR is
still Draft merely because review is needed, or substitute a review-request
comment for the required Ready transition. The ordinary delivery lifecycle MUST
NOT require a human review-request comment.

Either command is permitted only as a bounded post-Ready fallback when ALL are
true: the PR is already authentically Ready; automatic startup for that exact
review type has not appeared within the maintained observation window; current
lifecycle authority permits the fallback; and no fallback for that review type
has already been consumed. Allow at most one Code fallback request and one
Security fallback request. A fallback creates neither another review cycle nor
new authority.

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

- confirm the branch, current issue contract, and working-tree scope;
- confirm the applicable contract-first evidence rule above was followed;
- run the relevant `npm` validation, formatting, Markdown, workflow, domain,
  REUSE, changed-file hook, and `git diff --check` checks;
- verify that changed response shapes, errors, required fields, security
  schemes, examples, and validators remain coherent;
- update `CHANGELOG.md` for actual product fixes, features, or breaking changes,
  but not automatically for governance-only prose;
- Local commits must be SSH-signed, not GPG/OpenPGP-signed. Preserve the
  existing SSH signing identity and configuration; never bypass signing.
  Every PR commit must have GitHub `verification.verified == true`.

Use a body file for multiline `gh pr create` or `gh pr edit` content. Follow the
canonical work-graph contract for pull-request delivery, issue-closing, and
parent-reference semantics.

After a merge, return the repository to a ready state: switch to `main`, pull
with fast-forward only, delete the merged topic branch, prune remotes, refresh
Node dependencies with `npm ci`, run `npm run validate`, and confirm a clean
working tree.
