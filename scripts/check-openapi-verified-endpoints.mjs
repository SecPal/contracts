#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

/**
 * Regression guard: fail if docs/openapi.yaml omits verified API operations
 * or regresses their critical contract invariants (email verification resend +
 * German address reference data + employee documents + qualification catalog +
 * employee qualifications + organizational units + employee compliance alerts +
 * canonical schema-4 bootstrap and notification runtime metadata).
 *
 * Usage: node scripts/check-openapi-verified-endpoints.mjs <path-to-openapi.yaml>
 */

import fs from 'fs'
import path from 'path'
import { isDeepStrictEqual } from 'node:util'
import * as yaml from 'js-yaml'

/** @type {readonly [method: string, pathTemplate: string][]} */
const REQUIRED_OPERATIONS = [
  ['post', '/auth/email/verification-notification'],
  ['get', '/addresses/de/streets'],
  ['get', '/addresses/de/localities'],
  ['get', '/addresses/de/status'],
  ['get', '/employees/compliance-alerts'],
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
  ['get', '/lookups/legal-entities'],
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
const componentParameters = doc?.components?.parameters ?? {}
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
const legalEntityLookup = schemas.LegalEntityLookup ?? {}
const customerUpdateRequest = schemas.CustomerUpdateRequest ?? {}
const organizationalUnit = schemas.OrganizationalUnit ?? {}
const createRequest = schemas.OrganizationalUnitCreateRequest ?? {}
const updateRequest = schemas.OrganizationalUnitUpdateRequest ?? {}
const parentIdParameter = paths['/organizational-units']?.get?.parameters?.find(
  (parameter) => parameter?.name === 'parent_id'
)
const organizationalUnitListParameters =
  paths['/organizational-units']?.get?.parameters ?? []
const employeeComplianceAlerts = paths['/employees/compliance-alerts']?.get
const contractErrors = []

const canonicalSchemaVersionComponents = [
  'NotificationRuntimeState',
  'NotificationRuntimeStateConflictDetails',
  'BootstrapCompatibility',
]
const canonicalSchemaVersionSchemaKeywords = new Set([
  'type',
  'const',
  'description',
  'example',
])

for (const schemaName of canonicalSchemaVersionComponents) {
  const schemaVersion = schemas[schemaName]?.properties?.schema_version
  const unexpectedKeywords = Object.keys(schemaVersion ?? {}).filter(
    (keyword) => !canonicalSchemaVersionSchemaKeywords.has(keyword)
  )

  if (
    schemaVersion?.type !== 'integer' ||
    schemaVersion?.const !== 4 ||
    schemaVersion?.example !== 4 ||
    unexpectedKeywords.length > 0
  ) {
    contractErrors.push(
      `${schemaName}.schema_version must define canonical schema version integer 4 as its only valid value and example, without additional validation constraints.`
    )
  }
}

function verifyCanonicalSchemaVersionExampleValues(candidate) {
  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      verifyCanonicalSchemaVersionExampleValues(item)
    }

    return
  }

  if (candidate === null || typeof candidate !== 'object') {
    return
  }

  for (const [key, value] of Object.entries(candidate)) {
    if (key === 'schema_version' && value !== 4) {
      contractErrors.push(
        'Every concrete runtime and bootstrap schema version value must be integer 4.'
      )
    }

    verifyCanonicalSchemaVersionExampleValues(value)
  }
}

const notificationInstallation =
  paths['/me/notification-installations/{installationId}']?.put
const canonicalSchemaVersionExampleCollections = [
  responses.NotificationInstallationConflict?.content?.['application/json']
    ?.examples,
  notificationInstallation?.requestBody?.content?.['application/json']
    ?.examples,
  notificationInstallation?.responses?.['200']?.content?.['application/json']
    ?.examples,
  notificationInstallation?.responses?.['201']?.content?.['application/json']
    ?.examples,
  paths['/bootstrap']?.get?.responses?.['200']?.content?.['application/json']
    ?.examples,
]

for (const examples of canonicalSchemaVersionExampleCollections) {
  verifyCanonicalSchemaVersionExampleValues(examples)
}

const parameterRefPrefix = '#/components/parameters/'
const resolveParameter = (parameter) => {
  if (!parameter?.$ref?.startsWith(parameterRefPrefix)) return parameter
  return componentParameters[parameter.$ref.slice(parameterRefPrefix.length)]
}
const hasExactlyParameterRefs = (actual, expected) =>
  actual.length === expected.length &&
  isDeepStrictEqual(
    actual.map((parameter) => parameter?.$ref).sort(),
    [...expected].sort()
  )

const employeeListParameterRefs = [
  '#/components/parameters/EmployeePage',
  '#/components/parameters/EmployeePerPage',
  '#/components/parameters/EmployeeStatusFilter',
  '#/components/parameters/EmployeeSearchFilter',
  '#/components/parameters/EmployeeLegalEntityFilter',
  '#/components/parameters/EmployeeEstablishmentFilter',
]
const employeeComplianceAlertParameterRefs = [
  ...employeeListParameterRefs.slice(0, 3),
  '#/components/parameters/EmployeeComplianceStatusFilter',
  ...employeeListParameterRefs.slice(3),
]
const employeeListParameters = paths['/employees']?.get?.parameters ?? []
const employeeComplianceAlertParameterEntries =
  employeeComplianceAlerts?.parameters ?? []

if (
  !hasExactlyParameterRefs(employeeListParameters, employeeListParameterRefs) ||
  !hasExactlyParameterRefs(
    employeeComplianceAlertParameterEntries,
    employeeComplianceAlertParameterRefs
  )
) {
  contractErrors.push(
    'GET /employees and GET /employees/compliance-alerts must reuse exactly the effective page, per_page, status, compliance_status, search, legal_entity_id, and establishment_id query parameter components applicable to each operation.'
  )
}

const employeeComplianceAlertParameters =
  employeeComplianceAlertParameterEntries.map(resolveParameter)
const expectedEmployeeComplianceAlertParameters = {
  page: {
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
  },
  per_page: {
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 15 },
  },
  status: {
    in: 'query',
    required: false,
    schema: { $ref: '#/components/schemas/EmployeeStatus' },
  },
  compliance_status: {
    in: 'query',
    required: false,
    schema: { $ref: '#/components/schemas/EmployeeComplianceAlertStatus' },
  },
  search: {
    in: 'query',
    required: false,
    schema: { type: 'string', maxLength: 255 },
  },
  legal_entity_id: {
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  },
  establishment_id: {
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  },
}

for (const [name, expected] of Object.entries(
  expectedEmployeeComplianceAlertParameters
)) {
  const matches = employeeComplianceAlertParameters.filter(
    (parameter) => parameter?.name === name
  )
  const actual = matches[0]
  if (
    matches.length !== 1 ||
    !isDeepStrictEqual(
      {
        in: actual?.in,
        required: actual?.required,
        schema: actual?.schema,
      },
      expected
    )
  ) {
    contractErrors.push(
      `GET /employees/compliance-alerts ${name} must match the verified API query contract.`
    )
  }
}

const complianceStatusSchema = schemas.EmployeeComplianceAlertStatus ?? {}
const complianceStatusParameter = employeeComplianceAlertParameters.find(
  (parameter) => parameter?.name === 'compliance_status'
)
if (
  complianceStatusSchema.type !== 'string' ||
  complianceStatusSchema.enum?.join(',') !== 'warning,critical,expired'
) {
  contractErrors.push(
    'EmployeeComplianceAlertStatus must allow exactly warning, critical, and expired.'
  )
}

if (
  !/highest active alert severity/i.test(
    employeeComplianceAlerts?.description ?? ''
  ) ||
  !/highest active alert severity/i.test(
    complianceStatusParameter?.description ?? ''
  ) ||
  !/highest active employee compliance-alert severity/i.test(
    complianceStatusSchema.description ?? ''
  )
) {
  contractErrors.push(
    'GET /employees/compliance-alerts must describe compliance_status as the highest active alert severity for each employee.'
  )
}

const employee = schemas.Employee ?? {}
const employeeCreateRequest = schemas.EmployeeCreateRequest ?? {}
const employeeUpdateRequest = schemas.EmployeeUpdateRequest ?? {}
const employeeAdditionalCertification =
  schemas.EmployeeAdditionalCertification ?? {}
const microsecondApiTimestamp = schemas.MicrosecondApiTimestamp ?? {}
const nullableMicrosecondApiTimestamp =
  schemas.NullableMicrosecondApiTimestamp ?? {}
const alertDocument = schemas.EmployeeComplianceAlertDocument ?? {}
const employeeResourceProperties = [
  'id',
  'tenant_id',
  'employee_number',
  'first_name',
  'last_name',
  'full_name',
  'date_of_birth',
  'email',
  'phone',
  'photo_path',
  'bwr_id',
  'bwr_status',
  'bwr_registered_at',
  'bwr_submission_date',
  'bwr_notes',
  'gender',
  'birth_name',
  'previous_names',
  'birth_city',
  'birth_country',
  'nationalities',
  'addresses',
  'current_address',
  'structured_address',
  'emergency_contacts',
  'intended_activities',
  'id_document_type',
  'id_document_number',
  'id_document_expiry',
  'id_document_copy_path',
  'id_document_copy_deleted_at',
  'employment_end_date',
  'retention_period_end',
  'tax_id',
  'social_security_number',
  'status',
  'hire_date',
  'contract_start_date',
  'termination_date',
  'last_working_day',
  'contract_type',
  'weekly_hours',
  'monthly_hours',
  'hourly_rate',
  'health_insurance_type',
  'health_insurance_provider',
  'health_insurance_number',
  'sachkunde_type',
  'sachkunde_certificate',
  'sachkunde_ihk_number',
  'sachkunde_exam_date',
  'sachkunde_issued_date',
  'work_permit_type',
  'work_permit_number',
  'work_permit_expiry',
  'work_permit_copy_path',
  'work_permit_issued_by',
  'work_permit_copy_deleted_at',
  'firearms_license_number',
  'firearms_license_expiry',
  'firearms_license_issued_by',
  'first_aid_cert_number',
  'first_aid_cert_date',
  'first_aid_cert_expiry',
  'fire_safety_cert_date',
  'fire_safety_cert_expiry',
  'evacuation_cert_date',
  'evacuation_cert_expiry',
  'additional_certifications',
  'residence_permit_type',
  'residence_permit_number',
  'residence_permit_expiry',
  'requires_work_permit',
  'has_valid_work_authorization',
  'expiring_documents',
  'criminal_record_status',
  'criminal_record_check_date',
  'user_id',
  'user_account_active',
  'user_account_activated_at',
  'user_account_deactivated_at',
  'onboarding_completed',
  'onboarding_steps',
  'onboarding_started_at',
  'onboarding_completed_at',
  'onboarding_workflow',
  'onboarding_invitation',
  'legal_entity_id',
  'establishment_id',
  'position',
  'management_level',
  'user',
  'qualifications',
  'documents',
  'created_at',
  'updated_at',
  'deleted_at',
]
const conditionallyOmittedEmployeeProperties =
  'addresses current_address id_document_number tax_id social_security_number hourly_rate health_insurance_number sachkunde_ihk_number work_permit_number firearms_license_number first_aid_cert_number residence_permit_number user qualifications documents'.split(
    ' '
  )
const requiredEmployeeResourceProperties = employeeResourceProperties.filter(
  (property) => !conditionallyOmittedEmployeeProperties.includes(property)
)
const sensitiveEmployeeProperties =
  'id_document_number tax_id social_security_number health_insurance_number sachkunde_ihk_number work_permit_number firearms_license_number first_aid_cert_number residence_permit_number'.split(
    ' '
  )
const conditionallyLoadedEmployeeRelationships = [
  'addresses',
  'current_address',
  'user',
  'qualifications',
  'documents',
]
const workPermitTypes = [
  'none',
  'temporary',
  'permanent',
  'blue_card',
  'seasonal',
  'student',
]
const expectedWorkPermitTypeShape = {
  type: ['string', 'null'],
  enum: workPermitTypes,
}
const contractShape = (value) => {
  if (Array.isArray(value)) return value.map(contractShape)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['description', 'example'].includes(key))
      .map(([key, entry]) => [key, contractShape(entry)])
  )
}
const expectedEmployeeResourcePropertyShapes = {
  id_document_type: {
    type: ['string', 'null'],
    enum: ['passport', 'id_card', 'residence_permit'],
  },
  id_document_number: { type: ['string', 'null'] },
  id_document_expiry: { type: ['string', 'null'], format: 'date' },
  id_document_copy_path: { type: ['string', 'null'] },
  id_document_copy_deleted_at: {
    $ref: '#/components/schemas/NullableApiTimestamp',
  },
  employment_end_date: {
    $ref: '#/components/schemas/NullableMicrosecondApiTimestamp',
  },
  retention_period_end: {
    $ref: '#/components/schemas/NullableMicrosecondApiTimestamp',
  },
  work_permit_copy_path: { type: ['string', 'null'] },
  work_permit_issued_by: { type: ['string', 'null'], maxLength: 255 },
  work_permit_copy_deleted_at: {
    $ref: '#/components/schemas/NullableApiTimestamp',
  },
  work_permit_type: expectedWorkPermitTypeShape,
  firearms_license_number: { type: ['string', 'null'] },
  firearms_license_expiry: { type: ['string', 'null'], format: 'date' },
  firearms_license_issued_by: {
    type: ['string', 'null'],
    maxLength: 255,
  },
  first_aid_cert_number: { type: ['string', 'null'] },
  first_aid_cert_date: { type: ['string', 'null'], format: 'date' },
  first_aid_cert_expiry: { type: ['string', 'null'], format: 'date' },
  fire_safety_cert_date: { type: ['string', 'null'], format: 'date' },
  fire_safety_cert_expiry: { type: ['string', 'null'], format: 'date' },
  evacuation_cert_date: { type: ['string', 'null'], format: 'date' },
  evacuation_cert_expiry: { type: ['string', 'null'], format: 'date' },
  additional_certifications: {
    type: 'array',
    items: { $ref: '#/components/schemas/EmployeeAdditionalCertification' },
  },
  requires_work_permit: { type: 'boolean' },
  has_valid_work_authorization: { type: 'boolean' },
  qualifications: {
    type: 'array',
    items: { $ref: '#/components/schemas/EmployeeQualificationResource' },
  },
  documents: {
    type: 'array',
    items: { $ref: '#/components/schemas/EmployeeDocumentResource' },
  },
}
const actualEmployeeResourcePropertyShapes = Object.fromEntries(
  Object.keys(expectedEmployeeResourcePropertyShapes).map((property) => [
    property,
    contractShape(employee.properties?.[property]),
  ])
)
const expectedEmployeeAdditionalCertificationShape = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', maxLength: 255 },
    number: { type: ['string', 'null'], maxLength: 255 },
    issued_date: { type: ['string', 'null'] },
    expiry_date: { type: ['string', 'null'] },
    issuer: { type: ['string', 'null'], maxLength: 255 },
  },
}
const expectedMicrosecondApiTimestampShape = {
  type: 'string',
  format: 'date-time',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z$',
}
const expectedNullableMicrosecondApiTimestampShape = {
  oneOf: [
    { $ref: '#/components/schemas/MicrosecondApiTimestamp' },
    { type: 'null' },
  ],
}

if (
  !isDeepStrictEqual(
    Object.keys(employee.properties ?? {}).sort(),
    [...employeeResourceProperties].sort()
  ) ||
  !isDeepStrictEqual(
    [...(employee.required ?? [])].sort(),
    [...requiredEmployeeResourceProperties].sort()
  ) ||
  !isDeepStrictEqual(
    actualEmployeeResourcePropertyShapes,
    expectedEmployeeResourcePropertyShapes
  ) ||
  !isDeepStrictEqual(
    contractShape(employeeCreateRequest.properties?.work_permit_type),
    expectedWorkPermitTypeShape
  ) ||
  !isDeepStrictEqual(
    contractShape(employeeUpdateRequest.properties?.work_permit_type),
    expectedWorkPermitTypeShape
  ) ||
  !isDeepStrictEqual(
    contractShape(employeeAdditionalCertification),
    expectedEmployeeAdditionalCertificationShape
  ) ||
  !isDeepStrictEqual(
    contractShape(microsecondApiTimestamp),
    expectedMicrosecondApiTimestampShape
  ) ||
  !isDeepStrictEqual(
    contractShape(nullableMicrosecondApiTimestamp),
    expectedNullableMicrosecondApiTimestampShape
  ) ||
  sensitiveEmployeeProperties.some(
    (property) =>
      !/employees\.read_sensitive/.test(
        employee.properties?.[property]?.description ?? ''
      )
  ) ||
  !/employees\.read_salary/.test(
    employee.properties?.hourly_rate?.description ?? ''
  ) ||
  conditionallyLoadedEmployeeRelationships.some(
    (property) =>
      !/omitted/i.test(employee.properties?.[property]?.description ?? '')
  ) ||
  !/employees\.read_sensitive/.test(
    employee.properties?.additional_certifications?.description ?? ''
  ) ||
  !/employees\.read_sensitive/.test(
    employeeAdditionalCertification.properties?.number?.description ?? ''
  )
) {
  contractErrors.push(
    'Employee must inventory every EmployeeResource field, including permission-gated identifiers and conditionally loaded relationships.'
  )
}

const expectedAlertDocumentProperties = {
  type: {
    type: 'string',
    enum: [
      'work_permit',
      'residence_permit',
      'id_document',
      'firearms_license',
      'first_aid_certificate',
      'fire_safety_certificate',
      'evacuation_certificate',
      'additional_certification',
    ],
  },
  label: {
    type: 'string',
    description: 'Human-readable document or certification label.',
  },
  expiry: { type: 'string', format: 'date' },
  status: { $ref: '#/components/schemas/EmployeeComplianceAlertStatus' },
  days_until_expiry: { type: 'integer', minimum: -30, maximum: 30 },
}
if (
  !employee.required?.includes('expiring_documents') ||
  !isDeepStrictEqual(employee.properties?.expiring_documents, {
    type: 'array',
    items: { $ref: '#/components/schemas/EmployeeComplianceAlertDocument' },
  }) ||
  alertDocument.type !== 'object' ||
  alertDocument.additionalProperties !== false ||
  !isDeepStrictEqual(alertDocument.required, [
    'type',
    'label',
    'expiry',
    'status',
    'days_until_expiry',
  ]) ||
  !isDeepStrictEqual(alertDocument.properties, expectedAlertDocumentProperties)
) {
  contractErrors.push(
    'Employee.expiring_documents must expose the complete verified employee compliance-alert document contract.'
  )
}

if (
  !isDeepStrictEqual(employeeComplianceAlerts?.security, [
    { BearerAuth: [] },
  ]) ||
  employeeComplianceAlerts?.responses?.['200']?.content?.['application/json']
    ?.schema?.$ref !== '#/components/schemas/EmployeeCollectionResponse' ||
  employeeComplianceAlerts?.responses?.['401']?.$ref !==
    '#/components/responses/Unauthorized' ||
  employeeComplianceAlerts?.responses?.['403']?.$ref !==
    '#/components/responses/Forbidden' ||
  employeeComplianceAlerts?.responses?.['422']?.$ref !==
    '#/components/responses/ValidationError' ||
  employeeComplianceAlerts?.responses?.['500']?.$ref !==
    '#/components/responses/InternalServerError'
) {
  contractErrors.push(
    'GET /employees/compliance-alerts must reuse the authenticated employee collection and standard error responses.'
  )
}

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
  legalEntityLookup.properties ?? {}
)
const legalEntityLookupAllowed = new Set(['id', 'name'])
if (
  legalEntityLookup.type !== 'object' ||
  legalEntityLookup.additionalProperties !== false ||
  legalEntityLookupProperties.some(
    (property) => !legalEntityLookupAllowed.has(property)
  ) ||
  !legalEntityLookup.required?.includes('id') ||
  !legalEntityLookup.required?.includes('name') ||
  legalEntityLookup.properties?.id?.type !== 'string' ||
  legalEntityLookup.properties?.id?.format !== 'uuid' ||
  legalEntityLookup.properties?.name?.type !== 'string'
) {
  contractErrors.push(
    'LegalEntityLookup must expose only required id and name fields.'
  )
}

const legalEntitiesResponse =
  paths['/lookups/legal-entities']?.get?.responses?.['200']?.content?.[
    'application/json'
  ]?.schema
if (
  legalEntitiesResponse?.$ref !==
  '#/components/schemas/LegalEntityLookupCollectionResponse'
) {
  contractErrors.push(
    'GET /lookups/legal-entities must return LegalEntityLookupCollectionResponse.'
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

const customerDescription = customer.description ?? ''
const customerLegalEntityDescription =
  customer.properties?.legal_entity_id?.description ?? ''

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

for (const relationship of ['parent', 'children', 'ancestors', 'descendants']) {
  const property = organizationalUnit.properties?.[relationship]
  const reference =
    relationship === 'parent'
      ? property?.anyOf?.find((schema) => schema?.$ref)?.$ref
      : property?.items?.$ref
  const mustBeNullable = relationship === 'parent'
  const isNullable = property?.anyOf?.some((schema) => schema?.type === 'null')
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

const allowedOrganizationalUnitBooleanWireValues = new Set([
  '1',
  '0',
  'true',
  'false',
])
const organizationalUnitBooleanWireDescription =
  'Omitted or empty values do not apply the filter. Non-empty query-string values may be `1` or `true` for `true`, and `0` or `false` for `false`. No other non-empty values are accepted.'

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
  if (
    parameter?.schema?.type !== 'boolean' ||
    parameter.required !== false ||
    parameter.allowEmptyValue !== true
  ) {
    contractErrors.push(
      `GET /organizational-units must define ${flag} as an optional boolean query filter that permits an empty value.`
    )
  }

  const wireExamples = parameter?.['x-wire-examples'] ?? {}
  if (
    !parameter?.description?.includes(
      organizationalUnitBooleanWireDescription
    ) ||
    wireExamples[numericTrueExample]?.value !== '1' ||
    wireExamples[numericFalseExample]?.value !== '0' ||
    wireExamples[textTrueExample]?.value !== 'true' ||
    wireExamples[textFalseExample]?.value !== 'false' ||
    Object.values(wireExamples).some(
      (example) =>
        !allowedOrganizationalUnitBooleanWireValues.has(example?.value)
    )
  ) {
    contractErrors.push(
      `GET /organizational-units must document omitted or empty ${flag} query-string values as not applying the filter, and non-empty values as 1 or true for true and 0 or false for false, without unrelated values.`
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
    'Organizational-unit deletion must document its direct-child conflict response shape.'
  )
}

const organizationalUnitDeleteDescription =
  paths['/organizational-units/{organizational_unit}']?.delete?.description ??
  ''
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
      !description.includes('is_active') ||
      !description.includes('is_assignable')
  )
) {
  contractErrors.push(
    'Organizational-unit ancestor and descendant responses must document both independent operational status flags.'
  )
}

if (contractErrors.length) {
  console.error('OpenAPI verified-endpoint contract guard failed:')
  for (const line of contractErrors) {
    console.error(`  - ${line}`)
  }
  process.exit(1)
}

console.log(
  `Verified-endpoint presence guard OK (${REQUIRED_OPERATIONS.length} operations).`
)
