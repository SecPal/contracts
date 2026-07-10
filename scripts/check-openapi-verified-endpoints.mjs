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
const organizationalUnit = schemas.OrganizationalUnit ?? {}
const createRequest = schemas.OrganizationalUnitCreateRequest ?? {}
const updateRequest = schemas.OrganizationalUnitUpdateRequest ?? {}
const parentIdParameter = paths['/organizational-units']?.get?.parameters?.find(
  (parameter) => parameter?.name === 'parent_id'
)
const contractErrors = []

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

for (const flag of ['is_legal_entity', 'is_establishment']) {
  if ('default' in (updateRequest.properties?.[flag] ?? {})) {
    contractErrors.push(
      `OrganizationalUnitUpdateRequest.${flag} must not default an omitted PATCH field.`
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
