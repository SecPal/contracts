#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import * as yaml from 'js-yaml'

const target = process.argv[2]
if (!target) {
  console.error(
    'Usage: node scripts/check-service-booking-crud.mjs <path-to-openapi.yaml>'
  )
  process.exit(2)
}

let document
try {
  document = yaml.load(fs.readFileSync(path.resolve(target), 'utf8'), {
    schema: yaml.JSON_SCHEMA,
  })
} catch (error) {
  console.error(`Unable to parse Service Booking CRUD candidate: ${target}`)
  console.error(error)
  process.exit(2)
}

const paths = document?.paths ?? {}
const schemas = document?.components?.schemas ?? {}
const parameters = document?.components?.parameters ?? {}
const responses = document?.components?.responses ?? {}
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
const REQUIRED_PATHS = new Map([
  ['/service-bookings', ['get', 'post']],
  ['/service-bookings/{serviceBooking}', ['get', 'patch']],
  ['/service-bookings/{serviceBooking}/retire', ['post']],
])
const EXACT_QUANTITY_PATTERN =
  '^(?!0(?:\\.0{1,4})?$)(?:0|[1-9][0-9]{0,9})(?:\\.[0-9]{1,4})?$'
const EXACT_PRICE_PATTERN = '^(?:0|[1-9][0-9]{0,9})(?:\\.[0-9]{1,4})?$'
const EXACT_TOTAL_PATTERN = '^(?:0|[1-9][0-9]{0,19})\\.[0-9]{2}$'

function rejectUnless(condition, message) {
  if (!condition) errors.push(message)
}

function operationMethods(pathItem) {
  return Object.keys(pathItem ?? {}).filter((key) => HTTP_METHODS.has(key))
}

function responseRef(operation, status, component) {
  return (
    operation?.responses?.[status]?.$ref ===
    `#/components/responses/${component}`
  )
}

function responseSchemaRef(operation, status, component) {
  return (
    operation?.responses?.[status]?.content?.['application/json']?.schema
      ?.$ref === `#/components/schemas/${component}`
  )
}

function requestSchemaRef(operation) {
  return operation?.requestBody?.content?.['application/json']?.schema?.$ref
}

function hasExactKeys(value, expected) {
  return isDeepStrictEqual(
    Object.keys(value ?? {}).sort(),
    [...expected].sort()
  )
}

function hasExactRequired(schema, expected) {
  return isDeepStrictEqual(
    [...(schema?.required ?? [])].sort(),
    [...expected].sort()
  )
}

function containsKey(value, forbidden) {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(
    ([key, child]) => forbidden.has(key) || containsKey(child, forbidden)
  )
}

for (const [pathKey, methods] of REQUIRED_PATHS) {
  rejectUnless(paths[pathKey], `Missing Service Booking path: ${pathKey}`)
  rejectUnless(
    isDeepStrictEqual(
      operationMethods(paths[pathKey]).sort(),
      [...methods].sort()
    ),
    `${pathKey} must expose exactly: ${methods.join(', ')}`
  )
}

const bookingPaths = Object.keys(paths).filter((pathKey) =>
  pathKey.startsWith('/service-bookings')
)
rejectUnless(
  isDeepStrictEqual(bookingPaths.sort(), [...REQUIRED_PATHS.keys()].sort()),
  'Service Booking CRUD must expose only the three canonical paths and five operations.'
)

const operations = {
  list: paths['/service-bookings']?.get,
  create: paths['/service-bookings']?.post,
  inspect: paths['/service-bookings/{serviceBooking}']?.get,
  update: paths['/service-bookings/{serviceBooking}']?.patch,
  retire: paths['/service-bookings/{serviceBooking}/retire']?.post,
}
const operationContracts = {
  list: [
    'listServiceBookings',
    'service_bookings.read',
    '200',
    'ServiceBookingCollectionResponse',
  ],
  create: [
    'createServiceBooking',
    'service_bookings.create',
    '201',
    'ServiceBookingResponse',
  ],
  inspect: [
    'getServiceBooking',
    'service_bookings.read',
    '200',
    'ServiceBookingResponse',
  ],
  update: [
    'updateServiceBooking',
    'service_bookings.update',
    '200',
    'ServiceBookingResponse',
  ],
  retire: [
    'retireServiceBooking',
    'service_bookings.retire',
    '200',
    'ServiceBookingResponse',
  ],
}

for (const [
  name,
  [operationId, permission, status, schemaName],
] of Object.entries(operationContracts)) {
  const operation = operations[name]
  const permissionMentions = [
    ...(operation?.description ?? '').matchAll(
      /`(service_bookings\.[a-z_]+)`/g
    ),
  ].map((match) => match[1])
  const successStatuses = Object.keys(operation?.responses ?? {}).filter(
    (candidate) => /^2\d\d$/.test(candidate)
  )

  rejectUnless(
    operation?.operationId === operationId,
    `${name} must use operationId ${operationId}.`
  )
  rejectUnless(
    isDeepStrictEqual(permissionMentions, [permission]),
    `${name} must name exactly the ${permission} capability.`
  )
  rejectUnless(
    isDeepStrictEqual(operation?.security, [{ BearerAuth: [] }]),
    `${name} must require BearerAuth.`
  )
  rejectUnless(
    isDeepStrictEqual(operation?.tags, ['Service Bookings']),
    `${name} must use only the Service Bookings tag.`
  )
  rejectUnless(
    isDeepStrictEqual(successStatuses, [status]) &&
      responseSchemaRef(operation, status, schemaName),
    `${name} must return only ${status} with ${schemaName}.`
  )
}

const declaredPermissions = new Set(
  Object.values(operations).flatMap((operation) =>
    [
      ...(operation?.description ?? '').matchAll(
        /`(service_bookings\.[a-z_]+)`/g
      ),
    ].map((match) => match[1])
  )
)
rejectUnless(
  isDeepStrictEqual([...declaredPermissions].sort(), [
    'service_bookings.create',
    'service_bookings.read',
    'service_bookings.retire',
    'service_bookings.update',
  ]),
  'Service Booking operations must define exactly the four required capabilities.'
)

const listParameters = operations.list?.parameters ?? []
rejectUnless(
  isDeepStrictEqual(
    listParameters.map((parameter) => parameter?.name),
    ['page', 'per_page']
  ) &&
    listParameters[0]?.schema?.type === 'integer' &&
    listParameters[0]?.schema?.minimum === 1 &&
    listParameters[0]?.schema?.default === 1 &&
    listParameters[1]?.schema?.type === 'integer' &&
    listParameters[1]?.schema?.minimum === 1 &&
    listParameters[1]?.schema?.maximum === 100 &&
    listParameters[1]?.schema?.default === 15,
  'Service Booking list must expose only page=1 and per_page=15 pagination with a maximum of 100.'
)

const requiredErrors = {
  list: {
    401: 'Unauthorized',
    403: 'Forbidden',
    422: 'ServiceBookingValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  create: {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'ServiceBookingNotFound',
    422: 'ServiceBookingValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  inspect: {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'ServiceBookingNotFound',
    422: 'ServiceBookingValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  update: {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'ServiceBookingNotFound',
    409: 'ServiceBookingConflict',
    422: 'ServiceBookingValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  retire: {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'ServiceBookingNotFound',
    409: 'ServiceBookingConflict',
    422: 'ServiceBookingValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
}
for (const [name, statusMap] of Object.entries(requiredErrors)) {
  for (const [status, response] of Object.entries(statusMap)) {
    rejectUnless(
      responseRef(operations[name], status, response),
      `${name} must use ${response} for HTTP ${status}.`
    )
  }
}

for (const operation of [
  operations.inspect,
  operations.update,
  operations.retire,
]) {
  rejectUnless(
    isDeepStrictEqual(operation?.parameters, [
      { $ref: '#/components/parameters/ServiceBookingId' },
    ]),
    'Service Booking target operations must use the canonical ServiceBookingId parameter.'
  )
}
rejectUnless(
  parameters.ServiceBookingId?.name === 'serviceBooking' &&
    parameters.ServiceBookingId?.in === 'path' &&
    parameters.ServiceBookingId?.required === true &&
    parameters.ServiceBookingId?.schema?.type === 'string' &&
    parameters.ServiceBookingId?.schema?.format === 'uuid' &&
    /malformed.*422/is.test(parameters.ServiceBookingId?.description ?? '') &&
    /unavailable.*404/is.test(parameters.ServiceBookingId?.description ?? ''),
  'ServiceBookingId must distinguish malformed UUID input from unavailable resources.'
)

const createFields = [
  'contract_id',
  'service_date',
  'quantity',
  'billing_unit',
  'unit_price',
]
const updateFields = ['service_date', 'quantity', 'billing_unit', 'unit_price']
const createRequest = schemas.ServiceBookingCreateRequest
const updateRequest = schemas.ServiceBookingUpdateRequest
rejectUnless(
  requestSchemaRef(operations.create) ===
    '#/components/schemas/ServiceBookingCreateRequest' &&
    createRequest?.type === 'object' &&
    createRequest?.additionalProperties === false &&
    hasExactKeys(createRequest?.properties, createFields) &&
    hasExactRequired(createRequest, createFields),
  'Create must accept exactly the five required caller-owned booking facts.'
)
rejectUnless(
  requestSchemaRef(operations.update) ===
    '#/components/schemas/ServiceBookingUpdateRequest' &&
    updateRequest?.type === 'object' &&
    updateRequest?.additionalProperties === false &&
    updateRequest?.minProperties === 1 &&
    hasExactKeys(updateRequest?.properties, updateFields) &&
    (updateRequest?.required?.length ?? 0) === 0,
  'PATCH must be partial, non-empty, closed, and exclude contract and server-owned fields.'
)
rejectUnless(
  operations.retire?.requestBody === undefined,
  'Retirement must accept no request body.'
)

const booking = schemas.ServiceBooking
const resourceFields = [
  'id',
  'contract_id',
  'service_date',
  'quantity',
  'billing_unit',
  'unit_price',
  'currency_code',
  'total',
  'invoice_state',
  'invoiced_at',
  'status',
  'retired_at',
  'created_at',
  'updated_at',
]
rejectUnless(
  booking?.type === 'object' &&
    booking?.additionalProperties === false &&
    hasExactKeys(booking?.properties, resourceFields) &&
    hasExactRequired(booking, resourceFields),
  'ServiceBooking must expose exactly the required public business record.'
)
rejectUnless(
  booking?.properties?.id?.type === 'string' &&
    booking?.properties?.id?.format === 'uuid' &&
    booking?.properties?.contract_id?.type === 'string' &&
    booking?.properties?.contract_id?.format === 'uuid' &&
    createRequest?.properties?.contract_id?.type === 'string' &&
    createRequest?.properties?.contract_id?.format === 'uuid',
  'Service Booking and Contract identities must use UUID strings.'
)

const quantity = schemas.ServiceBookingQuantity
const total = schemas.ServiceBookingTotal
rejectUnless(
  quantity?.type === 'string' &&
    quantity?.pattern === EXACT_QUANTITY_PATTERN &&
    quantity?.minLength === 1 &&
    quantity?.maxLength === 15 &&
    !['float', 'double'].includes(quantity?.format),
  'ServiceBookingQuantity must remain a positive bounded exact decimal string.'
)
rejectUnless(
  schemas.ContractUnitPrice?.type === 'string' &&
    schemas.ContractUnitPrice?.pattern === EXACT_PRICE_PATTERN &&
    booking?.properties?.unit_price?.$ref ===
      '#/components/schemas/ContractUnitPrice' &&
    createRequest?.properties?.unit_price?.$ref ===
      '#/components/schemas/ContractUnitPrice' &&
    updateRequest?.properties?.unit_price?.$ref ===
      '#/components/schemas/ContractUnitPrice',
  'Service Booking unit price must reuse ContractUnitPrice exact decimal semantics.'
)
rejectUnless(
  total?.type === 'string' &&
    total?.readOnly === true &&
    total?.pattern === EXACT_TOTAL_PATTERN &&
    total?.minLength === 4 &&
    total?.maxLength === 23 &&
    !['float', 'double'].includes(total?.format) &&
    /read-only.*PostgreSQL.*quantity.*unit_price.*two[- ]decimal/is.test(
      total?.description ?? ''
    ),
  'ServiceBookingTotal must be a read-only PostgreSQL-derived exact two-decimal string.'
)

for (const schema of [booking, createRequest, updateRequest]) {
  rejectUnless(
    schema?.properties?.service_date?.$ref ===
      '#/components/schemas/ServiceBookingDate' &&
      schema?.properties?.quantity?.$ref ===
        '#/components/schemas/ServiceBookingQuantity' &&
      schema?.properties?.billing_unit?.$ref ===
        '#/components/schemas/BillingUnit' &&
      schema?.properties?.unit_price?.$ref ===
        '#/components/schemas/ContractUnitPrice',
    'Service Booking request and response fields must reuse canonical value schemas.'
  )
}
rejectUnless(
  schemas.ServiceBookingDate?.type === 'string' &&
    schemas.ServiceBookingDate?.format === 'date',
  'ServiceBookingDate must remain a calendar date.'
)
rejectUnless(
  isDeepStrictEqual(schemas.BillingUnit?.enum, ['hour', 'day', 'unit', 'flat']),
  'Service Bookings must reuse the exact BillingUnit closed set.'
)
rejectUnless(
  isDeepStrictEqual(schemas.ServiceBookingStatus?.enum, ['active', 'retired']),
  'ServiceBookingStatus must be exactly active and retired.'
)
rejectUnless(
  isDeepStrictEqual(schemas.InvoiceState?.enum, ['unbilled', 'invoiced']),
  'InvoiceState must be exactly unbilled and invoiced.'
)
rejectUnless(
  booking?.properties?.currency_code?.$ref ===
    '#/components/schemas/ContractCurrencyCode' &&
    booking?.properties?.currency_code?.readOnly === true &&
    booking?.properties?.total?.$ref ===
      '#/components/schemas/ServiceBookingTotal' &&
    booking?.properties?.invoice_state?.$ref ===
      '#/components/schemas/InvoiceState' &&
    booking?.properties?.invoice_state?.readOnly === true &&
    booking?.properties?.invoiced_at?.$ref ===
      '#/components/schemas/NullableApiTimestamp' &&
    booking?.properties?.invoiced_at?.readOnly === true &&
    booking?.properties?.status?.$ref ===
      '#/components/schemas/ServiceBookingStatus' &&
    booking?.properties?.status?.readOnly === true &&
    booking?.properties?.retired_at?.$ref ===
      '#/components/schemas/NullableApiTimestamp' &&
    booking?.properties?.retired_at?.readOnly === true,
  'Service Booking response-only values must use canonical currency, total, invoice, and lifecycle schemas.'
)

const lifecycleSets = booking?.allOf ?? []
const statusVariants = lifecycleSets.find((entry) =>
  entry?.oneOf?.some((variant) => variant?.title === 'ActiveServiceBooking')
)?.oneOf
const invoiceVariants = lifecycleSets.find((entry) =>
  entry?.oneOf?.some((variant) => variant?.title === 'UnbilledServiceBooking')
)?.oneOf
rejectUnless(
  statusVariants?.length === 2 &&
    statusVariants[0]?.properties?.status?.const === 'active' &&
    statusVariants[0]?.properties?.retired_at?.type === 'null' &&
    statusVariants[1]?.properties?.status?.const === 'retired' &&
    statusVariants[1]?.properties?.retired_at?.$ref ===
      '#/components/schemas/ApiTimestamp' &&
    invoiceVariants?.length === 2 &&
    invoiceVariants[0]?.properties?.invoice_state?.const === 'unbilled' &&
    invoiceVariants[0]?.properties?.invoiced_at?.type === 'null' &&
    invoiceVariants[1]?.properties?.invoice_state?.const === 'invoiced' &&
    invoiceVariants[1]?.properties?.invoiced_at?.$ref ===
      '#/components/schemas/ApiTimestamp',
  'Service Booking lifecycle and invoice evidence must be independently coupled.'
)

rejectUnless(
  schemas.ServiceBookingResponse?.type === 'object' &&
    schemas.ServiceBookingResponse?.additionalProperties === false &&
    hasExactRequired(schemas.ServiceBookingResponse, ['data']) &&
    hasExactKeys(schemas.ServiceBookingResponse?.properties, ['data']) &&
    schemas.ServiceBookingResponse?.properties?.data?.$ref ===
      '#/components/schemas/ServiceBooking',
  'Single Service Booking responses must use the closed data envelope.'
)
rejectUnless(
  schemas.ServiceBookingCollectionResponse?.type === 'object' &&
    schemas.ServiceBookingCollectionResponse?.additionalProperties === false &&
    hasExactRequired(schemas.ServiceBookingCollectionResponse, [
      'data',
      'links',
      'meta',
    ]) &&
    hasExactKeys(schemas.ServiceBookingCollectionResponse?.properties, [
      'data',
      'links',
      'meta',
    ]) &&
    schemas.ServiceBookingCollectionResponse?.properties?.data?.items?.$ref ===
      '#/components/schemas/ServiceBooking' &&
    schemas.ServiceBookingCollectionResponse?.properties?.links?.$ref ===
      '#/components/schemas/PaginationLinks' &&
    schemas.ServiceBookingCollectionResponse?.properties?.meta?.$ref ===
      '#/components/schemas/PaginationMeta',
  'Service Booking lists must use the standard data, links, and meta envelope.'
)

const forbiddenPublicFields = new Set([
  'tenant',
  'tenant_id',
  'shift',
  'shift_id',
  'allocations',
  'cost_center_id',
  'internal_cost_center_id',
  'customer',
  'contract',
  'audit_events',
  'actor_id',
  'constraint_name',
  'trigger_name',
])
rejectUnless(
  ![booking, createRequest, updateRequest].some((schema) =>
    containsKey(schema, forbiddenPublicFields)
  ),
  'Service Booking schemas must exclude tenant, Shift, allocation, embedded-resource, audit, and persistence fields.'
)

const notFound = schemas.ServiceBookingNotFoundError
rejectUnless(
  responses.ServiceBookingNotFound?.content?.['application/json']?.schema
    ?.$ref === '#/components/schemas/ServiceBookingNotFoundError' &&
    /service booking or contract/i.test(
      responses.ServiceBookingNotFound?.description ?? ''
    ) &&
    /indistinguishable/i.test(
      responses.ServiceBookingNotFound?.description ?? ''
    ) &&
    notFound?.type === 'object' &&
    notFound?.additionalProperties === false &&
    hasExactKeys(notFound?.properties, ['message', 'code']) &&
    hasExactRequired(notFound, ['message', 'code']) &&
    notFound?.properties?.message?.const === 'Resource not found' &&
    notFound?.properties?.code?.const === 'NOT_FOUND',
  'ServiceBookingNotFound must be closed, neutral, and information-poor.'
)

const conflict = schemas.ServiceBookingConflictError
rejectUnless(
  responses.ServiceBookingConflict?.content?.['application/json']?.schema
    ?.$ref === '#/components/schemas/ServiceBookingConflictError' &&
    conflict?.type === 'object' &&
    conflict?.additionalProperties === false &&
    hasExactKeys(conflict?.properties, ['message', 'code']) &&
    hasExactRequired(conflict, ['message', 'code']) &&
    conflict?.properties?.message?.type === 'string' &&
    conflict?.properties?.code?.const === 'CONFLICT',
  'Service Booking conflicts must use a closed neutral envelope.'
)
rejectUnless(
  hasExactKeys(
    responses.ServiceBookingConflict?.content?.['application/json']?.examples,
    ['retired', 'concurrentTransition']
  ),
  'Shared Service Booking conflict examples must apply truthfully to both PATCH and retirement.'
)

rejectUnless(
  /active tenant/i.test(operations.list?.description ?? '') &&
    /active and retired/is.test(operations.list?.description ?? '') &&
    /created_at.*descending/is.test(operations.list?.description ?? '') &&
    /id.*descending/is.test(operations.list?.description ?? ''),
  'Service Booking list must include history and use deterministic active-tenant ordering.'
)
rejectUnless(
  /currency.*owning contract/is.test(operations.create?.description ?? '') &&
    /total.*PostgreSQL/is.test(operations.create?.description ?? '') &&
    /unbilled/is.test(operations.create?.description ?? '') &&
    /active/is.test(operations.create?.description ?? '') &&
    /committed/is.test(operations.create?.description ?? ''),
  'Create must document Contract-derived currency, database total, initial state, and committed response.'
)
rejectUnless(
  /active and unbilled/is.test(operations.update?.description ?? '') &&
    /invoiced.*409/is.test(operations.update?.description ?? '') &&
    /retired.*409/is.test(operations.update?.description ?? '') &&
    /contract_id.*422/is.test(operations.update?.description ?? '') &&
    /concurrent.*409/is.test(operations.update?.description ?? '') &&
    /committed/is.test(operations.update?.description ?? ''),
  'PATCH must document immutable association, lifecycle, invoice, concurrency, and committed-state semantics.'
)
rejectUnless(
  /terminal/is.test(operations.retire?.description ?? '') &&
    /already retired.*409/is.test(operations.retire?.description ?? '') &&
    /invoiced/is.test(operations.retire?.description ?? '') &&
    /does not.*invoice/is.test(operations.retire?.description ?? '') &&
    /committed/is.test(operations.retire?.description ?? ''),
  'Retirement must be terminal, idempotency-conflict-aware, invoice-preserving, and committed.'
)

if (errors.length > 0) {
  console.error('Service Booking CRUD OpenAPI guard failed:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log('Service Booking CRUD OpenAPI guard passed.')
