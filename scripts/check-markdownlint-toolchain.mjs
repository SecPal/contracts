#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";

const EXPECTED_MARKDOWNLINT_VERSION = "0.49.0";
const EXPECTED_PRETTIER_RANGE = "^3.9.5";
const EXPECTED_PRETTIER_VERSION = "3.9.5";

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
const setupScript = readFileSync(
  new URL("../scripts/setup-pre-commit.sh", import.meta.url),
  "utf8",
);

const declaredVersion = packageJson.devDependencies?.["markdownlint-cli"] ?? "";
if (declaredVersion !== EXPECTED_MARKDOWNLINT_VERSION) {
  fail(
    `package.json must pin markdownlint-cli to ${EXPECTED_MARKDOWNLINT_VERSION}, found ${declaredVersion || "missing"}.`,
  );
}

const lockfileDeclaredVersion = packageLock.packages?.[""]?.devDependencies?.["markdownlint-cli"] ?? "";
if (lockfileDeclaredVersion !== EXPECTED_MARKDOWNLINT_VERSION) {
  fail(
    `package-lock.json root package must pin markdownlint-cli to ${EXPECTED_MARKDOWNLINT_VERSION}, found ${lockfileDeclaredVersion || "missing"}.`,
  );
}

const lockedPackageVersion =
  packageLock.packages?.["node_modules/markdownlint-cli"]?.version ?? "";
if (lockedPackageVersion !== EXPECTED_MARKDOWNLINT_VERSION) {
  fail(
    `package-lock.json must resolve node_modules/markdownlint-cli to ${EXPECTED_MARKDOWNLINT_VERSION}, found ${lockedPackageVersion || "missing"}.`,
  );
}

const declaredPrettierRange = packageJson.devDependencies?.prettier ?? "";
if (declaredPrettierRange !== EXPECTED_PRETTIER_RANGE) {
  fail(
    `package.json must declare Prettier as ${EXPECTED_PRETTIER_RANGE}, found ${declaredPrettierRange || "missing"}.`,
  );
}

const lockedPrettierVersion = packageLock.packages?.["node_modules/prettier"]?.version ?? "";
if (lockedPrettierVersion !== EXPECTED_PRETTIER_VERSION) {
  fail(
    `package-lock.json must resolve node_modules/prettier to ${EXPECTED_PRETTIER_VERSION}, found ${lockedPrettierVersion || "missing"}.`,
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

const prettierHookPattern =
  /- id: prettier\b(?<hook>.*?)(?=\n\s*-\s+id:|\n\s*#\s|\n\s*-\s+repo:|\z)/s;
const prettierHookMatch = preCommitConfig.match(prettierHookPattern);

if (!prettierHookMatch?.groups?.hook) {
  fail("could not locate the Prettier hook in .pre-commit-config.yaml.");
}

const prettierHook = prettierHookMatch.groups.hook;

if (!prettierHook.includes("entry: node node_modules/prettier/bin/prettier.cjs")) {
  fail("the Prettier pre-commit hook must invoke its locked JavaScript entrypoint.");
}

if (!prettierHook.includes("language: system")) {
  fail("the Prettier pre-commit hook must use the repository-local toolchain.");
}

if (prettierHook.includes("additional_dependencies:") || prettierHook.includes("--ignore-prepublish")) {
  fail("the Prettier pre-commit hook must not configure a separate npm environment.");
}

if (preCommitConfig.includes("github.com/pre-commit/mirrors-prettier")) {
  fail(".pre-commit-config.yaml must not use the obsolete mirrors-prettier hook.");
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
