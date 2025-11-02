#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2025 SecPal Contributors
# SPDX-License-Identifier: MIT

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

# Auto-detect default branch (fallback to main)
# Use symbolic-ref instead of remote show to avoid network hang
BASE="$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')"
[ -z "${BASE:-}" ] && BASE="main"

echo "Using base branch: $BASE"

# Fetch base branch for PR size check (failure is handled later)
git fetch origin "$BASE" 2>/dev/null || true

# 0) Formatting & Compliance
FORMAT_EXIT=0
if command -v npx >/dev/null 2>&1; then
  npx --yes prettier --check '**/*.{md,yml,yaml,json,ts,tsx,js,jsx}' || FORMAT_EXIT=1
  npx --yes markdownlint-cli2 '**/*.md' || FORMAT_EXIT=1
fi
# Workflow linting (part of documented gates)
# NOTE: actionlint is disabled in local preflight due to known hanging issues
# It runs in CI via .github/workflows/actionlint.yml instead
if [ -d .github/workflows ]; then
  if command -v actionlint >/dev/null 2>&1; then
    echo "ℹ️  Skipping actionlint in local preflight (runs in CI)" >&2
    # Uncomment below to enable (may hang):
    # timeout 30 actionlint || FORMAT_EXIT=1
  else
    echo "Warning: .github/workflows found but actionlint not installed - skipping workflow lint" >&2
  fi
fi
if command -v reuse >/dev/null 2>&1; then
  reuse lint || FORMAT_EXIT=1
fi
if [ "$FORMAT_EXIT" -ne 0 ]; then
  echo "Formatting/compliance checks failed. Fix issues above." >&2
  exit 1
fi

# 1) PHP / Laravel
if [ -f composer.json ]; then
  if ! command -v composer >/dev/null 2>&1; then
    echo "Warning: composer.json found but composer not installed - skipping PHP checks" >&2
  else
    composer install --no-interaction --no-progress --prefer-dist --optimize-autoloader
    # Run Laravel Pint code style check if available (blocking: aligns with gates)
    if [ -x ./vendor/bin/pint ]; then
      ./vendor/bin/pint --test
    fi
    # Run PHPStan (use configured level from phpstan.neon if exists, else max)
    if [ -x ./vendor/bin/phpstan ]; then
      if [ -f phpstan.neon ] || [ -f phpstan.neon.dist ]; then
        ./vendor/bin/phpstan analyse
      else
        ./vendor/bin/phpstan analyse --level=max
      fi
    fi
    # Run tests (Laravel Artisan → Pest → PHPUnit)
    if [ -f artisan ]; then
      php artisan test --parallel
    elif [ -x ./vendor/bin/pest ]; then
      ./vendor/bin/pest --parallel
    elif [ -x ./vendor/bin/phpunit ]; then
      ./vendor/bin/phpunit
    fi
  fi
fi

# 2) Node / React
if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
  # Check if scripts exist before running (pnpm run <script> exits 0 with --if-present)
  pnpm run --if-present lint
  pnpm run --if-present typecheck
  pnpm run --if-present test
elif [ -f package-lock.json ] && command -v npm >/dev/null 2>&1; then
  npm ci
  npm audit --audit-level=high || {
    echo "High or critical severity vulnerabilities detected by npm audit. Please address the issues above before continuing." >&2
    exit 1
  }
  # npm run lint runs redocly - exit code 1 = errors, 2 = warnings
  # We accept warnings (exit 2) but fail on errors (exit 1)
  set +e  # Temporarily disable exit-on-error to capture exit code
  npm run --if-present lint
  EXIT=$?
  set -e  # Re-enable exit-on-error
  if [ $EXIT -eq 1 ]; then
    echo "Linting failed with errors" >&2
    exit 1
  elif [ $EXIT -eq 2 ]; then
    # Exit code 2 = warnings only; this is acceptable, so we intentionally do nothing here.
    # Warnings are still shown above; we just don't block the commit on them.
    :
  elif [ $EXIT -ne 0 ]; then
    echo "Linting failed with unexpected exit code $EXIT" >&2
    exit $EXIT
  fi
  npm run --if-present typecheck
  npm run --if-present test
elif [ -f yarn.lock ] && command -v yarn >/dev/null 2>&1; then
  yarn install --frozen-lockfile
  # Yarn doesn't have --if-present, check package.json using jq or Node.js
  if command -v jq >/dev/null 2>&1; then
    jq -e '.scripts.lint' package.json >/dev/null 2>&1 && yarn lint
    jq -e '.scripts.typecheck' package.json >/dev/null 2>&1 && yarn typecheck
    jq -e '.scripts.test' package.json >/dev/null 2>&1 && yarn test
  elif command -v node >/dev/null 2>&1; then
    node -e "process.exit(require('./package.json').scripts?.lint ? 0 : 1)" && yarn lint
    node -e "process.exit(require('./package.json').scripts?.typecheck ? 0 : 1)" && yarn typecheck
    node -e "process.exit(require('./package.json').scripts?.test ? 0 : 1)" && yarn test
  else
    echo "Warning: jq and node not found - attempting to run yarn scripts (failures will be ignored)" >&2
    yarn lint 2>/dev/null || true
    yarn typecheck 2>/dev/null || true
    yarn test 2>/dev/null || true
  fi
fi

# 3) CHANGELOG validation (for non-docs branches)
# Branch prefixes that are exempt from CHANGELOG updates (configuration)
CHANGELOG_EXEMPT_PREFIXES="^(docs|chore|ci|test)/"
# Minimum lines in [Unreleased] to consider it non-empty
# This counts substantive content lines (not headings, blanks, or HTML comments)
# Minimum 3 ensures at least some documentation (e.g., 1-2 bullet points)
MIN_CHANGELOG_LINES=3

# Helper function to filter CHANGELOG content (POSIX-compliant with whitespace tolerance)
filter_changelog_content() {
  grep -Ev '^##' | grep -Ev '^$' | grep -Ev '^[[:space:]]*<!--' | grep -Ev '^[[:space:]]*-->'
}

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
# Use POSIX-compliant case statement instead of bash-specific [[ =~ ]] for portability
BRANCH_IS_EXEMPT=false
case "$CURRENT_BRANCH" in
  docs/*|chore/*|ci/*|test/*)
    BRANCH_IS_EXEMPT=true
    ;;
esac

if [ -f CHANGELOG.md ] && [ "$CURRENT_BRANCH" != "main" ] && [ "$BRANCH_IS_EXEMPT" = false ]; then
  # Check if CHANGELOG has [Unreleased] section
  if ! grep -q "## \[Unreleased\]" CHANGELOG.md; then
    echo "❌ CHANGELOG.md missing [Unreleased] section" >&2
    echo "Tip: Every feature/fix/refactor branch must update CHANGELOG.md" >&2
    echo "Exempt branches: docs/*, chore/*, ci/*, test/*" >&2
    exit 1
  fi

  # Check if there's actual content after [Unreleased] (robust to last/only section)
  # Find line number of [Unreleased], then extract content up to next heading or EOF
  # Use grep -nE for robustness with Keep a Changelog format (supports links)
  UNRELEASED_START=$(grep -nE '^## \[Unreleased\]' CHANGELOG.md | cut -d: -f1)
  if [ -n "$UNRELEASED_START" ]; then
    # Find next heading after [Unreleased], or use EOF if none found
    UNRELEASED_END=$(tail -n +"$((UNRELEASED_START + 1))" CHANGELOG.md | grep -n '^## ' | head -1 | cut -d: -f1)
    if [ -n "$UNRELEASED_END" ]; then
      # Extract content between [Unreleased] and next heading (using helper function)
      UNRELEASED_CONTENT=$(sed -n "$((UNRELEASED_START + 1)),$((UNRELEASED_START + UNRELEASED_END - 1))p" CHANGELOG.md | filter_changelog_content | wc -l)
    else
      # [Unreleased] is the last section, extract all remaining content (using helper function)
      UNRELEASED_CONTENT=$(tail -n +"$((UNRELEASED_START + 1))" CHANGELOG.md | filter_changelog_content | wc -l)
    fi

    if [ "$UNRELEASED_CONTENT" -lt "$MIN_CHANGELOG_LINES" ]; then
      echo "⚠️  Warning: [Unreleased] section appears empty in CHANGELOG.md" >&2
      echo "Did you forget to document your changes?" >&2
    fi
  fi
fi

# 4) Check PR size locally (against BASE)
if ! git rev-parse -q --verify "origin/$BASE" >/dev/null 2>&1; then
  echo "Warning: Cannot verify base branch origin/$BASE - skipping PR size check." >&2
  echo "Tip: Run 'git fetch origin $BASE' to enable PR size checking." >&2
else
  MERGE_BASE=$(git merge-base "origin/$BASE" HEAD 2>/dev/null)
  if [ -z "$MERGE_BASE" ]; then
    echo "Warning: Cannot determine merge base with origin/$BASE. Skipping PR size check." >&2
  else
    # Get raw diff output
    RAW_DIFF_OUTPUT=$(git diff --numstat "$MERGE_BASE"..HEAD 2>/dev/null)
    DIFF_OUTPUT="$RAW_DIFF_OUTPUT"

    # Load exclude patterns from .preflight-exclude if it exists
    if [ -f "$ROOT_DIR/.preflight-exclude" ]; then
      # Extract non-comment, non-empty lines as grep-compatible regex patterns
      # Strip CR for Windows/CRLF compatibility
      EXCLUDE_PATTERNS=$(grep -vE '^[[:space:]]*(#|$)' "$ROOT_DIR/.preflight-exclude" | tr -d '\r' || true)

      if [ -n "$EXCLUDE_PATTERNS" ]; then
        # Build regex alternation for efficient filtering (patterns are used as-is)
        EXCLUDE_REGEX=$(echo "$EXCLUDE_PATTERNS" | tr '\n' '|' | sed 's/|$//')

        # Validate regex and warn about dangerous patterns
        # grep exit codes: 0=match, 1=no match, 2=error (invalid regex)
        set +e  # Temporarily disable exit-on-error to capture grep's exit code
        echo "" | grep -qE -- "$EXCLUDE_REGEX" 2>/dev/null
        GREP_EXIT=$?
        set -e  # Re-enable exit-on-error
        if [ $GREP_EXIT -ne 2 ]; then
          # Pattern is valid (exit 0 or 1), check if it matches everything
          # Test against diverse filenames to detect overly broad patterns
          # Include various cases: lowercase, uppercase, numbers, special chars, hidden files
          if echo "test-file.txt" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo "another-file.js" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo "random.md" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo "README.md" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo "package.json" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo ".hidden" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo "File123.py" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo "UPPERCASE" | grep -qE -- "$EXCLUDE_REGEX"; then
            echo "⚠️  WARNING: .preflight-exclude contains pattern that matches EVERYTHING (e.g., '.*')" >&2
            echo "This will exclude all files from PR size calculation!" >&2
          fi
        else
          # Invalid regex - grep failed even on empty input
          echo "⚠️  WARNING: .preflight-exclude contains invalid regex pattern(s)" >&2
          echo "The pattern will be ignored. Please check your .preflight-exclude file." >&2
          echo "Common issues: unbalanced brackets [, unmatched (, trailing backslash \\" >&2
        fi

        # Use -- to prevent patterns starting with - from being interpreted as flags
        # || true prevents script exit if pattern is invalid
        DIFF_OUTPUT=$(echo "$DIFF_OUTPUT" | grep -vE -- "$EXCLUDE_REGEX" 2>/dev/null || true)
      fi
    fi

    # Check if all files were excluded
    if [ -n "$RAW_DIFF_OUTPUT" ] && [ -z "$DIFF_OUTPUT" ]; then
      echo "⚠️  All changed files are excluded (lock files, license files, etc.)"
      echo "Preflight OK · Changed lines: 0 (after exclusions)"
      exit 0
    else
      # Use --numstat for locale-independent parsing (sum insertions + deletions)
      CHANGED=$(echo "$DIFF_OUTPUT" | awk '{ins+=$1; del+=$2} END {print ins+del+0}')
      [ -z "$CHANGED" ] && CHANGED=0

      if [ "$CHANGED" -gt 600 ]; then
        # Check for override file (similar to GitHub label for exceptional cases)
        if [ -f "$ROOT_DIR/.preflight-allow-large-pr" ]; then
          echo "⚠️  Large PR override active ($CHANGED > 600 lines). Remove .preflight-allow-large-pr when done." >&2
        else
          echo "PR too large ($CHANGED > 600 lines). Please split into smaller slices." >&2
          echo "Tip: Lock files and license files are already excluded. See .preflight-exclude for details." >&2
          echo "For exceptional cases, create .preflight-allow-large-pr to override this check." >&2
          exit 2
        fi
      else
        echo "Preflight OK · Changed lines: $CHANGED"
      fi
    fi
  fi
fi

# All checks passed
exit 0
