#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const guardPath = fileURLToPath(
  new URL('./check-workflow-action-pins.mjs', import.meta.url)
)
const fullSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function runGuard(workflows) {
  const directory = mkdtempSync(join(tmpdir(), 'check-workflow-action-pins-'))

  for (const [name, content] of Object.entries(workflows)) {
    writeFileSync(join(directory, name), content)
  }

  try {
    return spawnSync(process.execPath, [guardPath, directory], {
      encoding: 'utf8',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('accepts the repository workflows', () => {
  const result = spawnSync(process.execPath, [guardPath], { encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr)
})

test('accepts external actions and reusable workflows pinned to full SHAs', () => {
  const result = runGuard({
    'workflow.yml': `jobs:
  action:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${fullSha} # v7
  reusable:
    uses: octo-org/workflows/.github/workflows/check.yml@${fullSha} # main
  local:
    uses: ./.github/workflows/local.yml
`,
  })

  assert.equal(result.status, 0, result.stderr)
})

for (const [name, reference] of [
  ['a mutable major tag', 'actions/checkout@v7 # v7'],
  [
    'a mutable branch',
    'octo-org/workflows/.github/workflows/check.yml@main # main',
  ],
  ['an abbreviated SHA', 'actions/checkout@abcdef0 # v7'],
  ['a reference without a SHA', 'actions/checkout # v7'],
  ['an uppercase SHA', `actions/checkout@${fullSha.toUpperCase()} # v7`],
  ['a missing Dependabot source comment', `actions/checkout@${fullSha}`],
]) {
  test(`rejects ${name}`, () => {
    const result = runGuard({
      'workflow.yml': `jobs:
  action:
    runs-on: ubuntu-latest
    steps:
      - uses: ${reference}
`,
    })

    assert.notEqual(result.status, 0, result.stderr || result.stdout)
  })
}

test('rejects malformed YAML', () => {
  const result = runGuard({ 'workflow.yml': 'jobs: [\n' })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /^Error: could not parse /)
})
