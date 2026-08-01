// SPDX-FileCopyrightText: 2026 SecPal
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const domainCheckPath = join(scriptDirectory, 'check-domains.sh')

function runDomainCheck(files) {
  const directory = mkdtempSync(join(tmpdir(), 'check-domains-'))

  try {
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(directory, name), contents)
    }

    return spawnSync('bash', [domainCheckPath], {
      cwd: directory,
      encoding: 'utf8',
    })
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

test('rejects the retired changelog host even when documentation cites the checker', () => {
  const result = runDomainCheck({
    'deployment.md':
      'The old host changelog.secpal.app must not be deployed; see scripts/check-domains.sh.\n',
  })

  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stdout, /changelog\.secpal\.app/)
})

test('rejects the retired changelog host when an allowed host shares the line', () => {
  const result = runDomainCheck({
    'migration.md': 'Migrate from changelog.secpal.app to secpal.app.\n',
  })

  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stdout, /changelog\.secpal\.app/)
})
