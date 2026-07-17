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
const changelogPath = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url))
const guardPath = fileURLToPath(
  new URL('./check-domain-contracts.mjs', import.meta.url)
)
const contractSource = readFileSync(contractPath, 'utf8')
const changelogSource = readFileSync(changelogPath, 'utf8')
const contract = yaml.load(contractSource)
const schemas = contract.components.schemas
const paths = contract.paths

function runGuard(candidate, candidateChangelog = changelogSource) {
  const directory = mkdtempSync(join(tmpdir(), 'domain-contracts-'))
  const candidatePath = join(directory, 'openapi.yaml')
  const candidateChangelogPath = join(directory, 'CHANGELOG.md')
  writeFileSync(candidatePath, yaml.dump(candidate))
  writeFileSync(candidateChangelogPath, candidateChangelog)

  try {
    return spawnSync(
      process.execPath,
      [guardPath, candidatePath, candidateChangelogPath],
      { encoding: 'utf8' }
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('accepts the repository domain contract', () => {
  const result = runGuard(contract)

  assert.equal(result.status, 0, result.stderr)
})

test('defines OU-free customer, site, and employee domain relationships', () => {
  assert.deepEqual(schemas.Customer.required.includes('legal_entity_id'), true)
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

test('keeps employee creation audit examples aligned with domain assignments', () => {
  const employeeCreationActivities = [
    paths['/activity-logs'].get.responses['200'].content['application/json']
      .examples.paginatedResponse.value.data[0],
    paths['/activity-logs/{activity}'].get.responses['200'].content[
      'application/json'
    ].examples.employeeCreation.value.data,
  ]

  for (const activity of employeeCreationActivities) {
    assert.equal(activity.subject_type, 'App\\Models\\Employee')
    assert.equal(activity.event, 'created')
    assert.equal(activity.log_name, 'employee_changes')
    assert.equal(activity.description, 'created')
    assert.match(
      activity.properties.attributes.legal_entity_id,
      /^[0-9a-f-]{36}$/i
    )
    assert.match(
      activity.properties.attributes.establishment_id,
      /^[0-9a-f-]{36}$/i
    )
    for (const forbiddenField of [
      'organizational_unit_id',
      'name',
      'first_name',
      'last_name',
      'email',
      'phone',
    ]) {
      assert.equal(
        Object.hasOwn(activity.properties.attributes, forbiddenField),
        false,
        `employee audit attributes must not expose ${forbiddenField}`
      )
    }
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

test('limits customer-establishment uniqueness to the relationship pair', () => {
  assert.deepEqual(schemas.CustomerEstablishment['x-unique-by'], [
    'customer_id',
    'establishment_id',
  ])
  assert.doesNotMatch(
    paths['/customer-establishments'].post.description,
    /local identifying data/i
  )

  const examples =
    schemas.CustomerEstablishmentCreateRequest['x-uniqueness-examples']
  const reusableContact = examples.accepted[0]
  assert.notEqual(
    reusableContact.existing.customer_id,
    reusableContact.value.customer_id
  )
  assert.equal(reusableContact.existing.email, reusableContact.value.email)

  const duplicatePair = examples.rejected[0]
  assert.equal(
    duplicatePair.existing.customer_id,
    duplicatePair.value.customer_id
  )
  assert.equal(
    duplicatePair.existing.establishment_id,
    duplicatePair.value.establishment_id
  )
  assert.notEqual(duplicatePair.existing.email, duplicatePair.value.email)
  assert.equal(duplicatePair.status, 409)
})

test('documents OU conflict changes without claiming administration is unchanged', () => {
  assert.match(changelogSource, /role-downgraded or deleted.*conflict/is)
  assert.doesNotMatch(
    changelogSource,
    /organizational-unit and scope administration contracts remain unchanged/i
  )
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
  assert.deepEqual(Object.keys(schemas.CustomerLookup.properties), [
    'id',
    'name',
  ])

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

test('documents evidence for every relationship-writing workflow', () => {
  for (const schemaName of [
    'CustomerCreateRequest',
    'CustomerUpdateRequest',
    'CustomerEstablishmentCreateRequest',
    'SiteCreateRequest',
    'SiteUpdateRequest',
    'EmployeeCreateRequest',
    'EmployeeUpdateRequest',
  ]) {
    const examples = schemas[schemaName]['x-validation-examples']
    assert.ok(examples?.accepted?.length > 0, `${schemaName} accepted evidence`)
    assert.ok(examples?.rejected?.length > 0, `${schemaName} rejected evidence`)
  }

  for (const [schemaName, relationshipFields] of [
    ['CustomerUpdateRequest', ['legal_entity_id']],
    [
      'SiteUpdateRequest',
      ['customer_id', 'legal_entity_id', 'establishment_id'],
    ],
    ['EmployeeUpdateRequest', ['legal_entity_id', 'establishment_id']],
  ]) {
    const examples = schemas[schemaName]['x-validation-examples']
    for (const example of [examples.accepted[0], examples.rejected[0]]) {
      assert.ok(
        relationshipFields.some((field) => Object.hasOwn(example.value, field)),
        `${schemaName} must mutate a relationship field`
      )
      assert.deepEqual(
        relationshipFields.filter((field) =>
          Object.hasOwn(example.resulting, field)
        ),
        relationshipFields,
        `${schemaName} resulting state`
      )
    }
  }
})

test('documents tenant-consistent customer establishment links', () => {
  const examples =
    schemas.CustomerEstablishmentCreateRequest['x-validation-examples']

  assert.ok(examples?.accepted?.length > 0)
  assert.ok(examples?.rejected?.length > 0)
  assert.equal(examples.rejected[0].status, 422)
})

test('documents customer-establishment read authorization consistently', () => {
  for (const operation of [
    paths['/customer-establishments'].get,
    paths['/customer-establishments/{customer_establishment}'].get,
  ]) {
    assert.match(
      operation.description,
      /view access.*customer assignment.*organizational scope.*authorized/is
    )
    assert.equal(
      operation.responses['403'].$ref,
      '#/components/responses/Forbidden'
    )
  }
})

test('documents employee qualification access after OU decoupling', () => {
  const operation = paths['/employees/{employee}/qualifications'].get

  assert.match(
    operation.description,
    /OU scopes do not grant access.*organizational scopes.*403.*No organizational entitlement exists/is
  )
  assert.equal(
    operation.responses['403'].$ref,
    '#/components/responses/SimpleForbidden'
  )
})

test('keeps lookup eligibility and dependent relationship lifecycle rules explicit', () => {
  assert.match(
    paths['/lookups/legal-entities'].get.description,
    /customers\.create.*sites\.create.*employees\.create/i
  )
  assert.match(
    paths['/lookups/legal-entities/{legal_entity}/establishments'].get
      .description,
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
    /customers\.create.*customers\.update.*sites\.create.*sites\.update.*employees\.create.*employees\.update/i
  )
  assert.match(
    paths['/lookups/legal-entities/{legal_entity}/establishments'].get
      .description,
    /customers\.update.*sites\.create.*sites\.update.*employees\.create.*employees\.update/i
  )
  assert.match(
    paths['/lookups/establishments/{establishment}/customers'].get.description,
    /sites\.create.*sites\.update.*active, assignable, non-deleted establishment/i
  )
  assert.match(
    paths['/lookups/establishments/{establishment}/customer-candidates'].get
      .description,
    /customers\.update.*active, assignable, non-deleted establishment/i
  )

  const linkPath = paths['/customer-establishments/{customer_establishment}']
  assert.match(linkPath.patch.description, /customers\.update/i)
  assert.match(linkPath.delete.description, /customers\.update/i)
  assert.match(
    paths['/employees/{employee}'].patch.description,
    /employees\.update/i
  )
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
  const customerUpdate = paths['/customers/{customer}'].patch
  assert.equal(
    customerUpdate.responses['409'].$ref,
    '#/components/responses/Conflict'
  )

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

test('guard rejects stale or privacy-widened employee creation audit examples', () => {
  const candidate = structuredClone(contract)
  const listActivity =
    candidate.paths['/activity-logs'].get.responses['200'].content[
      'application/json'
    ].examples.paginatedResponse.value.data[0]
  const detailActivity =
    candidate.paths['/activity-logs/{activity}'].get.responses['200'].content[
      'application/json'
    ].examples.employeeCreation.value.data

  delete listActivity.properties.attributes.establishment_id
  detailActivity.properties.attributes.organizational_unit_id =
    '550e8400-e29b-41d4-a716-446655440030'
  detailActivity.properties.attributes.name = 'John Doe'

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /employee creation audit examples/)
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

test('guard derives lookup permissions and conflict responses from workflows', () => {
  const candidate = structuredClone(contract)
  for (const pathName of [
    '/lookups/legal-entities',
    '/lookups/legal-entities/{legal_entity}/establishments',
  ]) {
    candidate.paths[pathName].get.description = candidate.paths[
      pathName
    ].get.description.replace('`sites.update`, ', '')
  }
  candidate.paths[
    '/lookups/establishments/{establishment}/customers'
  ].get.description = candidate.paths[
    '/lookups/establishments/{establishment}/customers'
  ].get.description.replace(' or `sites.update`', '')
  delete candidate.paths['/customers/{customer}'].patch.responses['409']

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /GET Legal Entity lookups.*sites\.update/)
  assert.match(result.stderr, /GET establishment lookups.*sites\.update/)
  assert.match(result.stderr, /GET linked customer lookups.*sites\.update/)
  assert.match(
    result.stderr,
    /PATCH customer Legal Entity reassignment.*Conflict.*409/
  )
})

test('guard rejects relationship-writing operations missing from the workflow model', () => {
  const candidate = structuredClone(contract)
  candidate.paths['/sites/{site}/domain-copy'] = {
    patch: {
      description: 'Requires sites.update.',
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                establishment_id: { type: 'string', format: 'uuid' },
              },
            },
          },
        },
      },
      responses: {},
    },
  }

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(
    result.stderr,
    /PATCH \/sites\/\{site\}\/domain-copy.*workflow model/
  )
})

test('guard rejects widened relationship uniqueness and missing evidence', () => {
  const candidate = structuredClone(contract)
  candidate.components.schemas.CustomerEstablishment['x-unique-by'].push(
    'email'
  )
  delete candidate.components.schemas.CustomerEstablishmentCreateRequest[
    'x-uniqueness-examples'
  ]
  candidate.paths['/customer-establishments'].post.description =
    'Duplicate identification includes local identifying data.'

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /CustomerEstablishment uniqueness/)
})

test('guard rejects changelog claims that contradict OU conflicts', () => {
  const contradictoryChangelog = `${changelogSource}\nOrganizational-unit and scope administration contracts remain unchanged.\n`

  const result = runGuard(contract, contradictoryChangelog)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /CHANGELOG OU lifecycle notes/)
})

test('guard rejects incomplete customer-establishment read authorization', () => {
  const candidate = structuredClone(contract)
  candidate.paths['/customer-establishments'].get.description =
    'Lists authorized assignments.'
  delete candidate.paths['/customer-establishments/{customer_establishment}']
    .get.responses['403']

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /GET customer-establishment collections/)
  assert.match(result.stderr, /GET customer-establishment links/)
})

test('guard rejects stale OU-based employee qualification access', () => {
  const candidate = structuredClone(contract)
  candidate.paths['/employees/{employee}/qualifications'].get.description =
    'Users with organizational scopes see employees in their allowed units.'

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /GET employee qualifications/)
})

test('guard rejects missing assignment workflow evidence', () => {
  const candidate = structuredClone(contract)
  delete candidate.components.schemas.SiteUpdateRequest['x-validation-examples']

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /PATCH site assignments.*workflow evidence/)
})

test('guard rejects distinguishable duplicate responses', () => {
  const candidate = structuredClone(contract)
  candidate.components.schemas.DuplicateResourceError.properties.message.enum =
    ['This email address already exists.']

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
