#!/bin/bash
# SPDX-FileCopyrightText: 2025 SecPal Contributors
# SPDX-License-Identifier: AGPL-3.0-or-later

set -e

# Check if .license-policy.json exists
if [ ! -f .license-policy.json ]; then
  echo "No .license-policy.json found, skipping license check."
  exit 0
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
  echo "Error: jq is required but not installed!" >&2
  exit 1
fi

# Validate JSON is well-formed
if ! jq empty .license-policy.json > /dev/null 2>&1; then
  echo "Error: .license-policy.json is malformed (invalid JSON)." >&2
  exit 1
fi

# Check for allowedLicenses key
if ! jq -e 'has("allowedLicenses") and (.allowedLicenses != null)' .license-policy.json > /dev/null 2>&1; then
  echo "Error: 'allowedLicenses' key is missing or null in .license-policy.json." >&2
  exit 1
fi

# Verify allowedLicenses array is not empty (Bug fix: use length check instead of join result)
if [ "$(jq -r '.allowedLicenses | length' .license-policy.json)" -eq 0 ]; then
  echo "Error: 'allowedLicenses' array is empty in .license-policy.json." >&2
  exit 1
fi

ALLOWED=$(jq -r '.allowedLicenses | join(";")' .license-policy.json)

npx license-checker --production --onlyAllow "$ALLOWED" --summary
