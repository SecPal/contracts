<!--
SPDX-FileCopyrightText: 2025 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# SecPal Contracts

This repository contains the OpenAPI 3.1 specifications for the SecPal API. It serves as the single source of truth for all API contracts between the frontend, backend, and any other clients.

## Overview

- **OpenAPI Version:** 3.1.0
- **Specification File:** `docs/openapi.yaml`
- **Version:** `0.0.1` (Initial Development)

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

## Licensing

This repository uses a dual-licensing model. See the `LICENSE` and `REUSE.toml` files for details.

<!-- CLA Test: Verify CI workflows -->
