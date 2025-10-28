<!--
SPDX-FileCopyrightText: 2025 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# SecPal Contracts

> OpenAPI 3.1 specifications for the SecPal API

[![Quality Gates](https://github.com/SecPal/contracts/actions/workflows/quality.yml/badge.svg)](https://github.com/SecPal/contracts/actions/workflows/quality.yml)
[![PR Size](https://github.com/SecPal/contracts/actions/workflows/pr-size.yml/badge.svg)](https://github.com/SecPal/contracts/actions/workflows/pr-size.yml)
[![License: AGPL v3+](https://img.shields.io/badge/License-AGPL%20v3+-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

This repository contains the OpenAPI 3.1 specifications for the SecPal API. It serves as the single source of truth for all API contracts between the frontend, backend, and any other clients.

## Overview

- **OpenAPI Format:** 3.1.0
- **API Version:** `0.0.1` (Initial Development)
- **Specification File:** `docs/openapi.yaml`
- **Base URL:** `https://api.secpal.app/v1`
- **Last Updated:** 2025-10-25

### Available Endpoints

**Monitoring:**

- `GET /health` - Health check endpoint for monitoring API status

**Future Endpoints** _(planned)_:

- Authentication & Authorization
- Guard Management
- Shift Scheduling
- Incident Reporting
- Client Management

_See `docs/openapi.yaml` for complete specification details._

## Usage

The API specification can be used to:

- Generate client libraries
- Generate server stubs
- Configure API gateways
- Validate API requests and responses

## Development

### Prerequisites

- Node.js v22.x
- npm

### Setup

```bash
# Install dependencies
npm install
```

### Validation

To validate the OpenAPI specification locally, run:

```bash
npm run lint
```

This uses `@redocly/cli` to lint the `docs/openapi.yaml` file against the configured rules.

## Contributing

Please read the main `CONTRIBUTING.md` in the [SecPal/.github](https://github.com/SecPal/.github) repository. All contributions must follow the organization-wide guidelines.

- **Branch Naming:** `feat/add-new-endpoint`, `fix/correct-schema-definition`, etc.
- **Commits:** Must follow Conventional Commits specification.
- **Pull Requests:** Must be small, focused, and link to a relevant issue.

## 🤖 Automation

This repository uses automated project board management. Issues and PRs are automatically added to the [SecPal Roadmap](https://github.com/orgs/SecPal/projects/1) with status based on labels and PR state.

**Quick Start:**

```bash
# Create issue (auto-added to project board)
gh issue create --label "enhancement" --title "..."

# Draft PR workflow (recommended)
gh pr create --draft --body "Closes #123"  # → 🚧 In Progress
gh pr ready <PR>                            # → 👀 In Review
gh pr merge <PR> --squash                   # → ✅ Done
```

See [Project Automation docs](https://github.com/SecPal/.github/blob/main/docs/workflows/PROJECT_AUTOMATION.md) for details.

## Licensing

This repository uses a dual-licensing model. See the `LICENSE` and `REUSE.toml` files for details.

<!-- CLA Test: Verify CI workflows -->
