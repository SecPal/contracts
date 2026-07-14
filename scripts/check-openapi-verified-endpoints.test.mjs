#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const guardPath = fileURLToPath(
  new URL('./check-openapi-verified-endpoints.mjs', import.meta.url)
)
const contractPath = fileURLToPath(
  new URL('../docs/openapi.yaml', import.meta.url)
)
const contract = readFileSync(contractPath, 'utf8')

function runGuard(source) {
  const directory = mkdtempSync(join(tmpdir(), 'verified-endpoints-'))
  const candidatePath = join(directory, 'openapi.yaml')
  writeFileSync(candidatePath, source)

  try {
    return spawnSync(process.execPath, [guardPath, candidatePath], {
      encoding: 'utf8',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('accepts the repository contract', () => {
  const result = runGuard(contract)

  assert.equal(result.status, 0, result.stderr)
})

test('rejects organizational-unit boolean filters without numeric wire encoding', () => {
  const candidate = contract.replaceAll(
    'Query-string values must be `1` for `true` and `0` for `false`; textual `true` and `false` are not accepted.',
    'Filter by independent administrative status.'
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects organizational-unit boolean filters without both numeric wire values', () => {
  const candidate = contract.replaceAll("value: '0'", "value: '1'")
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('accepts schema-valid nullable example fields', () => {
  const candidate = contract.replaceAll(
    '              name: ACME Corporation GmbH\n',
    '              name: ACME Corporation GmbH\n              contact: null\n'
  )
  const result = runGuard(candidate)

  assert.equal(result.status, 0, result.stderr)
})

test('rejects non-UUID Legal Entity assignment examples', () => {
  const candidate = contract.replaceAll(
    "legal_entity_id: '770e8400-e29b-41d4-a716-446655440002'",
    'legal_entity_id: not-a-uuid'
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects contradictory accepted and rejected Legal Entity IDs', () => {
  const candidate = contract.replaceAll(
    "legal_entity_id: '770e8400-e29b-41d4-a716-446655440002'",
    "legal_entity_id: '770e8400-e29b-41d4-a716-446655440000'"
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

for (const [kind, legalEntityId] of [
  ['accepted', '770e8400-e29b-41d4-a716-446655440000'],
  ['rejected', '770e8400-e29b-41d4-a716-446655440002'],
]) {
  test(`reports malformed ${kind} assignment examples without throwing`, () => {
    const candidate = contract.replaceAll(
      `            value:\n              legal_entity_id: '${legalEntityId}'`,
      `            malformed_value:\n              legal_entity_id: '${legalEntityId}'`
    )
    const result = runGuard(candidate)

    assert.equal(result.status, 1, result.stderr)
    assert.doesNotMatch(result.stderr, /TypeError/)
  })
}

test('compares Legal Entity UUIDs case-insensitively', () => {
  const candidate = contract.replaceAll(
    "legal_entity_id: '770e8400-e29b-41d4-a716-446655440002'",
    "legal_entity_id: '770E8400-E29B-41D4-A716-446655440000'"
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects malformed tenant metadata', () => {
  const candidate = contract.replaceAll(
    "legal_entity_tenant_id: '660e8400-e29b-41d4-a716-446655440002'",
    'legal_entity_tenant_id: not-a-uuid'
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('compares tenant UUIDs case-insensitively', () => {
  const candidate = contract.replaceAll(
    "legal_entity_tenant_id: '660e8400-e29b-41d4-a716-446655440002'",
    "legal_entity_tenant_id: '660E8400-E29B-41D4-A716-446655440001'"
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects assignment examples missing required request fields', () => {
  const candidate = contract.replaceAll('              billing_address:\n', '')
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects assignment examples with invalid required field types', () => {
  const candidate = contract.replaceAll(
    '              name: ACME Corporation GmbH',
    '              name: null'
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects assignment examples that violate nested request schemas', () => {
  const candidate = contract.replaceAll(
    '                country: DE',
    '                country: 123'
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})
