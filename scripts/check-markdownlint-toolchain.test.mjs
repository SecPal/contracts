// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  validateMarkdownlintToolchain,
  validatePrettierToolchain,
  validateSetupScript,
} from "./check-markdownlint-toolchain.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);

const validHook = `---
repos:
  - repo: local
    hooks:
      - id: prettier
        entry: node node_modules/prettier/bin/prettier.cjs
        language: system`;

function validate(preCommitConfig, lockfile = packageLock) {
  validatePrettierToolchain({
    packageJson,
    packageLock: lockfile,
    preCommitConfig,
  });
}

test("accepts the locked repository-local Prettier hook at end of file", () => {
  assert.doesNotThrow(() => validate(validHook));
});

test("rejects additional dependencies after an explanatory comment", () => {
  const config = `${validHook}
        # This dependency would create a separate toolchain.
        additional_dependencies:
          - prettier@3.9.5`;

  assert.throws(() => validate(config), /must not configure a separate npm environment/);
});

test("rejects an unlocked entry even when a comment contains the expected command", () => {
  const config = validHook.replace(
    "entry: node node_modules/prettier/bin/prettier.cjs",
    "entry: npx prettier # entry: node node_modules/prettier/bin/prettier.cjs",
  );

  assert.throws(() => validate(config), /must invoke its locked JavaScript entrypoint/);
});

test("rejects a prefixed hook id", () => {
  const config = validHook.replace("id: prettier", "id: prettier-extra");

  assert.throws(() => validate(config), /could not locate the Prettier hook/);
});

test("rejects a mismatched root lockfile declaration", () => {
  const mismatchedLockfile = structuredClone(packageLock);
  mismatchedLockfile.packages[""].devDependencies.prettier = "^3.9.4";

  assert.throws(
    () => validate(validHook, mismatchedLockfile),
    /package-lock.json root package must declare Prettier as \^3\.9\.5/,
  );
});

test("rejects the obsolete Prettier mirror", () => {
  const config = `---
repos:
  - repo: https://github.com/pre-commit/mirrors-prettier
    rev: v3.0.3
    hooks:
      - id: prettier`;

  assert.throws(() => validate(config), /must not use the obsolete mirrors-prettier hook/);
});

test("accepts the repository-local markdownlint hook at end of file", () => {
  const config = `---
repos:
  - repo: local
    hooks:
      - id: markdownlint
        entry: node node_modules/markdownlint-cli/markdownlint.js
        language: system`;

  assert.doesNotThrow(() => validateMarkdownlintToolchain(config));
});

test("rejects a markdownlint hook with a separate dependency tree", () => {
  const config = `---
repos:
  - repo: local
    hooks:
      - id: markdownlint
        entry: node node_modules/markdownlint-cli/markdownlint.js
        language: system
        additional_dependencies:
          - markdownlint-cli@0.49.1`;

  assert.throws(
    () => validateMarkdownlintToolchain(config),
    /must not install a separate dependency tree/,
  );
});

test("rejects a commented-out repository-root change", () => {
  const setupScript = `#!/usr/bin/env bash
ROOT_DIR="$(git rev-parse --show-toplevel)"
# cd "$ROOT_DIR"
npm ci
pre-commit install --install-hooks`;

  assert.throws(
    () => validateSetupScript(setupScript),
    /must run from the repository root/,
  );
});

test("accepts dependency bootstrap from the repository root", () => {
  const setupScript = `#!/usr/bin/env bash
ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"
npm ci
pre-commit install --install-hooks`;

  assert.doesNotThrow(() => validateSetupScript(setupScript));
});
