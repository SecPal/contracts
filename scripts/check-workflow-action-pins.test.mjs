#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const guardPath = fileURLToPath(
  new URL('./check-workflow-action-pins.mjs', import.meta.url)
)
const fullSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const dependabotAutoMergeWorkflow = readFileSync(
  new URL('../.github/workflows/dependabot-auto-merge.yml', import.meta.url),
  'utf8'
)

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
  quoted:
    runs-on: ubuntu-latest
    steps:
      - uses: 'actions/checkout@${fullSha}' # v7
      - uses: "actions/setup-node@${fullSha}" # v7
`,
  })

  assert.equal(result.status, 0, result.stderr)
})

test('accepts unrelated uses keys outside jobs and steps', () => {
  const result = runGuard({
    'workflow.yml': `env:
  uses: ordinary-environment-value
jobs:
  action:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`,
  })

  assert.equal(result.status, 0, result.stderr)
})

test('keeps the Dependabot auto-merge workflow on the v1 release channel', () => {
  assert.match(
    dependabotAutoMergeWorkflow,
    /reusable-dependabot-auto-merge\.yml@[0-9a-f]{40} # v1$/m
  )
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

test('rejects an uncommented duplicate of a documented reference', () => {
  const result = runGuard({
    'workflow.yml': `jobs:
  action:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${fullSha} # v7
      - uses: actions/checkout@${fullSha}
`,
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /must retain its source tag or branch/)
})

test('rejects a source comment spoofed inside a block scalar', () => {
  const result = runGuard({
    'workflow.yml': `jobs:
  action:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${fullSha}
      - run: |
          uses: actions/checkout@${fullSha} # v7
`,
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /must retain its source tag or branch/)
})

test('rejects an aliased uses value that bypasses literal pin inspection', () => {
  const result = runGuard({
    'workflow.yml': `env:
  ACTION: &checkout actions/checkout@v7
jobs:
  action:
    runs-on: ubuntu-latest
    steps:
      - uses: *checkout
`,
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /uses reference must be an explicit string/)
})

test('rejects an aliased job that bypasses job traversal', () => {
  const result = runGuard({
    'workflow.yml': `job-template: &job
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v7
jobs:
  action: *job
`,
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /job must not use a YAML alias/)
})

test('rejects an aliased jobs mapping that bypasses job traversal', () => {
  const result = runGuard({
    'workflow.yml': `job-templates: &jobs
  action:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
jobs: *jobs
`,
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /jobs must not use a YAML alias/)
})

test('rejects an aliased steps sequence that bypasses step traversal', () => {
  const result = runGuard({
    'workflow.yml': `step-template: &steps
  - uses: actions/checkout@v7
jobs:
  action:
    runs-on: ubuntu-latest
    steps: *steps
`,
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /steps must not use a YAML alias/)
})

test('rejects an aliased step that bypasses uses traversal', () => {
  const result = runGuard({
    'workflow.yml': `step-template: &step
  uses: actions/checkout@v7
jobs:
  action:
    runs-on: ubuntu-latest
    steps:
      - *step
`,
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /step must not use a YAML alias/)
})

test('rejects one trailing comment shared by flow-style references', () => {
  const result = runGuard({
    'workflow.yml': `on: push
jobs: { one: { uses: octo-org/workflows/.github/workflows/check.yml@${fullSha} }, two: { uses: octo-org/workflows/.github/workflows/check.yml@${fullSha} } } # main
`,
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /must retain its source tag or branch/)
})
