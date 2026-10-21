<!--
SPDX-FileCopyrightText: 2025-2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# SecPal Contracts

> SecPal – A guard's best friend

[![Quality Gates](https://github.com/SecPal/contracts/actions/workflows/quality.yml/badge.svg)](https://github.com/SecPal/contracts/actions/workflows/quality.yml)
[![License: AGPL v3+](https://img.shields.io/badge/License-AGPL%20v3+-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

SecPal is operations software for German private security services. This
repository owns the public HTTP API contract shared by the SecPal server and its
clients.

## Contract responsibility

[`docs/openapi.yaml`](docs/openapi.yaml) is the normative public HTTP API
contract for the SecPal API. The OpenAPI 3.1 document defines public paths and
methods, request bodies, response schemas, authentication security declarations,
and reusable public API components.

The OpenAPI document itself is the public endpoint inventory; this README does
not duplicate it.

Security-relevant interface semantics include authorization-facing HTTP
behavior where represented, tenant-sensitive resource interfaces, validation,
and error shapes. Runtime authentication, authorization, tenant isolation,
validation, and other enforcement belong to the API implementation. A
discovered mismatch between the contract and implementation is contract drift
that must be reconciled explicitly.

This repository does not own client-specific native bridge contracts,
deployment interfaces, separate machine-readable security-event contracts, or
internal implementation interfaces. Those remain with their responsible
repositories.

## Validate locally

```bash
npm ci
npm run validate
```

These canonical package scripts validate the OpenAPI contract and the
repository's policy and formatting requirements.

## Related repositories

- [`SecPal/api`](https://github.com/SecPal/api) owns the server implementation
  and observable runtime behavior.
- [`SecPal/frontend`](https://github.com/SecPal/frontend) owns the shared
  browser and PWA client.
- [`SecPal/android`](https://github.com/SecPal/android) owns the Android client
  and its native bridge contracts.
- [`SecPal/deployment`](https://github.com/SecPal/deployment) owns self-hosting,
  deployment, and operational integration contracts.

Frontend and native clients consume the public HTTP contract without moving
their client-specific integration protocols into this repository.

## Contributing

See the repository's [`CONTRIBUTING.md`](CONTRIBUTING.md) and the
[organization-wide contribution guidance](https://github.com/SecPal/.github/blob/main/CONTRIBUTING.md).

## Security

Report vulnerabilities through the process in [`SECURITY.md`](SECURITY.md).

The required OpenAPI Lint check first runs the immutable organization Trivy
repository scanner on the exact checked-out commit with read-only permissions.
It includes npm development dependencies, exposed secrets and supported
misconfigurations. Only successful CLEAN evidence allows dependency installation
and contract validation to proceed; missing, failed, stale or non-CLEAN evidence
fails the check. The shared action owns scanner/database identity, freshness,
policy and redaction, retaining bounded secret-safe evidence for 14 days.

Trivy does not replace Redocly, OpenAPI semantics, verified-endpoint or domain
contract checks, or prove semantic coverage for every configuration format.
Workflow changes remain candidate-controlled and subject to the existing GitHub
protections and maintainer review; this check is not independent, tamper-proof
workflow enforcement.

## License

Repository-owned code, where applicable, is licensed under the GNU Affero
General Public License 3.0 or later. See [`LICENSE`](LICENSE); file-level SPDX
and REUSE metadata in [`REUSE.toml`](REUSE.toml) provide the applicable
licensing authority.
