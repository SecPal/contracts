#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

function fail(message) {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function yamlPaths(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`

    if (entry.isDirectory()) {
      return yamlPaths(path)
    }

    return /\.ya?ml$/i.test(entry.name) ? [path] : []
  })
}

function manifestPaths(githubDirectory) {
  const workflowsDirectory = `${githubDirectory}/workflows`
  const actionsDirectory = `${githubDirectory}/actions`
  const hasWorkflows = existsSync(workflowsDirectory)
  const hasActions = existsSync(actionsDirectory)

  if (!hasWorkflows && !hasActions) {
    return yamlPaths(githubDirectory)
  }

  const workflows = hasWorkflows ? yamlPaths(workflowsDirectory) : []
  const actions = hasActions
    ? yamlPaths(actionsDirectory).filter((path) =>
        /\/action\.ya?ml$/i.test(path)
      )
    : []

  return [...workflows, ...actions]
}

function repositoryDirectory(githubDirectory) {
  if (basename(githubDirectory) === '.github') {
    return dirname(githubDirectory)
  }

  if (
    basename(githubDirectory) === 'workflows' &&
    basename(dirname(githubDirectory)) === '.github'
  ) {
    return dirname(dirname(githubDirectory))
  }

  return dirname(githubDirectory)
}

function localActionManifest(repositoryRoot, reference, sourcePath) {
  const actionDirectory = resolve(repositoryRoot, reference)
  const repositoryRelativePath = relative(repositoryRoot, actionDirectory)

  if (
    isAbsolute(repositoryRelativePath) ||
    repositoryRelativePath === '..' ||
    repositoryRelativePath.startsWith(`..${sep}`)
  ) {
    fail(
      `${sourcePath} local action reference escapes the repository: ${reference}.`
    )
  }

  const candidates = ['action.yml', 'action.yaml']
    .map((name) => `${actionDirectory}/${name}`)
    .filter((path) => existsSync(path) && statSync(path).isFile())

  if (candidates.length !== 1) {
    fail(
      `${sourcePath} local action reference must resolve to exactly one action.yml or action.yaml manifest: ${reference}.`
    )
  }

  return candidates[0]
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

function aliasKeyReference(node, context) {
  if (
    node?.kind === 'mapping' &&
    node.items.some(({ key }) => key.kind === 'alias')
  ) {
    return { context, kind: 'alias-key' }
  }

  return null
}

function stepReferences(steps) {
  if (steps?.kind === 'alias') {
    return [{ context: 'steps', kind: 'alias-container' }]
  }

  if (steps?.kind !== 'sequence') {
    return []
  }

  return steps.items.flatMap((step) => {
    if (step.kind === 'alias') {
      return [{ context: 'step', kind: 'alias-container' }]
    }

    if (step.kind !== 'mapping') {
      return []
    }

    const aliasKey = aliasKeyReference(step, 'step')
    if (aliasKey) {
      return [aliasKey]
    }

    const action = mappingValue(step, 'uses')
    return action ? [{ ...action, referenceKind: 'action' }] : []
  })
}

function workflowReferences(document) {
  const jobs = mappingValue(document, 'jobs')

  if (jobs?.kind === 'alias') {
    return [{ context: 'jobs', kind: 'alias-container' }]
  }

  if (jobs?.kind !== 'mapping') {
    return []
  }

  return jobs.items.flatMap(({ value: job }) => {
    if (job.kind === 'alias') {
      return [{ context: 'job', kind: 'alias-container' }]
    }

    if (job.kind !== 'mapping') {
      return []
    }

    const aliasKey = aliasKeyReference(job, 'job')
    if (aliasKey) {
      return [aliasKey]
    }

    const references = []
    const reusableWorkflow = mappingValue(job, 'uses')
    if (reusableWorkflow) {
      references.push({ ...reusableWorkflow, referenceKind: 'workflow' })
    }

    const steps = mappingValue(job, 'steps')
    references.push(...stepReferences(steps))

    return references
  })
}

function compositeActionReferences(document) {
  const runs = mappingValue(document, 'runs')

  if (runs?.kind === 'alias') {
    return [{ context: 'runs', kind: 'alias-container' }]
  }

  if (runs?.kind !== 'mapping') {
    return []
  }

  const aliasKey = aliasKeyReference(runs, 'composite action')
  if (aliasKey) {
    return [aliasKey]
  }

  return stepReferences(mappingValue(runs, 'steps'))
}

function manifestReferences(document) {
  const aliasKey = aliasKeyReference(document, 'document')
  if (aliasKey) {
    return [aliasKey]
  }

  return [
    ...workflowReferences(document),
    ...compositeActionReferences(document),
  ]
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

const githubDirectory = process.argv[2]
  ? new URL(process.argv[2], `file://${process.cwd()}/`)
  : new URL('../.github/', import.meta.url)
let githubDirectoryDisplay = githubDirectory.href

let paths
let repositoryRoot
try {
  githubDirectoryDisplay = fileURLToPath(githubDirectory)
  if (!statSync(githubDirectoryDisplay).isDirectory()) {
    fail(`${githubDirectoryDisplay} must be a GitHub configuration directory.`)
  }
  paths = manifestPaths(githubDirectoryDisplay)
  repositoryRoot = repositoryDirectory(githubDirectoryDisplay)
} catch (error) {
  fail(`could not read ${githubDirectoryDisplay}: ${error}`)
}

const pendingPaths = [...paths]
const visitedPaths = new Set()

for (let pathIndex = 0; pathIndex < pendingPaths.length; pathIndex += 1) {
  const manifestPath = pendingPaths[pathIndex]
  if (visitedPaths.has(manifestPath)) {
    continue
  }
  visitedPaths.add(manifestPath)

  let document
  let manifestText
  try {
    manifestText = readFileSync(manifestPath, 'utf8')
    yaml.load(manifestText, { schema: yaml.JSON_SCHEMA })
    document = parseDocument(manifestText)
  } catch (error) {
    fail(`could not parse ${manifestPath}: ${error}`)
  }

  for (const referenceNode of manifestReferences(document)) {
    if (referenceNode.kind === 'alias-container') {
      fail(
        `${manifestPath} ${referenceNode.context} must not use a YAML alias because external uses references cannot be verified.`
      )
    }

    if (referenceNode.kind === 'alias-key') {
      fail(
        `${manifestPath} ${referenceNode.context} mapping key must not use a YAML alias because external uses references cannot be verified.`
      )
    }

    if (referenceNode.kind !== 'scalar') {
      fail(
        `${manifestPath} uses reference must be an explicit string so its immutable pin and source comment can be verified.`
      )
    }

    const { event, value: reference } = referenceNode
    if (reference.startsWith('./')) {
      if (referenceNode.referenceKind === 'action') {
        const localManifest = localActionManifest(
          repositoryRoot,
          reference,
          manifestPath
        )
        if (!visitedPaths.has(localManifest)) {
          pendingPaths.push(localManifest)
        }
      }
      continue
    }

    if (!/@[0-9a-f]{40}$/.test(reference)) {
      fail(
        `${manifestPath} external uses reference must end with a lowercase full 40-character commit SHA: ${reference}.`
      )
    }

    if (!sourceComment(manifestText, event)) {
      fail(
        `${manifestPath} external uses reference must retain its source tag or branch in a same-line comment: ${reference}.`
      )
    }
  }
}

console.log('GitHub action pin guard OK.')
