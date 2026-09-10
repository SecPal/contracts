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
    'Usage: node scripts/check-contract-crud.mjs <path-to-openapi.yaml>'
  )
  process.exit(2)
}

let document
try {
  document = yaml.load(fs.readFileSync(path.resolve(target), 'utf8'), {
    schema: yaml.JSON_SCHEMA,
  })
} catch (error) {
  console.error(`Unable to parse Contract CRUD candidate: ${target}`)
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
  ['/contracts', ['get', 'post']],
  ['/contracts/{contract}', ['get', 'patch']],
  ['/contracts/{contract}/retire', ['post']],
])
const EXACT_PRICE_PATTERN = '^(?:0|[1-9][0-9]{0,9})(?:\\.[0-9]{1,4})?$'

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
  rejectUnless(paths[pathKey], `Missing Contract path: ${pathKey}`)
  rejectUnless(
    isDeepStrictEqual(
      operationMethods(paths[pathKey]).sort(),
      [...methods].sort()
    ),
    `${pathKey} must expose exactly: ${methods.join(', ')}`
  )
}

const contractPaths = Object.keys(paths).filter((pathKey) =>
  pathKey.startsWith('/contracts')
)
rejectUnless(
  isDeepStrictEqual(contractPaths.sort(), [...REQUIRED_PATHS.keys()].sort()),
  'Contract CRUD must expose only the three canonical paths and five operations.'
)

const forbiddenAdjacentPaths = Object.keys(paths).filter((pathKey) =>
  /^\/contracts\/(?:.*\/)?(?:service-bookings|cost-centers)(?:\/|$)/.test(
    pathKey
  )
)
rejectUnless(
  forbiddenAdjacentPaths.length === 0,
  'Contract CRUD must not absorb Service Booking or Internal Cost Center HTTP surfaces.'
)

const operations = {
  list: paths['/contracts']?.get,
  create: paths['/contracts']?.post,
  inspect: paths['/contracts/{contract}']?.get,
  update: paths['/contracts/{contract}']?.patch,
  retire: paths['/contracts/{contract}/retire']?.post,
}
const operationContracts = {
  list: [
    'listContracts',
    'contracts.read',
    '200',
    'ContractCollectionResponse',
  ],
  create: ['createContract', 'contracts.create', '201', 'ContractResponse'],
  inspect: ['getContract', 'contracts.read', '200', 'ContractResponse'],
  update: ['updateContract', 'contracts.update', '200', 'ContractResponse'],
  retire: ['retireContract', 'contracts.retire', '200', 'ContractResponse'],
}

for (const [
  name,
  [operationId, permission, status, schemaName],
] of Object.entries(operationContracts)) {
  const operation = operations[name]
  const permissionMentions = [
    ...(operation?.description ?? '').matchAll(/`(contracts\.[a-z_]+)`/g),
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
    isDeepStrictEqual(operation?.tags, ['Contracts']),
    `${name} must use only the Contracts tag.`
  )
  rejectUnless(
    isDeepStrictEqual(successStatuses, [status]) &&
      responseSchemaRef(operation, status, schemaName),
    `${name} must return only ${status} with ${schemaName}.`
  )
}

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
  'Contract list must expose only page=1 and per_page=15 pagination with a maximum of 100.'
)

const requiredErrors = {
  list: {
    401: 'Unauthorized',
    403: 'Forbidden',
    422: 'ContractValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  create: {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'ContractNotFound',
    422: 'ContractValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  inspect: {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'ContractNotFound',
    422: 'ContractValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  update: {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'ContractNotFound',
    409: 'ContractConflict',
    422: 'ContractValidationError',
    429: 'TooManyRequests',
    500: 'InternalServerError',
  },
  retire: {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'ContractNotFound',
    409: 'ContractConflict',
    422: 'ContractValidationError',
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

const targetOperations = [
  operations.inspect,
  operations.update,
  operations.retire,
]
for (const operation of targetOperations) {
  rejectUnless(
    isDeepStrictEqual(operation?.parameters, [
      { $ref: '#/components/parameters/ContractId' },
    ]),
    'Contract target operations must use the canonical ContractId parameter.'
  )
}
rejectUnless(
  parameters.ContractId?.name === 'contract' &&
    parameters.ContractId?.in === 'path' &&
    parameters.ContractId?.required === true &&
    parameters.ContractId?.schema?.type === 'string' &&
    parameters.ContractId?.schema?.format === 'uuid' &&
    /malformed.*422/is.test(parameters.ContractId?.description ?? '') &&
    /unavailable.*404/is.test(parameters.ContractId?.description ?? ''),
  'ContractId must distinguish malformed UUID input from unavailable resources.'
)

const requestFields = [
  'customer_id',
  'type',
  'starts_on',
  'ends_on',
  'billing_unit',
  'unit_price',
  'currency_code',
]
const createRequest = schemas.ContractCreateRequest
const updateRequest = schemas.ContractUpdateRequest
rejectUnless(
  requestSchemaRef(operations.create) ===
    '#/components/schemas/ContractCreateRequest' &&
    createRequest?.type === 'object' &&
    createRequest?.additionalProperties === false &&
    hasExactKeys(createRequest?.properties, requestFields) &&
    hasExactRequired(createRequest, [
      'customer_id',
      'type',
      'starts_on',
      'billing_unit',
      'unit_price',
      'currency_code',
    ]),
  'Create must accept only the closed persistence-backed business fields.'
)
rejectUnless(
  requestSchemaRef(operations.update) ===
    '#/components/schemas/ContractUpdateRequest' &&
    updateRequest?.type === 'object' &&
    updateRequest?.additionalProperties === false &&
    updateRequest?.minProperties === 1 &&
    hasExactKeys(updateRequest?.properties, requestFields) &&
    (updateRequest?.required?.length ?? 0) === 0,
  'PATCH must be partial, non-empty, closed, and exclude lifecycle fields.'
)
rejectUnless(
  operations.retire?.requestBody === undefined,
  'Retirement must be explicit and accept no request body.'
)

const contract = schemas.Contract
const resourceFields = [
  'id',
  'customer_id',
  'type',
  'status',
  'starts_on',
  'ends_on',
  'billing_unit',
  'unit_price',
  'currency_code',
  'retired_at',
  'created_at',
  'updated_at',
]
rejectUnless(
  contract?.type === 'object' &&
    contract?.additionalProperties === false &&
    hasExactKeys(contract?.properties, resourceFields) &&
    hasExactRequired(contract, resourceFields),
  'Contract resources must expose exactly the required public business state.'
)
rejectUnless(
  contract?.properties?.id?.type === 'string' &&
    contract?.properties?.id?.format === 'uuid' &&
    contract?.properties?.customer_id?.type === 'string' &&
    contract?.properties?.customer_id?.format === 'uuid' &&
    createRequest?.properties?.customer_id?.type === 'string' &&
    createRequest?.properties?.customer_id?.format === 'uuid',
  'Contract and Customer identities must use UUID strings.'
)

rejectUnless(
  isDeepStrictEqual(schemas.ContractType?.enum, [
    'permanent',
    'temporary',
    'one_time',
    'recurring',
  ]),
  'ContractType must be exactly permanent, temporary, one_time, and recurring.'
)
rejectUnless(
  isDeepStrictEqual(schemas.ContractStatus?.enum, ['active', 'retired']),
  'ContractStatus must be exactly active and retired.'
)
rejectUnless(
  isDeepStrictEqual(schemas.BillingUnit?.enum, ['hour', 'day', 'unit', 'flat']),
  'BillingUnit must be exactly hour, day, unit, and flat.'
)

const price = schemas.ContractUnitPrice
rejectUnless(
  price?.type === 'string' &&
    price?.pattern === EXACT_PRICE_PATTERN &&
    price?.minLength === 1 &&
    price?.maxLength === 15 &&
    !['float', 'double'].includes(price?.format),
  'ContractUnitPrice must remain the bounded exact decimal-string representation.'
)
const currency = schemas.ContractCurrencyCode
rejectUnless(
  currency?.type === 'string' &&
    currency?.minLength === 3 &&
    currency?.maxLength === 3 &&
    currency?.pattern === '^[A-Z]{3}$',
  'ContractCurrencyCode must be exactly three uppercase ASCII letters.'
)

for (const schema of [contract, createRequest, updateRequest]) {
  rejectUnless(
    schema?.properties?.type?.$ref === '#/components/schemas/ContractType' &&
      schema?.properties?.billing_unit?.$ref ===
        '#/components/schemas/BillingUnit' &&
      schema?.properties?.unit_price?.$ref ===
        '#/components/schemas/ContractUnitPrice' &&
      schema?.properties?.currency_code?.$ref ===
        '#/components/schemas/ContractCurrencyCode' &&
      schema?.properties?.starts_on?.$ref ===
        '#/components/schemas/ContractDate' &&
      schema?.properties?.ends_on?.$ref ===
        '#/components/schemas/NullableContractDate',
    'Contract request and response fields must reuse the canonical value schemas.'
  )
}
rejectUnless(
  contract?.properties?.status?.$ref ===
    '#/components/schemas/ContractStatus' &&
    contract?.properties?.retired_at?.$ref ===
      '#/components/schemas/NullableApiTimestamp' &&
    schemas.ContractDate?.type === 'string' &&
    schemas.ContractDate?.format === 'date' &&
    isDeepStrictEqual(schemas.NullableContractDate?.type, ['string', 'null']) &&
    schemas.NullableContractDate?.format === 'date',
  'Contract lifecycle and business dates must use their canonical schemas.'
)

const lifecycleVariants = contract?.oneOf ?? []
const activeVariant = lifecycleVariants.find(
  (variant) => variant?.title === 'ActiveContract'
)
const retiredVariant = lifecycleVariants.find(
  (variant) => variant?.title === 'RetiredContract'
)
rejectUnless(
  lifecycleVariants.length === 2 &&
    activeVariant?.type === 'object' &&
    hasExactRequired(activeVariant, ['status', 'retired_at']) &&
    hasExactKeys(activeVariant?.properties, ['status', 'retired_at']) &&
    activeVariant?.properties?.status?.type === 'string' &&
    activeVariant?.properties?.status?.const === 'active' &&
    activeVariant?.properties?.retired_at?.type === 'null' &&
    retiredVariant?.type === 'object' &&
    hasExactRequired(retiredVariant, ['status', 'retired_at']) &&
    hasExactKeys(retiredVariant?.properties, ['status', 'retired_at']) &&
    retiredVariant?.properties?.status?.type === 'string' &&
    retiredVariant?.properties?.status?.const === 'retired' &&
    retiredVariant?.properties?.retired_at?.$ref ===
      '#/components/schemas/ApiTimestamp',
  'Contract schema must reject active-with-timestamp and retired-with-null lifecycle combinations.'
)

rejectUnless(
  /null.*status.*active.*server-generated timestamp.*status.*retired/is.test(
    contract?.properties?.retired_at?.description ?? ''
  ),
  'Contract status must remain coupled to server-owned retirement evidence.'
)

rejectUnless(
  schemas.ContractResponse?.type === 'object' &&
    schemas.ContractResponse?.additionalProperties === false &&
    hasExactRequired(schemas.ContractResponse, ['data']) &&
    hasExactKeys(schemas.ContractResponse?.properties, ['data']) &&
    schemas.ContractResponse?.properties?.data?.$ref ===
      '#/components/schemas/Contract',
  'Single Contract responses must use the closed data envelope.'
)
rejectUnless(
  schemas.ContractCollectionResponse?.type === 'object' &&
    schemas.ContractCollectionResponse?.additionalProperties === false &&
    hasExactRequired(schemas.ContractCollectionResponse, [
      'data',
      'links',
      'meta',
    ]) &&
    hasExactKeys(schemas.ContractCollectionResponse?.properties, [
      'data',
      'links',
      'meta',
    ]) &&
    schemas.ContractCollectionResponse?.properties?.data?.items?.$ref ===
      '#/components/schemas/Contract' &&
    schemas.ContractCollectionResponse?.properties?.links?.$ref ===
      '#/components/schemas/PaginationLinks' &&
    schemas.ContractCollectionResponse?.properties?.meta?.$ref ===
      '#/components/schemas/PaginationMeta',
  'Contract lists must use the standard data, links, and meta envelope.'
)

const forbiddenPublicFields = new Set([
  'tenant_id',
  'audit_id',
  'actor_id',
  'service_bookings',
  'cost_centers',
  'constraint_name',
  'trigger_name',
])
rejectUnless(
  ![contract, createRequest, updateRequest].some((schema) =>
    containsKey(schema, forbiddenPublicFields)
  ),
  'Contract public schemas must exclude tenant, audit, persistence, and adjacent-resource internals.'
)

const notFound = schemas.ContractNotFoundError
rejectUnless(
  responses.ContractNotFound?.content?.['application/json']?.schema?.$ref ===
    '#/components/schemas/ContractNotFoundError' &&
    /contract or customer/i.test(
      responses.ContractNotFound?.description ?? ''
    ) &&
    /indistinguishable/i.test(responses.ContractNotFound?.description ?? '') &&
    notFound?.type === 'object' &&
    notFound?.additionalProperties === false &&
    hasExactKeys(notFound?.properties, ['message', 'code']) &&
    hasExactRequired(notFound, ['message', 'code']) &&
    notFound?.properties?.message?.const === 'Resource not found' &&
    notFound?.properties?.code?.const === 'NOT_FOUND',
  'ContractNotFound must be closed, neutral, and information-poor.'
)

const conflict = schemas.ContractConflictError
rejectUnless(
  responses.ContractConflict?.content?.['application/json']?.schema?.$ref ===
    '#/components/schemas/ContractConflictError' &&
    conflict?.type === 'object' &&
    conflict?.additionalProperties === false &&
    hasExactKeys(conflict?.properties, ['message', 'code']) &&
    hasExactRequired(conflict, ['message', 'code']) &&
    conflict?.properties?.message?.type === 'string' &&
    conflict?.properties?.code?.type === 'string' &&
    conflict?.properties?.code?.const === 'CONFLICT',
  'Contract conflicts must use a closed neutral envelope without history or persistence details.'
)

rejectUnless(
  /active tenant/i.test(operations.list?.description ?? '') &&
    /created_at.*descending/is.test(operations.list?.description ?? '') &&
    /id.*descending/is.test(operations.list?.description ?? ''),
  'Contract list must be active-tenant scoped and deterministically ordered.'
)
rejectUnless(
  /server-owned/is.test(operations.create?.description ?? '') &&
    /active/is.test(operations.create?.description ?? '') &&
    /committed/is.test(operations.create?.description ?? ''),
  'Contract creation must document server-owned lifecycle and committed state.'
)
rejectUnless(
  /only active contracts.*patch/is.test(operations.update?.description ?? '') &&
    /retired.*409/is.test(operations.update?.description ?? '') &&
    /customer_id.*service booking history.*409/is.test(
      operations.update?.description ?? ''
    ) &&
    /currency_code.*service booking history.*409/is.test(
      operations.update?.description ?? ''
    ) &&
    /unit_price.*not retroactive/is.test(
      operations.update?.description ?? ''
    ) &&
    /ends_on.*null.*clear/is.test(operations.update?.description ?? ''),
  'PATCH must document lifecycle, history, price, and null-clearing semantics.'
)
rejectUnless(
  /terminal/is.test(operations.retire?.description ?? '') &&
    /already retired.*409/is.test(operations.retire?.description ?? '') &&
    /no reopen/is.test(operations.retire?.description ?? '') &&
    /committed/is.test(operations.retire?.description ?? ''),
  'Retirement must be explicit, terminal, conflict-aware, and committed.'
)
rejectUnless(
  /ends_on.*null.*starts_on/is.test(createRequest?.description ?? '') &&
    /ends_on.*null.*starts_on/is.test(updateRequest?.description ?? ''),
  'Create and update must document the Contract date relationship.'
)

if (errors.length > 0) {
  console.error('Contract CRUD OpenAPI guard failed:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log('Contract CRUD OpenAPI guard passed.')
