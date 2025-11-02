<!--
SPDX-FileCopyrightText: 2025 SecPal Contributors
SPDX-License-Identifier: CC0-1.0
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Project automation now triggers on label changes (labeled event)
- Pre-push hook no longer fails with exit code 1 when [Unreleased] is the last CHANGELOG section

### Added

- Initial repository structure for OpenAPI contracts.
- Basic OpenAPI 3.1 specification file.
- CI workflow for linting, formatting, and REUSE compliance.
- Dependabot configuration for `npm` and `github-actions`.
