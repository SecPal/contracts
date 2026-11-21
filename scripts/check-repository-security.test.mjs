// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
const source = steps.find(
  (step) => step.name === 'Admit main source assessment'
)
const scan = steps.find((step) => step.id === 'repository-security')
const gate = steps.find(
  (step) => step.name === 'Require clean repository security'
)

test('one security job serves the existing caller and the daily and diagnostic events', () => {
  assert.deepEqual(workflow.on, {
    workflow_call: null,
    schedule: [{ cron: '47 2 * * *' }],
    workflow_dispatch: null,
  })
  assert.deepEqual(caller.on, {
    pull_request: { branches: ['main'] },
    push: { branches: ['main'] },
  })
  assert.deepEqual(Object.keys(workflow.jobs), ['openapi-lint'])
  assert.equal(job.if, undefined)
  assert.equal(
    source.if,
    "${{ github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' }}"
  )
  assert.equal(source.shell, 'bash')
  const validation = steps.slice(steps.indexOf(gate) + 1)
  assert.deepEqual(
    validation.map((step) => step.name),
    ['Setup Node.js', 'Install dependencies', 'Validate OpenAPI specification']
  )
  assert.ok(
    validation.every(
      (step) =>
        step.if ===
        "${{ github.event_name != 'schedule' && github.event_name != 'workflow_dispatch' }}"
    )
  )
})

test('scheduled and diagnostic assessment admits protected Contracts main and its exact SHA', (t) => {
  const sha = 'a'.repeat(40)
  const root = mkdtempSync(join(tmpdir(), 'contracts-assessment-'))
  t.after(() => rmSync(root, { recursive: true }))
  const accepted = {
    GITHUB_REPOSITORY: 'SecPal/contracts',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REF_PROTECTED: 'true',
    GITHUB_SHA: sha,
  }
  const rejected = [
    { GITHUB_REPOSITORY: 'other/contracts' },
    { GITHUB_REF: 'refs/heads/candidate' },
    { GITHUB_REF: 'refs/tags/main' },
    { GITHUB_REF_PROTECTED: 'false' },
    { GITHUB_REF_PROTECTED: '' },
    { GITHUB_SHA: 'main' },
    { GITHUB_SHA: 'a'.repeat(39) },
    { GITHUB_SHA: '' },
  ]
  for (const event of ['schedule', 'workflow_dispatch']) {
    for (const [index, changed] of [{}, ...rejected].entries()) {
      const summary = join(root, `${event}-${index}.md`)
      const result = spawnSync('bash', ['-eo', 'pipefail', '-c', source.run], {
        encoding: 'utf8',
        env: {
          ...accepted,
          ...changed,
          GITHUB_EVENT_NAME: event,
          GITHUB_STEP_SUMMARY: summary,
        },
      })
      assert.equal(result.status, index === 0 ? 0 : 1)
      assert.equal(result.stdout, '')
      assert.equal(existsSync(summary), index === 0)
      if (index === 0)
        assert.match(readFileSync(summary, 'utf8'), new RegExp(sha))
    }
  }
})

test('the existing required OpenAPI check scans exact source before dependencies', () => {
  assert.equal(
    caller.jobs['openapi-lint'].uses,
    './.github/workflows/local-openapi-lint.yml'
  )
  assert.equal(caller.jobs['openapi-lint'].name, 'OpenAPI Lint')
  assert.equal(job.name, 'Validate OpenAPI Specification')
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.equal(steps[0], source)
  assert.deepEqual(steps[1].with, {
    ref: '${{ github.sha }}',
    'persist-credentials': false,
  })
  assert.match(
    scan?.uses,
    /^SecPal\/\.github\/\.github\/actions\/trivy-repository-scan@[0-9a-f]{40}$/
  )
  for (const key of ['with', 'env', 'if', 'continue-on-error']) {
    assert.equal(Object.hasOwn(scan, key), false)
  }
  assert.equal(steps.indexOf(scan), 2)
  assert.equal(steps.indexOf(gate), 3)
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
