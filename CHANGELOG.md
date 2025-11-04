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
