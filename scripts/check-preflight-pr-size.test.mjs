#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const preflightPath = join(repositoryRoot, 'scripts/preflight.sh')

function run(directory, command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: directory,
    encoding: 'utf8',
    ...options,
  })
}

function runPreflight(directory) {
  return run(directory, 'bash', ['scripts/preflight.sh'], {
    env: {
      ...process.env,
      PATH: `${join(directory, 'bin')}:/usr/bin:/bin`,
    },
  })
}

test('reports advisory PR size after filtering valid exclusions by path', () => {
  const directory = mkdtempSync(join(tmpdir(), 'contracts-pr-size-advisory-'))

  try {
    mkdirSync(join(directory, 'scripts'))
    mkdirSync(join(directory, 'bin'))
    mkdirSync(join(directory, 'node_modules/.bin'), { recursive: true })
    copyFileSync(preflightPath, join(directory, 'scripts/preflight.sh'))

    for (const command of ['npx', 'npm', 'reuse']) {
      const stubPath = join(directory, 'bin', command)
      writeFileSync(stubPath, '#!/usr/bin/env bash\nexit 0\n')
      chmodSync(stubPath, 0o755)
    }
    const markdownlint = join(directory, 'node_modules/.bin/markdownlint')
    writeFileSync(markdownlint, '#!/usr/bin/env bash\nexit 0\n')
    chmodSync(markdownlint, 0o755)

    for (const [args, message] of [
      [['init', '--quiet', '--initial-branch=main'], 'initialize fixture'],
      [['config', 'user.name', 'SecPal Test'], 'configure fixture user'],
      [['config', 'user.email', 'test@secpal.dev'], 'configure fixture email'],
      [['config', 'commit.gpgSign', 'false'], 'disable fixture signing'],
    ]) {
      assert.equal(run(directory, 'git', args).status, 0, message)
    }
    writeFileSync(join(directory, 'seed.txt'), '')
    assert.equal(run(directory, 'git', ['add', '.']).status, 0)
    assert.equal(
      run(directory, 'git', ['commit', '--quiet', '-m', 'seed']).status,
      0
    )
    assert.equal(
      run(directory, 'git', ['remote', 'add', 'origin', directory]).status,
      0
    )
    assert.equal(
      run(directory, 'git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
        .status,
      0
    )
    assert.equal(
      run(directory, 'git', [
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
        'refs/remotes/origin/main',
      ]).status,
      0
    )
    assert.equal(
      run(directory, 'git', ['checkout', '--quiet', '-b', 'test-branch'])
        .status,
      0
    )

    writeFileSync(
      join(directory, 'large.txt'),
      Array.from({ length: 601 }, (_, index) => `line ${index + 1}`).join(
        '\n'
      ) + '\n'
    )
    assert.equal(run(directory, 'git', ['add', 'large.txt']).status, 0)
    assert.equal(
      run(directory, 'git', ['commit', '--quiet', '-m', 'large change']).status,
      0
    )

    const oversized = runPreflight(directory)
    assert.equal(oversized.status, 0, oversized.stderr || oversized.stdout)
    assert.match(
      oversized.stderr,
      /PR size: 601 changed lines \(601 insertions, 0 deletions; advisory threshold: 600\)/
    )
    assert.match(
      oversized.stderr,
      /WARNING: PR size advisory threshold exceeded\./
    )

    writeFileSync(join(directory, '.preflight-exclude'), '[\n')
    const invalidExclusion = runPreflight(directory)
    assert.equal(
      invalidExclusion.status,
      0,
      invalidExclusion.stderr || invalidExclusion.stdout
    )
    assert.match(invalidExclusion.stderr, /contains invalid regex pattern\(s\)/)
    assert.match(invalidExclusion.stderr, /PR size: 601 changed lines/)

    mkdirSync(join(directory, 'LICENSES'))
    writeFileSync(
      join(directory, 'LICENSES/license.txt'),
      Array.from({ length: 601 }, (_, index) => `license ${index + 1}`).join(
        '\n'
      ) + '\n'
    )
    assert.equal(
      run(directory, 'git', ['add', 'LICENSES/license.txt']).status,
      0
    )
    assert.equal(
      run(directory, 'git', ['commit', '--quiet', '-m', 'license fixture'])
        .status,
      0
    )
    writeFileSync(
      join(directory, '.preflight-exclude'),
      '^LICENSES/.*\\.txt$\n'
    )

    const anchoredExclusion = runPreflight(directory)
    assert.equal(
      anchoredExclusion.status,
      0,
      anchoredExclusion.stderr || anchoredExclusion.stdout
    )
    assert.match(anchoredExclusion.stderr, /PR size: 601 changed lines/)
    assert.match(
      anchoredExclusion.stderr,
      /WARNING: PR size advisory threshold exceeded\./
    )

    writeFileSync(join(directory, '.preflight-exclude'), '.*\n')
    const allExcluded = runPreflight(directory)
    assert.equal(
      allExcluded.status,
      0,
      allExcluded.stderr || allExcluded.stdout
    )
    assert.match(
      allExcluded.stdout,
      /Preflight OK · PR size: 0 changed lines \(0 insertions, 0 deletions; advisory threshold: 600\)/
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
