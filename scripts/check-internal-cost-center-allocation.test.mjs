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
  new URL('./check-internal-cost-center-allocation.mjs', import.meta.url)
)
const contractPath = fileURLToPath(
  new URL('../docs/openapi.yaml', import.meta.url)
)
const contract = yaml.load(readFileSync(contractPath, 'utf8'), {
  schema: yaml.JSON_SCHEMA,
})

function runGuard(candidate) {
  const directory = mkdtempSync(join(tmpdir(), 'internal-cost-center-'))
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

test('accepts the authoritative Internal Cost Center and allocation contract', () => {
  const result = runGuard(contract)

  assert.equal(result.status, 0, result.stderr)
  assert.match(
    result.stdout,
    /Internal Cost Center allocation OpenAPI guard passed/
  )
})

test('rejects drift across Internal Cost Center and allocation trust boundaries', () => {
  const cases = [
    {
      label: 'ambiguous top-level route',
      diagnostic: /ambiguous top-level \/cost-centers path is forbidden/,
      mutate(candidate) {
        candidate.paths['/cost-centers'] = { get: { responses: {} } }
      },
    },
    {
      label: 'Internal Cost Center delete',
      diagnostic: /must expose exactly: get, patch/,
      mutate(candidate) {
        candidate.paths['/internal-cost-centers/{internalCostCenter}'].delete =
          {
            responses: {},
          }
      },
    },
    {
      label: 'reactivation alias',
      diagnostic: /delete and reactivate aliases are forbidden/,
      mutate(candidate) {
        candidate.paths[
          '/internal-cost-centers/{internalCostCenter}/reactivate'
        ] = { post: { responses: {} } }
      },
    },
    {
      label: 'Site CostCenter path drift',
      diagnostic: /existing Site CostCenter paths or schema changed/,
      mutate(candidate) {
        candidate.paths['/sites/{site}/cost-centers'].get.summary =
          'List Internal Cost Centers'
      },
    },
    {
      label: 'Site CostCenter schema reuse',
      diagnostic:
        /responses must use only the explicit InternalCostCenter schema/,
      mutate(candidate) {
        candidate.components.schemas.InternalCostCenterResponse.properties.data =
          {
            $ref: '#/components/schemas/CostCenter',
          }
      },
    },
    {
      label: 'legacy permission reuse',
      diagnostic:
        /must name exactly the internal_cost_centers\.read capability/,
      mutate(candidate) {
        candidate.paths['/internal-cost-centers'].get.description =
          'Requires `cost-centers.read`.'
      },
    },
    {
      label: 'delete capability',
      diagnostic: /six accepted capability names/,
      mutate(candidate) {
        candidate.paths[
          '/internal-cost-centers/{internalCostCenter}/deactivate'
        ].post.description += ' Requires `internal_cost_centers.delete`.'
      },
    },
    {
      label: 'mutable code',
      diagnostic:
        /PATCH must be partial, non-empty, closed, and allow only name/,
      mutate(candidate) {
        candidate.components.schemas.InternalCostCenterUpdateRequest.properties.code =
          { type: 'string' }
      },
    },
    {
      label: 'empty PATCH',
      diagnostic:
        /PATCH must be partial, non-empty, closed, and allow only name/,
      mutate(candidate) {
        delete candidate.components.schemas.InternalCostCenterUpdateRequest
          .minProperties
      },
    },
    {
      label: 'caller-owned lifecycle',
      diagnostic: /exactly required, nonblank, bounded code and name/,
      mutate(candidate) {
        candidate.components.schemas.InternalCostCenterCreateRequest.properties.status =
          { type: 'string' }
      },
    },
    {
      label: 'lifecycle mismatch',
      diagnostic:
        /lifecycle must couple active to null and inactive to a timestamp/,
      mutate(candidate) {
        delete candidate.components.schemas.InternalCostCenter.oneOf
      },
    },
    {
      label: 'duplicated path parameter',
      diagnostic: /must reuse the canonical InternalCostCenterId parameter/,
      mutate(candidate) {
        candidate.paths[
          '/internal-cost-centers/{internalCostCenter}'
        ].patch.parameters = [
          structuredClone(candidate.components.parameters.InternalCostCenterId),
        ]
      },
    },
    {
      label: 'caller-owned response lifecycle',
      diagnostic:
        /identity, lifecycle, and timestamps must be explicitly read-only/,
      mutate(candidate) {
        delete candidate.components.schemas.InternalCostCenter.properties.status
          .readOnly
      },
    },
    {
      label: 'allocation row POST',
      diagnostic: /exactly complete-snapshot GET and PUT/,
      mutate(candidate) {
        candidate.paths[
          '/service-bookings/{serviceBooking}/cost-center-allocations'
        ].post = { responses: {} }
      },
    },
    {
      label: 'allocation row identity',
      diagnostic:
        /contain only Internal Cost Center UUID and integer basis points/,
      mutate(candidate) {
        candidate.components.schemas.CostCenterAllocationItem.properties.id = {
          type: 'string',
          format: 'uuid',
        }
      },
    },
    {
      label: 'floating allocation share',
      diagnostic: /integer basis points from 1 through 10000/,
      mutate(candidate) {
        candidate.components.schemas.CostCenterAllocationItem.properties.share_bps.type =
          'number'
      },
    },
    {
      label: 'zero allocation share',
      diagnostic: /integer basis points from 1 through 10000/,
      mutate(candidate) {
        candidate.components.schemas.CostCenterAllocationItem.properties.share_bps.minimum = 0
      },
    },
    {
      label: 'non-empty collection requirement',
      diagnostic:
        /allow empty, reject duplicate targets, and require exactly 10000 bps/,
      mutate(candidate) {
        candidate.components.schemas.CostCenterAllocationReplacementRequest.properties.allocations.minItems = 1
      },
    },
    {
      label: 'duplicate merging',
      diagnostic: /reject duplicate targets/,
      mutate(candidate) {
        delete candidate.components.schemas
          .CostCenterAllocationReplacementRequest.properties.allocations[
          'x-secpal-unique-by'
        ]
      },
    },
    {
      label: 'sum invariant relaxation',
      diagnostic: /require exactly 10000 bps/,
      mutate(candidate) {
        delete candidate.components.schemas
          .CostCenterAllocationReplacementRequest.properties.allocations[
          'x-secpal-allocation-invariant'
        ]
      },
    },
    {
      label: 'body-injected Service Booking',
      diagnostic: /must require a complete collection/,
      mutate(candidate) {
        candidate.components.schemas.CostCenterAllocationReplacementRequest.properties.service_booking_id =
          { type: 'string', format: 'uuid' }
      },
    },
    {
      label: 'body-injected tenant',
      diagnostic: /must require a complete collection/,
      mutate(candidate) {
        candidate.components.schemas.CostCenterAllocationReplacementRequest.properties.tenant_id =
          { type: 'integer' }
      },
    },
    {
      label: 'monetary allocation',
      diagnostic: /must require a complete collection/,
      mutate(candidate) {
        candidate.components.schemas.CostCenterAllocationReplacementRequest.properties.amount =
          { type: 'string' }
      },
    },
    {
      label: 'Shift coupling',
      diagnostic: /must require a complete collection/,
      mutate(candidate) {
        candidate.components.schemas.CostCenterAllocationReplacementRequest.properties.shift_id =
          { type: 'string', format: 'uuid' }
      },
    },
    {
      label: 'deactivation body',
      diagnostic: /Deactivation must accept no request body/,
      mutate(candidate) {
        candidate.paths[
          '/internal-cost-centers/{internalCostCenter}/deactivate'
        ].post.requestBody = { required: true, content: {} }
      },
    },
    {
      label: 'invoice-state restriction',
      diagnostic:
        /independent from Service Booking invoice and retirement lifecycle/,
      mutate(candidate) {
        candidate.paths[
          '/service-bookings/{serviceBooking}/cost-center-allocations'
        ].put.description = 'Requires `cost_center_allocations.update`.'
      },
    },
    {
      label: 'partial failure exposure',
      diagnostic: /atomic replacement, database-final consistency/,
      mutate(candidate) {
        candidate.paths[
          '/service-bookings/{serviceBooking}/cost-center-allocations'
        ].put.description = candidate.paths[
          '/service-bookings/{serviceBooking}/cost-center-allocations'
        ].put.description.replace(
          'Every failure leaves the original snapshot unchanged.',
          'Partial writes may remain after failure.'
        )
      },
    },
    {
      label: 'historical allocation deletion',
      diagnostic: /preserve history while preventing new allocation/,
      mutate(candidate) {
        candidate.paths[
          '/internal-cost-centers/{internalCostCenter}/deactivate'
        ].post.description = 'Requires `internal_cost_centers.deactivate`.'
      },
    },
    {
      label: 'open conflict envelope',
      diagnostic: /must remain a closed neutral error envelope/,
      mutate(candidate) {
        candidate.components.schemas.CostCenterAllocationConflictError.additionalProperties = true
      },
    },
  ]

  for (const fixture of cases) {
    const candidate = structuredClone(contract)
    fixture.mutate(candidate)
    const result = runGuard(candidate)

    assert.notEqual(result.status, 0, `${fixture.label} was accepted`)
    assert.match(result.stderr, fixture.diagnostic, fixture.label)
  }
})
