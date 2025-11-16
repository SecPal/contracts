<!--
SPDX-FileCopyrightText: 2025 SecPal Contributors
SPDX-License-Identifier: CC0-1.0
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Secret Management API Specification**: Complete OpenAPI 3.1 spec for Secret CRUD and Sharing endpoints
  - **5 Secret CRUD endpoints**: `GET /secrets`, `POST /secrets`, `GET /secrets/{id}`, `PATCH /secrets/{id}`, `DELETE /secrets/{id}`
  - **3 Secret Sharing endpoints**: `GET /secrets/{id}/shares`, `POST /secrets/{id}/shares`, `DELETE /secrets/{id}/shares/{shareId}`
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
