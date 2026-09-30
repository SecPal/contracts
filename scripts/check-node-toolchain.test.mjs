// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { validateNodeToolchain } from './check-node-toolchain.mjs'

const valid = {
  runtimeVersion: 'v26.10.0',
  nvmrc: '26\n',
  packageJson: { engines: { node: '^26.0.0' } },
  packageLock: { packages: { '': { engines: { node: '^26.0.0' } } } },
  workflows: {
    'local-prettier.yml': {
      jobs: {
        prettier: {
          steps: [
            {
              uses: 'actions/setup-node@1234567890123456789012345678901234567890',
              with: { 'node-version': '26' },
            },
          ],
        },
      },
    },
    'local-openapi-lint.yml': {
      jobs: {
        lint: {
          steps: [
            {
              uses: 'actions/setup-node@1234567890123456789012345678901234567890',
              with: { 'node-version': '26' },
            },
          ],
        },
      },
    },
  },
}

test('Node 26 toolchain accepts coherent selectors', () => {
  assert.doesNotThrow(() => validateNodeToolchain(valid))
})

test('Node 26 toolchain rejects runtime and engine drift', () => {
  for (const change of [
    { runtimeVersion: 'v24.15.0' },
    { nvmrc: '24\n' },
    { packageJson: { engines: { node: '>=26' } } },
    { packageLock: { packages: { '': { engines: { node: '^24.0.0' } } } } },
  ]) {
    assert.throws(() => validateNodeToolchain({ ...valid, ...change }))
  }
})

test('Node 26 toolchain discovers new workflow selectors', () => {
  const workflows = structuredClone(valid.workflows)
  workflows['extra.yml'] = {
    jobs: {
      extra: {
        steps: [
          {
            uses: 'actions/setup-node@1234567890123456789012345678901234567890',
            with: { 'node-version': '24' },
          },
        ],
      },
    },
  }
  assert.throws(() => validateNodeToolchain({ ...valid, workflows }))
})

test('Node 26 toolchain rejects missing required workflow selectors', () => {
  const workflows = structuredClone(valid.workflows)
  workflows['local-prettier.yml'].jobs.prettier.steps = []
  assert.throws(() => validateNodeToolchain({ ...valid, workflows }))
})

test('workflow files must be regular before they are read', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'secpal-node-toolchain-'))
  const workflows = join(fixture, '.github', 'workflows')
  const script = join(fixture, 'scripts', 'check-node-toolchain.mjs')
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

  try {
    mkdirSync(workflows, { recursive: true })
    mkdirSync(dirname(script))
    copyFileSync(
      join(repositoryRoot, 'scripts', 'check-node-toolchain.mjs'),
      script
    )
    symlinkSync(
      join(repositoryRoot, 'node_modules'),
      join(fixture, 'node_modules'),
      'dir'
    )
    writeFileSync(join(fixture, '.nvmrc'), '26\n')
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify(valid.packageJson)
    )
    writeFileSync(
      join(fixture, 'package-lock.json'),
      JSON.stringify(valid.packageLock)
    )

    const pinnedWorkflow = `jobs:\n  lint:\n    steps:\n      - uses: actions/setup-node@${'1'.repeat(40)}\n        with:\n          node-version: '26'\n`
    writeFileSync(join(workflows, 'local-prettier.yml'), pinnedWorkflow)
    writeFileSync(join(workflows, 'local-openapi-lint.yml'), pinnedWorkflow)
    writeFileSync(join(workflows, 'extra.yaml'), 'jobs: {}\n')

    const runGuard = () =>
      spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 5000 })
    assert.equal(runGuard().status, 0, 'regular .yml and .yaml files load')

    const pipe = join(fixture, 'unread-target')
    assert.equal(spawnSync('mkfifo', [pipe]).status, 0)
    for (const name of ['probe.yml', 'probe.yaml']) {
      const link = join(workflows, name)
      symlinkSync(pipe, link)
      const result = runGuard()
      assert.equal(
        result.error,
        undefined,
        `${name} target must never be opened`
      )
      assert.equal(result.status, 1)
      assert.ok(result.stderr.includes(`${name} must be a regular file`))
      rmSync(link)
    }

    const workflowPipe = join(workflows, 'probe.yml')
    assert.equal(spawnSync('mkfifo', [workflowPipe]).status, 0)
    const pipeResult = runGuard()
    assert.equal(pipeResult.error, undefined, 'FIFO must never be opened')
    assert.equal(pipeResult.status, 1)
    assert.ok(pipeResult.stderr.includes('probe.yml must be a regular file'))
    rmSync(workflowPipe)

    mkdirSync(join(workflows, 'probe.yaml'))
    const result = runGuard()
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /probe\.yaml must be a regular file/)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
