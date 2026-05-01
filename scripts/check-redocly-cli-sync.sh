#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: MIT

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required to verify the installed @redocly/cli version." >&2
  exit 1
fi

if [ ! -f package.json ] || [ ! -f package-lock.json ]; then
  echo "Error: package.json and package-lock.json are required." >&2
  exit 1
fi

DECLARED_VERSION="$(node -p "require('./package.json').devDependencies?.['@redocly/cli'] ?? ''")"
LOCKED_VERSION="$(node -p "require('./package-lock.json').packages?.['node_modules/@redocly/cli']?.version ?? ''")"

if [ -z "$LOCKED_VERSION" ]; then
  echo "Error: package-lock.json does not contain a node_modules/@redocly/cli entry." >&2
  exit 1
fi

if [ ! -f node_modules/@redocly/cli/package.json ]; then
  echo "Error: @redocly/cli is not installed. Run npm ci before validation." >&2
  exit 1
fi

INSTALLED_VERSION="$(node -p "require('./node_modules/@redocly/cli/package.json').version")"

if [ "$INSTALLED_VERSION" != "$LOCKED_VERSION" ]; then
  echo "Error: installed @redocly/cli version $INSTALLED_VERSION does not match lockfile version $LOCKED_VERSION (declared range: $DECLARED_VERSION)." >&2
  echo "Run npm ci to refresh local dependencies before running validation." >&2
  exit 1
fi
