#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)

function runGuard(manifests, { direct = false } = {}) {
  const repositoryDirectory = mkdtempSync(
    join(tmpdir(), 'check-workflow-action-pins-')
  )
  const githubDirectory = join(repositoryDirectory, '.github')

  for (const [name, content] of Object.entries(manifests)) {
    const relativePath =
      direct || name.includes('/') ? name : `.github/workflows/${name}`
    const path = join(repositoryDirectory, relativePath)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }

  try {
    return spawnSync(
      process.execPath,
      [guardPath, direct ? repositoryDirectory : githubDirectory],
      {
        encoding: 'utf8',
      }
    )
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true })
  }
}

test('runs the pin guard from the lint script used by pull-request CI', () => {
  assert.match(
    packageJson.scripts.prelint,
    /node scripts\/check-workflow-action-pins\.mjs/
  )
})

test('accepts the repository workflows', () => {
  const result = spawnSync(process.execPath, [guardPath], {
    encoding: 'utf8',
  })

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

test('keeps scanning a directly supplied workflow directory', () => {
  const result = runGuard(
    {
      'workflow.yml': `jobs:
  action:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@main
`,
    },
    { direct: true }
  )

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /must end with a lowercase full 40-character/)
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

test('rejects an alias used as the jobs mapping key', () => {
  const result = runGuard({
    'workflow.yml': `env:
  JOBS_KEY: &jobs-key jobs
*jobs-key :
  action:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
`,
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /mapping key must not use a YAML alias/)
})

test('rejects mutable external uses in a composite action manifest', () => {
  const result = runGuard({
    '.github/actions/example/action.yml': `name: Example action
description: Example composite action
runs:
  using: composite
  steps:
    - uses: actions/checkout@main
`,
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /must end with a lowercase full 40-character/)
})

test('accepts pinned external uses in a composite action manifest', () => {
  const result = runGuard({
    '.github/actions/example/action.yml': `name: Example action
description: Example composite action
runs:
  using: composite
  steps:
    - uses: actions/checkout@${fullSha} # v7
`,
  })

  assert.equal(result.status, 0, result.stderr)
})

test('ignores non-action YAML files beside composite action manifests', () => {
  const result = runGuard({
    '.github/actions/example/metadata.yml': `runs:
  steps:
    - uses: actions/checkout@main
`,
  })

  assert.equal(result.status, 0, result.stderr)
})

test('follows referenced local action manifests outside .github/actions', () => {
  const result = runGuard({
    'workflow.yml': `jobs:
  action:
    runs-on: ubuntu-latest
    steps:
      - uses: ./tools/ci
`,
    'tools/ci/action.yml': `name: CI action
description: Example composite action
runs:
  using: composite
  steps:
    - uses: actions/checkout@main
`,
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /must end with a lowercase full 40-character/)
})

test('accepts pinned referenced local actions outside .github/actions', () => {
  const result = runGuard({
    'workflow.yml': `jobs:
  action:
    runs-on: ubuntu-latest
    steps:
      - uses: ./tools/ci
`,
    'tools/ci/action.yml': `name: CI action
description: Example composite action
runs:
  using: composite
  steps:
    - uses: actions/checkout@${fullSha} # v7
`,
  })

  assert.equal(result.status, 0, result.stderr)
})

test('follows nested referenced local action manifests', () => {
  const result = runGuard({
    'workflow.yml': `jobs:
  action:
    runs-on: ubuntu-latest
    steps:
      - uses: ./tools/outer
`,
    'tools/outer/action.yml': `name: Outer action
description: Example composite action
runs:
  using: composite
  steps:
    - uses: ./tools/inner
`,
    'tools/inner/action.yml': `name: Inner action
description: Example composite action
runs:
  using: composite
  steps:
    - uses: actions/checkout@main
`,
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /must end with a lowercase full 40-character/)
})

test('terminates local action reference cycles', () => {
  const result = runGuard({
    'workflow.yml': `jobs:
  action:
    runs-on: ubuntu-latest
    steps:
      - uses: ./tools/one
`,
    'tools/one/action.yml': `name: First action
description: Example composite action
runs:
  using: composite
  steps:
    - uses: ./tools/two
`,
    'tools/two/action.yml': `name: Second action
description: Example composite action
runs:
  using: composite
  steps:
    - uses: ./tools/one
`,
  })

  assert.equal(result.status, 0, result.stderr)
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
