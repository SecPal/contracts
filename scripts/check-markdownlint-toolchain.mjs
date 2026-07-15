#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";

import { load as loadYaml } from "js-yaml";

const EXPECTED_MARKDOWNLINT_VERSION = "0.49.0";
const EXPECTED_PRETTIER_RANGE = "^3.9.5";
const EXPECTED_PRETTIER_VERSION = "3.9.5";

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function requireInvariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function validatePrettierToolchain({ packageJson, packageLock, preCommitConfig }) {
  const declaredPrettierRange = packageJson.devDependencies?.prettier ?? "";
  requireInvariant(
    declaredPrettierRange === EXPECTED_PRETTIER_RANGE,
    `package.json must declare Prettier as ${EXPECTED_PRETTIER_RANGE}, found ${declaredPrettierRange || "missing"}.`,
  );

  const lockfileDeclaredPrettierRange = packageLock.packages?.[""]?.devDependencies?.prettier ?? "";
  requireInvariant(
    lockfileDeclaredPrettierRange === EXPECTED_PRETTIER_RANGE,
    `package-lock.json root package must declare Prettier as ${EXPECTED_PRETTIER_RANGE}, found ${lockfileDeclaredPrettierRange || "missing"}.`,
  );

  const lockedPrettierVersion = packageLock.packages?.["node_modules/prettier"]?.version ?? "";
  requireInvariant(
    lockedPrettierVersion === EXPECTED_PRETTIER_VERSION,
    `package-lock.json must resolve node_modules/prettier to ${EXPECTED_PRETTIER_VERSION}, found ${lockedPrettierVersion || "missing"}.`,
  );

  let config;
  try {
    config = loadYaml(preCommitConfig);
  } catch (error) {
    throw new Error(`could not parse .pre-commit-config.yaml: ${error.message}`, { cause: error });
  }

  const repositories = Array.isArray(config?.repos) ? config.repos : [];
  requireInvariant(
    !repositories.some((repository) =>
      String(repository?.repo ?? "").includes("github.com/pre-commit/mirrors-prettier"),
    ),
    ".pre-commit-config.yaml must not use the obsolete mirrors-prettier hook.",
  );

  const prettierHooks = repositories.flatMap((repository) =>
    (Array.isArray(repository?.hooks) ? repository.hooks : [])
      .filter((hook) => hook?.id === "prettier")
      .map((hook) => ({ hook, repository: repository.repo })),
  );

  requireInvariant(
    prettierHooks.length > 0,
    "could not locate the Prettier hook in .pre-commit-config.yaml.",
  );
  requireInvariant(
    prettierHooks.length === 1,
    ".pre-commit-config.yaml must define exactly one Prettier hook.",
  );

  const [{ hook: prettierHook, repository }] = prettierHooks;
  requireInvariant(
    repository === "local",
    "the Prettier pre-commit hook must use the repository-local toolchain.",
  );
  requireInvariant(
    prettierHook.entry === "node node_modules/prettier/bin/prettier.cjs",
    "the Prettier pre-commit hook must invoke its locked JavaScript entrypoint.",
  );
  requireInvariant(
    prettierHook.language === "system",
    "the Prettier pre-commit hook must use the repository-local toolchain.",
  );
  requireInvariant(
    !Object.hasOwn(prettierHook, "additional_dependencies") &&
      !JSON.stringify(prettierHook).includes("--ignore-prepublish"),
    "the Prettier pre-commit hook must not configure a separate npm environment.",
  );
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

const lockfileDeclaredVersion =
  packageLock.packages?.[""]?.devDependencies?.["markdownlint-cli"] ?? "";
if (lockfileDeclaredVersion !== EXPECTED_MARKDOWNLINT_VERSION) {
  fail(
    `package-lock.json root package must pin markdownlint-cli to ${EXPECTED_MARKDOWNLINT_VERSION}, found ${lockfileDeclaredVersion || "missing"}.`,
  );
}

const lockedPackageVersion = packageLock.packages?.["node_modules/markdownlint-cli"]?.version ?? "";
if (lockedPackageVersion !== EXPECTED_MARKDOWNLINT_VERSION) {
  fail(
    `package-lock.json must resolve node_modules/markdownlint-cli to ${EXPECTED_MARKDOWNLINT_VERSION}, found ${lockedPackageVersion || "missing"}.`,
  );
}

try {
  validatePrettierToolchain({ packageJson, packageLock, preCommitConfig });
} catch (error) {
  fail(error.message);
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
