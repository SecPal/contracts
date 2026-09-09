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
    'Usage: node scripts/check-legal-hold-contract.mjs <path-to-openapi.yaml>'
  )
  process.exit(2)
}

let document
try {
  document = yaml.load(fs.readFileSync(path.resolve(target), 'utf8'), {
    schema: yaml.JSON_SCHEMA,
  })
} catch (error) {
  console.error(`Unable to parse Legal Hold contract candidate: ${target}`)
  console.error(error)
  process.exit(2)
}

const errors = []
const paths = document?.paths ?? {}
const schemas = document?.components?.schemas ?? {}
const responses = document?.components?.responses ?? {}
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
const REQUIRED_OPERATIONS = new Map([
  ['/legal-holds', ['get', 'post']],
  ['/legal-holds/{legalHold}', ['get']],
  ['/legal-holds/{legalHold}/attachments', ['post']],
  ['/legal-holds/{legalHold}/attachments/{attachment}/detach', ['post']],
  ['/legal-holds/{legalHold}/release', ['post']],
])
const MUTATIONS = [
  paths['/legal-holds']?.post,
  paths['/legal-holds/{legalHold}/attachments']?.post,
  paths['/legal-holds/{legalHold}/attachments/{attachment}/detach']?.post,
  paths['/legal-holds/{legalHold}/release']?.post,
]

function rejectUnless(condition, message) {
  if (!condition) errors.push(message)
}

function operationMethods(pathItem) {
  return Object.keys(pathItem ?? {}).filter((key) => HTTP_METHODS.has(key))
}

function responseSchema(operation, status) {
  return operation?.responses?.[status]?.content?.['application/json']?.schema
}

function requestSchemaRef(operation) {
  return operation?.requestBody?.content?.['application/json']?.schema?.$ref
}

function hasExactProperties(schema, names) {
  return isDeepStrictEqual(
    Object.keys(schema?.properties ?? {}).sort(),
    names.sort()
  )
}

function hasExactRequired(schema, names) {
  return isDeepStrictEqual([...(schema?.required ?? [])].sort(), names.sort())
}

function responseRef(operation, status, name) {
  return (
    operation?.responses?.[status]?.$ref === `#/components/responses/${name}`
  )
}

function containsForbiddenKey(value, forbidden) {
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenKey(item, forbidden))
  }
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(
    ([key, child]) =>
      forbidden.has(key) || containsForbiddenKey(child, forbidden)
  )
}

for (const [pathKey, methods] of REQUIRED_OPERATIONS) {
  rejectUnless(paths[pathKey], `Missing Legal Hold path: ${pathKey}`)
  rejectUnless(
    isDeepStrictEqual(
      operationMethods(paths[pathKey]).sort(),
      [...methods].sort()
    ),
    `${pathKey} must expose exactly: ${methods.join(', ')}`
  )
}

const legalHoldPaths = Object.keys(paths).filter((pathKey) =>
  pathKey.startsWith('/legal-holds')
)
rejectUnless(
  isDeepStrictEqual(
    legalHoldPaths.sort(),
    [...REQUIRED_OPERATIONS.keys()].sort()
  ),
  'Legal Hold must expose only the five canonical paths and six required operations.'
)

const operations = {
  list: paths['/legal-holds']?.get,
  create: paths['/legal-holds']?.post,
  inspect: paths['/legal-holds/{legalHold}']?.get,
  attach: paths['/legal-holds/{legalHold}/attachments']?.post,
  detach:
    paths['/legal-holds/{legalHold}/attachments/{attachment}/detach']?.post,
  release: paths['/legal-holds/{legalHold}/release']?.post,
}

const successContracts = {
  list: ['200', 'LegalHoldCollectionResponse'],
  create: ['201', 'LegalHoldResponse'],
  inspect: ['200', 'LegalHoldResponse'],
  attach: ['201', 'LegalHoldActivityAttachmentResponse'],
  detach: ['200', 'LegalHoldActivityAttachmentResponse'],
  release: ['200', 'LegalHoldResponse'],
}

for (const [name, [status, schemaName]] of Object.entries(successContracts)) {
  const successStatuses = Object.keys(operations[name]?.responses ?? {}).filter(
    (candidate) => /^2\d\d$/.test(candidate)
  )
  rejectUnless(
    isDeepStrictEqual(successStatuses, [status]) &&
      responseSchema(operations[name], status)?.$ref ===
        `#/components/schemas/${schemaName}`,
    `${name} must return only ${status} with ${schemaName}.`
  )
}

rejectUnless(
  new Set(Object.values(operations).map((operation) => operation?.operationId))
    .size === 6,
  'Legal Hold operation IDs must be present and unique.'
)

const expectedPermissions = {
  list: 'legal_holds.read',
  create: 'legal_holds.create',
  inspect: 'legal_holds.read',
  attach: 'legal_holds.attach',
  detach: 'legal_holds.detach',
  release: 'legal_holds.release',
}
for (const [name, permission] of Object.entries(expectedPermissions)) {
  const description = operations[name]?.description ?? ''
  rejectUnless(
    description.includes(`\`${permission}\``),
    `${name} must name the ${permission} capability.`
  )
  rejectUnless(
    !/legal[-_]hold:[a-z]/i.test(description),
    `${name} must not use a legacy colon-style permission.`
  )
}

const createRequest = schemas.LegalHoldCreateRequest
const attachRequest = schemas.LegalHoldAttachRequest
const detachRequest = schemas.LegalHoldDetachRequest
const releaseRequest = schemas.LegalHoldReleaseRequest
const justification = schemas.LegalHoldJustification

rejectUnless(
  requestSchemaRef(operations.create) ===
    '#/components/schemas/LegalHoldCreateRequest',
  'Create must use LegalHoldCreateRequest.'
)
rejectUnless(
  hasExactProperties(createRequest, ['case_reference', 'justification']) &&
    hasExactRequired(createRequest, ['case_reference', 'justification']) &&
    createRequest?.additionalProperties === false,
  'Create accepts exactly required case_reference and justification fields.'
)
rejectUnless(
  createRequest?.properties?.case_reference?.type === 'string' &&
    createRequest?.properties?.case_reference?.minLength === 1 &&
    createRequest?.properties?.case_reference?.maxLength === 64,
  'Create case_reference must contain 1 to 64 characters.'
)
rejectUnless(
  justification?.type === 'string' &&
    justification?.minLength === 1 &&
    justification?.maxLength === 2000,
  'Legal Hold justifications must contain 1 to 2000 characters.'
)

rejectUnless(
  requestSchemaRef(operations.attach) ===
    '#/components/schemas/LegalHoldAttachRequest' &&
    hasExactProperties(attachRequest, ['activity_id']) &&
    hasExactRequired(attachRequest, ['activity_id']) &&
    attachRequest?.additionalProperties === false &&
    attachRequest?.properties?.activity_id?.type === 'integer' &&
    attachRequest?.properties?.activity_id?.minimum === 1,
  'Attach accepts exactly one required positive integer activity_id.'
)

for (const [name, schemaName, schema] of [
  ['detach', 'LegalHoldDetachRequest', detachRequest],
  ['release', 'LegalHoldReleaseRequest', releaseRequest],
]) {
  rejectUnless(
    requestSchemaRef(operations[name]) ===
      `#/components/schemas/${schemaName}` &&
      hasExactProperties(schema, ['justification']) &&
      hasExactRequired(schema, ['justification']) &&
      schema?.properties?.justification?.$ref ===
        '#/components/schemas/LegalHoldJustification' &&
      schema?.additionalProperties === false,
    `${name} requires exactly one bounded justification.`
  )
}

const requestSchemas = [
  createRequest,
  attachRequest,
  detachRequest,
  releaseRequest,
]
rejectUnless(
  !requestSchemas.some((schema) =>
    containsForbiddenKey(schema, new Set(['tenant_id']))
  ),
  'Legal Hold requests must never accept tenant_id.'
)

rejectUnless(
  isDeepStrictEqual(schemas.LegalHoldStatus?.enum, ['active', 'released']),
  'LegalHoldStatus must be exactly active and released.'
)

const commonFields = schemas.LegalHoldCommonFields
rejectUnless(
  hasExactProperties(commonFields, [
    'id',
    'case_reference',
    'status',
    'created_at',
    'released_at',
  ]),
  'Legal Hold summary fields must remain privacy-minimized.'
)
rejectUnless(
  schemas.LegalHoldSummary?.allOf?.[0]?.$ref ===
    '#/components/schemas/LegalHoldCommonFields' &&
    schemas.LegalHoldSummary?.unevaluatedProperties === false,
  'LegalHoldSummary must strictly compose the common fields.'
)

const legalHoldDetail = schemas.LegalHold?.allOf?.[1]
rejectUnless(
  schemas.LegalHold?.allOf?.[0]?.$ref ===
    '#/components/schemas/LegalHoldCommonFields' &&
    hasExactProperties(legalHoldDetail, [
      'justification',
      'release_justification',
      'attachments',
    ]) &&
    schemas.LegalHold?.unevaluatedProperties === false,
  'LegalHold detail must add only justifications and attachment history.'
)

const attachment = schemas.LegalHoldActivityAttachment
rejectUnless(
  hasExactProperties(attachment, [
    'id',
    'activity_id',
    'attached_at',
    'detached_at',
    'detachment_justification',
  ]) &&
    attachment?.additionalProperties === false &&
    attachment?.properties?.activity_id?.type === 'integer',
  'Attachment responses must expose only stable evidence-link facts.'
)

const forbiddenResponseFields = new Set([
  'tenant_id',
  'created_by_user_id',
  'created_by_identity_id',
  'released_by_user_id',
  'released_by_identity_id',
  'attached_by_user_id',
  'attached_by_identity_id',
  'detached_by_user_id',
  'detached_by_identity_id',
  'activity_identity_id',
  'previous_hash',
  'event_hash',
  'merkle_root',
  'merkle_proof',
  'ots_proof',
  'audit_metadata',
  'encryption_key',
])
rejectUnless(
  ![commonFields, schemas.LegalHold, schemas.LegalHoldSummary, attachment].some(
    (schema) => containsForbiddenKey(schema, forbiddenResponseFields)
  ),
  'Legal Hold resources must exclude tenant, actor, audit, hash, and storage internals.'
)

rejectUnless(
  responseSchema(operations.list, '200')?.$ref ===
    '#/components/schemas/LegalHoldCollectionResponse' &&
    schemas.LegalHoldCollectionResponse?.properties?.data?.items?.$ref ===
      '#/components/schemas/LegalHoldSummary' &&
    schemas.LegalHoldCollectionResponse?.properties?.links?.$ref ===
      '#/components/schemas/PaginationLinks' &&
    schemas.LegalHoldCollectionResponse?.properties?.meta?.$ref ===
      '#/components/schemas/PaginationMeta',
  'List must use the standard paginated summary envelope.'
)

for (const name of ['create', 'attach', 'detach', 'release']) {
  rejectUnless(
    operations[name]?.responses?.['409'],
    `${name} must document 409 state conflicts.`
  )
  rejectUnless(
    responseRef(operations[name], '422', 'LegalHoldValidationError'),
    `${name} must document malformed input as 422.`
  )
}

for (const name of ['list', 'inspect']) {
  rejectUnless(
    responseRef(operations[name], '422', 'LegalHoldValidationError'),
    `${name} must document malformed input as 422.`
  )
}

for (const [name, operation] of Object.entries(operations)) {
  rejectUnless(
    responseRef(operation, '401', 'Unauthorized') &&
      responseRef(operation, '403', 'Forbidden'),
    `${name} must use the repository-wide 401 and 403 responses.`
  )
}

for (const name of ['inspect', 'attach', 'detach', 'release']) {
  rejectUnless(
    responseRef(operations[name], '404', 'LegalHoldNotFound'),
    `${name} must use the information-poor Legal Hold 404 response.`
  )
}
rejectUnless(
  /active tenant/i.test(responses.LegalHoldNotFound?.description ?? '') &&
    /indistinguishable/i.test(responses.LegalHoldNotFound?.description ?? ''),
  'LegalHoldNotFound must conceal foreign-tenant and nonexistent targets.'
)

for (const operation of MUTATIONS) {
  const description = operation?.description ?? ''
  rejectUnless(
    responseRef(operation, '500', 'InternalServerError') &&
      /committed/i.test(description) &&
      /audit/i.test(description) &&
      /does not commit/i.test(description),
    'Every mutation must document committed audit atomicity and neutral 500 failure.'
  )
}

rejectUnless(
  /created_at.*descending/i.test(operations.list?.description ?? '') &&
    /id.*descending/i.test(operations.list?.description ?? '') &&
    /active tenant/i.test(operations.list?.description ?? ''),
  'List must be active-tenant scoped and deterministically ordered.'
)
rejectUnless(
  /prevents normal Activity retention deletion/i.test(
    operations.attach?.description ?? ''
  ) &&
    /does not protect the Activity/i.test(
      operations.detach?.description ?? ''
    ) &&
    /normal retention eligibility/i.test(
      operations.release?.description ?? ''
    ) &&
    /does not trigger immediate deletion/i.test(
      operations.release?.description ?? ''
    ),
  'Attachment and release operations must preserve the accepted retention contract.'
)

if (errors.length > 0) {
  console.error('Legal Hold OpenAPI contract guard failed:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log('Legal Hold OpenAPI contract guard passed.')
