<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# SecPal/contracts Copilot Instructions

`AGENTS.md` is the authoritative Contracts runtime baseline. This compatibility
mirror summarizes the same authority boundary for tools that load this path.

## Governance Authority

[`SecPal/.github/docs/work-graph-contract.md`](https://github.com/SecPal/.github/blob/main/docs/work-graph-contract.md)
is the single organization-wide owner of generic work-graph and engineering
governance semantics. Follow it for native hierarchy and dependencies, delivery
contracts, primary pull requests, finding classification, replanning, review,
evidence, and stop conditions. Do not redefine those semantics locally.

GitHub-native issue state and relationships are authoritative. Contracts prose
owns OpenAPI, validation, compatibility, and supply-chain detail, not graph
sequence, readiness, or progress.

## Contracts Runtime Constraints

- Run `git status --short --branch` before writing; preserve existing topic work.
- Never bypass hooks, force-push, or push directly from a protected branch.
- Keep work inside the current delivery contract and use canonical replanning
  for a real prerequisite or independent responsibility.
- For an observable OpenAPI or API-contract change, start with the smallest
  meaningful failing contract, validation, or example evidence where it can
  demonstrate the changed contract.
- For governance-only prose, behavior-preserving formatting or refactoring,
  dependency metadata-only updates, and source-shape changes, existing
  structural evidence may suffice; do not manufacture a failing behavior test.
- Apply canonical proportional evidence, finding materiality, finite review, and
  stop conditions. Invalid or immaterial observations may be dispositioned with
  concise evidence and no mutation.

## OpenAPI, Validation, And Supply Chain

- SecPal/contracts is the contract-first source of truth for the SecPal API. Use
  OpenAPI 3.1 and keep `docs/openapi.yaml` primary unless a real contract requires
  decomposition.
- Prefer reusable `$ref` components and preserve coherent security schemes,
  errors, parameters, examples, required fields, and response coverage.
- Keep external API breakage deliberate and evidenced. Preserve compatibility
  unless the owning pre-`1.x` contract explicitly removes an insecure or
  obsolete path.
- Preserve the `package.json` validation pipeline: Redocly, Node validators,
  verified-endpoint checks, domain-contract checks, and formatting.
- Keep policy matchers narrow and prove allowed and rejected cases when changing
  them. Do not silently broaden security-related allowlists.
- Pin external actions and reusable workflows to immutable full 40-character
  SHAs with reviewed source refs retained in same-line comments.
- Preserve intentional dependency overrides and security pins; isolate unrelated
  supply-chain updates from manual contract changes.
- Follow the workflow overlay for timeouts, least privilege, reusable workflows,
  secret handling, and `yamllint`.

## Delivery Hygiene

- Run the smallest complete applicable validation, formatting, Markdown, REUSE,
  changed-file hook, and `git diff --check` checks.
- Update `CHANGELOG.md` for product fixes, features, or breaking changes, not
  automatically for governance-only prose.
- Keep commits cryptographically signed and use no bypass.
- Follow the canonical contract for pull-request delivery and relationship
  semantics. Keep GitHub communication in English, SPDX years current, and
  project artifacts free of AI attribution unless explicitly required.

## Domain Policy

Use `secpal.app` for the public homepage and real email addresses,
`apk.secpal.app` for Android artifacts, `api.secpal.dev` for the API,
`app.secpal.dev` for the PWA, `secpal.dev` for development, staging, testing,
and examples, and `app.secpal` only as the Android application identifier.
