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
    'Usage: node scripts/check-work-instruction-lifecycle.mjs <path-to-openapi.yaml>'
  )
  process.exit(2)
}

let document
try {
  document = yaml.load(fs.readFileSync(path.resolve(target), 'utf8'), {
    schema: yaml.JSON_SCHEMA,
  })
} catch (error) {
  console.error(`Unable to parse Work Instruction candidate: ${target}`)
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
const WORK_INSTRUCTION_PATHS = new Map([
  ['/work-instructions', ['get', 'post']],
  ['/work-instructions/{workInstruction}', ['get', 'patch']],
  ['/work-instructions/{workInstruction}/submit-for-review', ['post']],
  ['/work-instructions/{workInstruction}/publish', ['post']],
  ['/work-instructions/{workInstruction}/archive', ['post']],
])
const RESOURCE_FIELDS = [
  'id',
  'instruction_number',
  'title',
  'body',
  'locale',
  'status',
  'published_at',
  'published_by_user_id',
  'archived_at',
  'archived_by_user_id',
  'created_at',
  'updated_at',
]
const CREATE_FIELDS = ['instruction_number', 'title', 'body', 'locale']
const UPDATE_FIELDS = ['title', 'body', 'locale']
const SERVER_OWNED_FIELDS = [
  'id',
  'status',
  'published_at',
  'published_by_user_id',
  'archived_at',
  'archived_by_user_id',
  'created_at',
  'updated_at',
]
const UNSUPPORTED_FIELDS = new Set([
  'tenant_id',
  'valid_from',
  'valid_until',
  'effective_date',
  'version',
  'scope',
  'scope_criteria',
  'recipient_scope',
  'employee_ids',
  'role_ids',
  'site_ids',
  'location_ids',
  'organizational_unit_ids',
  'requires_acknowledgment',
  'acknowledgment_deadline',
  'acknowledgment_deadline_days',
  'sections',
  'template_id',
  'standard_block_ids',
])
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

function mentionedPermissions(operation) {
  return [
    ...(operation?.description ?? '').matchAll(/`([a-z_-]+\.[a-z_]+)`/g),
  ].map((match) => match[1])
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

for (const [pathKey, methods] of WORK_INSTRUCTION_PATHS) {
  rejectUnless(paths[pathKey], `Missing Work Instruction path: ${pathKey}`)
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
      .filter((pathKey) => pathKey.startsWith('/work-instructions'))
      .sort(),
    [...WORK_INSTRUCTION_PATHS.keys()].sort()
  ),
  'Work Instructions must expose exactly five canonical paths and seven operations; delete, reopen, unpublish, and return-to-draft aliases are forbidden.'
)
rejectUnless(
  !Object.keys(paths).some(
    (pathKey) =>
      pathKey.startsWith('/work-instruction-templates') ||
      pathKey.startsWith('/standard-blocks') ||
      /\/acknowledg(?:e|ments?)(?:\/|$)/.test(pathKey)
  ),
  'Template, standard-block, and acknowledgment surfaces belong to separate contracts.'
)

const operations = {
  list: paths['/work-instructions']?.get,
  create: paths['/work-instructions']?.post,
  inspect: paths['/work-instructions/{workInstruction}']?.get,
  update: paths['/work-instructions/{workInstruction}']?.patch,
  submit: paths['/work-instructions/{workInstruction}/submit-for-review']?.post,
  publish: paths['/work-instructions/{workInstruction}/publish']?.post,
  archive: paths['/work-instructions/{workInstruction}/archive']?.post,
}
const operationContracts = {
  list: [
    'listWorkInstructions',
    'work_instructions.read',
    '200',
    'WorkInstructionCollectionResponse',
  ],
  create: [
    'createWorkInstruction',
    'work_instructions.create',
    '201',
    'WorkInstructionResponse',
  ],
  inspect: [
    'getWorkInstruction',
    'work_instructions.read',
    '200',
    'WorkInstructionResponse',
  ],
  update: [
    'updateWorkInstruction',
    'work_instructions.update',
    '200',
    'WorkInstructionResponse',
  ],
  submit: [
    'submitWorkInstructionForReview',
    'work_instructions.update',
    '200',
    'WorkInstructionResponse',
  ],
  publish: [
    'publishWorkInstruction',
    'work_instructions.publish',
    '200',
    'WorkInstructionResponse',
  ],
  archive: [
    'archiveWorkInstruction',
    'work_instructions.archive',
    '200',
    'WorkInstructionResponse',
  ],
}

for (const [name, contract] of Object.entries(operationContracts)) {
  const [operationId, permission, status, responseSchema] = contract
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
    isDeepStrictEqual(operation?.tags, ['Work Instructions']),
    `${name} must use only the Work Instructions tag.`
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

rejectUnless(
  isDeepStrictEqual(
    [
      ...new Set(Object.values(operations).flatMap(mentionedPermissions)),
    ].sort(),
    [
      'work_instructions.archive',
      'work_instructions.create',
      'work_instructions.publish',
      'work_instructions.read',
      'work_instructions.update',
    ]
  ),
  'The lifecycle surface must define exactly the five accepted Work Instruction capabilities.'
)

rejectUnless(
  isDeepStrictEqual(
    (operations.list?.parameters ?? []).map((parameter) => parameter?.name),
    ['page', 'per_page']
  ) &&
    operations.list?.parameters?.[0]?.schema?.minimum === 1 &&
    operations.list?.parameters?.[0]?.schema?.default === 1 &&
    operations.list?.parameters?.[1]?.schema?.minimum === 1 &&
    operations.list?.parameters?.[1]?.schema?.maximum === 100 &&
    operations.list?.parameters?.[1]?.schema?.default === 15,
  'Work Instruction list must expose only page=1 and per_page=15 pagination with a maximum of 100.'
)
rejectUnless(
  /created_at DESC.*id DESC/s.test(operations.list?.description ?? ''),
  'Work Instruction list ordering must be created_at DESC then id DESC.'
)

rejectUnless(
  parameters.WorkInstructionId?.name === 'workInstruction' &&
    parameters.WorkInstructionId?.in === 'path' &&
    parameters.WorkInstructionId?.required === true &&
    parameters.WorkInstructionId?.schema?.type === 'string' &&
    parameters.WorkInstructionId?.schema?.format === 'uuid' &&
    ['inspect', 'update', 'submit', 'publish', 'archive'].every((name) =>
      isDeepStrictEqual(operations[name]?.parameters, [
        { $ref: '#/components/parameters/WorkInstructionId' },
      ])
    ),
  'Work Instruction item operations must reuse the canonical WorkInstructionId parameter.'
)

rejectUnless(
  requestRef(operations.create, 'WorkInstructionCreateRequest'),
  'Create must use WorkInstructionCreateRequest.'
)
rejectUnless(
  requestRef(operations.update, 'WorkInstructionUpdateRequest'),
  'PATCH must use WorkInstructionUpdateRequest.'
)
for (const name of ['submit', 'publish', 'archive']) {
  rejectUnless(
    operations[name] && !('requestBody' in operations[name]),
    `${name} must accept no request body.`
  )
}

const createSchema = schemas.WorkInstructionCreateRequest
rejectUnless(
  createSchema?.type === 'object' &&
    createSchema?.additionalProperties === false &&
    exactKeys(createSchema?.properties, CREATE_FIELDS) &&
    exactRequired(createSchema, CREATE_FIELDS),
  'Create must be closed and require exactly instruction_number, title, body, and locale.'
)
rejectUnless(
  createSchema?.properties?.instruction_number?.type === 'string' &&
    createSchema.properties.instruction_number.minLength === 1 &&
    createSchema.properties.instruction_number.maxLength === 64 &&
    createSchema.properties.instruction_number.pattern === NONBLANK_PATTERN &&
    createSchema?.properties?.title?.type === 'string' &&
    createSchema.properties.title.minLength === 1 &&
    createSchema.properties.title.maxLength === 255 &&
    createSchema.properties.title.pattern === NONBLANK_PATTERN &&
    createSchema?.properties?.body?.type === 'string' &&
    createSchema.properties.body.minLength === 1 &&
    createSchema.properties.body.pattern === NONBLANK_PATTERN &&
    createSchema?.properties?.locale?.$ref ===
      '#/components/schemas/WorkInstructionLocale',
  'Create text must be nonblank with persisted bounds and locale must use the closed WorkInstructionLocale schema.'
)

const updateSchema = schemas.WorkInstructionUpdateRequest
rejectUnless(
  updateSchema?.type === 'object' &&
    updateSchema?.additionalProperties === false &&
    updateSchema?.minProperties === 1 &&
    exactKeys(updateSchema?.properties, UPDATE_FIELDS) &&
    exactRequired(updateSchema, []),
  'PATCH must be partial, non-empty, closed, and allow only title, body, and locale.'
)
rejectUnless(
  updateSchema?.properties?.title?.type === 'string' &&
    updateSchema.properties.title.minLength === 1 &&
    updateSchema.properties.title.maxLength === 255 &&
    updateSchema.properties.title.pattern === NONBLANK_PATTERN &&
    updateSchema?.properties?.body?.type === 'string' &&
    updateSchema.properties.body.minLength === 1 &&
    updateSchema.properties.body.pattern === NONBLANK_PATTERN &&
    updateSchema?.properties?.locale?.$ref ===
      '#/components/schemas/WorkInstructionLocale',
  'PATCH text must be nonblank with persisted bounds and locale must use the closed WorkInstructionLocale schema.'
)

rejectUnless(
  isDeepStrictEqual(schemas.WorkInstructionStatus?.enum, [
    'draft',
    'in_review',
    'published',
    'archived',
  ]),
  'Work Instruction lifecycle must be exactly draft, in_review, published, archived.'
)
rejectUnless(
  isDeepStrictEqual(schemas.WorkInstructionLocale?.enum, ['de', 'en']),
  'Work Instruction locale must be exactly de and en.'
)

const resourceSchema = schemas.WorkInstruction
rejectUnless(
  resourceSchema?.type === 'object' &&
    resourceSchema?.additionalProperties === false &&
    exactKeys(resourceSchema?.properties, RESOURCE_FIELDS) &&
    exactRequired(resourceSchema, RESOURCE_FIELDS),
  'Work Instruction responses must expose exactly the authoritative persisted public field set.'
)
rejectUnless(
  SERVER_OWNED_FIELDS.every(
    (field) => resourceSchema?.properties?.[field]?.readOnly === true
  ) &&
    !resourceSchema?.properties?.instruction_number?.readOnly &&
    !updateSchema?.properties?.instruction_number,
  'Identity, lifecycle evidence, and timestamps must be read-only while instruction_number remains create-only and immutable.'
)
rejectUnless(
  resourceSchema?.properties?.id?.type === 'string' &&
    resourceSchema.properties.id.format === 'uuid' &&
    resourceSchema?.properties?.instruction_number?.type === 'string' &&
    resourceSchema.properties.instruction_number.minLength === 1 &&
    resourceSchema.properties.instruction_number.maxLength === 64 &&
    resourceSchema.properties.instruction_number.pattern === NONBLANK_PATTERN &&
    resourceSchema?.properties?.title?.type === 'string' &&
    resourceSchema.properties.title.minLength === 1 &&
    resourceSchema.properties.title.maxLength === 255 &&
    resourceSchema.properties.title.pattern === NONBLANK_PATTERN &&
    resourceSchema?.properties?.body?.type === 'string' &&
    resourceSchema.properties.body.minLength === 1 &&
    resourceSchema.properties.body.pattern === NONBLANK_PATTERN &&
    resourceSchema?.properties?.locale?.$ref ===
      '#/components/schemas/WorkInstructionLocale' &&
    resourceSchema?.properties?.status?.$ref ===
      '#/components/schemas/WorkInstructionStatus' &&
    resourceSchema?.properties?.published_at?.$ref ===
      '#/components/schemas/NullableApiTimestamp' &&
    resourceSchema?.properties?.published_by_user_id?.$ref ===
      '#/components/schemas/NullableWorkInstructionActorId' &&
    resourceSchema?.properties?.archived_at?.$ref ===
      '#/components/schemas/NullableApiTimestamp' &&
    resourceSchema?.properties?.archived_by_user_id?.$ref ===
      '#/components/schemas/NullableWorkInstructionActorId' &&
    resourceSchema?.properties?.created_at?.$ref ===
      '#/components/schemas/ApiTimestamp' &&
    resourceSchema?.properties?.updated_at?.$ref ===
      '#/components/schemas/ApiTimestamp' &&
    isDeepStrictEqual(schemas.NullableWorkInstructionActorId?.type, [
      'string',
      'null',
    ]) &&
    schemas.NullableWorkInstructionActorId?.format === 'uuid',
  'Work Instruction response fields must preserve their authoritative schemas.'
)
rejectUnless(
  !containsPropertyName(
    {
      properties: {
        WorkInstruction: resourceSchema,
        WorkInstructionCreateRequest: createSchema,
        WorkInstructionUpdateRequest: updateSchema,
      },
    },
    UNSUPPORTED_FIELDS
  ),
  'Tenant, template, acknowledgment, scope, version, effective-date, recipient, and section fields are forbidden from Work Instruction schemas.'
)

const lifecycleBranches = resourceSchema?.oneOf ?? []
rejectUnless(
  isDeepStrictEqual(
    lifecycleBranches.map((branch) => branch?.properties?.status?.const),
    ['draft', 'in_review', 'published', 'archived']
  ) &&
    lifecycleBranches.every((branch) =>
      exactRequired(branch, [
        'status',
        'published_at',
        'published_by_user_id',
        'archived_at',
        'archived_by_user_id',
      ])
    ) &&
    ['draft', 'in_review'].every((status, index) =>
      [
        'published_at',
        'published_by_user_id',
        'archived_at',
        'archived_by_user_id',
      ].every(
        (field) =>
          lifecycleBranches[index]?.properties?.[field]?.type === 'null'
      )
    ) &&
    lifecycleBranches[2]?.properties?.published_at?.$ref ===
      '#/components/schemas/ApiTimestamp' &&
    lifecycleBranches[2]?.properties?.published_by_user_id?.$ref ===
      '#/components/schemas/NullableWorkInstructionActorId' &&
    lifecycleBranches[2]?.properties?.archived_at?.type === 'null' &&
    lifecycleBranches[2]?.properties?.archived_by_user_id?.type === 'null' &&
    lifecycleBranches[3]?.properties?.published_at?.$ref ===
      '#/components/schemas/ApiTimestamp' &&
    lifecycleBranches[3]?.properties?.published_by_user_id?.$ref ===
      '#/components/schemas/NullableWorkInstructionActorId' &&
    lifecycleBranches[3]?.properties?.archived_at?.$ref ===
      '#/components/schemas/ApiTimestamp' &&
    lifecycleBranches[3]?.properties?.archived_by_user_id?.$ref ===
      '#/components/schemas/NullableWorkInstructionActorId' &&
    lifecycleBranches[3]?.['x-secpal-temporal-invariant'] ===
      'archived_at >= published_at',
  'Lifecycle response branches must couple each status to its authoritative nullable publication and archive evidence.'
)

rejectUnless(
  schemas.WorkInstructionResponse?.additionalProperties === false &&
    exactRequired(schemas.WorkInstructionResponse, ['data']) &&
    exactKeys(schemas.WorkInstructionResponse?.properties, ['data']) &&
    schemas.WorkInstructionResponse?.properties?.data?.$ref ===
      '#/components/schemas/WorkInstruction' &&
    schemas.WorkInstructionCollectionResponse?.additionalProperties === false &&
    exactRequired(schemas.WorkInstructionCollectionResponse, [
      'data',
      'links',
      'meta',
    ]) &&
    schemas.WorkInstructionCollectionResponse?.properties?.data?.items?.$ref ===
      '#/components/schemas/WorkInstruction' &&
    schemas.WorkInstructionCollectionResponse?.properties?.links?.$ref ===
      '#/components/schemas/PaginationLinks' &&
    schemas.WorkInstructionCollectionResponse?.properties?.meta?.$ref ===
      '#/components/schemas/PaginationMeta',
  'Work Instruction responses must reuse the canonical data, links, and meta envelopes.'
)

rejectUnless(
  schemas.WorkInstructionNotFoundError?.additionalProperties === false &&
    exactRequired(schemas.WorkInstructionNotFoundError, ['message', 'code']) &&
    exactKeys(schemas.WorkInstructionNotFoundError?.properties, [
      'message',
      'code',
    ]) &&
    schemas.WorkInstructionNotFoundError?.properties?.message?.const ===
      'Resource not found' &&
    schemas.WorkInstructionNotFoundError?.properties?.code?.const ===
      'NOT_FOUND' &&
    schemas.WorkInstructionConflictError?.additionalProperties === false &&
    exactRequired(schemas.WorkInstructionConflictError, ['message', 'code']) &&
    exactKeys(schemas.WorkInstructionConflictError?.properties, [
      'message',
      'code',
    ]) &&
    schemas.WorkInstructionConflictError?.properties?.code?.const ===
      'CONFLICT',
  'Work Instruction not-found and conflict envelopes must be closed and information-poor.'
)

for (const [name, operation] of Object.entries(operations)) {
  const expectedResponses = new Set(['401', '403', '422', '429', '500'])
  if (name !== 'list' && name !== 'create') expectedResponses.add('404')
  if (['create', 'update', 'submit', 'publish', 'archive'].includes(name)) {
    expectedResponses.add('409')
  }
  rejectUnless(
    isDeepStrictEqual(
      Object.keys(operation?.responses ?? {}).sort(),
      [operationContracts[name][2], ...expectedResponses].sort()
    ),
    `${name} must expose exactly its success, 401, 403, 404 where applicable, 409 where applicable, 422, 429, and 500 responses.`
  )
  rejectUnless(
    responseRef(operation, '401', 'Unauthorized') &&
      responseRef(operation, '403', 'Forbidden') &&
      responseRef(operation, '422', 'WorkInstructionValidationError') &&
      responseRef(operation, '429', 'TooManyRequests') &&
      responseRef(operation, '500', 'InternalServerError'),
    `${name} must reuse the shared authentication, authorization, validation, throttling, and server error responses.`
  )
  if (expectedResponses.has('404')) {
    rejectUnless(
      responseRef(operation, '404', 'WorkInstructionNotFound'),
      `${name} must use the information-poor Work Instruction 404 response.`
    )
  }
  if (expectedResponses.has('409')) {
    rejectUnless(
      responseRef(operation, '409', 'WorkInstructionConflict'),
      `${name} must use the closed Work Instruction conflict response.`
    )
  }
}

rejectUnless(
  /performs only the draft-to-in_review transition.*any non-draft state\s+returns 409/is.test(
    operations.submit?.description ?? ''
  ) &&
    /performs only the in_review-to-published transition.*draft, published, and\s+archived states return 409.*no direct draft-to-published shortcut/is.test(
      operations.publish?.description ?? ''
    ) &&
    /performs only the published-to-archived terminal transition.*draft, in_review, and archived states return 409/is.test(
      operations.archive?.description ?? ''
    ),
  'Work Instruction lifecycle actions must preserve exactly draft-to-in_review, in_review-to-published, and published-to-archived with every other source state rejected.'
)

rejectUnless(
  /transactionally revalidates authoritative state/i.test(
    [
      operations.update?.description,
      operations.submit?.description,
      operations.publish?.description,
      operations.archive?.description,
    ].join(' ')
  ) &&
    /PATCH.*publish.*409/is.test(operations.update?.description ?? '') &&
    /exactly one.*publish.*succeeds.*409/is.test(
      operations.publish?.description ?? ''
    ) &&
    /exactly one.*archive.*succeeds.*409/is.test(
      operations.archive?.description ?? ''
    ),
  'Mutable and lifecycle operations must document transactional state revalidation and fail-closed race outcomes.'
)

if (errors.length > 0) {
  console.error('Work Instruction lifecycle OpenAPI guard failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Work Instruction lifecycle OpenAPI guard passed')
