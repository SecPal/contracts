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

const workflowPath = process.argv[2]
  ? new URL(process.argv[2], `file://${process.cwd()}/`)
  : new URL('../.github/workflows/pr-size.yml', import.meta.url)
const workflowPathDisplay = fileURLToPath(workflowPath)

let workflow
try {
  workflow = yaml.load(readFileSync(workflowPath, 'utf8'), {
    schema: yaml.JSON_SCHEMA,
  })
} catch (error) {
  fail(`could not parse ${workflowPathDisplay}: ${error}`)
}

const expectedPermissions = {
  contents: 'read',
  'pull-requests': 'read',
}

if (!workflow?.permissions || typeof workflow.permissions !== 'object') {
  fail('.github/workflows/pr-size.yml must define top-level permissions.')
}

if (
  Object.keys(workflow.permissions).length !==
  Object.keys(expectedPermissions).length
) {
  fail(
    '.github/workflows/pr-size.yml must define exactly the required permissions.'
  )
}

for (const [scope, access] of Object.entries(expectedPermissions)) {
  if (workflow.permissions[scope] !== access) {
    fail(
      `.github/workflows/pr-size.yml permissions.${scope} must be ${access}.`
    )
  }
}

for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
  if (job && typeof job === 'object' && Object.hasOwn(job, 'permissions')) {
    fail(
      `.github/workflows/pr-size.yml jobs.${jobName} must not override permissions.`
    )
  }
}

console.log('PR-size workflow permission guard OK.')
