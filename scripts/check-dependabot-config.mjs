#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

function fail(message) {
  console.error(`Error: ${message}`)
  process.exit(1)
}

const configPath = process.argv[2]
  ? new URL(process.argv[2], `file://${process.cwd()}/`)
  : new URL('../.github/dependabot.yml', import.meta.url)
let configPathDisplay = configPath.href

let config
try {
  configPathDisplay = fileURLToPath(configPath)
  config = yaml.load(readFileSync(configPath, 'utf8'), {
    schema: yaml.JSON_SCHEMA,
  })
} catch (error) {
  fail(`could not parse ${configPathDisplay}: ${error}`)
}

const updates = Array.isArray(config?.updates) ? config.updates : []
const githubActionsUpdate = updates.find(
  (entry) => entry?.['package-ecosystem'] === 'github-actions'
)

if (!githubActionsUpdate) {
  fail('missing github-actions update entry in .github/dependabot.yml.')
}

if (githubActionsUpdate?.['pull-request-branch-name']?.separator !== '-') {
  fail(
    'github-actions pull-request-branch-name.separator must stay set to "-".'
  )
}

const groups = githubActionsUpdate.groups
if (!groups || typeof groups !== 'object') {
  fail('github-actions updates must define readable Dependabot groups.')
}

const expectedGroups = {
  'shared-workflow-pins': ['SecPal/.github*'],
  'github-actions-patch': ['*'],
  'github-actions-minor': ['*'],
  'github-actions-major': ['*'],
}

for (const [name, patterns] of Object.entries(expectedGroups)) {
  const group = groups[name]
  if (!group || !Array.isArray(group.patterns)) {
    fail(`github-actions group "${name}" must define patterns.`)
  }

  if (group.patterns.length !== patterns.length) {
    fail(
      `github-actions group "${name}" must define exactly ${patterns.length} pattern(s).`
    )
  }

  for (const pattern of patterns) {
    if (!group.patterns.includes(pattern)) {
      fail(`github-actions group "${name}" must include pattern "${pattern}".`)
    }
  }
}

for (const kind of ['patch', 'minor', 'major']) {
  const group = groups[`github-actions-${kind}`]
  if (
    JSON.stringify(group['update-types']) !== JSON.stringify([kind]) ||
    JSON.stringify(group['exclude-patterns']) !==
      JSON.stringify(['SecPal/.github*'])
  ) {
    fail(
      `github-actions-${kind} must be homogeneous and exclude shared commit pins.`
    )
  }
}
if (Object.hasOwn(groups['shared-workflow-pins'], 'update-types')) {
  fail('Shared commit pins must remain on their unclassified manual path.')
}

console.log('Dependabot config guard OK.')
