#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import { readFileSync } from "node:fs";
import * as yaml from "js-yaml";

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const configPath = process.argv[2]
  ? new URL(process.argv[2], `file://${process.cwd()}/`)
  : new URL("../.github/dependabot.yml", import.meta.url);

let config;
try {
  config = yaml.load(readFileSync(configPath, "utf8"), {
    schema: yaml.JSON_SCHEMA,
  });
} catch (error) {
  fail(`could not parse .github/dependabot.yml: ${error}`);
}

const updates = Array.isArray(config?.updates) ? config.updates : [];
const githubActionsUpdate = updates.find(
  (entry) => entry?.["package-ecosystem"] === "github-actions",
);

if (!githubActionsUpdate) {
  fail("missing github-actions update entry in .github/dependabot.yml.");
}

if (githubActionsUpdate?.["pull-request-branch-name"]?.separator !== "-") {
  fail('github-actions pull-request-branch-name.separator must stay set to "-".');
}

const groups = githubActionsUpdate.groups;
if (!groups || typeof groups !== "object") {
  fail("github-actions updates must define readable Dependabot groups.");
}

const expectedGroups = {
  "secpal-workflows": ["SecPal/.github*"],
  "github-actions": ["actions/*"],
  "third-party-actions": ["*"],
};

for (const [name, patterns] of Object.entries(expectedGroups)) {
  const group = groups[name];
  if (!group || !Array.isArray(group.patterns)) {
    fail(`github-actions group "${name}" must define patterns.`);
  }

  if (group.patterns.length !== patterns.length) {
    fail(
      `github-actions group "${name}" must define exactly ${patterns.length} pattern(s).`,
    );
  }

  for (const pattern of patterns) {
    if (!group.patterns.includes(pattern)) {
      fail(`github-actions group "${name}" must include pattern "${pattern}".`);
    }
  }
}

const thirdPartyExcludes = groups["third-party-actions"]?.["exclude-patterns"];
if (!Array.isArray(thirdPartyExcludes)) {
  fail('github-actions group "third-party-actions" must define exclude-patterns.');
}

for (const excludedPattern of ["SecPal/.github*", "actions/*"]) {
  if (!thirdPartyExcludes.includes(excludedPattern)) {
    fail(
      `github-actions group "third-party-actions" must exclude "${excludedPattern}".`,
    );
  }
}

console.log("Dependabot config guard OK.");
