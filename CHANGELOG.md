<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: CC0-1.0
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Documented the phase-1 MFA contract in `docs/openapi.yaml`, including pending login challenges for `/auth/login` and `/auth/token`, MFA challenge verification, authenticated TOTP enrollment, self-service disablement, and one-time recovery-code regeneration semantics

### Fixed

- Switched the Contracts repo's Prettier and OpenAPI PR checks to repo-local workflow jobs so contract PRs no longer fail when the shared `.github` composite Node setup action path is unavailable during GitHub Actions resolution
- Added the missing `chain_link_valid` field to the `GET /v1/activity-logs/{activity}/verify` response schema so generated clients and response validators match the API payload

### Removed

- Removed the deleted legacy product-module contract, including its retired CRUD, sharing, and attachment endpoints and schemas.

### Security

- Scoped the transitive `undici` override to `@redocly/cli` and pinned it to `6.24.0` so contract validation tooling no longer resolves the vulnerable HTTP client release reported by `npm audit`
- Pinned transitive `brace-expansion` and `yaml` resolutions to patched semver-compatible releases so the contracts toolchain no longer reports the moderate `npm audit` findings surfaced during the Redocly CLI maintenance update

### Added

- `.github/instructions/openapi.instructions.md` - targeted OpenAPI contract guidance for `docs/openapi.yaml`
- `.github/instructions/github-workflows.instructions.md` - targeted workflow and Dependabot guidance for GitHub automation files in this repo
- `.github/instructions/org-shared.instructions.md` — org-wide Copilot principles available as a repo-local overlay that can be loaded
  manually for contract-relevant files

### Changed

- Reduced the repo-local Copilot always-on context by replacing the long runtime baseline and removing the auto-loaded overlay fallback, which lowers request size in large VS Code workspaces without dropping the contract-specific governance rules

- Replaced the remaining inline activity-log pagination schema with shared `PaginationLinks` and `PaginationMeta` component references so paginated responses use the contract's canonical pagination building blocks
- Updated `@redocly/cli` from `2.25.2` to `2.25.3` so `npm run validate` no longer emits the current upgrade banner tracked in #156

- Aligned the contract repo's domain guidance and the OpenAPI base/server URLs with the active host split: `api.secpal.dev` for the API, `app.secpal.dev` for the PWA, `secpal.app` for the public homepage and real email addresses, and `app.secpal.app` only as the Android identifier
- Extended the authenticated-user schema with explicit `hasCustomerAccess` and `hasSiteAccess` flags so clients can distinguish scoped collection access from pure role/permission metadata and keep customer/site route gating consistent with the API's fail-closed collection behavior
- Clarified the employee lifecycle contract by centralizing the official status set (`applicant`, `pre_contract`, `active`, `on_leave`, `terminated`), documenting that onboarding invitations are only allowed for `pre_contract`, and exposing invitation-eligibility metadata in employee response schemas

- Updated `@redocly/cli` from `2.25.1` to `2.25.2` so `npm run validate` no longer emits the stale Redocly update notice tracked in #149

- Documented the canonical auth/self-service contract surface in `docs/openapi.yaml` for Issue #146, including `POST /auth/login`, `POST /auth/token`, `POST /auth/logout`, the deprecated legacy alias `POST /auth/session/logout`, `POST /auth/logout-all`, and the official `/me` self-service namespace
- Documented the employee invite flow in the OpenAPI contract by adding `send_invitation` to employee creation requests and the persisted `onboarding_invitation` delivery-status block to employee responses
- Updated `@redocly/cli` from `2.24.0` to `2.24.1` so `npm run validate` no longer emits the stale Redocly update notice tracked in #136
- Added explicit top-level OpenAPI tag declarations for all currently used operation groups so documentation tooling can render consistent tag metadata and descriptions (#129)
- `.github/copilot-instructions.md` now requires a branch hygiene check before any write action so contract work never starts on local `main` and dirty non-`main` branches must be assessed before continuing
- `.github/copilot-instructions.md` now requires stale `SPDX-FileCopyrightText` years in edited files and license sidecars to be normalized to `YYYY` or `YYYY-YYYY` without spaces
- `.github/copilot-instructions.md` now clarifies that if an edited file has no inline SPDX header, its companion `.license` file must be checked and updated instead
- repo-local contracts instructions and overlays now also restate Copilot review handling, signed-commit checks, EPIC/sub-issue requirements, REUSE checks, 4-pass review, and the `secpal.app` vs `secpal.dev` use-case split so project-wide governance is locally complete
- repo-local contracts instructions and overlays now also require warning, audit, and deprecation notices from scripts and package managers to be reviewed and either fixed or tracked immediately
- `.github/copilot-instructions.md` - replaced long-form repo guidance with a self-contained runtime baseline for this repository
- `.github/instructions/org-shared.instructions.md` - reduced to a short repo-local overlay that reinforces the runtime baseline instead of duplicating org documents

- `.github/copilot-instructions.md` — removed dead org-banner HTML comment block (replaced by `org-shared.instructions.md`)

- **Enhanced Activity Logs API Documentation** (#462): Comprehensive improvements to OpenAPI specification
  - **Realistic Examples**: Added detailed request/response examples for all 3 endpoints
    - `GET /activity-logs`: Paginated list with 3 activities showing hash chains, Merkle proofs, and OTS data
    - `GET /activity-logs/{activity}`: Single activity with full relationships (causer, subject)
    - `GET /activity-logs/{activity}/verify`: All verification scenarios (valid, pending, invalid)
  - **Error Scenarios**: Detailed error response examples
    - 422 Validation Errors: Date range validation, pagination limits, UUID format validation
    - 403 Forbidden: Organizational scope denial with descriptive messages
  - **Enhanced Descriptions**: Added comprehensive endpoint descriptions including:
    - Authorization layer documentation (tenant isolation, permissions, organizational scoping, leadership filtering)
    - Access control logic (scoped vs. global access, leadership ranks, system activities)
    - Hash chain and Merkle tree explanations
  - **Schema Compliance**: Fixed batch_uuid format to proper UUID format (removed "batch-" prefix)
  - **Error Schema**: Added required `code` property to all error examples for schema compliance
  - Related: Closes #462 (Activity Logging OpenAPI Documentation)

- **Preflight Script Performance**: Optimized `scripts/preflight.sh` for significantly faster local development
  - Prettier/markdownlint: Check only changed files in branch instead of all files (up to 10-100x faster for small changes)
  - composer/npm/pnpm: Skip dependency installation if lockfile unchanged and vendor/node_modules exists (saves minutes per push)
  - npm audit: Only run after fresh install, skip when dependencies unchanged (saves 5-10s network call)
  - git fetch: Cache for 5 minutes with 30s timeout to prevent hanging on slow networks
  - Expected improvement: 60s → 10s for doc fixes, 90s → 25s for API changes without dependency updates
  - All quality gates remain enforced: Pint, PHPStan, Prettier, Markdownlint, OpenAPI validation, REUSE

### Added

- **Customer & Site Management API Specification** (#71, Phase 5 of Epic SecPal/.github#210): Complete OpenAPI 3.1 spec for Customer, Site, Assignment, and CostCenter management
  - **6 Customer endpoints**: `GET /customers` (list with filters), `POST /customers` (create with auto-generated KD-YYYY-####), `GET /customers/{customer}` (show with relationships), `PATCH /customers/{customer}` (update), `DELETE /customers/{customer}` (soft delete), `GET /customers/{customer}/sites` (list customer's sites)
  - **6 Site endpoints**: `GET /sites` (list with comprehensive filtering: customer_id, organizational_unit_id, type, is_active, currently_valid, search), `POST /sites` (create with auto-generated OBJ-YYYY-####), `GET /sites/{site}` (show with relationships), `PATCH /sites/{site}` (update), `DELETE /sites/{site}` (soft delete), nested cost centers route
  - **10 Assignment endpoints**:
    - Customer Assignments (4): `GET /customers/{customer}/assignments`, `POST /customers/{customer}/assignments`, `PATCH /customer-assignments/{assignment}`, `DELETE /customer-assignments/{assignment}`
    - Site Assignments (4): `GET /sites/{site}/assignments`, `POST /sites/{site}/assignments`, `PATCH /site-assignments/{assignment}`, `DELETE /site-assignments/{assignment}`
    - User Assignments (2): `GET /me/customer-assignments`, `GET /me/site-assignments`
  - **5 CostCenter endpoints** (nested under sites): `GET /sites/{site}/cost-centers`, `POST /sites/{site}/cost-centers`, `GET /sites/{site}/cost-centers/{costCenter}`, `PUT /sites/{site}/cost-centers/{costCenter}`, `DELETE /sites/{site}/cost-centers/{costCenter}`
  - **Schemas**: `Customer` (with billing_address, contact, metadata), `Site` (with type: permanent/temporary, GPS coordinates, validity dates), `CustomerAssignment` (flexible roles), `SiteAssignment` (with is_primary flag), `CostCenter` (with activity_type), `Address` (with lat/lng), `Contact` (reusable)
  - **Validation Rules**: maxLength constraints, required fields, enum types, unique constraints (customer_number, site_number, cost_center code per site)
  - **Filtering**: Comprehensive query parameters (search, customer_id, organizational_unit_id, type, is_active, currently_valid, active_only)
  - **Pagination**: All list endpoints support `page` and `per_page` (default 15, max 100)
  - **Relationships**: Support for eager loading (include parameter: sites, assignments, customer, organizationalUnit, costCenters)
  - **Need-to-Know Access**: Users see customers/sites via organizational unit access, direct assignment, or customer assignment
  - **Conditional Visibility**: notes and access_instructions only visible to users with update permission
  - **Error Responses**: 400, 401, 403, 404, 422 with detailed schemas
  - **Authentication**: Bearer token (JWT) required for all endpoints
  - **PATCH Semantics**: Customer and Site updates use PATCH (all fields optional)
  - **PUT Semantics**: CostCenter updates use PUT (required fields enforced)
  - **Soft Deletes**: All entities support soft deletion with validation (e.g., cannot delete customer with active sites)
  - Related: Implements spec for SecPal/api PRs #349-#368 (Epic #210: Customer & Site Management)

- **Git Conflict Marker Detection**: Automated check for unresolved merge conflicts
  - `scripts/check-conflict-markers.sh` - Scans all tracked files for conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`, `|||||||`)
  - `.github/workflows/check-conflict-markers.yml` - CI integration (runs on all PRs and pushes to main)
  - `docs/scripts/CHECK_CONFLICT_MARKERS.md` - Complete usage guide with examples and troubleshooting
  - Exit codes: 0 = clean, 1 = conflicts detected
  - Prevents accidental commits of broken code from merge conflicts
  - Colored output shows exact file locations and line numbers

### Fixed

- Aligned `EmployeeCreateRequest` with the employee-create API validation so `date_of_birth`, `position`, `contract_start_date`, and `organizational_unit_id` are now required and non-null in the shared contract (#141)
- `scripts/preflight.sh` now blocks branches whose commit range contains a symlinked `.gitattributes`, preventing the remote push warning investigated in #138 from being reintroduced
- Activity log contract responses now match the backend resource and verification payload shapes
- OpenAPI 3.1 now models nullable `Customer.contact` and `Site.contact` references correctly
- **Employee OpenAPI contract now matches backend request/response behavior** (#116)
  - corrected employee contract type enums to `full_time`, `part_time`, `minijob`, and `freelance`
  - documented the `data` response envelope used by employee create/show/update endpoints
  - added missing employee request and response fields such as `position`, `management_level`, embedded `organizational_unit`, and BWR-related fields
  - replaced inline employee request bodies with reusable OpenAPI component schemas

- Project automation now triggers on label changes (labeled event)
- Pre-push hook no longer fails with exit code 1 when [Unreleased] is the last CHANGELOG section

### Added

- Initial repository structure for OpenAPI contracts.
- Basic OpenAPI 3.1 specification file.
- CI workflow for linting, formatting, and REUSE compliance.
- Dependabot configuration for `npm` and `github-actions`.
