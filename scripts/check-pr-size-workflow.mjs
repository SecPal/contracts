#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import { readFileSync } from "node:fs";
import * as yaml from "js-yaml";

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const workflowPath = new URL(
  "../.github/workflows/pr-size.yml",
  import.meta.url,
);

let workflow;
try {
  workflow = yaml.load(readFileSync(workflowPath, "utf8"), {
    schema: yaml.JSON_SCHEMA,
  });
} catch (error) {
  fail(`could not parse .github/workflows/pr-size.yml: ${error}`);
}

const expectedPermissions = {
  contents: "read",
  "pull-requests": "read",
};

if (!workflow?.permissions || typeof workflow.permissions !== "object") {
  fail(".github/workflows/pr-size.yml must define top-level permissions.");
}

for (const [scope, access] of Object.entries(expectedPermissions)) {
  if (workflow.permissions[scope] !== access) {
    fail(
      `.github/workflows/pr-size.yml permissions.${scope} must be ${access}.`,
    );
  }
}

console.log("PR-size workflow permission guard OK.");
