#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

function fail(message) {
  throw new Error(message)
}

export function parseNodeEngine(value) {
  const match = /^(\^(\d+)\.(\d+)\.(\d+))$/.exec(value ?? '')
  if (!match) {
    fail('package.json engines.node must be a single caret range')
  }

  const [, range, major, minor, patch] = match
  if (Number(major) === 0) {
    fail('package.json engines.node must describe a stable Node major')
  }

  return {
    range,
    minimum: [Number(major), Number(minor), Number(patch)],
  }
}

export function satisfiesNodeEngine(version, engine) {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return false

  const candidate = match.slice(1).map(Number)
  const [major, minor, patch] = engine.minimum
  if (candidate[0] !== major) return false
  if (candidate[1] !== minor) return candidate[1] > minor
  return candidate[2] >= patch
}

function workflowFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => join(directory, entry.name))
}

function workflowSteps(document) {
  const jobs = document?.jobs
  if (!jobs || typeof jobs !== 'object') return []
  return Object.values(jobs).flatMap((job) =>
    Array.isArray(job?.steps) ? job.steps : []
  )
}

function selectorMajor(value, path) {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value !== 'string') {
    fail(`${path} has a non-string setup-node selector`)
  }
  const match = /^(\d+)(?:\.x|\.\d+(?:\.\d+)?)?$/.exec(value)
  if (!match) fail(`${path} has an unsupported setup-node selector: ${value}`)
  return Number(match[1])
}

export function checkNodeToolchain(repositoryRoot, runtime = process.version) {
  const root = resolve(repositoryRoot)
  const packageJson = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8')
  )
  const engine = parseNodeEngine(packageJson.engines?.node)
  const canonicalMajor = engine.minimum[0]

  const nvmrc = readFileSync(join(root, '.nvmrc'), 'utf8').trim()
  if (!/^\d+$/.test(nvmrc) || Number(nvmrc) !== canonicalMajor) {
    fail('.nvmrc must select the Node major derived from engines.node')
  }

  const workflowsDirectory = join(root, '.github', 'workflows')
  for (const path of workflowFiles(workflowsDirectory)) {
    if (!statSync(path).isFile()) continue
    const document = load(readFileSync(path, 'utf8'))
    for (const step of workflowSteps(document)) {
      if (
        typeof step?.uses !== 'string' ||
        !step.uses.startsWith('actions/setup-node@')
      ) {
        continue
      }
      const selector = step.with?.['node-version']
      if (selectorMajor(selector, basename(path)) !== canonicalMajor) {
        fail(
          `${basename(path)} setup-node selector is incompatible with engines.node`
        )
      }
    }
  }

  if (!satisfiesNodeEngine(runtime, engine)) {
    fail(`Node ${runtime} does not satisfy engines.node ${engine.range}`)
  }
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isMain) {
  try {
    checkNodeToolchain(process.argv[2] ?? process.cwd())
  } catch (error) {
    console.error(`Error: ${error.message}`)
    process.exitCode = 1
  }
}
