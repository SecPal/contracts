<!--
SPDX-FileCopyrightText: 2025-2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Contributing to SecPal Contracts

Use the shared guide for GitHub issue scope, signed commits, review and
protected delivery.
[SecPal contributor guide](https://github.com/SecPal/.github/blob/main/CONTRIBUTING.md)

## Local checks

Use Node.js 26 and pre-commit. In a standalone clone, install the hooks and run
preflight from the repository root:

```bash
./scripts/setup-pre-commit.sh
./scripts/setup-pre-push.sh
./scripts/preflight.sh
```

For an isolated SecPal assignment, use the workspace setup for Contracts.
[Workspace setup](https://github.com/SecPal/.github/blob/main/WORKSPACE_SETUP.md)

## Contract changes

Use OpenAPI 3.1 and justify public compatibility changes. Update the relevant
examples and validators in the owning delivery. Explain breaking changes and
any required migration steps in the pull request. Preserve the applicable SPDX
and REUSE metadata when adding or editing files.
[OpenAPI ownership](AGENTS.md#openapi-ownership) · [REUSE metadata](REUSE.toml)

## Security pin override branches

Keep transitive security pins separate from contract, feature, or dependency
update work. Use `fix/<package>-<pinned-version>`. Include only the pin and the
regenerated lockfile. Reference the finding and explain the security impact in
the pull request. Review Dependabot updates in their own pull requests.
