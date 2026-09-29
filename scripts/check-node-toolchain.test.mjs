// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict'
import { test } from 'node:test'

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
