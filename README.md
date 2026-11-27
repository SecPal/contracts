<!--
SPDX-FileCopyrightText: 2025-2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# SecPal Contracts

SecPal develops open-source software for professional security operations. This
repository owns the public HTTP API contract shared by the SecPal server and
its clients. [SecPal project overview](https://github.com/SecPal)

The OpenAPI 3.1 specification defines the public endpoints, schemas, and
security declarations. The API repository owns runtime behavior and
enforcement. Reconcile discrepancies in the owning contract and implementation
work. [OpenAPI specification](docs/openapi.yaml) · [API implementation](https://github.com/SecPal/api)

## Validate locally

With Node.js 26 and npm:

```bash
npm ci
npm run validate
```

The validation runs Redocly, contract and policy checks, and formatting.
[Contributor guide](CONTRIBUTING.md)

## Security

The OpenAPI Lint workflow requires a successful CLEAN read-only Trivy scan of
the exact checkout before installing dependencies and validating the contract.
The shared scanner owns scan scope, policy, and evidence retention.
[Workflow](.github/workflows/local-openapi-lint.yml) · [Repository scanning](https://github.com/SecPal/.github/blob/main/docs/trivy-repository-scanning.md)

To report a vulnerability, follow the [Security policy](SECURITY.md).

## License

Repository-owned code, where applicable, uses AGPL-3.0-or-later. File-level SPDX
and REUSE metadata identify the applicable licenses.
[License](LICENSE) · [REUSE metadata](REUSE.toml)
