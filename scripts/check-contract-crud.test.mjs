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
import * as yaml from 'js-yaml'

const guardPath = fileURLToPath(
  new URL('./check-contract-crud.mjs', import.meta.url)
)
const contractPath = fileURLToPath(
  new URL('../docs/openapi.yaml', import.meta.url)
)
const contract = yaml.load(readFileSync(contractPath, 'utf8'), {
  schema: yaml.JSON_SCHEMA,
})

function runGuard(candidate) {
  const directory = mkdtempSync(join(tmpdir(), 'contract-crud-'))
  const candidatePath = join(directory, 'openapi.yaml')

  try {
    writeFileSync(candidatePath, yaml.dump(candidate, { lineWidth: 100 }))
    return spawnSync(process.execPath, [guardPath, candidatePath], {
      encoding: 'utf8',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('accepts the authoritative Contract CRUD contract', () => {
  const result = runGuard(contract)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Contract CRUD OpenAPI guard passed/)
})

test('accepts separately owned adjacent top-level resource surfaces', () => {
  const candidate = structuredClone(contract)
  candidate.paths['/service-bookings'] = { get: { responses: {} } }
  candidate.paths['/internal-cost-centers'] = { get: { responses: {} } }

  const result = runGuard(candidate)

  assert.equal(result.status, 0, result.stderr)
})

test('rejects drift across the Contract CRUD trust boundaries', () => {
  const cases = [
    {
      label: 'extra delete operation',
      diagnostic: /must expose exactly: get, patch/,
      mutate(candidate) {
        candidate.paths['/contracts/{contract}'].delete = { responses: {} }
      },
    },
    {
      label: 'reopen route',
      diagnostic: /only the three canonical paths/,
      mutate(candidate) {
        candidate.paths['/contracts/{contract}/reopen'] = {
          post: { responses: {} },
        }
      },
    },
    {
      label: 'extra list filter',
      diagnostic: /expose only page=1 and per_page=15 pagination/,
      mutate(candidate) {
        candidate.paths['/contracts'].get.parameters.push({
          name: 'status',
          in: 'query',
          schema: { type: 'string' },
        })
      },
    },
    {
      label: 'permission drift',
      diagnostic: /must name exactly the contracts\.retire capability/,
      mutate(candidate) {
        candidate.paths['/contracts/{contract}/retire'].post.description =
          'Retires a Contract and requires `contracts.delete`.'
      },
    },
    {
      label: 'caller-owned lifecycle on create',
      diagnostic: /closed persistence-backed business fields/,
      mutate(candidate) {
        candidate.components.schemas.ContractCreateRequest.properties.status = {
          type: 'string',
        }
      },
    },
    {
      label: 'empty PATCH',
      diagnostic: /PATCH must be partial, non-empty, closed/,
      mutate(candidate) {
        delete candidate.components.schemas.ContractUpdateRequest.minProperties
      },
    },
    {
      label: 'lifecycle field on PATCH',
      diagnostic: /PATCH must be partial, non-empty, closed/,
      mutate(candidate) {
        candidate.components.schemas.ContractUpdateRequest.properties.retired_at =
          {
            type: 'string',
          }
      },
    },
    {
      label: 'unsupported Contract type',
      diagnostic: /ContractType must be exactly/,
      mutate(candidate) {
        candidate.components.schemas.ContractType.enum.push('subscription')
      },
    },
    {
      label: 'unsupported lifecycle state',
      diagnostic: /ContractStatus must be exactly/,
      mutate(candidate) {
        candidate.components.schemas.ContractStatus.enum.push('draft')
      },
    },
    {
      label: 'uncoupled retirement evidence',
      diagnostic: /status must remain coupled/,
      mutate(candidate) {
        delete candidate.components.schemas.Contract.properties.retired_at
          .description
      },
    },
    {
      label: 'active Contract with retirement timestamp',
      diagnostic: /reject active-with-timestamp and retired-with-null/,
      mutate(candidate) {
        candidate.components.schemas.Contract.oneOf[0].properties.retired_at = {
          $ref: '#/components/schemas/ApiTimestamp',
        }
      },
    },
    {
      label: 'retired Contract with null retirement evidence',
      diagnostic: /reject active-with-timestamp and retired-with-null/,
      mutate(candidate) {
        candidate.components.schemas.Contract.oneOf[1].properties.retired_at = {
          type: 'null',
        }
      },
    },
    {
      label: 'unsupported billing unit',
      diagnostic: /BillingUnit must be exactly/,
      mutate(candidate) {
        candidate.components.schemas.BillingUnit.enum.push('shift')
      },
    },
    {
      label: 'binary floating-point price',
      diagnostic: /bounded exact decimal-string representation/,
      mutate(candidate) {
        candidate.components.schemas.ContractUnitPrice = {
          type: 'number',
          format: 'double',
        }
      },
    },
    {
      label: 'widened currency shape',
      diagnostic: /exactly three uppercase ASCII letters/,
      mutate(candidate) {
        candidate.components.schemas.ContractCurrencyCode.pattern =
          '^[A-Za-z]{3}$'
      },
    },
    {
      label: 'tenant leakage',
      diagnostic: /exclude tenant, audit, persistence/,
      mutate(candidate) {
        candidate.components.schemas.Contract.properties.tenant_id = {
          type: 'integer',
        }
      },
    },
    {
      label: 'retirement body',
      diagnostic: /Retirement must be explicit and accept no request body/,
      mutate(candidate) {
        candidate.paths['/contracts/{contract}/retire'].post.requestBody = {
          required: true,
          content: {},
        }
      },
    },
    {
      label: 'nested Service Booking surface',
      diagnostic: /must not absorb Service Booking or Internal Cost Center/,
      mutate(candidate) {
        candidate.paths['/contracts/{contract}/service-bookings'] = {
          get: { responses: {} },
        }
      },
    },
    {
      label: 'existence-revealing 404',
      diagnostic: /information-poor/,
      mutate(candidate) {
        candidate.components.responses.ContractNotFound.description =
          'The requested record does not exist.'
      },
    },
    {
      label: 'history-revealing conflict details',
      diagnostic: /closed neutral envelope without history or persistence/,
      mutate(candidate) {
        candidate.components.schemas.ContractConflictError.additionalProperties = true
        candidate.components.schemas.ContractConflictError.properties.details =
          { type: 'object' }
      },
    },
    {
      label: 'missing historical association conflict',
      diagnostic: /PATCH must document lifecycle, history, price/,
      mutate(candidate) {
        candidate.paths['/contracts/{contract}'].patch.description =
          'Updates an active Contract and requires `contracts.update`.'
      },
    },
  ]

  for (const { label, diagnostic, mutate } of cases) {
    const candidate = structuredClone(contract)
    mutate(candidate)
    const result = runGuard(candidate)

    assert.notEqual(result.status, 0, label)
    assert.match(result.stderr, diagnostic, label)
  }
})
