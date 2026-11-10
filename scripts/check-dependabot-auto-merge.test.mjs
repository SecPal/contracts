// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as yaml from 'js-yaml'

test('immutable enrollment reconciles every PR without executing its source', () => {
  const w = yaml.load(
    readFileSync('.github/workflows/dependabot-auto-merge.yml', 'utf8')
  )
  const trigger = w.on.pull_request_target
  assert.equal(trigger?.branches, undefined)
  for (const event of [
    'opened',
    'synchronize',
    'reopened',
    'ready_for_review',
    'labeled',
    'unlabeled',
    'edited',
    'converted_to_draft',
  ])
    assert.ok(trigger.types.includes(event), event)
  assert.equal(w.on.pull_request, undefined)
  assert.equal(w['cache-mode'], 'none')
  assert.equal(w.concurrency['cancel-in-progress'], true)
  const job = w.jobs['auto-merge']
  assert.equal(job.if, undefined)
  assert.equal(
    job.uses.split('@')[0],
    'SecPal/.github/.github/workflows/reusable-dependabot-auto-merge.yml'
  )
  assert.match(job.uses.split('@')[1] ?? '', /^[0-9a-f]{40}$/)
  assert.equal(job.steps, undefined)
  assert.equal(job.secrets, undefined)
  assert.equal(job.with.phase, '2')
  assert.equal(job.with['merge-method'], 'squash')
  assert.equal(job.with['allowed-ecosystems'], 'github_actions,npm_and_yarn')
  assert.deepEqual(w.permissions, {
    contents: 'write',
    'pull-requests': 'write',
    checks: 'read',
    statuses: 'read',
  })
})
