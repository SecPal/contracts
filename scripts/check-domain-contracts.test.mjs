#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

const contractPath = fileURLToPath(
  new URL('../docs/openapi.yaml', import.meta.url)
)
const guardPath = fileURLToPath(
  new URL('./check-domain-contracts.mjs', import.meta.url)
)
const contractSource = readFileSync(contractPath, 'utf8')
const contract = yaml.load(contractSource)
const schemas = contract.components.schemas
const paths = contract.paths

function runGuard(candidate) {
  const directory = mkdtempSync(join(tmpdir(), 'domain-contracts-'))
  const candidatePath = join(directory, 'openapi.yaml')
  writeFileSync(candidatePath, yaml.dump(candidate))

  try {
    return spawnSync(process.execPath, [guardPath, candidatePath], {
      encoding: 'utf8',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('accepts the repository domain contract', () => {
  const result = runGuard(contract)

  assert.equal(result.status, 0, result.stderr)
})

test('defines OU-free customer, site, and employee domain relationships', () => {
  assert.deepEqual(
    schemas.Customer.required.includes('legal_entity_id'),
    true
  )
  assert.deepEqual(
    schemas.Site.required.filter((field) =>
      ['customer_id', 'legal_entity_id', 'establishment_id'].includes(field)
    ),
    ['customer_id', 'legal_entity_id', 'establishment_id']
  )
  assert.deepEqual(
    schemas.Employee.required.filter((field) =>
      ['legal_entity_id', 'establishment_id'].includes(field)
    ),
    ['legal_entity_id', 'establishment_id']
  )

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
    assert.equal(
      Object.hasOwn(schemas[schemaName].properties, 'organizational_unit_id'),
      false,
      `${schemaName} must not expose organizational_unit_id`
    )
    assert.equal(
      Object.hasOwn(schemas[schemaName].properties, 'organizational_unit'),
      false,
      `${schemaName} must not expose an organizational_unit relationship`
    )
  }
})

test('moves local customer data to a unique customer establishment contract', () => {
  assert.equal(Object.hasOwn(schemas.Customer.properties, 'contact'), false)
  assert.equal(Object.hasOwn(schemas.Customer.properties, 'notes'), false)
  assert.equal(Object.hasOwn(schemas.Customer.properties, 'metadata'), false)

  assert.deepEqual(schemas.CustomerEstablishment.required, [
    'id',
    'customer_id',
    'establishment_id',
    'created_at',
    'updated_at',
  ])
  assert.match(
    schemas.CustomerEstablishment.description,
    /unique.*customer_id.*establishment_id/i
  )
  for (const property of [
    'customer_id',
    'establishment_id',
    'contact_name',
    'phone',
    'email',
    'comments',
  ]) {
    assert.ok(schemas.CustomerEstablishment.properties[property], property)
  }
})

test('defines minimal legal entity, establishment, and customer lookups', () => {
  assert.deepEqual(Object.keys(schemas.LegalEntityLookup.properties), [
    'id',
    'name',
  ])
  assert.deepEqual(Object.keys(schemas.EstablishmentLookup.properties), [
    'id',
    'name',
  ])
  assert.deepEqual(Object.keys(schemas.CustomerLookup.properties), ['id', 'name'])

  for (const schemaName of [
    'LegalEntityLookup',
    'EstablishmentLookup',
    'CustomerLookup',
  ]) {
    assert.deepEqual(schemas[schemaName].required, ['id', 'name'])
    assert.equal(schemas[schemaName].additionalProperties, false)
  }
})

test('uses one neutral duplicate response for every domain create operation', () => {
  assert.deepEqual(schemas.DuplicateResourceError.required, ['message', 'code'])
  assert.deepEqual(schemas.DuplicateResourceError.properties.code.enum, [
    'DUPLICATE_RESOURCE',
  ])

  for (const path of [
    '/customers',
    '/customer-establishments',
    '/sites',
    '/employees',
  ]) {
    assert.equal(
      contract.paths[path].post.responses['409'].$ref,
      '#/components/responses/DuplicateConflict',
      path
    )
  }
  assert.match(
    contract.components.responses.DuplicateConflict.description,
    /atomically.*same transaction/i
  )
})

test('keeps the closed customer response free of undeclared relationship includes', () => {
  assert.equal(schemas.Customer.additionalProperties, false)
  assert.equal(
    paths['/customers/{customer}'].get.parameters.some(
      (parameter) => parameter.name === 'include'
    ),
    false
  )
  assert.doesNotMatch(
    paths['/customers/{customer}'].get.description,
    /optional relationships/i
  )
})

test('uses an approved example domain for customer establishment contacts', () => {
  assert.equal(
    schemas.CustomerEstablishment.properties.email.example,
    'max.mustermann@secpal.dev'
  )
})

test('defines the customer establishment path parameter once', () => {
  const pathItem = paths['/customer-establishments/{customer_establishment}']

  assert.deepEqual(pathItem.parameters, [
    {
      name: 'customer_establishment',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    },
  ])
  for (const operation of ['get', 'patch', 'delete']) {
    assert.equal(pathItem[operation].parameters, undefined, operation)
  }
})

test('models pagination links for customer establishment collections', () => {
  assert.deepEqual(schemas.CustomerEstablishmentCollectionResponse.required, [
    'data',
    'links',
    'meta',
  ])
  assert.equal(
    schemas.CustomerEstablishmentCollectionResponse.properties.links.$ref,
    '#/components/schemas/PaginationLinks'
  )
})

test('documents accepted and rejected site and employee domain assignments', () => {
  for (const schemaName of ['SiteCreateRequest', 'EmployeeCreateRequest']) {
    const examples = schemas[schemaName]['x-validation-examples']

    assert.ok(examples?.accepted?.length > 0, `${schemaName} accepted example`)
    assert.ok(examples?.rejected?.length > 0, `${schemaName} rejected example`)
    assert.equal(examples.rejected[0].status, 422, schemaName)
  }
})

test('documents tenant-consistent customer establishment links', () => {
  const examples = schemas.CustomerEstablishmentCreateRequest[
    'x-validation-examples'
  ]

  assert.ok(examples?.accepted?.length > 0)
  assert.ok(examples?.rejected?.length > 0)
  assert.equal(examples.rejected[0].status, 422)
})

test('keeps lookup eligibility and dependent relationship lifecycle rules explicit', () => {
  assert.match(
    paths['/lookups/legal-entities'].get.description,
    /customers\.create.*sites\.create.*employees\.create/i
  )
  assert.match(
    paths['/lookups/legal-entities/{legal_entity}/establishments'].get.description,
    /same tenant, active, assignable, non-deleted/i
  )
  assert.match(paths['/sites'].post.description, /customer-establishment link/i)
  assert.match(
    paths['/lookups/establishments/{establishment}/customers'].get.description,
    /existing customer-establishment link/i
  )
  assert.match(
    paths['/customers/{customer}'].patch.description,
    /no customer-establishment links or sites/i
  )
  assert.match(
    paths['/customer-establishments/{customer_establishment}'].delete
      .description,
    /blocked.*sites/i
  )
  assert.equal(
    paths['/customer-establishments/{customer_establishment}'].delete.responses[
      '409'
    ].$ref,
    '#/components/responses/Conflict'
  )
})

test('keeps create and update domain assignments closed and validates their final state', () => {
  assert.equal(schemas.EmployeeCreateRequest.additionalProperties, false)
  assert.equal(schemas.EmployeeUpdateRequest.additionalProperties, false)
  assert.match(
    paths['/employees'].post.description,
    /active, assignable, non-deleted.*organizational write access/i
  )
  assert.match(
    paths['/employees/{employee}'].patch.description,
    /resulting.*same tenant.*Legal Entity.*active, assignable, non-deleted/i
  )
  assert.match(
    schemas.SiteUpdateRequest.description,
    /resulting.*existing customer-establishment link/i
  )
})

test('enforces lookup eligibility when assignment UUIDs are submitted directly', () => {
  assert.match(
    paths['/customer-establishments'].post.description,
    /active, non-deleted customer.*active, assignable, non-deleted establishment.*organizational write access/i
  )
  assert.match(
    paths['/sites'].post.description,
    /active, non-deleted customer.*active, assignable, non-deleted.*organizational write access/i
  )
  assert.match(
    schemas.SiteUpdateRequest.description,
    /active, non-deleted customer.*active, assignable, non-deleted.*organizational write access/i
  )
})

test('separates customer link candidates from customers already linked for sites', () => {
  const linkedCustomers =
    paths['/lookups/establishments/{establishment}/customers'].get
  assert.match(
    linkedCustomers.description,
    /active, non-deleted customers.*existing customer-establishment link/i
  )

  const linkCandidates =
    paths['/lookups/establishments/{establishment}/customer-candidates']?.get
  assert.ok(linkCandidates)
  assert.match(linkCandidates.description, /customers\.update/i)
  assert.match(
    linkCandidates.description,
    /active, non-deleted customers.*not yet linked/i
  )
  assert.equal(
    linkCandidates.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/CustomerLookupCollectionResponse'
  )
})

test('keeps lookup permissions aligned with every link and assignment workflow', () => {
  assert.match(
    paths['/lookups/legal-entities'].get.description,
    /customers\.create.*customers\.update.*sites\.create.*employees\.create/i
  )
  assert.match(
    paths['/lookups/legal-entities/{legal_entity}/establishments'].get
      .description,
    /customers\.update.*sites\.create.*employees\.create/i
  )
  assert.match(
    paths['/lookups/establishments/{establishment}/customers'].get.description,
    /sites\.create.*active, assignable, non-deleted establishment/i
  )
  assert.match(
    paths[
      '/lookups/establishments/{establishment}/customer-candidates'
    ].get.description,
    /customers\.update.*active, assignable, non-deleted establishment/i
  )

  const linkPath =
    paths['/customer-establishments/{customer_establishment}']
  assert.match(linkPath.patch.description, /customers\.update/i)
  assert.match(linkPath.delete.description, /customers\.update/i)
})

test('names link-management permission and blocks referenced OU role downgrades', () => {
  assert.match(
    paths['/customer-establishments'].post.description,
    /customers\.update/i
  )

  const organizationalUnitUpdate =
    paths['/organizational-units/{organizational_unit}'].patch
  assert.match(
    organizationalUnitUpdate.description,
    /is_legal_entity.*is_establishment.*referenced.*customers.*customer-establishment links.*sites.*employees/i
  )
  assert.equal(
    organizationalUnitUpdate.responses['409'].$ref,
    '#/components/responses/Conflict'
  )
})

test('blocks deletion of domain records that still have dependents', () => {
  const customerDelete = paths['/customers/{customer}'].delete
  assert.match(
    customerDelete.description,
    /customer-establishment links or sites/i
  )
  assert.equal(
    customerDelete.responses['409'].$ref,
    '#/components/responses/Conflict'
  )

  const organizationalUnitDelete =
    paths['/organizational-units/{organizational_unit}'].delete
  assert.match(
    organizationalUnitDelete.description,
    /customers, customer-establishment links, sites, or employees/i
  )
  assert.equal(
    organizationalUnitDelete.responses['409'].$ref,
    '#/components/responses/OrganizationalUnitDeletionConflict'
  )
})

test('guard rejects reopened writes and weakened final-state or deletion rules', () => {
  const candidate = structuredClone(contract)
  delete candidate.components.schemas.EmployeeUpdateRequest.additionalProperties
  candidate.components.schemas.SiteUpdateRequest.description = 'Partial update.'
  candidate.paths['/customers/{customer}'].delete.responses['409'] = undefined

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /EmployeeUpdateRequest/)
  assert.match(result.stderr, /PATCH site assignments/)
  assert.match(result.stderr, /DELETE customers/)
})

test('guard rejects restored OU fields and list filters', () => {
  const candidate = structuredClone(contract)
  candidate.components.schemas.Employee.properties.organizational_unit_id = {
    type: 'string',
    format: 'uuid',
  }
  candidate.paths['/sites'].get.parameters.push({
    name: 'organizational_unit_id',
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /organizational_unit_id/)
})

test('guard rejects optionalized domain relationships', () => {
  const candidate = structuredClone(contract)
  candidate.components.schemas.Site.required =
    candidate.components.schemas.Site.required.filter(
      (property) => property !== 'establishment_id'
    )

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /Site\.establishment_id/)
})

test('guard rejects widened lookup data', () => {
  const candidate = structuredClone(contract)
  candidate.components.schemas.CustomerLookup.properties.customer_number = {
    type: 'string',
  }

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /CustomerLookup/)
})

test('guard rejects weakened lookup, permission, and OU role invariants', () => {
  const candidate = structuredClone(contract)
  candidate.paths[
    '/lookups/establishments/{establishment}/customers'
  ].get.description = 'Returns authorized customer options.'
  candidate.paths[
    '/lookups/establishments/{establishment}/customer-candidates'
  ].get.description = 'Returns authorized customer options.'
  candidate.paths['/customer-establishments'].post.description =
    'Creates a customer-establishment link.'
  candidate.paths[
    '/customer-establishments/{customer_establishment}'
  ].patch.description = 'Updates local contact data.'
  candidate.paths[
    '/customer-establishments/{customer_establishment}'
  ].delete.description = 'Deletes a link when unused.'
  candidate.paths[
    '/organizational-units/{organizational_unit}'
  ].patch.description = 'Updates an organizational unit.'
  delete candidate.paths['/organizational-units/{organizational_unit}'].patch
    .responses['409']

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /GET linked customer lookups/)
  assert.match(result.stderr, /GET customer link candidates/)
  assert.match(result.stderr, /POST customer-establishment links/)
  assert.match(result.stderr, /PATCH customer-establishment links/)
  assert.match(result.stderr, /DELETE customer-establishment links/)
  assert.match(result.stderr, /PATCH organizational-unit roles/)
})

test('guard rejects distinguishable duplicate responses', () => {
  const candidate = structuredClone(contract)
  candidate.components.schemas.DuplicateResourceError.properties.message.enum = [
    'This email address already exists.',
  ]

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /neutral fixed shape/)
})

test('guard rejects customer includes that widen the closed response', () => {
  const candidate = structuredClone(contract)
  candidate.paths['/customers/{customer}'].get.parameters.push({
    name: 'include',
    in: 'query',
    schema: { type: 'string', enum: ['sites'] },
  })

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /closed Customer response/)
})

test('guard rejects unapproved contact example domains', () => {
  const candidate = structuredClone(contract)
  candidate.components.schemas.CustomerEstablishment.properties.email.example =
    'max.mustermann@example.com'

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /secpal\.dev/)
})

test('guard rejects duplicated customer establishment path parameters', () => {
  const candidate = structuredClone(contract)
  const pathItem =
    candidate.paths['/customer-establishments/{customer_establishment}']
  pathItem.get.parameters = structuredClone(pathItem.parameters)

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /path-level UUID parameter/)
})

test('guard rejects incomplete pagination and domain-assignment examples', () => {
  const candidate = structuredClone(contract)
  delete candidate.components.schemas.CustomerEstablishmentCollectionResponse
    .properties.links
  candidate.components.schemas.CustomerEstablishmentCollectionResponse.required =
    ['data', 'meta']
  delete candidate.components.schemas.EmployeeCreateRequest[
    'x-validation-examples'
  ].rejected

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /pagination links/)
  assert.match(result.stderr, /EmployeeCreateRequest/)
})

test('guard rejects malformed UUIDs in domain-assignment examples', () => {
  const candidate = structuredClone(contract)
  candidate.components.schemas.SiteCreateRequest[
    'x-validation-examples'
  ].accepted[0].value.establishment_id = 'not-a-uuid'

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /SiteCreateRequest/)
})
