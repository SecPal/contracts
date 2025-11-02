<!--
SPDX-FileCopyrightText: 2025 SecPal
SPDX-License-Identifier: AGPL-3.0-or-later
-->

<!--
╔════════════════════════════════════════════════════════════════╗
║  🚨 AI MUST READ ORGANIZATION-WIDE INSTRUCTIONS FIRST 🚨       ║
╠════════════════════════════════════════════════════════════════╣
║  Location: https://github.com/SecPal/.github/blob/main/.github/copilot-instructions.md ║
║                                                                ║
║  Critical Topics Defined There:                                ║
║  - 🛡️ Copilot Review Protocol (ALWAYS request after PR)       ║
║  - 🧪 Quality Gates (NEVER bypass)                            ║
║  - 📝 TDD Policy (Write tests FIRST)                          ║
║  - 🔐 Security Requirements                                    ║
║                                                                ║
║  ⚠️ This file contains REPO-SPECIFIC rules only               ║
╚════════════════════════════════════════════════════════════════╝
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

## Learned Lessons (Copilot-Proof Standard)

**Note:** These lessons extend the organization-wide learned lessons.
See [.github repository instructions][org-lessons] for complete list.

[org-lessons]: https://github.com/SecPal/.github/blob/main/.github/copilot-instructions.md#learned-lessons-copilot-proof-standard

### Contracts-Specific Lessons

#### 1. OpenAPI Completeness from v0.0.1 (MANDATORY)

**WHAT:** Every OpenAPI spec MUST include complete infrastructure from first commit:

```yaml
# ✅ REQUIRED - Complete structure
openapi: 3.1.0
info:
  title: SecPal API
  version: 0.0.1
  description: Complete professional description
  contact:
    name: SecPal Support
    email: info@secpal.app
    url: https://secpal.app
  license:
    name: AGPL-3.0-or-later
    url: https://www.gnu.org/licenses/agpl-3.0.html

servers:
  - url: https://api.secpal.app/v1
    description: Production
  - url: https://api.secpal.dev/v1
    description: Development

security:
  - BearerAuth: []

components:
  schemas: # ALL data models
  responses: # Standard error responses
  parameters: # Reusable parameters
  examples: # Request/response examples
  securitySchemes: # Authentication methods
  headers: # Standard headers (Rate-Limit-*, CORS, etc.)
```

**WHY:** Incomplete specs from day 1 = implementation assumptions = API drift = breaking changes later.

**HOW:**

1. Copy template from `.github/templates/openapi-template.yaml` (if exists)
2. Fill ALL 7 sections before first endpoint
3. Add infrastructure before features:
   - Error schemas (Error, ValidationError, NotFound, etc.)
   - Security schemes (BearerAuth)
   - Standard headers (X-Request-ID, Rate-Limit-\*)
   - Server configurations (all environments)

**VALIDATION:** Run `yq eval 'keys' docs/openapi.yaml` - MUST show: openapi, info, servers, security, components, paths.
Missing ANY = incomplete.

#### 2. Schema Reuse Over Inline (MANDATORY)

**WHAT:** ALL schemas MUST be defined in `components/schemas/` and referenced via `$ref`.

**WHY:** Inline schemas = duplication = drift = breaking changes when updating.

**HOW:**

```yaml
# ✅ CORRECT - Schema in components, referenced everywhere
components:
  schemas:
    User:
      type: object
      required: [id, email]
      properties:
        id: { type: integer, example: 123 }
        email: { type: string, format: email, example: 'user@secpal.app' }

paths:
  /users/{id}:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'

# ❌ WRONG - Inline schema
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
                  id: { type: integer }
```

**VALIDATION:** Run `grep -n "type: object" docs/openapi.yaml` - MUST ONLY appear under `components/schemas/`.
Zero matches in `paths/` section.

#### 3. Complete Error Coverage (MANDATORY)

**WHAT:** EVERY endpoint MUST define responses for ALL applicable HTTP status codes:

- 2xx: Success scenarios
- 4xx: Client errors (400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 422 Validation Error)
- 5xx: Server errors (500 Internal Server Error, 503 Service Unavailable)

**WHY:** Missing error responses = frontend teams guess error formats = inconsistent error handling.

**HOW:**

```yaml
paths:
  /users/{id}:
    get:
      responses:
        '200':
          description: User found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '404':
          $ref: '#/components/responses/NotFound'
        '500':
          $ref: '#/components/responses/InternalServerError'
```

**VALIDATION:** For each path operation, count response codes. Minimum 3 (1 success + 2 errors).
Protected endpoints: minimum 4 (include 401).

#### 4. Domain Policy in OpenAPI (CRITICAL)

**WHAT:** ALL URLs in OpenAPI specs MUST use correct domains:

- **Production:** `https://api.secpal.app`
- **Development:** `https://api.secpal.dev`
- **Contact/Homepage:** `https://secpal.app`
- **Email:** `info@secpal.app`, `security@secpal.app`
- **FORBIDDEN:** secpal.com, secpal.org

**WHY:** Wrong domains in public API specs = clients use wrong endpoints = production outages.

**HOW:**

```yaml
# ✅ CORRECT
info:
  contact:
    email: info@secpal.app
    url: https://secpal.app

servers:
  - url: https://api.secpal.app/v1
    description: Production
  - url: https://api.secpal.dev/v1
    description: Development
```

**VALIDATION:** Run `grep -o "secpal\.[a-z]*" docs/openapi.yaml | sort -u` - MUST return ONLY: secpal.app, secpal.dev.
Any other match = BLOCKER.

#### 5. Breaking Change Protocol (MANDATORY)

**WHAT:** Breaking changes REQUIRE API version bump and parallel support period.

**Breaking changes:**

- Remove endpoint
- Remove request/response field
- Change field type
- Add required field
- Change authentication method
- Change URL structure

**Non-breaking changes:**

- Add optional field
- Add new endpoint
- Deprecate field (with warning)

**HOW:**

```yaml
# When introducing breaking change:

# 1. Create new version
paths:
  /api/v2/users: # New version with breaking change
    get:
      summary: List users (v2 - paginated)
      parameters:
        - name: page
          required: true # Breaking: now required

  /api/v1/users: # Old version still supported
    get:
      summary: List users (v1 - deprecated)
      deprecated: true
```

**CHANGELOG entry:**

```markdown
## [Unreleased]

### Added

- API v2: Pagination support for all list endpoints

### Changed

- **BREAKING**: `/api/v2/users` requires `page` parameter

### Deprecated

- API v1 will be removed in version 2.0.0 (2026-Q2)
```

**VALIDATION:**

1. Breaking change = MAJOR version bump (0.x.y → 1.0.0 or 1.x.y → 2.0.0)
2. Old version endpoint still present in spec with `deprecated: true`
3. CHANGELOG.md has "BREAKING" entry with migration guide

## Mandatory Checklists (Contracts-Specific)

### Checklist 1: OpenAPI Completeness

MUST verify ALL items before PR:

- [ ] All 7 top-level sections present: openapi, info, servers, security, components, paths
- [ ] `components/schemas/` contains ALL data models (no inline schemas)
- [ ] `components/responses/` contains standard errors (Unauthorized, NotFound, ValidationError, InternalServerError)
- [ ] `components/securitySchemes/` defines ALL authentication methods
- [ ] `components/headers/` includes infrastructure headers (Rate-Limit-\*, X-Request-ID, CORS headers)
- [ ] `components/parameters/` defines reusable query/path parameters
- [ ] `components/examples/` includes examples for ALL schemas

### Checklist 2: Domain Verification

MUST verify ALL items before commit:

- [ ] Run `grep -o "secpal\.[a-z]*" docs/openapi.yaml | sort -u` → returns ONLY secpal.app, secpal.dev
- [ ] All server URLs use api.secpal.app (production) or api.secpal.dev (development)
- [ ] All contact emails use @secpal.app domain
- [ ] All homepage/documentation URLs use `https://secpal.app`
- [ ] ZERO instances of secpal.com or secpal.org

### Checklist 3: Error Coverage

MUST verify ALL items for EVERY endpoint:

- [ ] Success response (2xx) defined with schema
- [ ] Client errors defined (400, 401, 403, 404, 422 as applicable)
- [ ] Server errors defined (500, 503)
- [ ] Protected endpoints include 401 Unauthorized response
- [ ] All error responses use `$ref` to shared error schemas

### Checklist 4: Breaking Change Protocol

If PR contains breaking change, MUST verify:

- [ ] MAJOR version bump (0.x.y → 1.0.0 or 1.x.y → 2.0.0)
- [ ] New API version path created (`/api/v2/`)
- [ ] Old version still present with `deprecated: true`
- [ ] CHANGELOG.md entry: "**BREAKING**:" with migration guide
- [ ] Deprecation timeline documented (minimum 6 months for stable APIs)

### Checklist 5: Copilot-Proof OpenAPI

Achieve ALL criteria before requesting review.

- [ ] `npm run lint` exits with code 0 or 2 (zero errors)
- [ ] `npm run format` applied (Prettier formatting)
- [ ] All schemas have examples
- [ ] All endpoints have descriptions
- [ ] All parameters have descriptions and examples
- [ ] Consistent naming: camelCase (properties), kebab-case (paths)
- [ ] GitHub Copilot review → ZERO improvement suggestions
- [ ] REUSE compliance: `reuse lint` returns 0 errors

**TARGET:** All checks GREEN. Zero Copilot suggestions = standard achieved.

---
