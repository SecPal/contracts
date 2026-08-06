#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

function fail(message) {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function workflowPaths(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`

    if (entry.isDirectory()) {
      return workflowPaths(path)
    }

    return /\.ya?ml$/i.test(entry.name) ? [path] : []
  })
}

const workflowDirectory = process.argv[2]
  ? new URL(process.argv[2], `file://${process.cwd()}/`)
  : new URL('../.github/workflows/', import.meta.url)
let workflowDirectoryDisplay = workflowDirectory.href

let paths
try {
  workflowDirectoryDisplay = fileURLToPath(workflowDirectory)
  if (!statSync(workflowDirectoryDisplay).isDirectory()) {
    fail(`${workflowDirectoryDisplay} must be a workflow directory.`)
  }
  paths = workflowPaths(workflowDirectoryDisplay)
} catch (error) {
  fail(`could not read ${workflowDirectoryDisplay}: ${error}`)
}

for (const workflowPath of paths) {
  let workflow
  let workflowText
  try {
    workflowText = readFileSync(workflowPath, 'utf8')
    workflow = yaml.load(workflowText, { schema: yaml.JSON_SCHEMA })
  } catch (error) {
    fail(`could not parse ${workflowPath}: ${error}`)
  }

  const references = []
  function collectUses(value) {
    if (Array.isArray(value)) {
      value.forEach(collectUses)
      return
    }

    if (!value || typeof value !== 'object') {
      return
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if (key === 'uses' && typeof nestedValue === 'string') {
        references.push(nestedValue)
      }
      collectUses(nestedValue)
    }
  }
  collectUses(workflow)

  for (const reference of references.filter(
    (value) => !value.startsWith('./')
  )) {
    const escapedReference = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const referenceLine = new RegExp(
      `^\\s*(?:-\\s+)?uses:\\s*(?:"${escapedReference}"|'${escapedReference}'|${escapedReference})\\s+#\\s*([A-Za-z0-9][A-Za-z0-9._/-]*)\\s*$`,
      'm'
    )

    if (!/@[0-9a-f]{40}$/.test(reference)) {
      fail(
        `${workflowPath} external uses reference must end with a lowercase full 40-character commit SHA: ${reference}.`
      )
    }

    if (!referenceLine.test(workflowText)) {
      fail(
        `${workflowPath} external uses reference must retain its source tag or branch in a same-line comment: ${reference}.`
      )
    }
  }
}

console.log('Workflow action pin guard OK.')
