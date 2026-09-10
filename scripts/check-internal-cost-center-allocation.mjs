#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import * as yaml from 'js-yaml'

const target = process.argv[2]
if (!target) {
  console.error(
    'Usage: node scripts/check-internal-cost-center-allocation.mjs <path-to-openapi.yaml>'
  )
  process.exit(2)
}

let document
try {
  document = yaml.load(fs.readFileSync(path.resolve(target), 'utf8'), {
    schema: yaml.JSON_SCHEMA,
  })
} catch (error) {
  console.error(`Unable to parse Internal Cost Center candidate: ${target}`)
  console.error(error)
  process.exit(2)
}

const paths = document?.paths ?? {}
const schemas = document?.components?.schemas ?? {}
const parameters = document?.components?.parameters ?? {}
const errors = []
const HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
])
const INTERNAL_PATHS = new Map([
  ['/internal-cost-centers', ['get', 'post']],
  ['/internal-cost-centers/{internalCostCenter}', ['get', 'patch']],
  ['/internal-cost-centers/{internalCostCenter}/deactivate', ['post']],
])
const ALLOCATION_PATH =
  '/service-bookings/{serviceBooking}/cost-center-allocations'
const SITE_PATHS = [
  '/sites/{site}/cost-centers',
  '/sites/{site}/cost-centers/{costCenter}',
]
const SITE_COST_CENTER_BASELINE =
  '0419840fe205601716adcb961d27cd33417066754fc91478f7bc9726e2718be6'
const NONBLANK_PATTERN = '.*\\S.*'

function rejectUnless(condition, message) {
  if (!condition) errors.push(message)
}

function operationMethods(pathItem) {
  return Object.keys(pathItem ?? {}).filter((key) => HTTP_METHODS.has(key))
}

function exactKeys(value, expected) {
  return isDeepStrictEqual(
    Object.keys(value ?? {}).sort(),
    [...expected].sort()
  )
}

function exactRequired(schema, expected) {
  return isDeepStrictEqual(
    [...(schema?.required ?? [])].sort(),
    [...expected].sort()
  )
}

function schemaRef(operation, status, component) {
  return (
    operation?.responses?.[status]?.content?.['application/json']?.schema
      ?.$ref === `#/components/schemas/${component}`
  )
}

function requestRef(operation, component) {
  return (
    operation?.requestBody?.required === true &&
    operation?.requestBody?.content?.['application/json']?.schema?.$ref ===
      `#/components/schemas/${component}`
  )
}

function responseRef(operation, status, component) {
  return (
    operation?.responses?.[status]?.$ref ===
    `#/components/responses/${component}`
  )
}

function containsPropertyName(value, forbidden) {
  if (!value || typeof value !== 'object') return false
  if (Object.keys(value.properties ?? {}).some((key) => forbidden.has(key))) {
    return true
  }
  return [
    ...Object.values(value.properties ?? {}),
    value.items,
    ...(value.allOf ?? []),
    ...(value.oneOf ?? []),
    ...(value.anyOf ?? []),
  ].some((child) => containsPropertyName(child, forbidden))
}

function mentionedPermissions(operation) {
  return [
    ...(operation?.description ?? '').matchAll(/`([a-z_-]+\.[a-z_]+)`/g),
  ].map((match) => match[1])
}

for (const [pathKey, methods] of INTERNAL_PATHS) {
  rejectUnless(paths[pathKey], `Missing Internal Cost Center path: ${pathKey}`)
  rejectUnless(
    isDeepStrictEqual(
      operationMethods(paths[pathKey]).sort(),
      [...methods].sort()
    ),
    `${pathKey} must expose exactly: ${methods.join(', ')}`
  )
}

rejectUnless(
  isDeepStrictEqual(
    Object.keys(paths)
      .filter((pathKey) => pathKey.startsWith('/internal-cost-centers'))
      .sort(),
    [...INTERNAL_PATHS.keys()].sort()
  ),
  'Internal Cost Centers must expose only the three canonical paths and five operations; delete and reactivate aliases are forbidden.'
)

rejectUnless(
  !paths['/cost-centers'],
  'The ambiguous top-level /cost-centers path is forbidden.'
)
rejectUnless(
  paths[ALLOCATION_PATH] &&
    isDeepStrictEqual(operationMethods(paths[ALLOCATION_PATH]).sort(), [
      'get',
      'put',
    ]),
  'Service Booking allocations must expose exactly complete-snapshot GET and PUT.'
)

const siteBaseline = {
  paths: Object.fromEntries(
    SITE_PATHS.map((pathKey) => [pathKey, paths[pathKey]])
  ),
  schema: schemas.CostCenter,
}
const siteDigest = crypto
  .createHash('sha256')
  .update(JSON.stringify(siteBaseline))
  .digest('hex')
rejectUnless(
  siteDigest === SITE_COST_CENTER_BASELINE,
  'The existing Site CostCenter paths or schema changed.'
)

const operations = {
  list: paths['/internal-cost-centers']?.get,
  create: paths['/internal-cost-centers']?.post,
  inspect: paths['/internal-cost-centers/{internalCostCenter}']?.get,
  update: paths['/internal-cost-centers/{internalCostCenter}']?.patch,
  deactivate:
    paths['/internal-cost-centers/{internalCostCenter}/deactivate']?.post,
  inspectAllocations: paths[ALLOCATION_PATH]?.get,
  replaceAllocations: paths[ALLOCATION_PATH]?.put,
}
const operationContracts = {
  list: [
    'listInternalCostCenters',
    'internal_cost_centers.read',
    '200',
    'InternalCostCenterCollectionResponse',
    'Internal Cost Centers',
  ],
  create: [
    'createInternalCostCenter',
    'internal_cost_centers.create',
    '201',
    'InternalCostCenterResponse',
    'Internal Cost Centers',
  ],
  inspect: [
    'getInternalCostCenter',
    'internal_cost_centers.read',
    '200',
    'InternalCostCenterResponse',
    'Internal Cost Centers',
  ],
  update: [
    'updateInternalCostCenter',
    'internal_cost_centers.update',
    '200',
    'InternalCostCenterResponse',
    'Internal Cost Centers',
  ],
  deactivate: [
    'deactivateInternalCostCenter',
    'internal_cost_centers.deactivate',
    '200',
    'InternalCostCenterResponse',
    'Internal Cost Centers',
  ],
  inspectAllocations: [
    'getServiceBookingCostCenterAllocations',
    'cost_center_allocations.read',
    '200',
    'ServiceBookingCostCenterAllocationResponse',
    'Cost Center Allocations',
  ],
  replaceAllocations: [
    'replaceServiceBookingCostCenterAllocations',
    'cost_center_allocations.update',
    '200',
    'ServiceBookingCostCenterAllocationResponse',
    'Cost Center Allocations',
  ],
}

for (const [name, contract] of Object.entries(operationContracts)) {
  const [operationId, permission, status, responseSchema, tag] = contract
  const operation = operations[name]
  rejectUnless(
    operation?.operationId === operationId,
    `${name} must use operationId ${operationId}.`
  )
  rejectUnless(
    isDeepStrictEqual(mentionedPermissions(operation), [permission]),
    `${name} must name exactly the ${permission} capability.`
  )
  rejectUnless(
    isDeepStrictEqual(operation?.security, [{ BearerAuth: [] }]),
    `${name} must require BearerAuth.`
  )
  rejectUnless(
    isDeepStrictEqual(operation?.tags, [tag]),
    `${name} must use only the ${tag} tag.`
  )
  const successes = Object.keys(operation?.responses ?? {}).filter(
    (candidate) => /^2\d\d$/.test(candidate)
  )
  rejectUnless(
    isDeepStrictEqual(successes, [status]) &&
      schemaRef(operation, status, responseSchema),
    `${name} must return only ${status} with ${responseSchema}.`
  )
}

const exactPermissions = [
  'cost_center_allocations.read',
  'cost_center_allocations.update',
  'internal_cost_centers.create',
  'internal_cost_centers.deactivate',
  'internal_cost_centers.read',
  'internal_cost_centers.update',
]
rejectUnless(
  isDeepStrictEqual(
    [
      ...new Set(Object.values(operations).flatMap(mentionedPermissions)),
    ].sort(),
    exactPermissions
  ),
  'The new surfaces must define exactly the six accepted capability names.'
)

rejectUnless(
  isDeepStrictEqual(
    (operations.list?.parameters ?? []).map((parameter) => parameter?.name),
    ['page', 'per_page']
  ) &&
    operations.list.parameters[0]?.schema?.minimum === 1 &&
    operations.list.parameters[0]?.schema?.default === 1 &&
    operations.list.parameters[1]?.schema?.minimum === 1 &&
    operations.list.parameters[1]?.schema?.maximum === 100 &&
    operations.list.parameters[1]?.schema?.default === 15,
  'Internal Cost Center list must expose only page=1 and per_page=15 pagination with a maximum of 100.'
)
rejectUnless(
  /created_at DESC.*id DESC/s.test(operations.list?.description ?? ''),
  'Internal Cost Center list ordering must be created_at DESC then id DESC.'
)

rejectUnless(
  parameters.InternalCostCenterId?.name === 'internalCostCenter' &&
    parameters.InternalCostCenterId?.in === 'path' &&
    parameters.InternalCostCenterId?.required === true &&
    parameters.InternalCostCenterId?.schema?.type === 'string' &&
    parameters.InternalCostCenterId?.schema?.format === 'uuid' &&
    ['inspect', 'update', 'deactivate'].every((name) =>
      isDeepStrictEqual(operations[name]?.parameters, [
        { $ref: '#/components/parameters/InternalCostCenterId' },
      ])
    ),
  'Internal Cost Center item operations must reuse the canonical InternalCostCenterId parameter.'
)

rejectUnless(
  requestRef(operations.create, 'InternalCostCenterCreateRequest'),
  'Create must use InternalCostCenterCreateRequest.'
)
rejectUnless(
  requestRef(operations.update, 'InternalCostCenterUpdateRequest'),
  'PATCH must use InternalCostCenterUpdateRequest.'
)
rejectUnless(
  !operations.deactivate?.requestBody,
  'Deactivation must accept no request body.'
)
rejectUnless(
  requestRef(
    operations.replaceAllocations,
    'CostCenterAllocationReplacementRequest'
  ),
  'Allocation PUT must accept the complete replacement collection.'
)
rejectUnless(
  /permitted when the booking is invoiced or retired/.test(
    operations.replaceAllocations?.description ?? ''
  ) &&
    /does not modify commercial facts, total, invoice evidence, or retirement state/.test(
      operations.replaceAllocations?.description ?? ''
    ),
  'Allocation replacement must remain independent from Service Booking invoice and retirement lifecycle.'
)
rejectUnless(
  /PostgreSQL owns the final transaction-complete invariant/.test(
    operations.replaceAllocations?.description ?? ''
  ) &&
    /never exposes an intermediate split or promises last-write-wins/.test(
      operations.replaceAllocations?.description ?? ''
    ) &&
    /Every failure leaves the original snapshot unchanged/.test(
      operations.replaceAllocations?.description ?? ''
    ),
  'Allocation PUT must promise atomic replacement, database-final consistency, neutral conflict, and rollback on failure.'
)
rejectUnless(
  /Existing historical allocations remain intact/.test(
    operations.deactivate?.description ?? ''
  ) &&
    /inactive center cannot receive a new or reassigned allocation/.test(
      operations.deactivate?.description ?? ''
    ),
  'Deactivation must preserve history while preventing new allocation to inactive centers.'
)

const center = schemas.InternalCostCenter
rejectUnless(
  center?.type === 'object' &&
    center?.additionalProperties === false &&
    exactKeys(center?.properties, [
      'id',
      'code',
      'name',
      'status',
      'inactive_at',
      'created_at',
      'updated_at',
    ]) &&
    exactRequired(center, [
      'id',
      'code',
      'name',
      'status',
      'inactive_at',
      'created_at',
      'updated_at',
    ]),
  'InternalCostCenter must be closed and expose exactly the seven accepted fields.'
)
rejectUnless(
  isDeepStrictEqual(schemas.InternalCostCenterStatus?.enum, [
    'active',
    'inactive',
  ]) &&
    center?.oneOf?.length === 2 &&
    center.oneOf[0]?.properties?.status?.const === 'active' &&
    center.oneOf[0]?.properties?.inactive_at?.type === 'null' &&
    center.oneOf[1]?.properties?.status?.const === 'inactive' &&
    center.oneOf[1]?.properties?.inactive_at?.$ref ===
      '#/components/schemas/ApiTimestamp',
  'InternalCostCenter lifecycle must couple active to null and inactive to a timestamp.'
)
rejectUnless(
  ['id', 'status', 'inactive_at', 'created_at', 'updated_at'].every(
    (field) => center?.properties?.[field]?.readOnly === true
  ),
  'Internal Cost Center identity, lifecycle, and timestamps must be explicitly read-only.'
)
rejectUnless(
  /stable and immutable/.test(center?.description ?? '') &&
    /unique only within the active tenant/.test(
      center?.properties?.code?.description ?? ''
    ),
  'Internal Cost Center code must be immutable and unique only within its tenant.'
)

const create = schemas.InternalCostCenterCreateRequest
rejectUnless(
  create?.additionalProperties === false &&
    exactKeys(create?.properties, ['code', 'name']) &&
    exactRequired(create, ['code', 'name']) &&
    create?.properties?.code?.type === 'string' &&
    create?.properties?.code?.minLength === 1 &&
    create?.properties?.code?.maxLength === 64 &&
    create?.properties?.code?.pattern === NONBLANK_PATTERN &&
    create?.properties?.name?.type === 'string' &&
    create?.properties?.name?.minLength === 1 &&
    create?.properties?.name?.maxLength === 255 &&
    create?.properties?.name?.pattern === NONBLANK_PATTERN,
  'Create must accept exactly required, nonblank, bounded code and name.'
)
const update = schemas.InternalCostCenterUpdateRequest
rejectUnless(
  update?.additionalProperties === false &&
    update?.minProperties === 1 &&
    exactKeys(update?.properties, ['name']) &&
    exactRequired(update, []) &&
    update?.properties?.name?.type === 'string' &&
    update?.properties?.name?.minLength === 1 &&
    update?.properties?.name?.maxLength === 255 &&
    update?.properties?.name?.pattern === NONBLANK_PATTERN,
  'PATCH must be partial, non-empty, closed, and allow only name.'
)
rejectUnless(
  schemas.InternalCostCenterResponse?.additionalProperties === false &&
    exactRequired(schemas.InternalCostCenterResponse, ['data']) &&
    exactKeys(schemas.InternalCostCenterResponse?.properties, ['data']) &&
    schemas.InternalCostCenterResponse?.properties?.data?.$ref ===
      '#/components/schemas/InternalCostCenter' &&
    schemas.InternalCostCenterCollectionResponse?.additionalProperties ===
      false &&
    exactRequired(schemas.InternalCostCenterCollectionResponse, [
      'data',
      'links',
      'meta',
    ]) &&
    schemas.InternalCostCenterCollectionResponse?.properties?.data?.items
      ?.$ref === '#/components/schemas/InternalCostCenter',
  'Internal Cost Center responses must use only the explicit InternalCostCenter schema.'
)

const allocationItem = schemas.CostCenterAllocationItem
rejectUnless(
  allocationItem?.additionalProperties === false &&
    exactKeys(allocationItem?.properties, [
      'internal_cost_center_id',
      'share_bps',
    ]) &&
    exactRequired(allocationItem, ['internal_cost_center_id', 'share_bps']) &&
    allocationItem?.properties?.internal_cost_center_id?.format === 'uuid' &&
    allocationItem?.properties?.share_bps?.type === 'integer' &&
    allocationItem?.properties?.share_bps?.minimum === 1 &&
    allocationItem?.properties?.share_bps?.maximum === 10000,
  'Allocation items must contain only Internal Cost Center UUID and integer basis points from 1 through 10000.'
)

const replacement = schemas.CostCenterAllocationReplacementRequest
const allocations = replacement?.properties?.allocations
rejectUnless(
  replacement?.additionalProperties === false &&
    exactKeys(replacement?.properties, ['allocations']) &&
    exactRequired(replacement, ['allocations']) &&
    allocations?.type === 'array' &&
    allocations?.items?.$ref ===
      '#/components/schemas/CostCenterAllocationItem' &&
    allocations?.minItems === 0 &&
    allocations?.['x-secpal-unique-by'] === 'internal_cost_center_id' &&
    allocations?.['x-secpal-allocation-invariant'] ===
      'empty-or-sum-share-bps-exactly-10000',
  'Allocation replacement must require a complete collection, allow empty, reject duplicate targets, and require exactly 10000 bps when non-empty.'
)

const snapshot = schemas.ServiceBookingCostCenterAllocationSnapshot
rejectUnless(
  snapshot?.additionalProperties === false &&
    exactKeys(snapshot?.properties, ['service_booking_id', 'allocations']) &&
    exactRequired(snapshot, ['service_booking_id', 'allocations']) &&
    snapshot?.properties?.service_booking_id?.format === 'uuid' &&
    snapshot?.properties?.allocations?.items?.$ref ===
      '#/components/schemas/CostCenterAllocationItem' &&
    snapshot?.properties?.allocations?.minItems === 0 &&
    snapshot?.properties?.allocations?.['x-secpal-unique-by'] ===
      'internal_cost_center_id' &&
    snapshot?.properties?.allocations?.['x-secpal-allocation-invariant'] ===
      'empty-or-sum-share-bps-exactly-10000' &&
    /internal_cost_center_id ASC/.test(
      snapshot?.properties?.allocations?.description ?? ''
    ),
  'The response snapshot must identify its parent once and return a deterministic complete zero-or-10000 unique-target split.'
)
rejectUnless(
  schemas.ServiceBookingCostCenterAllocationResponse?.additionalProperties ===
    false &&
    exactRequired(schemas.ServiceBookingCostCenterAllocationResponse, [
      'data',
    ]) &&
    exactKeys(schemas.ServiceBookingCostCenterAllocationResponse?.properties, [
      'data',
    ]) &&
    schemas.ServiceBookingCostCenterAllocationResponse?.properties?.data
      ?.$ref ===
      '#/components/schemas/ServiceBookingCostCenterAllocationSnapshot',
  'Allocation responses must wrap exactly the complete business snapshot.'
)

rejectUnless(
  !containsPropertyName(
    { create, update, replacement, allocationItem },
    new Set([
      'tenant_id',
      'service_booking_id',
      'id',
      'amount',
      'money',
      'percentage',
      'shift_id',
      'code_copy',
      'name_copy',
      'created_at',
      'updated_at',
      'inactive_at',
      'status',
    ])
  ),
  'Requests must exclude tenant, parent, row identity, lifecycle, timestamp, money, percentage, label-copy, and Shift fields.'
)
const newSurfaceText = JSON.stringify({
  operations,
  center,
  create,
  update,
  allocationItem,
  replacement,
  snapshot,
})
rejectUnless(
  !newSurfaceText.includes('#/components/schemas/CostCenter"'),
  'The tenant-wide Internal Cost Center surface must not reuse the Site CostCenter schema.'
)

for (const schemaName of [
  'InternalCostCenterNotFoundError',
  'InternalCostCenterConflictError',
  'CostCenterAllocationNotFoundError',
  'CostCenterAllocationConflictError',
]) {
  rejectUnless(
    schemas[schemaName]?.additionalProperties === false &&
      exactRequired(schemas[schemaName], ['message', 'code']) &&
      exactKeys(schemas[schemaName]?.properties, ['message', 'code']),
    `${schemaName} must remain a closed neutral error envelope.`
  )
}

const requiredErrors = {
  list: {
    401: 'Unauthorized',
    403: 'Forbidden',
    422: 'InternalCostCenterValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  create: {
    401: 'Unauthorized',
    403: 'Forbidden',
    409: 'InternalCostCenterConflict',
    422: 'InternalCostCenterValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  inspect: {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'InternalCostCenterNotFound',
    422: 'InternalCostCenterValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  update: {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'InternalCostCenterNotFound',
    409: 'InternalCostCenterConflict',
    422: 'InternalCostCenterValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  deactivate: {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'InternalCostCenterNotFound',
    409: 'InternalCostCenterConflict',
    422: 'InternalCostCenterValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  inspectAllocations: {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'CostCenterAllocationNotFound',
    422: 'CostCenterAllocationValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  replaceAllocations: {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'CostCenterAllocationNotFound',
    409: 'CostCenterAllocationConflict',
    422: 'CostCenterAllocationValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
}

for (const [name, expected] of Object.entries(requiredErrors)) {
  for (const [status, component] of Object.entries(expected)) {
    rejectUnless(
      responseRef(operations[name], status, component),
      `${name} ${status} must reuse ${component}.`
    )
  }
}

if (errors.length > 0) {
  console.error('Internal Cost Center allocation OpenAPI guard failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Internal Cost Center allocation OpenAPI guard passed.')
