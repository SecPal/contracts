#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const guardPath = fileURLToPath(
  new URL('./check-markdownlint-toolchain.mjs', import.meta.url)
)
const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, 'package.json'), 'utf8')
)
const approvedVersion = packageJson.devDependencies['markdownlint-cli']
const mismatchedVersion = approvedVersion === '0.0.0' ? '0.0.1' : '0.0.0'

function runGuard(packageVersion) {
  const directory = mkdtempSync(join(tmpdir(), 'markdownlint-toolchain-'))
  const packageJsonPath = join(directory, 'package.json')

  cpSync(
    join(repositoryRoot, '.pre-commit-config.yaml'),
    join(directory, '.pre-commit-config.yaml')
  )
  cpSync(join(repositoryRoot, 'scripts'), join(directory, 'scripts'), {
    recursive: true,
  })
  writeFileSync(
    packageJsonPath,
    readFileSync(join(repositoryRoot, 'package.json'), 'utf8').replace(
      `"markdownlint-cli": "${approvedVersion}"`,
      `"markdownlint-cli": "${packageVersion}"`
    )
  )
  cpSync(
    join(repositoryRoot, 'package-lock.json'),
    join(directory, 'package-lock.json')
  )

  try {
    return spawnSync(process.execPath, [guardPath, directory], {
      encoding: 'utf8',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('accepts the approved markdownlint-cli version', () => {
  const result = runGuard(approvedVersion)

  assert.equal(result.status, 0, result.stderr)
})

test('rejects a mismatched markdownlint-cli package pin', () => {
  const result = runGuard(mismatchedVersion)

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(
    result.stderr,
    new RegExp(`package\\.json must pin markdownlint-cli to ${approvedVersion}`)
  )
})
