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

function parseNode(events, eventIndex, source) {
  const event = events[eventIndex]

  if (event.type === yaml.EVENT_SCALAR) {
    return [
      {
        event,
        kind: 'scalar',
        value: yaml.getScalarValue(source, event),
      },
      eventIndex + 1,
    ]
  }

  if (event.type === yaml.EVENT_ALIAS) {
    return [{ kind: 'alias' }, eventIndex + 1]
  }

  if (event.type === yaml.EVENT_MAPPING) {
    const items = []
    let nextIndex = eventIndex + 1

    while (events[nextIndex].type !== yaml.EVENT_POP) {
      const [key, valueIndex] = parseNode(events, nextIndex, source)
      const [value, followingIndex] = parseNode(events, valueIndex, source)
      items.push({ key, value })
      nextIndex = followingIndex
    }

    return [{ items, kind: 'mapping' }, nextIndex + 1]
  }

  if (event.type === yaml.EVENT_SEQUENCE) {
    const items = []
    let nextIndex = eventIndex + 1

    while (events[nextIndex].type !== yaml.EVENT_POP) {
      const [item, followingIndex] = parseNode(events, nextIndex, source)
      items.push(item)
      nextIndex = followingIndex
    }

    return [{ items, kind: 'sequence' }, nextIndex + 1]
  }

  throw new Error(`unsupported YAML event type ${event.type}`)
}

function parseDocument(source) {
  const events = yaml.parseEvents(source)
  const documentIndex = events.findIndex(
    (event) => event.type === yaml.EVENT_DOCUMENT
  )

  if (
    documentIndex === -1 ||
    events[documentIndex + 1].type === yaml.EVENT_POP
  ) {
    return null
  }

  return parseNode(events, documentIndex + 1, source)[0]
}

function mappingValue(node, key) {
  if (node?.kind !== 'mapping') {
    return null
  }

  return (
    node.items.find(
      (item) => item.key.kind === 'scalar' && item.key.value === key
    )?.value ?? null
  )
}

function workflowReferences(document) {
  const jobs = mappingValue(document, 'jobs')

  if (jobs?.kind !== 'mapping') {
    return []
  }

  return jobs.items.flatMap(({ value: job }) => {
    if (job.kind !== 'mapping') {
      return []
    }

    const references = []
    const reusableWorkflow = mappingValue(job, 'uses')
    if (reusableWorkflow) {
      references.push(reusableWorkflow)
    }

    const steps = mappingValue(job, 'steps')
    if (steps?.kind === 'sequence') {
      for (const step of steps.items) {
        const action = mappingValue(step, 'uses')
        if (action) {
          references.push(action)
        }
      }
    }

    return references
  })
}

function sourceComment(source, scalarEvent) {
  const quoted =
    scalarEvent.style === yaml.SCALAR_STYLE_SINGLE_QUOTED ||
    scalarEvent.style === yaml.SCALAR_STYLE_DOUBLE_QUOTED
  const valueEnd = scalarEvent.valueEnd + (quoted ? 1 : 0)
  const newline = source.indexOf('\n', valueEnd)
  const lineEnd = newline === -1 ? source.length : newline
  const suffix = source.slice(valueEnd, lineEnd)

  return /^\s+#\s*([A-Za-z0-9][A-Za-z0-9._/-]*)\s*$/.exec(suffix)?.[1]
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
  let document
  let workflowText
  try {
    workflowText = readFileSync(workflowPath, 'utf8')
    yaml.load(workflowText, { schema: yaml.JSON_SCHEMA })
    document = parseDocument(workflowText)
  } catch (error) {
    fail(`could not parse ${workflowPath}: ${error}`)
  }

  for (const referenceNode of workflowReferences(document)) {
    if (referenceNode.kind !== 'scalar') {
      fail(
        `${workflowPath} uses reference must be an explicit string so its immutable pin and source comment can be verified.`
      )
    }

    const { event, value: reference } = referenceNode
    if (reference.startsWith('./')) {
      continue
    }

    if (!/@[0-9a-f]{40}$/.test(reference)) {
      fail(
        `${workflowPath} external uses reference must end with a lowercase full 40-character commit SHA: ${reference}.`
      )
    }

    if (!sourceComment(workflowText, event)) {
      fail(
        `${workflowPath} external uses reference must retain its source tag or branch in a same-line comment: ${reference}.`
      )
    }
  }
}

console.log('Workflow action pin guard OK.')
