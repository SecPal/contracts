#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const guardPath = fileURLToPath(
  new URL('./check-pr-size-workflow.mjs', import.meta.url)
)

test('accepts the repository workflow', () => {
  const result = spawnSync(process.execPath, [guardPath], { encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr)
})

function runGuard(workflow) {
  const directory = mkdtempSync(join(tmpdir(), 'check-pr-size-workflow-'))
  const workflowPath = join(directory, 'pr-size.yml')
  writeFileSync(workflowPath, workflow)

  try {
    return spawnSync(process.execPath, [guardPath, workflowPath], {
      encoding: 'utf8',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('accepts exactly the required read permissions', () => {
  const result = runGuard(
    `permissions:\n  contents: read\n  pull-requests: read\n`
  )

  assert.equal(result.status, 0, result.stderr)
})

for (const [name, permissions] of [
  ['missing contents', 'pull-requests: read'],
  ['writable contents', 'contents: write\n  pull-requests: read'],
  ['missing pull requests', 'contents: read'],
  ['writable pull requests', 'contents: read\n  pull-requests: write'],
  [
    'an unexpected scope',
    'contents: read\n  pull-requests: read\n  issues: write',
  ],
]) {
  test(`rejects ${name}`, () => {
    const workflow = `permissions:\n  ${permissions.replaceAll('\n', '\n  ')}\n`
    const result = runGuard(workflow)

    assert.notEqual(result.status, 0, result.stderr || result.stdout)
  })
}

test('rejects a PR-size job-level permission override', () => {
  const result = runGuard(`permissions:
  contents: read
  pull-requests: read
jobs:
  pr-size:
    permissions:
      contents: write
`)

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
})

test('rejects a permission override in another job', () => {
  const result = runGuard(`permissions:
  contents: read
  pull-requests: read
jobs:
  pr-size: {}
  unexpected-job:
    permissions:
      issues: write
`)

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
})

test('rejects malformed YAML', () => {
  const directory = mkdtempSync(join(tmpdir(), 'check-pr-size-workflow-'))
  const workflowPath = join(directory, 'invalid-pr-size.yml')
  writeFileSync(workflowPath, 'permissions: [\n')

  try {
    const result = spawnSync(process.execPath, [guardPath, workflowPath], {
      encoding: 'utf8',
    })

    assert.notEqual(result.status, 0, result.stderr || result.stdout)
    assert.match(
      result.stderr,
      new RegExp(workflowPath.replaceAll('\\', '\\\\'))
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
