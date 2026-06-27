#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";

const EXPECTED_VERSION = "0.49.0";

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const preCommitConfig = readFileSync(
  new URL("../.pre-commit-config.yaml", import.meta.url),
  "utf8",
);
const preflightScript = readFileSync(new URL("../scripts/preflight.sh", import.meta.url), "utf8");

const declaredVersion = packageJson.devDependencies?.["markdownlint-cli"] ?? "";
if (declaredVersion !== EXPECTED_VERSION) {
  fail(
    `package.json must pin markdownlint-cli to ${EXPECTED_VERSION}, found ${declaredVersion || "missing"}.`,
  );
}

const lockfileDeclaredVersion = packageLock.packages?.[""]?.devDependencies?.["markdownlint-cli"] ?? "";
if (lockfileDeclaredVersion !== EXPECTED_VERSION) {
  fail(
    `package-lock.json root package must pin markdownlint-cli to ${EXPECTED_VERSION}, found ${lockfileDeclaredVersion || "missing"}.`,
  );
}

const lockedPackageVersion =
  packageLock.packages?.["node_modules/markdownlint-cli"]?.version ?? "";
if (lockedPackageVersion !== EXPECTED_VERSION) {
  fail(
    `package-lock.json must resolve node_modules/markdownlint-cli to ${EXPECTED_VERSION}, found ${lockedPackageVersion || "missing"}.`,
  );
}

const markdownlintHookPattern =
  /- id: markdownlint\b(?<hook>.*?)(?=\n\s*-\s+id:|\n\s*#\s|\n\s*-\s+repo:|\z)/s;
const hookMatch = preCommitConfig.match(markdownlintHookPattern);

if (!hookMatch?.groups?.hook) {
  fail("could not locate the markdownlint hook in .pre-commit-config.yaml.");
}

const hook = hookMatch.groups.hook;

if (!hook.includes("entry: markdownlint")) {
  fail("the markdownlint pre-commit hook must invoke the markdownlint entrypoint directly.");
}

if (!hook.includes("language: node")) {
  fail("the markdownlint pre-commit hook must use language: node.");
}

if (!hook.includes("additional_dependencies:")) {
  fail("the markdownlint pre-commit hook must declare additional_dependencies.");
}

if (!hook.includes(`- markdownlint-cli@${EXPECTED_VERSION}`)) {
  fail(
    `the markdownlint pre-commit hook must pin additional_dependencies to markdownlint-cli@${EXPECTED_VERSION}.`,
  );
}

if (hook.includes("language: system")) {
  fail("the markdownlint pre-commit hook must not use language: system.");
}

if (hook.includes("npx ")) {
  fail("the markdownlint pre-commit hook must not shell out through npx.");
}

if (!preflightScript.includes("node_modules/.bin/markdownlint")) {
  fail("scripts/preflight.sh must run the local locked node_modules/.bin/markdownlint binary.");
}

if (preflightScript.includes("npx --yes --package markdownlint-cli")) {
  fail("scripts/preflight.sh must not resolve markdownlint-cli through npx --package.");
}
