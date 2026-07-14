#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

/**
 * Regression guard: fail if docs/openapi.yaml omits verified API operations
 * or regresses their critical contract invariants (email verification resend +
 * German address reference data + employee documents + qualification catalog +
 * employee qualifications + organizational units).
 *
 * Usage: node scripts/check-openapi-verified-endpoints.mjs <path-to-openapi.yaml>
 */

import fs from 'fs'
import path from 'path'
import * as yaml from 'js-yaml'

/** @type {readonly [method: string, pathTemplate: string][]} */
const REQUIRED_OPERATIONS = [
  ['post', '/auth/email/verification-notification'],
  ['get', '/addresses/de/streets'],
  ['get', '/addresses/de/localities'],
  ['get', '/addresses/de/status'],
  ['get', '/employees/{employee}/documents'],
  ['post', '/employees/{employee}/documents'],
  ['get', '/employees/{employee}/documents/{document}'],
  ['get', '/employees/{employee}/documents/{document}/download'],
  ['delete', '/employees/{employee}/documents/{document}'],
  ['get', '/qualifications'],
  ['post', '/qualifications'],
  ['get', '/qualifications/{qualification}'],
  ['patch', '/qualifications/{qualification}'],
  ['delete', '/qualifications/{qualification}'],
  ['get', '/employees/{employee}/qualifications'],
  ['post', '/employees/{employee}/qualifications'],
  ['get', '/employee-qualifications/{employeeQualification}'],
  ['patch', '/employee-qualifications/{employeeQualification}'],
  ['delete', '/employee-qualifications/{employeeQualification}'],
  ['get', '/organizational-units'],
  ['post', '/organizational-units'],
  ['get', '/organizational-units/{organizational_unit}'],
  ['patch', '/organizational-units/{organizational_unit}'],
  ['delete', '/organizational-units/{organizational_unit}'],
  ['get', '/organizational-units/{organizational_unit}/descendants'],
  ['get', '/organizational-units/{organizational_unit}/ancestors'],
  ['post', '/organizational-units/{organizational_unit}/parent'],
  ['delete', '/organizational-units/{organizational_unit}/parent/{parent}'],
  ['get', '/customers/legal-entities'],
]

const target = process.argv[2]
if (!target) {
  console.error(
    'Usage: node scripts/check-openapi-verified-endpoints.mjs <path-to-openapi.yaml>'
  )
  process.exit(2)
}

const abs = path.resolve(target)
let raw
try {
  raw = fs.readFileSync(abs, 'utf8')
} catch (e) {
  console.error(`Cannot read OpenAPI file: ${abs}`)
  console.error(e)
  process.exit(2)
}

let doc
try {
  doc = yaml.load(raw, { schema: yaml.JSON_SCHEMA })
} catch (e) {
  console.error(`Invalid YAML: ${abs}`)
  console.error(e)
  process.exit(2)
}

const paths =
  doc && typeof doc.paths === 'object' && doc.paths !== null ? doc.paths : {}
const missing = []

for (const [method, pathKey] of REQUIRED_OPERATIONS) {
  const op = paths[pathKey]
  if (!op || op[method] == null) {
    missing.push(`${method.toUpperCase()} ${pathKey}`)
  }
}

if (missing.length) {
  console.error(
    'OpenAPI verified-endpoint presence guard failed. Missing operations:'
  )
  for (const line of missing) {
    console.error(`  - ${line}`)
  }
  process.exit(1)
}

const schemas = doc?.components?.schemas ?? {}
const responses = doc?.components?.responses ?? {}
const customer = schemas.Customer ?? {}
const customerCreateRequest = schemas.CustomerCreateRequest ?? {}
const customerCreateRequestBody = paths['/customers']?.post?.requestBody ?? {}
const customerCreateSchema =
  customerCreateRequestBody?.content?.['application/json']?.schema ?? {}
const customerUpdateRequestBody =
  paths['/customers/{customer}']?.patch?.requestBody ?? {}
const customerUpdateSchema =
  customerUpdateRequestBody?.content?.['application/json']?.schema ?? {}
const customerLegalEntityLookup = schemas.CustomerLegalEntityLookup ?? {}
const customerUpdateRequest = schemas.CustomerUpdateRequest ?? {}
const organizationalUnit = schemas.OrganizationalUnit ?? {}
const createRequest = schemas.OrganizationalUnitCreateRequest ?? {}
const updateRequest = schemas.OrganizationalUnitUpdateRequest ?? {}
const parentIdParameter = paths['/organizational-units']?.get?.parameters?.find(
  (parameter) => parameter?.name === 'parent_id'
)
const organizationalUnitListParameters =
  paths['/organizational-units']?.get?.parameters ?? []
const contractErrors = []

if (
  !customer.required?.includes('legal_entity_id') ||
  customer.properties?.legal_entity_id?.type !== 'string' ||
  customer.properties?.legal_entity_id?.format !== 'uuid'
) {
  contractErrors.push(
    'Customer.legal_entity_id must be a required UUID response field.'
  )
}

const isNullableVatId = (schema) =>
  Array.isArray(schema?.type) &&
  schema.type.includes('string') &&
  schema.type.includes('null') &&
  schema.maxLength === 32

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isUuid = (value) => typeof value === 'string' && uuidPattern.test(value)
const normalizeUuid = (value) =>
  typeof value === 'string' ? value.toLowerCase() : value

function matchesType(type, value) {
  if (type === 'null') return value === null
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number'
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }
  return false
}

function matchesSchema(schema, value) {
  if (!schema || typeof schema !== 'object') return false

  if (schema.$ref) {
    const prefix = '#/components/schemas/'
    if (!schema.$ref.startsWith(prefix)) return false
    return matchesSchema(schemas[schema.$ref.slice(prefix.length)], value)
  }
  if (
    schema.anyOf &&
    !schema.anyOf.some((entry) => matchesSchema(entry, value))
  ) {
    return false
  }
  if (
    schema.allOf &&
    !schema.allOf.every((entry) => matchesSchema(entry, value))
  ) {
    return false
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false
  if (schema.enum && !schema.enum.includes(value)) return false

  const declaredTypes = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : []
  if (
    declaredTypes.length > 0 &&
    !declaredTypes.some((type) => matchesType(type, value))
  ) {
    return false
  }
  if (value === null) {
    return declaredTypes.length === 0 || declaredTypes.includes('null')
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      return false
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      return false
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false
    if (schema.format === 'uuid' && !isUuid(value)) return false
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return false
    if (schema.maximum !== undefined && value > schema.maximum) return false
  }
  if (Array.isArray(value) && schema.items) {
    if (!value.every((entry) => matchesSchema(schema.items, entry)))
      return false
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    if (
      (schema.required ?? []).some(
        (property) => !Object.hasOwn(value, property)
      )
    ) {
      return false
    }
    for (const [property, propertyValue] of Object.entries(value)) {
      const propertySchema = schema.properties?.[property]
      if (propertySchema && !matchesSchema(propertySchema, propertyValue))
        return false
      if (!propertySchema && schema.additionalProperties === false) return false
    }
  }

  return true
}

if (
  customer.required?.includes('vat_id') ||
  !isNullableVatId(customer.properties?.vat_id)
) {
  contractErrors.push(
    'Customer.vat_id must be a nullable string response field with maxLength 32.'
  )
}

if (
  customerCreateRequest.required?.includes('vat_id') ||
  !isNullableVatId(customerCreateRequest.properties?.vat_id)
) {
  contractErrors.push(
    'CustomerCreateRequest.vat_id must be an optional nullable string field with maxLength 32.'
  )
}

if (
  customerUpdateRequest.required?.includes('vat_id') ||
  !isNullableVatId(customerUpdateRequest.properties?.vat_id)
) {
  contractErrors.push(
    'PATCH /customers/{customer} vat_id must be an optional nullable string field with maxLength 32.'
  )
}

if (
  customerCreateRequestBody.required !== true ||
  customerCreateSchema?.$ref !== '#/components/schemas/CustomerCreateRequest' ||
  !customerCreateRequest.required?.includes('legal_entity_id') ||
  customerCreateRequest.properties?.legal_entity_id?.type !== 'string' ||
  customerCreateRequest.properties?.legal_entity_id?.format !== 'uuid'
) {
  contractErrors.push(
    'POST /customers must require and reference CustomerCreateRequest with a required legal_entity_id UUID.'
  )
}

const customerResponseRef = '#/components/schemas/Customer'
for (const [label, responseSchema] of [
  [
    'GET /customers',
    paths['/customers']?.get?.responses?.['200']?.content?.['application/json']
      ?.schema?.properties?.data?.items,
  ],
  [
    'POST /customers',
    paths['/customers']?.post?.responses?.['201']?.content?.['application/json']
      ?.schema?.properties?.data,
  ],
  [
    'GET /customers/{customer}',
    paths['/customers/{customer}']?.get?.responses?.['200']?.content?.[
      'application/json'
    ]?.schema?.properties?.data,
  ],
  [
    'PATCH /customers/{customer}',
    paths['/customers/{customer}']?.patch?.responses?.['200']?.content?.[
      'application/json'
    ]?.schema?.properties?.data,
  ],
]) {
  if (responseSchema?.$ref !== customerResponseRef) {
    contractErrors.push(`${label} must return the Customer schema.`)
  }
}

const legalEntityLookupProperties = Object.keys(
  customerLegalEntityLookup.properties ?? {}
)
const legalEntityLookupAllowed = new Set(['id', 'name'])
if (
  customerLegalEntityLookup.type !== 'object' ||
  customerLegalEntityLookup.additionalProperties !== false ||
  legalEntityLookupProperties.some(
    (property) => !legalEntityLookupAllowed.has(property)
  ) ||
  !customerLegalEntityLookup.required?.includes('id') ||
  !customerLegalEntityLookup.required?.includes('name') ||
  customerLegalEntityLookup.properties?.id?.type !== 'string' ||
  customerLegalEntityLookup.properties?.id?.format !== 'uuid' ||
  customerLegalEntityLookup.properties?.name?.type !== 'string'
) {
  contractErrors.push(
    'CustomerLegalEntityLookup must expose only required id and name fields.'
  )
}

const customerLegalEntitiesResponse =
  paths['/customers/legal-entities']?.get?.responses?.['200']?.content?.[
    'application/json'
  ]?.schema
const customerLegalEntitiesItems =
  customerLegalEntitiesResponse?.properties?.data?.items
if (
  customerLegalEntitiesResponse?.type !== 'object' ||
  customerLegalEntitiesResponse?.additionalProperties !== false ||
  !customerLegalEntitiesResponse?.required?.includes('data') ||
  customerLegalEntitiesResponse?.properties?.data?.type !== 'array' ||
  customerLegalEntitiesItems?.$ref !==
    '#/components/schemas/CustomerLegalEntityLookup'
) {
  contractErrors.push(
    'GET /customers/legal-entities must return data[] of CustomerLegalEntityLookup.'
  )
}

if (
  customerUpdateRequestBody.required !== true ||
  customerUpdateSchema?.$ref !== '#/components/schemas/CustomerUpdateRequest' ||
  customerUpdateRequest.required?.includes('legal_entity_id') ||
  customerUpdateRequest.properties?.legal_entity_id?.type !== 'string' ||
  customerUpdateRequest.properties?.legal_entity_id?.format !== 'uuid'
) {
  contractErrors.push(
    'PATCH /customers/{customer} must require and reference CustomerUpdateRequest with an optional legal_entity_id UUID.'
  )
}

for (const [schemaName, schema] of [
  ['CustomerCreateRequest', customerCreateRequest],
  ['CustomerUpdateRequest', customerUpdateRequest],
]) {
  const validationExamples = schema['x-validation-examples'] ?? {}
  const acceptedExamples = Array.isArray(validationExamples.accepted)
    ? validationExamples.accepted
    : []
  const rejectedExamples = Array.isArray(validationExamples.rejected)
    ? validationExamples.rejected
    : []
  const isAssignmentExample = (example) =>
    typeof example?.name === 'string' &&
    example.name.trim().length > 0 &&
    isUuid(example?.customer_tenant_id) &&
    isUuid(example?.legal_entity_tenant_id) &&
    isUuid(example?.value?.legal_entity_id) &&
    matchesSchema(schema, example?.value)
  const hasOnlySameTenantExamples =
    acceptedExamples.length > 0 &&
    acceptedExamples.every(
      (example) =>
        isAssignmentExample(example) &&
        normalizeUuid(example.customer_tenant_id) ===
          normalizeUuid(example.legal_entity_tenant_id)
    )
  const hasOnlyCrossTenantRejections =
    rejectedExamples.length > 0 &&
    rejectedExamples.every(
      (example) =>
        isAssignmentExample(example) &&
        normalizeUuid(example.customer_tenant_id) !==
          normalizeUuid(example.legal_entity_tenant_id) &&
        example.status === 422
    )
  const usesDistinctLegalEntities = acceptedExamples.every((accepted) =>
    rejectedExamples.every(
      (rejected) =>
        normalizeUuid(accepted?.value?.legal_entity_id) !==
        normalizeUuid(rejected?.value?.legal_entity_id)
    )
  )

  if (
    !hasOnlySameTenantExamples ||
    !hasOnlyCrossTenantRejections ||
    !usesDistinctLegalEntities
  ) {
    contractErrors.push(
      `${schemaName} must include structurally valid accepted same-tenant and rejected cross-tenant Legal Entity assignment examples with distinct UUIDs.`
    )
  }
}

const customerCreateDescription = paths['/customers']?.post?.description ?? ''
const customerUpdateDescription =
  paths['/customers/{customer}']?.patch?.description ?? ''
const legalEntitiesDescription =
  paths['/customers/legal-entities']?.get?.description ?? ''
const customerDescription = customer.description ?? ''
const customerLegalEntityDescription =
  customer.properties?.legal_entity_id?.description ?? ''
for (const [label, description, requiredPermission] of [
  ['POST /customers', customerCreateDescription, 'customers.create'],
  [
    'PATCH /customers/{customer}',
    customerUpdateDescription,
    'customers.update',
  ],
  [
    'GET /customers/legal-entities',
    legalEntitiesDescription,
    'customers.create',
  ],
]) {
  for (const requiredText of [
    requiredPermission,
    'same tenant',
    'active, assignable, non-deleted Legal Entity',
    'organizational write access',
  ]) {
    if (!description.includes(requiredText)) {
      contractErrors.push(`${label} must document ${requiredText}.`)
    }
  }
}

for (const [label, description] of [
  ['Customer', customerDescription],
  ['Customer.legal_entity_id', customerLegalEntityDescription],
]) {
  for (const requiredText of [
    'No default Legal Entity assignment',
    'product-approved deterministic tenant-consistent rule',
  ]) {
    if (!description.includes(requiredText)) {
      contractErrors.push(
        `${label} must document the blocked no-default customer backfill invariant.`
      )
    }
  }
}

for (const relationship of [
  'parent',
  'children',
  'ancestors',
  'descendants',
]) {
  const property = organizationalUnit.properties?.[relationship]
  const reference =
    relationship === 'parent'
      ? property?.anyOf?.find((schema) => schema?.$ref)?.$ref
      : property?.items?.$ref
  const mustBeNullable = relationship === 'parent'
  const isNullable = property?.anyOf?.some(
    (schema) => schema?.type === 'null'
  )
  if (
    reference !== '#/components/schemas/OrganizationalUnit' ||
    (mustBeNullable && !isNullable)
  ) {
    contractErrors.push(
      `OrganizationalUnit.${relationship} must use the full OrganizationalUnit resource schema${
        mustBeNullable ? ' and allow null.' : '.'
      }`
    )
  }
}

const customTypeNameRule = createRequest.allOf?.find(
  (schema) =>
    schema?.if?.properties?.type?.const === 'custom' &&
    schema?.if?.required?.includes('type')
)
if (
  !customTypeNameRule?.then?.required?.includes('custom_type_name') ||
  customTypeNameRule?.then?.properties?.custom_type_name?.type !== 'string'
) {
  contractErrors.push(
    'Creating a custom organizational unit must require a non-null custom_type_name.'
  )
}

const updateCustomTypeNameRule = updateRequest.allOf?.find(
  (schema) =>
    schema?.if?.properties?.type?.const === 'custom' &&
    schema?.if?.required?.includes('type')
)
const updateCustomTypeNameSchema =
  updateCustomTypeNameRule?.then?.properties?.custom_type_name
if (
  !updateCustomTypeNameRule?.then?.required?.includes('custom_type_name') ||
  updateCustomTypeNameSchema?.type !== 'string' ||
  updateCustomTypeNameSchema?.minLength !== 1 ||
  updateCustomTypeNameSchema?.maxLength !== 255 ||
  updateCustomTypeNameSchema?.pattern !== '.*\\S.*'
) {
  contractErrors.push(
    'Updating an organizational unit to custom must require a non-blank custom_type_name.'
  )
}

const updateValidationExamples = updateRequest['x-validation-examples'] ?? {}
const acceptedUpdateExamples = updateValidationExamples.accepted ?? []
const rejectedUpdateExamples = updateValidationExamples.rejected ?? []

const hasExistingCustomUnitClearExample = rejectedUpdateExamples.some(
  (example) =>
    example?.existing_type === 'custom' &&
    !Object.hasOwn(example?.value ?? {}, 'type') &&
    example?.value?.custom_type_name === null
)

function acceptsCustomTypeNameExample(example) {
  const payload = example?.value ?? {}
  const effectiveType = payload.type ?? example?.existing_type
  const touchesCustomTypeName =
    Object.hasOwn(payload, 'type') || Object.hasOwn(payload, 'custom_type_name')

  if (effectiveType !== 'custom' || !touchesCustomTypeName) {
    return true
  }

  return (
    typeof payload.custom_type_name === 'string' &&
    payload.custom_type_name.trim().length > 0 &&
    payload.custom_type_name.length <= 255
  )
}

if (
  acceptedUpdateExamples.length === 0 ||
  acceptedUpdateExamples.some(
    (example) => !acceptsCustomTypeNameExample(example)
  ) ||
  rejectedUpdateExamples.length < 4 ||
  rejectedUpdateExamples.some((example) =>
    acceptsCustomTypeNameExample(example)
  ) ||
  !hasExistingCustomUnitClearExample
) {
  contractErrors.push(
    'OrganizationalUnitUpdateRequest must include executable accepted and rejected examples, including a standalone clear for an existing custom unit.'
  )
}

const organizationalUnitUpdateDescription =
  paths['/organizational-units/{organizational_unit}']?.patch?.description ?? ''
const customTypeNameDescription =
  updateRequest.properties?.custom_type_name?.description ?? ''
if (
  !organizationalUnitUpdateDescription.includes('custom_type_name') ||
  !organizationalUnitUpdateDescription.includes('422') ||
  !customTypeNameDescription.includes('existing custom unit')
) {
  contractErrors.push(
    'Organizational-unit PATCH must document the custom_type_name validation errors.'
  )
}

for (const flag of ['is_legal_entity', 'is_establishment']) {
  if ('default' in (updateRequest.properties?.[flag] ?? {})) {
    contractErrors.push(
      `OrganizationalUnitUpdateRequest.${flag} must not default an omitted PATCH field.`
    )
  }
}

for (const [
  flag,
  numericTrueExample,
  numericFalseExample,
  textTrueExample,
  textFalseExample,
] of [
  ['is_active', 'active', 'inactive', 'active_text', 'inactive_text'],
  [
    'is_assignable',
    'assignable',
    'unassignable',
    'assignable_text',
    'unassignable_text',
  ],
]) {
  if (
    !organizationalUnit.required?.includes(flag) ||
    organizationalUnit.properties?.[flag]?.type !== 'boolean'
  ) {
    contractErrors.push(
      `OrganizationalUnit.${flag} must be a required boolean response field.`
    )
  }

  for (const [schemaName, schema] of [
    ['OrganizationalUnitCreateRequest', createRequest],
    ['OrganizationalUnitUpdateRequest', updateRequest],
  ]) {
    if (
      schema.properties?.[flag]?.type !== 'boolean' ||
      schema.required?.includes(flag)
    ) {
      contractErrors.push(
        `${schemaName}.${flag} must be an optional boolean request field.`
      )
    }
  }

  if (createRequest.properties?.[flag]?.default !== true) {
    contractErrors.push(
      `OrganizationalUnitCreateRequest.${flag} must default an omitted field to true.`
    )
  }

  if ('default' in (updateRequest.properties?.[flag] ?? {})) {
    contractErrors.push(
      `OrganizationalUnitUpdateRequest.${flag} must not default an omitted PATCH field.`
    )
  }

  const parameter = organizationalUnitListParameters.find(
    (candidate) => candidate?.name === flag && candidate?.in === 'query'
  )
  if (parameter?.schema?.type !== 'boolean' || parameter.required !== false) {
    contractErrors.push(
      `GET /organizational-units must define ${flag} as an optional boolean query filter.`
    )
  }

  const wireExamples = parameter?.['x-wire-examples'] ?? {}
  if (
    !parameter?.description?.includes(
      'Query-string values may be `1` or `true` for `true`, and `0` or `false` for `false`. No other values are accepted.'
    ) ||
    Object.keys(wireExamples).length !== 4 ||
    wireExamples[numericTrueExample]?.value !== '1' ||
    wireExamples[numericFalseExample]?.value !== '0' ||
    wireExamples[textTrueExample]?.value !== 'true' ||
    wireExamples[textFalseExample]?.value !== 'false'
  ) {
    contractErrors.push(
      `GET /organizational-units must document ${flag} true and false as query-string values 1/true and 0/false only.`
    )
  }
}

const parentIdAlternatives = parentIdParameter?.schema?.anyOf ?? []
if (
  parentIdAlternatives.length !== 2 ||
  !parentIdAlternatives.some((schema) => schema?.const === 'null') ||
  !parentIdAlternatives.some(
    (schema) => schema?.type === 'string' && schema?.format === 'uuid'
  )
) {
  contractErrors.push(
    'The parent_id filter must accept only the exact string "null" or a UUID.'
  )
}

if (
  paths['/organizational-units/{organizational_unit}']?.delete?.responses?.[
    '409'
  ]?.$ref !== '#/components/responses/OrganizationalUnitHasChildrenConflict' ||
  responses.OrganizationalUnitHasChildrenConflict == null
) {
  contractErrors.push(
    'Organizational-unit deletion must document its child-conflict response shape.'
  )
}

const organizationalUnitDeleteDescription =
  paths['/organizational-units/{organizational_unit}']?.delete?.description ?? ''
const organizationalUnitHierarchyDescriptions = [
  paths['/organizational-units/{organizational_unit}/descendants']?.get
    ?.description ?? '',
  paths['/organizational-units/{organizational_unit}/ancestors']?.get
    ?.description ?? '',
]
const childConflictSchema = schemas.OrganizationalUnitHasChildrenConflict ?? {}
const childConflictDescriptions = [
  childConflictSchema.properties?.message?.description ?? '',
  childConflictSchema.properties?.child_count?.description ?? '',
]
if (
  !organizationalUnitDeleteDescription.includes('non-deleted direct child') ||
  !responses.OrganizationalUnitHasChildrenConflict?.description
    ?.toLowerCase()
    .includes('non-deleted direct child') ||
  childConflictDescriptions.some(
    (description) => !description.includes('non-deleted direct child')
  )
) {
  contractErrors.push(
    'Organizational-unit deletion must describe every non-deleted direct child as blocking, independently of is_active.'
  )
}

if (
  organizationalUnitHierarchyDescriptions.some(
    (description) =>
      !description.includes('is_active') || !description.includes('is_assignable')
  )
) {
  contractErrors.push(
    'Organizational-unit ancestor and descendant responses must document both independent operational status flags.'
  )
}

if (contractErrors.length) {
  console.error('OpenAPI organizational-unit contract guard failed:')
  for (const line of contractErrors) {
    console.error(`  - ${line}`)
  }
  process.exit(1)
}

console.log(
  `Verified-endpoint presence guard OK (${REQUIRED_OPERATIONS.length} operations).`
)
