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
