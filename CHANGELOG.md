<!--
SPDX-FileCopyrightText: 2025 SecPal Contributors
SPDX-License-Identifier: CC0-1.0
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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

- **Secret Management API Specification**: Complete OpenAPI 3.1 spec for Secret CRUD and Sharing endpoints
  - **5 Secret CRUD endpoints**: `GET /secrets`, `POST /secrets`, `GET /secrets/{secret}`, `PATCH /secrets/{secret}`, `DELETE /secrets/{secret}`
  - **3 Secret Sharing endpoints**: `GET /secrets/{secret}/shares`, `POST /secrets/{secret}/shares`, `DELETE /secrets/{secret}/shares/{share}`
  - **Schemas**: `Secret` (with encrypted fields), `SecretShare` (with permission hierarchy)
  - **Validation Rules**: Field lengths, required fields, permission enums (`read`, `write`, `admin`)
  - **XOR Constraint**: Share with user OR role (not both) - documented in spec
  - **Permission Hierarchy**: admin > write > read - documented with examples
  - **Error Responses**: 400, 401, 403, 404, 422 with detailed examples
  - **Authentication**: Bearer token (JWT) required for all endpoints
  - **Pagination**: List endpoints support `page` and `per_page` query parameters
  - Related: Implements spec for SecPal/api PRs #183, #185 (Phase 3: Secret Sharing & Access Control)

- **Git Conflict Marker Detection**: Automated check for unresolved merge conflicts
  - `scripts/check-conflict-markers.sh` - Scans all tracked files for conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`, `|||||||`)
  - `.github/workflows/check-conflict-markers.yml` - CI integration (runs on all PRs and pushes to main)
  - `docs/scripts/CHECK_CONFLICT_MARKERS.md` - Complete usage guide with examples and troubleshooting
  - Exit codes: 0 = clean, 1 = conflicts detected
  - Prevents accidental commits of broken code from merge conflicts
  - Colored output shows exact file locations and line numbers

### Changed

- **Preflight Script Performance**: Optimized `scripts/preflight.sh` for significantly faster local development
  - Prettier/markdownlint: Check only changed files in branch instead of all files (up to 10-100x faster for small changes)
  - composer/npm/pnpm: Skip dependency installation if lockfile unchanged and vendor/node_modules exists (saves minutes per push)
  - npm audit: Only run after fresh install, skip when dependencies unchanged (saves 5-10s network call)
  - git fetch: Cache for 5 minutes with 30s timeout to prevent hanging on slow networks
  - Expected improvement: 60s → 10s for doc fixes, 90s → 25s for API changes without dependency updates
  - All quality gates remain enforced: Pint, PHPStan, Prettier, Markdownlint, OpenAPI validation, REUSE

### Fixed

- Project automation now triggers on label changes (labeled event)
- Pre-push hook no longer fails with exit code 1 when [Unreleased] is the last CHANGELOG section

### Added

- Initial repository structure for OpenAPI contracts.
- Basic OpenAPI 3.1 specification file.
- CI workflow for linting, formatting, and REUSE compliance.
- Dependabot configuration for `npm` and `github-actions`.
