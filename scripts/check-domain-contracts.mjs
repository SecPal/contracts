#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'

const contractPath = resolve(process.argv[2] ?? 'docs/openapi.yaml')
const contract = yaml.load(readFileSync(contractPath, 'utf8'))
const schemas = contract?.components?.schemas ?? {}
const responses = contract?.components?.responses ?? {}
const paths = contract?.paths ?? {}
const errors = []

const uuidProperty = (property) =>
  property?.type === 'string' && property?.format === 'uuid'

function requireUuid(schemaName, propertyName, required) {
  const schema = schemas[schemaName]
  if (
    !uuidProperty(schema?.properties?.[propertyName]) ||
    Boolean(schema?.required?.includes(propertyName)) !== required
  ) {
    errors.push(
      `${schemaName}.${propertyName} must be ${required ? 'a required' : 'an optional'} UUID.`
    )
  }
}

function rejectOuFields(schemaName) {
  const properties = schemas[schemaName]?.properties ?? {}
  for (const propertyName of ['organizational_unit_id', 'organizational_unit']) {
    if (Object.hasOwn(properties, propertyName)) {
      errors.push(`${schemaName} must not expose ${propertyName}.`)
    }
  }
}

const customerAllowedProperties = new Set([
  'id',
  'customer_number',
  'legal_entity_id',
  'vat_id',
  'name',
  'billing_address',
  'is_active',
  'created_at',
  'updated_at',
  'deleted_at',
])
for (const propertyName of Object.keys(schemas.Customer?.properties ?? {})) {
  if (!customerAllowedProperties.has(propertyName)) {
    errors.push(`Customer must not expose non-master-data field ${propertyName}.`)
  }
}

for (const schemaName of [
  'Customer',
  'CustomerCreateRequest',
  'CustomerUpdateRequest',
  'Site',
  'SiteCreateRequest',
  'SiteUpdateRequest',
  'Employee',
  'EmployeeCreateRequest',
  'EmployeeUpdateRequest',
]) {
  rejectOuFields(schemaName)
}

requireUuid('Customer', 'legal_entity_id', true)
requireUuid('CustomerCreateRequest', 'legal_entity_id', true)
requireUuid('CustomerUpdateRequest', 'legal_entity_id', false)
for (const schemaName of ['Site', 'SiteCreateRequest']) {
  requireUuid(schemaName, 'customer_id', true)
  requireUuid(schemaName, 'legal_entity_id', true)
  requireUuid(schemaName, 'establishment_id', true)
}
for (const propertyName of [
  'customer_id',
  'legal_entity_id',
  'establishment_id',
]) {
  requireUuid('SiteUpdateRequest', propertyName, false)
}
for (const schemaName of ['Employee', 'EmployeeCreateRequest']) {
  requireUuid(schemaName, 'legal_entity_id', true)
  requireUuid(schemaName, 'establishment_id', true)
}
for (const propertyName of ['legal_entity_id', 'establishment_id']) {
  requireUuid('EmployeeUpdateRequest', propertyName, false)
}

for (const [pathName, operation] of [
  ['/sites', paths['/sites']?.get],
  ['/employees', paths['/employees']?.get],
]) {
  const parameters = operation?.parameters ?? []
  if (parameters.some((parameter) => parameter?.name === 'organizational_unit_id')) {
    errors.push(`GET ${pathName} must not expose an organizational_unit_id filter.`)
  }
}
const siteIncludes = paths['/sites/{site}']?.get?.parameters?.find(
  (parameter) => parameter?.name === 'include'
)?.schema?.enum
if (siteIncludes?.some((value) => /organizational/i.test(value))) {
  errors.push('GET /sites/{site} must not expose an organizational-unit include.')
}

const customerEstablishment = schemas.CustomerEstablishment ?? {}
const expectedCustomerEstablishmentRequired = [
  'id',
  'customer_id',
  'establishment_id',
  'created_at',
  'updated_at',
]
if (
  JSON.stringify(customerEstablishment.required) !==
    JSON.stringify(expectedCustomerEstablishmentRequired) ||
  !/unique.*customer_id.*establishment_id/i.test(
    customerEstablishment.description ?? ''
  )
) {
  errors.push(
    'CustomerEstablishment must define the unique customer_id and establishment_id pair and required response fields.'
  )
}
for (const propertyName of [
  'customer_id',
  'establishment_id',
  'contact_name',
  'phone',
  'email',
  'comments',
]) {
  if (!customerEstablishment.properties?.[propertyName]) {
    errors.push(`CustomerEstablishment must expose ${propertyName}.`)
  }
}

for (const schemaName of [
  'LegalEntityLookup',
  'EstablishmentLookup',
  'CustomerLookup',
]) {
  const schema = schemas[schemaName] ?? {}
  if (
    schema.type !== 'object' ||
    schema.additionalProperties !== false ||
    JSON.stringify(schema.required) !== JSON.stringify(['id', 'name']) ||
    JSON.stringify(Object.keys(schema.properties ?? {})) !==
      JSON.stringify(['id', 'name']) ||
    !uuidProperty(schema.properties?.id) ||
    schema.properties?.name?.type !== 'string'
  ) {
    errors.push(`${schemaName} must expose only required id and name fields.`)
  }
}

for (const [pathName, responseRef] of [
  [
    '/lookups/legal-entities',
    '#/components/schemas/LegalEntityLookupCollectionResponse',
  ],
  [
    '/lookups/legal-entities/{legal_entity}/establishments',
    '#/components/schemas/EstablishmentLookupCollectionResponse',
  ],
  [
    '/lookups/establishments/{establishment}/customers',
    '#/components/schemas/CustomerLookupCollectionResponse',
  ],
]) {
  const operation = paths[pathName]?.get
  const actualRef =
    operation?.responses?.['200']?.content?.['application/json']?.schema?.$ref
  if (
    actualRef !== responseRef ||
    !/only/i.test(operation?.description ?? '') ||
    !/authorized/i.test(operation?.description ?? '')
  ) {
    errors.push(
      `GET ${pathName} must return the minimal authorized lookup response.`
    )
  }
}

const duplicateError = schemas.DuplicateResourceError ?? {}
if (
  duplicateError.additionalProperties !== false ||
  JSON.stringify(duplicateError.required) !==
    JSON.stringify(['message', 'code']) ||
  JSON.stringify(duplicateError.properties?.code?.enum) !==
    JSON.stringify(['DUPLICATE_RESOURCE']) ||
  JSON.stringify(duplicateError.properties?.message?.enum) !==
    JSON.stringify(['A matching record already exists.'])
) {
  errors.push('DuplicateResourceError must retain its neutral fixed shape.')
}
if (
  responses.DuplicateConflict?.content?.['application/json']?.schema?.$ref !==
    '#/components/schemas/DuplicateResourceError' ||
  !/atomically.*same transaction/i.test(
    responses.DuplicateConflict?.description ?? ''
  )
) {
  errors.push(
    'DuplicateConflict must document atomic checking and use DuplicateResourceError.'
  )
}
for (const pathName of [
  '/customers',
  '/customer-establishments',
  '/sites',
  '/employees',
]) {
  if (
    paths[pathName]?.post?.responses?.['409']?.$ref !==
    '#/components/responses/DuplicateConflict'
  ) {
    errors.push(`POST ${pathName} must use DuplicateConflict for duplicates.`)
  }
}

if (errors.length > 0) {
  console.error('Domain contract guard failed:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log('Domain contract guard passed.')
