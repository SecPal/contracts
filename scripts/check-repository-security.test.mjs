// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as yaml from 'js-yaml'

const workflow = yaml.load(
  readFileSync(
    new URL('../.github/workflows/local-openapi-lint.yml', import.meta.url),
    'utf8'
  )
)
const caller = yaml.load(
  readFileSync(
    new URL('../.github/workflows/quality.yml', import.meta.url),
    'utf8'
  )
)
const job = workflow.jobs['openapi-lint']
const steps = job.steps
const scan = steps.find((step) => step.id === 'repository-security')
const gate = steps.find(
  (step) => step.name === 'Require clean repository security'
)

test('the existing required OpenAPI check scans exact source before dependencies', () => {
  assert.equal(
    caller.jobs['openapi-lint'].uses,
    './.github/workflows/local-openapi-lint.yml'
  )
  assert.equal(caller.jobs['openapi-lint'].name, 'OpenAPI Lint')
  assert.equal(job.name, 'Validate OpenAPI Specification')
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.deepEqual(steps[0].with, {
    ref: '${{ github.sha }}',
    'persist-credentials': false,
  })
  assert.equal(
    scan?.uses,
    'SecPal/.github/.github/actions/trivy-repository-scan@e89bf9b04bd90bd29b6909994bb7431b56ce5aa2'
  )
  for (const key of ['with', 'env', 'if', 'continue-on-error']) {
    assert.equal(Object.hasOwn(scan, key), false)
  }
  assert.equal(steps.indexOf(scan), 1)
  assert.equal(steps.indexOf(gate), 2)
  assert.equal(gate.if, '${{ always() }}')
  assert.equal(gate.shell, 'bash')
  assert.equal(Object.hasOwn(gate, 'continue-on-error'), false)
  assert.deepEqual(gate.env, {
    SCAN_OUTCOME: '${{ steps.repository-security.outcome }}',
    GATE_STATE: '${{ steps.repository-security.outputs.gate-state }}',
  })
  assert.ok(
    steps.findIndex((step) => step.run === 'npm ci') > steps.indexOf(gate)
  )
  assert.equal(steps.at(-1).run, 'npm run lint')
})

// Execute the workflow's actual admission phase; absent admission does nothing.
function admit(outcome, state) {
  return spawnSync(
    'bash',
    ['--noprofile', '--norc', '-eo', 'pipefail', '-c', gate?.run ?? ''],
    {
      encoding: 'utf8',
      env: { ...process.env, SCAN_OUTCOME: outcome, GATE_STATE: state },
    }
  )
}

test('only successful CLEAN output admits the existing required check', () => {
  for (const outcome of ['success', 'failure', 'cancelled', 'skipped', '']) {
    for (const state of [
      'CLEAN',
      'ACTIONABLE',
      'REVIEW_REQUIRED',
      'UNKNOWN_STALE',
      '',
      'CLEAN;true',
    ]) {
      const result = admit(outcome, state)
      assert.equal(
        result.status === 0,
        outcome === 'success' && state === 'CLEAN',
        outcome + '/' + state
      )
    }
  }
})

test('rejected untrusted state is never printed by the admission command', () => {
  const synthetic = 'synthetic-value-not-a-credential'
  const result = admit('success', synthetic)
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout.includes(synthetic), false)
  assert.equal(result.stderr.includes(synthetic), false)
})
