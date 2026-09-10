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
  new URL('./check-service-booking-crud.mjs', import.meta.url)
)
const contractPath = fileURLToPath(
  new URL('../docs/openapi.yaml', import.meta.url)
)
const contract = yaml.load(readFileSync(contractPath, 'utf8'), {
  schema: yaml.JSON_SCHEMA,
})

function runGuard(candidate) {
  const directory = mkdtempSync(join(tmpdir(), 'service-booking-crud-'))
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

test('accepts the authoritative Service Booking CRUD contract', () => {
  const result = runGuard(contract)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Service Booking CRUD OpenAPI guard passed/)
})

test('rejects drift across Service Booking trust boundaries', () => {
  const cases = [
    {
      label: 'delete operation',
      diagnostic: /must expose exactly: get, patch/,
      mutate(candidate) {
        candidate.paths['/service-bookings/{serviceBooking}'].delete = {
          responses: {},
        }
      },
    },
    {
      label: 'invoice route',
      diagnostic:
        /only its three canonical paths plus the allocation extension/,
      mutate(candidate) {
        candidate.paths['/service-bookings/{serviceBooking}/invoice'] = {
          post: { responses: {} },
        }
      },
    },
    {
      label: 'allocation route',
      diagnostic:
        /only its three canonical paths plus the allocation extension/,
      mutate(candidate) {
        candidate.paths['/service-bookings/{serviceBooking}/allocations'] = {
          get: { responses: {} },
        }
      },
    },
    {
      label: 'permission drift',
      diagnostic: /must name exactly the service_bookings\.retire capability/,
      mutate(candidate) {
        candidate.paths[
          '/service-bookings/{serviceBooking}/retire'
        ].post.description =
          'Retires a booking and requires `service_bookings.delete`.'
      },
    },
    {
      label: 'tenant injection',
      diagnostic: /exactly the five required caller-owned booking facts/,
      mutate(candidate) {
        candidate.components.schemas.ServiceBookingCreateRequest.properties.tenant_id =
          { type: 'integer' }
      },
    },
    {
      label: 'total injection',
      diagnostic: /exactly the five required caller-owned booking facts/,
      mutate(candidate) {
        candidate.components.schemas.ServiceBookingCreateRequest.properties.total =
          { type: 'string' }
      },
    },
    {
      label: 'empty PATCH',
      diagnostic: /PATCH must be partial, non-empty, closed/,
      mutate(candidate) {
        delete candidate.components.schemas.ServiceBookingUpdateRequest
          .minProperties
      },
    },
    {
      label: 'Contract reassignment',
      diagnostic: /exclude contract and server-owned fields/,
      mutate(candidate) {
        candidate.components.schemas.ServiceBookingUpdateRequest.properties.contract_id =
          { type: 'string', format: 'uuid' }
      },
    },
    {
      label: 'binary floating-point quantity',
      diagnostic: /positive bounded exact decimal string/,
      mutate(candidate) {
        candidate.components.schemas.ServiceBookingQuantity = {
          type: 'number',
          format: 'double',
        }
      },
    },
    {
      label: 'duplicated price semantics',
      diagnostic: /reuse ContractUnitPrice/,
      mutate(candidate) {
        candidate.components.schemas.ServiceBooking.properties.unit_price = {
          type: 'string',
        }
      },
    },
    {
      label: 'caller-rounded total',
      diagnostic: /read-only PostgreSQL-derived exact two-decimal string/,
      mutate(candidate) {
        candidate.components.schemas.ServiceBookingTotal.description =
          'A caller-calculated decimal amount.'
      },
    },
    {
      label: 'billing unit drift',
      diagnostic: /exact BillingUnit closed set/,
      mutate(candidate) {
        candidate.components.schemas.BillingUnit.enum.push('shift')
      },
    },
    {
      label: 'invoice state drift',
      diagnostic: /InvoiceState must be exactly/,
      mutate(candidate) {
        candidate.components.schemas.InvoiceState.enum.push('paid')
      },
    },
    {
      label: 'lifecycle drift',
      diagnostic: /ServiceBookingStatus must be exactly/,
      mutate(candidate) {
        candidate.components.schemas.ServiceBookingStatus.enum.push('deleted')
      },
    },
    {
      label: 'Shift coupling',
      diagnostic: /exclude tenant, Shift, allocation/,
      mutate(candidate) {
        candidate.components.schemas.ServiceBooking.properties.shift_id = {
          type: 'string',
          format: 'uuid',
        }
      },
    },
    {
      label: 'allocation coupling',
      diagnostic: /exclude tenant, Shift, allocation/,
      mutate(candidate) {
        candidate.components.schemas.ServiceBooking.properties.allocations = {
          type: 'array',
        }
      },
    },
    {
      label: 'invoice PATCH field',
      diagnostic: /exclude contract and server-owned fields/,
      mutate(candidate) {
        candidate.components.schemas.ServiceBookingUpdateRequest.properties.invoice_state =
          { type: 'string' }
      },
    },
    {
      label: 'caller-owned currency response field',
      diagnostic: /response-only values must use canonical/,
      mutate(candidate) {
        delete candidate.components.schemas.ServiceBooking.properties
          .currency_code.readOnly
      },
    },
    {
      label: 'invoiced conflict applied to retirement',
      diagnostic: /conflict examples must apply truthfully/,
      mutate(candidate) {
        candidate.components.responses.ServiceBookingConflict.content[
          'application/json'
        ].examples.invoiced = {
          value: {
            message: 'The Service Booking is invoiced.',
            code: 'CONFLICT',
          },
        }
      },
    },
    {
      label: 'retirement body',
      diagnostic: /Retirement must accept no request body/,
      mutate(candidate) {
        candidate.paths[
          '/service-bookings/{serviceBooking}/retire'
        ].post.requestBody = { required: true, content: {} }
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
