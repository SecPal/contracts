#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as yaml from 'js-yaml'
import { fileURLToPath } from 'node:url'

const guardPath = fileURLToPath(
  new URL('./check-dependabot-config.mjs', import.meta.url)
)

test('reports the custom path when Dependabot YAML is malformed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'check-dependabot-config-'))
  const configPath = join(directory, 'invalid-dependabot.yml')
  writeFileSync(configPath, 'updates: [\n')

  try {
    const result = spawnSync(process.execPath, [guardPath, configPath], {
      encoding: 'utf8',
    })

    assert.notEqual(result.status, 0, result.stderr || result.stdout)
    assert.ok(result.stderr.includes(configPath), result.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('reports non-file input URLs through the guard error path', () => {
  const configPath = 'https://example.invalid/dependabot.yml'
  const result = spawnSync(process.execPath, [guardPath, configPath], {
    encoding: 'utf8',
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stderr, /^Error: could not parse /)
  assert.ok(result.stderr.includes(configPath), result.stderr)
})

test('remote hook updates stay covered and opt out of central patch auto-merge', () => {
  const config = yaml.load(
    readFileSync(new URL('../.github/dependabot.yml', import.meta.url), 'utf8')
  )
  const hooks = config.updates.filter(
    (entry) => entry['package-ecosystem'] === 'pre-commit'
  )
  assert.equal(hooks.length, 1)
  assert.equal(hooks[0].directory, '/')
  assert.deepEqual(hooks[0].schedule, {
    interval: 'daily',
    time: '04:00',
    timezone: 'Europe/Berlin',
  })
  assert.deepEqual(hooks[0].labels, ['developer-experience', 'dependabot'])
  assert.ok(!JSON.stringify(hooks[0].labels).includes('dependencies'))
})

test('quality uses the reviewed central manifest guard with read-only permissions', () => {
  const quality = yaml.load(
    readFileSync(
      new URL('../.github/workflows/quality.yml', import.meta.url),
      'utf8'
    )
  )
  assert.deepEqual(quality.jobs['dependabot-manifests'], {
    name: 'Dependabot Manifest Guard',
    permissions: { contents: 'read' },
    uses: 'SecPal/.github/.github/workflows/reusable-dependabot-manifest-coverage.yml@80732e29ad253f63fa8c46637f6686c344ce82ad',
  })
  assert.deepEqual(quality.on, {
    pull_request: { branches: ['main'] },
    push: { branches: ['main'] },
  })
})
