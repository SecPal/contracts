<!--
SPDX-FileCopyrightText: 2025 SecPal
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Contracts Repository - Copilot Instructions

Repository-specific instructions for GitHub Copilot when working in the `contracts` repository.

**Note:** This file extends the [organization-wide Copilot instructions](https://github.com/SecPal/.github/blob/main/.github/copilot-instructions.md).

## Repository Purpose

Single source of truth for **OpenAPI 3.1** API specifications for the SecPal platform.

## Critical Rules (Contracts-Specific)

1. **OpenAPI 3.1 Only:** Use OpenAPI 3.1.0 syntax (not 3.0.x or Swagger 2.0)
2. **Single File:** All specs in `docs/openapi.yaml` - no splitting until complexity requires it
3. **Redocly Compliance:** All changes MUST pass `npm run lint` (Redocly)
4. **Backwards Compatibility:** Breaking changes require API version bump (`/api/v2/`)
5. **Schema-First:** Design API contract BEFORE implementing in backend/frontend

## OpenAPI Best Practices

### Component Reuse

```yaml
# ✅ Good: Reuse schemas via $ref
paths:
  /users/{id}:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'

# ❌ Bad: Inline schemas
paths:
  /users/{id}:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: ...
```

### Error Responses

Always define standard error schemas:

```yaml
components:
  schemas:
    Error:
      type: object
      required:
        - code
        - message
      properties:
        code:
          type: string
          example: 'RESOURCE_NOT_FOUND'
        message:
          type: string
          example: 'User with ID 123 not found'
        details:
          type: object
          additionalProperties: true

  responses:
    NotFound:
      description: Resource not found
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'
```

### Security Schemes

```yaml
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: JWT token obtained from /auth/login

security:
  - BearerAuth: [] # Apply globally
```

## Validation Rules

### Required Redocly Rules

See `.redocly.yaml` for active ruleset. Key rules:

- `no-ambiguous-paths`: No overlapping path patterns
- `no-empty-servers`: Server URLs must be defined
- `no-invalid-media-type-examples`: Examples must match schema
- `operation-operationId-unique`: Each operation needs unique ID
- `path-not-include-query`: Query params in path definitions
- `component-name-unique`: No duplicate component names

### Exit Codes

Redocly lint exit codes:

- `0`: No errors or warnings
- `1`: Errors found (CI FAILS)
- `2`: Only warnings (CI PASSES, warnings visible)

**Note:** `preflight.sh` treats exit code 2 as success (allows warnings).

## Workflow

### Making Changes

```bash
# 1. Create feature branch
git checkout -b feature/add-user-endpoint

# 2. Edit OpenAPI spec
vim docs/openapi.yaml

# 3. Validate locally
npm run lint

# 4. Format
npm run format

# 5. Commit (signed)
git add docs/openapi.yaml
git commit -S -m "feat(api): add GET /users/{id} endpoint"

# 6. Push (triggers preflight.sh)
git push
```

### Breaking Changes

```yaml
# Old: /api/v1/users
paths:
  /api/v1/users:
    get:
      summary: List users
      # ... existing spec

  # New: /api/v2/users with breaking change
  /api/v2/users:
    get:
      summary: List users (v2 - paginated)
      parameters:
        - name: page
          in: query
          required: true # ⚠️ Breaking: now required
          schema:
            type: integer
```

**CHANGELOG Entry Required:**

```markdown
## [Unreleased]

### Added

- API v2: Pagination support for all list endpoints

### Changed

- **BREAKING**: `/api/v2/users` now requires `page` query parameter

### Deprecated

- API v1 will be removed in version 2.0.0 (planned 2026-Q2)
```

## Common Tasks

### Add New Endpoint

1. Define in `paths:`
2. Create request/response schemas in `components/schemas/`
3. Add examples for all scenarios (success, errors)
4. Document all query/path/header parameters
5. Add security requirements if protected
6. Update CHANGELOG.md
7. Run `npm run lint` and `npm run format`

### Modify Existing Endpoint

1. Check if change is **breaking** (removes fields, changes types, adds required fields)
2. If breaking → Create new API version
3. If non-breaking → Update in place
4. Update examples
5. Update CHANGELOG.md

### Add New Schema

```yaml
components:
  schemas:
    User:
      type: object
      required:
        - id
        - email
      properties:
        id:
          type: integer
          format: int64
          example: 123
        email:
          type: string
          format: email
          example: 'user@example.com'
        created_at:
          type: string
          format: date-time
          example: '2025-10-25T14:30:00Z'
      example:
        id: 123
        email: 'user@example.com'
        created_at: '2025-10-25T14:30:00Z'
```

## Testing

No automated tests for OpenAPI specs directly. Validation happens via:

1. **Redocly Lint:** `npm run lint` (syntax, semantic rules)
2. **Prettier:** `npm run format:check` (YAML formatting)
3. **Manual Review:** Use Redoc preview or Swagger UI

### Preview Spec Locally

```bash
# Using Redocly CLI
npx @redocly/cli preview-docs docs/openapi.yaml

# Opens browser at http://localhost:8080
```

## Integration with Other Repos

### Backend (api/)

```php
// Laravel controllers should match OpenAPI spec
// Use openapi.yaml as contract for validation

class UserController extends Controller
{
    /**
     * GET /api/v1/users/{id}
     *
     * @see docs/openapi.yaml#/paths/~1api~1v1~1users~1{id}/get
     */
    public function show(int $id): JsonResponse
    {
        // Implementation must match contract
    }
}
```

### Frontend (frontend/)

```typescript
// Generate TypeScript types from OpenAPI spec
// Use openapi-typescript or similar

import type { components } from './generated/api-types'

type User = components['schemas']['User']

async function getUser(id: number): Promise<User> {
  // Fetch must match contract
}
```

## References

- [OpenAPI 3.1 Specification](https://spec.openapis.org/oas/v3.1.0)
- [Redocly Documentation](https://redocly.com/docs/cli/)
- [Organization Copilot Instructions](https://github.com/SecPal/.github/blob/main/.github/copilot-instructions.md)
- [SecPal Contributing Guide](https://github.com/SecPal/.github/blob/main/CONTRIBUTING.md)

## Quality Checklist for PRs

- [ ] OpenAPI 3.1.0 syntax used
- [ ] `npm run lint` passes (exit code 0 or 2)
- [ ] `npm run format` applied
- [ ] All examples provided and valid
- [ ] Breaking changes documented in CHANGELOG.md
- [ ] Security schemes applied where needed
- [ ] All required fields marked
- [ ] Response schemas for all status codes (200, 400, 401, 404, 500)
- [ ] Consistent naming (camelCase for properties, kebab-case for paths)
- [ ] REUSE compliance (SPDX headers on all new files)
