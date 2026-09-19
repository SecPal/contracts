#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  checkNodeToolchain,
  parseNodeEngine,
  satisfiesNodeEngine,
} from './check-node-toolchain.mjs'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

function withFixture(mutate, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'check-node-toolchain-'))
  mkdirSync(join(directory, '.github', 'workflows'), { recursive: true })
  cpSync(join(repositoryRoot, 'package.json'), join(directory, 'package.json'))
  cpSync(join(repositoryRoot, '.nvmrc'), join(directory, '.nvmrc'))
  cpSync(
    join(repositoryRoot, '.github', 'workflows'),
    join(directory, '.github', 'workflows'),
    { recursive: true }
  )
  try {
    mutate(directory)
    callback(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('accepts the repository Node toolchain contract', () => {
  assert.doesNotThrow(() => checkNodeToolchain(repositoryRoot, process.version))
})

test('keeps both adjacent Node majors outside the caret contract', () => {
  const packageJson = JSON.parse(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf8')
  )
  const engine = parseNodeEngine(packageJson.engines.node)
  const [major, minor, patch] = engine.minimum

  assert.equal(
    satisfiesNodeEngine(`${major - 1}.${minor}.${patch}`, engine),
    false
  )
  assert.equal(satisfiesNodeEngine(`${major}.${minor}.${patch}`, engine), true)
  assert.equal(satisfiesNodeEngine(`${major + 1}.0.0`, engine), false)
})

test('enforces the engine contract through the repository guard', () => {
  withFixture(
    () => {},
    (directory) => {
      const packageJson = JSON.parse(
        readFileSync(join(directory, 'package.json'), 'utf8')
      )
      const engine = parseNodeEngine(packageJson.engines.node)
      const incompatibleRuntime = `v${engine.minimum[0] - 1}.0.0`
      assert.throws(
        () => checkNodeToolchain(directory, incompatibleRuntime),
        /does not satisfy engines.node/
      )
    }
  )
})

test('rejects an nvm major that differs from engines.node', () => {
  withFixture(
    (directory) => {
      const packageJson = JSON.parse(
        readFileSync(join(directory, 'package.json'), 'utf8')
      )
      const engine = parseNodeEngine(packageJson.engines.node)
      writeFileSync(join(directory, '.nvmrc'), `${engine.minimum[0] - 1}\n`)
    },
    (directory) => {
      assert.throws(
        () => checkNodeToolchain(directory, process.version),
        /\.nvmrc must select/
      )
    }
  )
})

test('rejects any directly owned workflow with an incompatible selector', () => {
  withFixture(
    (directory) => {
      const packageJson = JSON.parse(
        readFileSync(join(directory, 'package.json'), 'utf8')
      )
      const engine = parseNodeEngine(packageJson.engines.node)
      writeFileSync(
        join(directory, '.github', 'workflows', 'incompatible-node.yml'),
        `jobs:\n  validation:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # test\n        with:\n          node-version: '${engine.minimum[0] - 1}'\n`
      )
    },
    (directory) => {
      assert.throws(
        () => checkNodeToolchain(directory, process.version),
        /selector is incompatible/
      )
    }
  )
})

test('rejects a same-major workflow selector below the engine minimum', () => {
  withFixture(
    (directory) => {
      const packageJson = JSON.parse(
        readFileSync(join(directory, 'package.json'), 'utf8')
      )
      const engine = parseNodeEngine(packageJson.engines.node)
      const [major, minor, patch] = engine.minimum
      const belowMinimum =
        minor > 0 ? `${major}.${minor - 1}.999` : `${major}.0.${patch - 1}`
      writeFileSync(
        join(directory, '.github', 'workflows', 'below-minimum-node.yml'),
        `jobs:\n  validation:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # test\n        with:\n          node-version: '${belowMinimum}'\n`
      )
    },
    (directory) => {
      assert.throws(
        () => checkNodeToolchain(directory, process.version),
        /selector is incompatible/
      )
    }
  )
})

test('rejects selectors whose resolution may escape the engine contract', () => {
  const packageJson = JSON.parse(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf8')
  )
  const engine = parseNodeEngine(packageJson.engines.node)
  const [major, minor, patch] = engine.minimum
  const belowMinimum =
    minor > 0 ? `${major}.${minor - 1}.999` : `${major}.0.${patch - 1}`
  const incompatibleSelectors = [
    `${major}`,
    `${major}.x`,
    belowMinimum,
    `${major - 1}.${minor}.${patch}`,
    `${major + 1}.${minor}.${patch}`,
    undefined,
    `${major}.not-a-version`,
  ]

  for (const selector of incompatibleSelectors) {
    withFixture(
      (directory) => {
        const selectorLine =
          selector === undefined
            ? ''
            : `          node-version: '${selector}'\n`
        writeFileSync(
          join(directory, '.github', 'workflows', 'selector-boundary.yml'),
          `jobs:\n  validation:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # test\n        with:\n${selectorLine}`
        )
      },
      (directory) => {
        assert.throws(
          () => checkNodeToolchain(directory, process.version),
          /setup-node selector/
        )
      }
    )
  }
})

test('accepts compatible selectors without workflow-count snapshots', () => {
  withFixture(
    (directory) => {
      const packageJson = JSON.parse(
        readFileSync(join(directory, 'package.json'), 'utf8')
      )
      const engine = parseNodeEngine(packageJson.engines.node)
      const minimum = engine.minimum.join('.')
      writeFileSync(
        join(directory, '.github', 'workflows', 'compatible-range.yml'),
        `jobs:\n  validation:\n    runs-on: ubuntu-latest\n    steps:\n      - with:\n          node-version: '${engine.range}'\n        uses: actions/setup-node@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # test\n`
      )
      writeFileSync(
        join(directory, '.github', 'workflows', 'compatible-exact.yml'),
        `jobs:\n  validation:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # test\n        with:\n          node-version: '${minimum}'\n`
      )
    },
    (directory) => {
      assert.doesNotThrow(() => checkNodeToolchain(directory, process.version))
    }
  )
})

test('rejects a range that silently admits later Node majors', () => {
  const packageJson = JSON.parse(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf8')
  )
  const engine = parseNodeEngine(packageJson.engines.node)

  assert.throws(
    () => parseNodeEngine(`>=${engine.minimum.join('.')}`),
    /single caret range/
  )
})
