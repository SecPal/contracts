#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_VERSION = "0.49.1";
const repositoryRoot = resolve(
  process.argv[2] ?? fileURLToPath(new URL("../", import.meta.url)),
);

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(`${repositoryRoot}/package.json`, "utf8"));
const packageLock = JSON.parse(
  readFileSync(`${repositoryRoot}/package-lock.json`, "utf8"),
);
const preCommitConfig = readFileSync(`${repositoryRoot}/.pre-commit-config.yaml`, "utf8");
const preflightScript = readFileSync(`${repositoryRoot}/scripts/preflight.sh`, "utf8");
const setupScript = readFileSync(`${repositoryRoot}/scripts/setup-pre-commit.sh`, "utf8");

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

if (!hook.includes("entry: node node_modules/markdownlint-cli/markdownlint.js")) {
  fail("the markdownlint pre-commit hook must invoke its locked JavaScript entrypoint.");
}

if (!hook.includes("language: system")) {
  fail("the markdownlint pre-commit hook must use the repository-local toolchain.");
}

if (hook.includes("additional_dependencies:")) {
  fail("the markdownlint pre-commit hook must not install a separate dependency tree.");
}

if (hook.includes("npx ")) {
  fail("the markdownlint pre-commit hook must not shell out through npx.");
}

if (!preCommitConfig.includes("entry: node node_modules/prettier/bin/prettier.cjs")) {
  fail("the Prettier pre-commit hook must invoke its locked JavaScript entrypoint.");
}

if (!setupScript.includes('cd "$ROOT_DIR"')) {
  fail("scripts/setup-pre-commit.sh must run from the repository root.");
}

const npmCiIndex = setupScript.search(/^npm ci$/m);
const installHooksIndex = setupScript.search(/^pre-commit install --install-hooks$/m);
if (npmCiIndex === -1 || installHooksIndex === -1 || npmCiIndex > installHooksIndex) {
  fail("scripts/setup-pre-commit.sh must run npm ci before installing hooks.");
}

if (!preflightScript.includes("node_modules/.bin/markdownlint")) {
  fail("scripts/preflight.sh must run the local locked node_modules/.bin/markdownlint binary.");
}

if (preflightScript.includes("npx --yes --package markdownlint-cli")) {
  fail("scripts/preflight.sh must not resolve markdownlint-cli through npx --package.");
}

if (!preflightScript.includes("ensure_markdownlint_dependencies()")) {
  fail(
    "scripts/preflight.sh must centralize markdownlint bootstrap in an ensure_markdownlint_dependencies helper.",
  );
}

if (!preflightScript.includes("ensure_markdownlint_dependencies\n")) {
  fail(
    "scripts/preflight.sh must only install Node dependencies for markdownlint when the local binary is missing.",
  );
}
