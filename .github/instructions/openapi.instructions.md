---
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: AGPL-3.0-or-later
name: OpenAPI Contract Rules
description: Applies contract-first OpenAPI rules to the primary API specification.
applyTo: 'docs/openapi.yaml'
---

# OpenAPI Contract Rules

- Use OpenAPI 3.1 syntax only.
- Reuse components with `$ref`; avoid inline schema duplication in path operations.
- Keep response coverage complete for success and applicable error states.
- Maintain consistent security schemes, examples, naming, and reusable parameters.
- Treat breaking changes as versioned API changes and document them in `CHANGELOG.md`.
- Run the relevant Redocly validation and formatting after edits.
