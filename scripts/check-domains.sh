#!/bin/bash
# SPDX-FileCopyrightText: 2025-2026 SecPal
# SPDX-License-Identifier: MIT

# Domain Policy Enforcement Script
# Validates that only approved SecPal domains and identifiers are used
# ZERO TOLERANCE for other domains or deprecated .app web hosts

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Domain Policy Check ===${NC}"
echo "Allowed: secpal.app, changelog.secpal.app, apk.secpal.app, secpal.dev"
echo "Public changelog site: changelog.secpal.app"
echo "Active web hosts: api.secpal.dev, app.secpal.dev"
echo "Android artifact host: apk.secpal.app"
echo "Identifier-only: app.secpal (Android application ID)"
echo "Deprecated web hosts: api.secpal.app"
echo "Forbidden: secpal.com, secpal.org, secpal.net, secpal.io, secpal.example, ANY other"
echo ""

matches=$(grep -r -n -E "secpal\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*" \
    --include="*.md" \
    --include="*.yaml" \
    --include="*.yml" \
    --include="*.json" \
    --include="*.sh" \
    --include="*.ts" \
    --include="*.tsx" \
    --include="*.js" \
    --include="*.jsx" \
    --include="*.php" \
    --include="*.html" \
    --exclude-dir=".git" \
    --exclude-dir="node_modules" \
    --exclude-dir="vendor" \
    . 2>/dev/null | \
    grep -v -- "check-domains.sh" | \
    grep -v -- "Forbidden:" | \
    grep -v -- "FORBIDDEN:" | \
    grep -v -- '- "secpal\.' | \
    grep -v -- '^[[:space:]]*- \[' || true)

# Allowlist approach: flag any secpal.* domain not matching an approved pattern.
# Approved or temporarily tolerated here: secpal.app, changelog.secpal.app, apk.secpal.app,
# secpal.dev (including api/app subdomains), and deprecated-but-allowed
# api.secpal.app (reported separately below).
# This catches unknown domains (e.g. secpal.xyz) that a denylist-only check would miss.
violations=$(printf '%s\n' "$matches" | \
    grep -Ev '(^|[^A-Za-z0-9.-])secpal\.app($|[^A-Za-z0-9._-]|\.[^A-Za-z0-9_-]|\.$)|(^|[^A-Za-z0-9.-])changelog\.secpal\.app($|[^A-Za-z0-9._-]|\.[^A-Za-z0-9_-]|\.$)|(^|[^A-Za-z0-9.-])apk\.secpal\.app($|[^A-Za-z0-9._-]|\.[^A-Za-z0-9_-]|\.$)|(^|[^A-Za-z0-9.-])(\*\.|\.)?([A-Za-z0-9-]+\.)*secpal\.dev(\.[A-Za-z0-9_-]+)*($|[^A-Za-z0-9._-]|\.[^A-Za-z0-9_-]|\.$)|(^|[^A-Za-z0-9.-])api\.secpal\.app($|[^A-Za-z0-9._-]|\.[^A-Za-z0-9_-]|\.$)' | \
    grep -E 'secpal\.' || true)

deprecated_web_hosts=$(printf '%s\n' "$matches" | \
    grep -E 'api\.secpal\.app' | \
    grep -Ev -- 'appId|applicationId|package name|package/application ID|application ID|Android application identifier|Android identifier|Android package ID|identifier-only' | \
    grep -Ev -- 'active web hosts|Deprecated Web Hosts|deprecated_web_hosts|android_application_identifier|validation_rule|package_name|custom_url_scheme' | \
    grep -Ev -- '\./\.github/.*(copilot|instructions)' | \
    grep -Ev -- 'namespace "app\.secpal\.app"|package app\.secpal\.app;|getPackageName\(\)|adb shell monkey -p app\.secpal\.app' | \
    grep -Ev -- 'must not appear as active web hosts|not treated as a deployable web domain' || true)

if [[ -z "$violations" && -z "$deprecated_web_hosts" ]]; then
    echo -e "${GREEN}✅ Domain Policy Check PASSED${NC}"
    echo "All domain usage matches the approved SecPal split"
    exit 0
else
    echo -e "${RED}❌ Domain Policy Check FAILED${NC}"
    echo ""
    if [[ -n "$violations" ]]; then
        echo "Found forbidden domains:"
        echo "$violations"
        echo ""
    fi
    if [[ -n "$deprecated_web_hosts" ]]; then
        echo "Found deprecated .app web-host usage:"
        echo "$deprecated_web_hosts"
        echo ""
    fi
    echo -e "${YELLOW}Policy:${NC}"
    echo "  - secpal.app: public homepage and real email addresses"
    echo "  - changelog.secpal.app: public changelog site"
    echo "  - apk.secpal.app: canonical Android artifact/download host"
    echo "  - api.secpal.dev: live API host"
    echo "  - app.secpal.dev: live PWA/frontend host"
    echo "  - secpal.dev: development, staging, testing, examples"
    echo "  - app.secpal: Android application identifier only"
    echo "  - DEPRECATED as web hosts: api.secpal.app"
    echo "  - FORBIDDEN: secpal.com, secpal.org, secpal.net, secpal.io, secpal.example"
    echo ""
    echo "Fix these violations before committing."
    exit 1
fi
