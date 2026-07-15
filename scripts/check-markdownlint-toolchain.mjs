#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";

import { load as loadYaml } from "js-yaml";

const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function requireInvariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parsePreCommitConfig(preCommitConfig) {
  try {
    return loadYaml(preCommitConfig);
  } catch (error) {
    throw new Error(`could not parse .pre-commit-config.yaml: ${error.message}`, { cause: error });
  }
}

function findHooks(config, hookId) {
  const repositories = Array.isArray(config?.repos) ? config.repos : [];

  return repositories.flatMap((repository) =>
    (Array.isArray(repository?.hooks) ? repository.hooks : [])
      .filter((hook) => hook?.id === hookId)
      .map((hook) => ({ hook, repository: repository.repo })),
  );
}

export function validatePrettierToolchain({ packageJson, packageLock, preCommitConfig }) {
  const declaredPrettierRange = packageJson.devDependencies?.prettier ?? "";
  requireInvariant(
    declaredPrettierRange.length > 0,
    "package.json must declare Prettier in devDependencies.",
  );

  const lockfileDeclaredPrettierRange = packageLock.packages?.[""]?.devDependencies?.prettier ?? "";
  requireInvariant(
    lockfileDeclaredPrettierRange === declaredPrettierRange,
    `package-lock.json root package must match the package.json Prettier declaration ${declaredPrettierRange}, found ${lockfileDeclaredPrettierRange || "missing"}.`,
  );

  const lockedPrettierVersion = packageLock.packages?.["node_modules/prettier"]?.version ?? "";
  requireInvariant(
    EXACT_VERSION_PATTERN.test(lockedPrettierVersion),
    `package-lock.json must resolve node_modules/prettier to an exact version, found ${lockedPrettierVersion || "missing"}.`,
  );

  const config = parsePreCommitConfig(preCommitConfig);
  const repositories = Array.isArray(config?.repos) ? config.repos : [];
  requireInvariant(
    !repositories.some((repository) =>
      String(repository?.repo ?? "").includes("github.com/pre-commit/mirrors-prettier"),
    ),
    ".pre-commit-config.yaml must not use the obsolete mirrors-prettier hook.",
  );

  const prettierHooks = findHooks(config, "prettier");

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

export function validateMarkdownlintToolchain(preCommitConfig) {
  const markdownlintHooks = findHooks(parsePreCommitConfig(preCommitConfig), "markdownlint");

  requireInvariant(
    markdownlintHooks.length > 0,
    "could not locate the markdownlint hook in .pre-commit-config.yaml.",
  );
  requireInvariant(
    markdownlintHooks.length === 1,
    ".pre-commit-config.yaml must define exactly one markdownlint hook.",
  );

  const [{ hook: markdownlintHook, repository }] = markdownlintHooks;
  requireInvariant(
    repository === "local",
    "the markdownlint pre-commit hook must use the repository-local toolchain.",
  );
  requireInvariant(
    markdownlintHook.entry === "node node_modules/markdownlint-cli/markdownlint.js",
    "the markdownlint pre-commit hook must invoke its locked JavaScript entrypoint.",
  );
  requireInvariant(
    markdownlintHook.language === "system",
    "the markdownlint pre-commit hook must use the repository-local toolchain.",
  );
  requireInvariant(
    !Object.hasOwn(markdownlintHook, "additional_dependencies"),
    "the markdownlint pre-commit hook must not install a separate dependency tree.",
  );
  requireInvariant(
    !JSON.stringify(markdownlintHook).includes("npx "),
    "the markdownlint pre-commit hook must not shell out through npx.",
  );
}

export function validateMarkdownlintVersion({ packageJson, packageLock }) {
  const declaredVersion = packageJson.devDependencies?.["markdownlint-cli"] ?? "";
  requireInvariant(
    EXACT_VERSION_PATTERN.test(declaredVersion),
    `package.json must pin markdownlint-cli to an exact version, found ${declaredVersion || "missing"}.`,
  );

  const lockfileDeclaredVersion =
    packageLock.packages?.[""]?.devDependencies?.["markdownlint-cli"] ?? "";
  requireInvariant(
    lockfileDeclaredVersion === declaredVersion,
    `package-lock.json root package must match the package.json pin ${declaredVersion}, found ${lockfileDeclaredVersion || "missing"}.`,
  );

  const lockedPackageVersion =
    packageLock.packages?.["node_modules/markdownlint-cli"]?.version ?? "";
  requireInvariant(
    lockedPackageVersion === declaredVersion,
    `package-lock.json node_modules/markdownlint-cli must match the package.json pin ${declaredVersion}, found ${lockedPackageVersion || "missing"}.`,
  );
}

export function validateSetupScript(setupScript) {
  const rootDirChangeIndex = setupScript.search(/^cd "\$ROOT_DIR"$/m);
  requireInvariant(
    rootDirChangeIndex !== -1,
    "scripts/setup-pre-commit.sh must run from the repository root.",
  );

  const npmCiIndex = setupScript.search(/^npm ci$/m);
  const installHooksIndex = setupScript.search(/^pre-commit install --install-hooks$/m);
  requireInvariant(
    npmCiIndex !== -1 &&
      installHooksIndex !== -1 &&
      rootDirChangeIndex < npmCiIndex &&
      npmCiIndex < installHooksIndex,
    "scripts/setup-pre-commit.sh must run npm ci from the repository root before installing hooks.",
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

try {
  validatePrettierToolchain({ packageJson, packageLock, preCommitConfig });
  validateMarkdownlintVersion({ packageJson, packageLock });
  validateMarkdownlintToolchain(preCommitConfig);
  validateSetupScript(setupScript);
} catch (error) {
  fail(error.message);
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
