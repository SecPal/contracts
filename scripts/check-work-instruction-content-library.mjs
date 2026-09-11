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
    'Usage: node scripts/check-work-instruction-content-library.mjs <path-to-openapi.yaml>'
  )
  process.exit(2)
}

let document
try {
  document = yaml.load(fs.readFileSync(path.resolve(target), 'utf8'), {
    schema: yaml.JSON_SCHEMA,
  })
} catch (error) {
  console.error(`Unable to parse Work Instruction content candidate: ${target}`)
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
const CONTENT_PATHS = new Map([
  ['/work-instruction-templates', ['get', 'post']],
  ['/work-instruction-templates/{workInstructionTemplate}', ['get', 'put']],
  ['/standard-blocks', ['get']],
  ['/standard-blocks/{standardBlock}', ['get']],
])
const TEMPLATE_FIELDS = [
  'id',
  'translations',
  'localized',
  'created_at',
  'updated_at',
]
const STANDARD_BLOCK_FIELDS = [
  'id',
  'key',
  'locked',
  'localized',
  'created_at',
  'updated_at',
]
const LOCALIZED_FIELDS = ['locale', 'title', 'body', 'fallback_used']
const FORBIDDEN_CONTENT_FIELDS = new Set([
  'tenant_id',
  'work_instruction_template_id',
  'work_instruction_standard_block_id',
  'translation_id',
  'translation_ids',
  'category',
  'categories',
  'is_system_template',
  'system_template',
  'status',
  'published_at',
  'published_by_user_id',
  'archived_at',
  'archived_by_user_id',
  'acknowledgment_count',
  'acknowledgments',
  'requires_acknowledgment',
  'recipient_scope',
  'version',
  'effective_date',
  'sections',
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
    exactKeys(operation?.requestBody?.content, ['application/json']) &&
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

function responseComponentSchemaRef(component, schema) {
  const response = responses[component]
  return (
    exactKeys(response?.content, ['application/json']) &&
    response?.content?.['application/json']?.schema?.$ref ===
      `#/components/schemas/${schema}`
  )
}

function mentionedPermissions(operation) {
  return [
    ...(operation?.description ?? '').matchAll(
      /`(work_instructions\.[a-z_]+)`/g
    ),
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

function containsPatternProperties(value) {
  if (!value || typeof value !== 'object') return false
  if (Object.hasOwn(value, 'patternProperties')) return true
  return Object.values(value).some(containsPatternProperties)
}

function isContentLibraryPath(pathKey) {
  return (
    /^\/work-instruction-templates?(?:-translations)?(?:\/|$)/.test(pathKey) ||
    /^\/standard-blocks?(?:-translations)?(?:\/|$)/.test(pathKey) ||
    /^\/work-instruction-standard-blocks?(?:-translations)?(?:\/|$)/.test(
      pathKey
    )
  )
}

for (const [pathKey, methods] of CONTENT_PATHS) {
  rejectUnless(paths[pathKey], `Missing content-library path: ${pathKey}`)
  rejectUnless(
    isDeepStrictEqual(
      operationMethods(paths[pathKey]).sort(),
      [...methods].sort()
    ),
    `${pathKey} must expose exactly: ${methods.join(', ')}`
  )
  rejectUnless(
    !Object.hasOwn(paths[pathKey] ?? {}, 'parameters'),
    'Content-library Path Items must not define inherited parameters.'
  )
}

rejectUnless(
  isDeepStrictEqual(
    Object.keys(paths).filter(isContentLibraryPath).sort(),
    [...CONTENT_PATHS.keys()].sort()
  ),
  'The content library must expose exactly four canonical paths and six operations; translation-row and mutation aliases are forbidden.'
)

const operations = {
  listTemplates: paths['/work-instruction-templates']?.get,
  createTemplate: paths['/work-instruction-templates']?.post,
  inspectTemplate:
    paths['/work-instruction-templates/{workInstructionTemplate}']?.get,
  replaceTemplate:
    paths['/work-instruction-templates/{workInstructionTemplate}']?.put,
  listStandardBlocks: paths['/standard-blocks']?.get,
  inspectStandardBlock: paths['/standard-blocks/{standardBlock}']?.get,
}
const operationContracts = {
  listTemplates: [
    'listWorkInstructionTemplates',
    'work_instructions.read',
    '200',
    'WorkInstructionTemplateCollectionResponse',
  ],
  createTemplate: [
    'createWorkInstructionTemplate',
    'work_instructions.create',
    '201',
    'WorkInstructionTemplateResponse',
  ],
  inspectTemplate: [
    'getWorkInstructionTemplate',
    'work_instructions.read',
    '200',
    'WorkInstructionTemplateResponse',
  ],
  replaceTemplate: [
    'replaceWorkInstructionTemplateTranslations',
    'work_instructions.update',
    '200',
    'WorkInstructionTemplateResponse',
  ],
  listStandardBlocks: [
    'listWorkInstructionStandardBlocks',
    'work_instructions.read',
    '200',
    'WorkInstructionStandardBlockCollectionResponse',
  ],
  inspectStandardBlock: [
    'getWorkInstructionStandardBlock',
    'work_instructions.read',
    '200',
    'WorkInstructionStandardBlockResponse',
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
      'work_instructions.create',
      'work_instructions.read',
      'work_instructions.update',
    ]
  ),
  'The content library must reuse exactly read, create, and update Work Instruction capabilities.'
)

for (const name of ['listTemplates', 'listStandardBlocks']) {
  const operation = operations[name]
  rejectUnless(
    isDeepStrictEqual(
      (operation?.parameters ?? [])
        .slice(0, 2)
        .map((parameter) => parameter?.name),
      ['page', 'per_page']
    ) &&
      operation.parameters?.length === 3 &&
      operation.parameters[0]?.in === 'query' &&
      operation.parameters[0]?.required === false &&
      operation.parameters[0]?.schema?.type === 'integer' &&
      operation.parameters[0]?.schema?.minimum === 1 &&
      operation.parameters[0]?.schema?.default === 1 &&
      operation.parameters[1]?.in === 'query' &&
      operation.parameters[1]?.required === false &&
      operation.parameters[1]?.schema?.type === 'integer' &&
      operation.parameters[1]?.schema?.minimum === 1 &&
      operation.parameters[1]?.schema?.maximum === 100 &&
      operation.parameters[1]?.schema?.default === 15 &&
      isDeepStrictEqual(operation.parameters?.[2], {
        $ref: '#/components/parameters/WorkInstructionContentLocaleQuery',
      }),
    `${name} must expose only page=1, per_page=15 (max 100), and optional locale.`
  )
  rejectUnless(
    /created_at DESC.*id DESC/s.test(operation?.description ?? ''),
    `${name} ordering must be created_at DESC then id DESC.`
  )
}

const itemParameterContracts = [
  [
    'inspectTemplate',
    '#/components/parameters/WorkInstructionTemplateId',
    true,
  ],
  [
    'replaceTemplate',
    '#/components/parameters/WorkInstructionTemplateId',
    false,
  ],
  [
    'inspectStandardBlock',
    '#/components/parameters/WorkInstructionStandardBlockId',
    true,
  ],
]
for (const [name, identifierRef, localizedRead] of itemParameterContracts) {
  const expected = [{ $ref: identifierRef }]
  if (localizedRead) {
    expected.push({
      $ref: '#/components/parameters/WorkInstructionContentLocaleQuery',
    })
  }
  rejectUnless(
    isDeepStrictEqual(operations[name]?.parameters, expected),
    `${name} must reuse its UUID identifier and locale only for inspect operations.`
  )
}

rejectUnless(
  !('parameters' in (operations.createTemplate ?? {})),
  'Template creation must not accept query parameters.'
)

for (const [name, parameter, publicName] of [
  [
    'WorkInstructionTemplateId',
    parameters.WorkInstructionTemplateId,
    'workInstructionTemplate',
  ],
  [
    'WorkInstructionStandardBlockId',
    parameters.WorkInstructionStandardBlockId,
    'standardBlock',
  ],
]) {
  rejectUnless(
    parameter?.name === publicName &&
      parameter?.in === 'path' &&
      parameter?.required === true &&
      parameter?.schema?.type === 'string' &&
      parameter?.schema?.format === 'uuid' &&
      /Malformed values.*422.*valid.*404/is.test(parameter?.description ?? ''),
    `${name} must be a required UUID with malformed-422 and neutral-404 semantics.`
  )
}

const localeQuery = parameters.WorkInstructionContentLocaleQuery
rejectUnless(
  localeQuery?.name === 'locale' &&
    localeQuery?.in === 'query' &&
    localeQuery?.required === false &&
    localeQuery?.schema?.$ref ===
      '#/components/schemas/WorkInstructionContentLocale' &&
    /preferred_locale.*Accept-Language.*configured application default/is.test(
      localeQuery?.description ?? ''
    ),
  'The optional locale query must reuse de/en and defer omission to the existing preferred-locale, Accept-Language, application-default hierarchy.'
)

rejectUnless(
  requestRef(
    operations.createTemplate,
    'WorkInstructionTemplateTranslationsRequest'
  ) &&
    requestRef(
      operations.replaceTemplate,
      'WorkInstructionTemplateTranslationsRequest'
    ),
  'Template create and complete replacement must use the same closed translations request.'
)
for (const name of [
  'listTemplates',
  'inspectTemplate',
  'listStandardBlocks',
  'inspectStandardBlock',
]) {
  rejectUnless(
    operations[name] && !('requestBody' in operations[name]),
    `${name} must accept no request body.`
  )
}

const localeSchema = schemas.WorkInstructionContentLocale
rejectUnless(
  localeSchema?.type === 'string' &&
    isDeepStrictEqual(localeSchema?.enum, ['de', 'en']),
  'Content locales must be exactly de and en.'
)

const translationSchema = schemas.WorkInstructionTranslation
rejectUnless(
  translationSchema?.type === 'object' &&
    translationSchema?.additionalProperties === false &&
    exactKeys(translationSchema?.properties, ['title', 'body']) &&
    exactRequired(translationSchema, ['title', 'body']) &&
    translationSchema.properties.title?.type === 'string' &&
    translationSchema.properties.title?.minLength === 1 &&
    translationSchema.properties.title?.maxLength === 255 &&
    translationSchema.properties.title?.pattern === NONBLANK_PATTERN &&
    translationSchema.properties.body?.type === 'string' &&
    translationSchema.properties.body?.minLength === 1 &&
    translationSchema.properties.body?.pattern === NONBLANK_PATTERN,
  'Stored translation values must contain exactly required nonblank title (max 255) and body.'
)

const translationsSchema = schemas.WorkInstructionTemplateTranslations
rejectUnless(
  translationsSchema?.type === 'object' &&
    translationsSchema?.additionalProperties === false &&
    translationsSchema?.minProperties === 1 &&
    translationsSchema?.maxProperties === 2 &&
    exactKeys(translationsSchema?.properties, ['de', 'en']) &&
    exactRequired(translationsSchema, []) &&
    ['de', 'en'].every(
      (locale) =>
        translationsSchema.properties?.[locale]?.$ref ===
        '#/components/schemas/WorkInstructionTranslation'
    ),
  'Template translations must be a closed de/en snapshot with at least one and at most two translations.'
)

const localizedSchema = schemas.WorkInstructionLocalizedContent
rejectUnless(
  localizedSchema?.type === 'object' &&
    localizedSchema?.additionalProperties === false &&
    exactKeys(localizedSchema?.properties, LOCALIZED_FIELDS) &&
    exactRequired(localizedSchema, LOCALIZED_FIELDS) &&
    localizedSchema.properties.locale?.$ref ===
      '#/components/schemas/WorkInstructionContentLocale' &&
    localizedSchema.properties.title?.type === 'string' &&
    localizedSchema.properties.title?.minLength === 1 &&
    localizedSchema.properties.title?.maxLength === 255 &&
    localizedSchema.properties.title?.pattern === NONBLANK_PATTERN &&
    localizedSchema.properties.body?.type === 'string' &&
    localizedSchema.properties.body?.minLength === 1 &&
    localizedSchema.properties.body?.pattern === NONBLANK_PATTERN &&
    localizedSchema.properties.fallback_used?.type === 'boolean' &&
    /actual returned content locale/is.test(
      localizedSchema.properties.locale?.description ?? ''
    ) &&
    /resolved.*translation exists.*other supported locale.*fallback_used.*no usable translation.*500/is.test(
      localizedSchema?.description ?? ''
    ),
  'Localized content must expose actual locale, nonblank title/body, fallback_used, and deterministic fail-closed fallback semantics.'
)

const writeSchema = schemas.WorkInstructionTemplateTranslationsRequest
rejectUnless(
  writeSchema?.type === 'object' &&
    writeSchema?.additionalProperties === false &&
    exactKeys(writeSchema?.properties, ['translations']) &&
    exactRequired(writeSchema, ['translations']) &&
    writeSchema.properties.translations?.$ref ===
      '#/components/schemas/WorkInstructionTemplateTranslations',
  'Template writes must accept exactly the required translations snapshot.'
)

const templateSchema = schemas.WorkInstructionTemplate
rejectUnless(
  templateSchema?.type === 'object' &&
    templateSchema?.additionalProperties === false &&
    exactKeys(templateSchema?.properties, TEMPLATE_FIELDS) &&
    exactRequired(templateSchema, TEMPLATE_FIELDS) &&
    templateSchema.properties.id?.type === 'string' &&
    templateSchema.properties.id?.format === 'uuid' &&
    templateSchema.properties.id?.readOnly === true &&
    templateSchema.properties.translations?.$ref ===
      '#/components/schemas/WorkInstructionTemplateTranslations' &&
    templateSchema.properties.localized?.$ref ===
      '#/components/schemas/WorkInstructionLocalizedContent' &&
    templateSchema.properties.created_at?.$ref ===
      '#/components/schemas/ApiTimestamp' &&
    templateSchema.properties.created_at?.readOnly === true &&
    templateSchema.properties.updated_at?.$ref ===
      '#/components/schemas/ApiTimestamp' &&
    templateSchema.properties.updated_at?.readOnly === true,
  'Template resources must expose exactly id, translations, localized, created_at, and updated_at.'
)

const standardBlockSchema = schemas.WorkInstructionStandardBlock
rejectUnless(
  standardBlockSchema?.type === 'object' &&
    standardBlockSchema?.additionalProperties === false &&
    exactKeys(standardBlockSchema?.properties, STANDARD_BLOCK_FIELDS) &&
    exactRequired(standardBlockSchema, STANDARD_BLOCK_FIELDS) &&
    standardBlockSchema.properties.id?.type === 'string' &&
    standardBlockSchema.properties.id?.format === 'uuid' &&
    standardBlockSchema.properties.id?.readOnly === true &&
    standardBlockSchema.properties.key?.type === 'string' &&
    standardBlockSchema.properties.key?.minLength === 1 &&
    standardBlockSchema.properties.key?.maxLength === 128 &&
    standardBlockSchema.properties.key?.pattern === NONBLANK_PATTERN &&
    standardBlockSchema.properties.key?.readOnly === true &&
    standardBlockSchema.properties.locked?.type === 'boolean' &&
    standardBlockSchema.properties.locked?.const === true &&
    standardBlockSchema.properties.locked?.readOnly === true &&
    standardBlockSchema.properties.localized?.$ref ===
      '#/components/schemas/WorkInstructionLocalizedContent' &&
    standardBlockSchema.properties.created_at?.$ref ===
      '#/components/schemas/ApiTimestamp' &&
    standardBlockSchema.properties.created_at?.readOnly === true &&
    standardBlockSchema.properties.updated_at?.$ref ===
      '#/components/schemas/ApiTimestamp' &&
    standardBlockSchema.properties.updated_at?.readOnly === true,
  'Standard Blocks must expose exactly stable key, derived read-only locked=true, localized content, identity, and timestamps.'
)

const contentSchemas = {
  WorkInstructionTranslation: translationSchema,
  WorkInstructionTemplateTranslations: translationsSchema,
  WorkInstructionLocalizedContent: localizedSchema,
  WorkInstructionTemplateTranslationsRequest: writeSchema,
  WorkInstructionTemplate: templateSchema,
  WorkInstructionStandardBlock: standardBlockSchema,
}
rejectUnless(
  !containsPropertyName(
    { properties: contentSchemas },
    FORBIDDEN_CONTENT_FIELDS
  ),
  'Content schemas must exclude tenant, translation-row, category, system-template, lifecycle, acknowledgment, version, scope, and section fields.'
)
rejectUnless(
  !containsPatternProperties(contentSchemas),
  'Closed content schemas must not use patternProperties to widen accepted or returned fields.'
)

for (const [schemaName, resourceName] of [
  ['WorkInstructionTemplateResponse', 'WorkInstructionTemplate'],
  ['WorkInstructionStandardBlockResponse', 'WorkInstructionStandardBlock'],
]) {
  const responseSchema = schemas[schemaName]
  rejectUnless(
    responseSchema?.type === 'object' &&
      responseSchema?.additionalProperties === false &&
      exactRequired(responseSchema, ['data']) &&
      exactKeys(responseSchema?.properties, ['data']) &&
      responseSchema.properties.data?.$ref ===
        `#/components/schemas/${resourceName}`,
    `${schemaName} must be the closed canonical data envelope.`
  )
}
for (const [schemaName, resourceName] of [
  ['WorkInstructionTemplateCollectionResponse', 'WorkInstructionTemplate'],
  [
    'WorkInstructionStandardBlockCollectionResponse',
    'WorkInstructionStandardBlock',
  ],
]) {
  const responseSchema = schemas[schemaName]
  rejectUnless(
    responseSchema?.type === 'object' &&
      responseSchema?.additionalProperties === false &&
      exactRequired(responseSchema, ['data', 'links', 'meta']) &&
      exactKeys(responseSchema?.properties, ['data', 'links', 'meta']) &&
      responseSchema.properties.data?.type === 'array' &&
      responseSchema.properties.data?.items?.$ref ===
        `#/components/schemas/${resourceName}` &&
      responseSchema.properties.links?.$ref ===
        '#/components/schemas/PaginationLinks' &&
      responseSchema.properties.meta?.$ref ===
        '#/components/schemas/PaginationMeta',
    `${schemaName} must reuse the canonical data, links, and meta envelope.`
  )
}

const notFoundSchema = schemas.WorkInstructionContentNotFoundError
rejectUnless(
  notFoundSchema?.type === 'object' &&
    notFoundSchema?.additionalProperties === false &&
    exactRequired(notFoundSchema, ['message', 'code']) &&
    exactKeys(notFoundSchema?.properties, ['message', 'code']) &&
    notFoundSchema.properties.message?.const === 'Resource not found' &&
    notFoundSchema.properties.code?.const === 'NOT_FOUND',
  'Content-library 404 must be closed, neutral, and information-poor.'
)

const serverErrorSchema = schemas.WorkInstructionContentServerError
rejectUnless(
  serverErrorSchema?.type === 'object' &&
    serverErrorSchema?.additionalProperties === false &&
    exactRequired(serverErrorSchema, ['message', 'code']) &&
    exactKeys(serverErrorSchema?.properties, ['message', 'code']) &&
    serverErrorSchema.properties.message?.const === 'Internal server error' &&
    serverErrorSchema.properties.code?.const === 'INTERNAL_SERVER_ERROR',
  'Content-library 500 must be closed, neutral, and information-poor.'
)

rejectUnless(
  responseComponentSchemaRef(
    'WorkInstructionContentNotFound',
    'WorkInstructionContentNotFoundError'
  ) &&
    responseComponentSchemaRef(
      'WorkInstructionContentValidationError',
      'ValidationProblem'
    ) &&
    responseComponentSchemaRef(
      'WorkInstructionContentServerFailure',
      'WorkInstructionContentServerError'
    ),
  'Content-library response components must bind closed payloads for 404, 422, and 500.'
)

for (const [name, operation] of Object.entries(operations)) {
  const expectedResponses = new Set(['401', '403', '422', '429', '500'])
  if (
    ['inspectTemplate', 'replaceTemplate', 'inspectStandardBlock'].includes(
      name
    )
  ) {
    expectedResponses.add('404')
  }
  rejectUnless(
    isDeepStrictEqual(
      Object.keys(operation?.responses ?? {}).sort(),
      [operationContracts[name][2], ...expectedResponses].sort()
    ),
    `${name} must expose exactly its success, 401, 403, 404 where applicable, 422, 429, and 500 responses without 409.`
  )
  rejectUnless(
    responseRef(operation, '401', 'Unauthorized') &&
      responseRef(operation, '403', 'Forbidden') &&
      responseRef(operation, '422', 'WorkInstructionContentValidationError') &&
      responseRef(operation, '429', 'TooManyRequests') &&
      responseRef(operation, '500', 'WorkInstructionContentServerFailure'),
    `${name} must reuse shared authentication, authorization, validation, throttling, and the closed neutral content server-error response.`
  )
  if (expectedResponses.has('404')) {
    rejectUnless(
      responseRef(operation, '404', 'WorkInstructionContentNotFound'),
      `${name} must use the neutral content-library 404 response.`
    )
  }
}

rejectUnless(
  /active tenant.*created_at DESC.*id DESC.*only page, per_page, and locale/is.test(
    operations.listTemplates?.description ?? ''
  ) &&
    /server-derived tenant.*atomically/is.test(
      operations.createTemplate?.description ?? ''
    ) &&
    /active tenant.*cross-tenant.*404/is.test(
      operations.inspectTemplate?.description ?? ''
    ),
  'Template operations must document active-tenant isolation, neutral cross-tenant lookup, server-derived ownership, and atomic creation.'
)

rejectUnless(
  /complete desired translation snapshot.*omitted.*removed.*at least one.*transaction.*previous translation snapshot unchanged.*no client-visible intermediate state.*concurrent.*serialize.*never.*merge.*ETag.*version.*revision/is.test(
    operations.replaceTemplate?.description ?? ''
  ),
  'Template replacement must be complete atomic PUT with omission removal, rollback, zero-state exclusion, serialized whole snapshots, and no version mechanism.'
)

rejectUnless(
  /system-global.*active tenant.*work_instructions\.read.*created_at DESC.*id DESC.*only page, per_page, and locale/is.test(
    operations.listStandardBlocks?.description ?? ''
  ) &&
    /system-global.*immutable.*locked.*true/is.test(
      operations.inspectStandardBlock?.description ?? ''
    ),
  'Standard Blocks must be documented as system-global, readable in active tenant context, and immutable with locked=true.'
)

rejectUnless(
  Object.values(operations).every((operation) =>
    /no usable translation.*500|no translation.*500/is.test(
      operation?.description ?? ''
    )
  ),
  'Every content operation must fail closed with neutral 500 when a persisted resource has no usable translation.'
)

if (errors.length > 0) {
  console.error('Work Instruction content-library OpenAPI guard failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Work Instruction content-library OpenAPI guard passed')
