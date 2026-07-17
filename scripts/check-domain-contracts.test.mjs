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

test('aligns migrated collection filters with the domain APIs', () => {
  const cases = [
    {
      path: '/customers',
      names: ['page', 'per_page', 'search', 'is_active'],
      uuidNames: [],
      search: /name and customer_number/i,
    },
    {
      path: '/sites',
      names: [
        'page',
        'per_page',
        'search',
        'customer_id',
        'establishment_id',
        'type',
        'is_active',
      ],
      uuidNames: ['customer_id', 'establishment_id'],
      search: /name and site_number/i,
    },
    {
      path: '/employees',
      names: [
        'page',
        'per_page',
        'status',
        'search',
        'legal_entity_id',
        'establishment_id',
      ],
      uuidNames: ['legal_entity_id', 'establishment_id'],
      search: /email and employee_number/i,
    },
  ]

  for (const { path, names, uuidNames, search } of cases) {
    const parameters = paths[path].get.parameters
    assert.deepEqual(
      parameters.map(({ name }) => name),
      names,
      `${path} filters`
    )
    for (const name of uuidNames) {
      const parameter = parameters.find((candidate) => candidate.name === name)
      assert.equal(parameter.schema.type, 'string')
      assert.equal(parameter.schema.format, 'uuid')
    }
    assert.match(
      parameters.find(({ name }) => name === 'search').description,
      search
    )
  }
})

test('retains supported customer and site business identifier inputs', () => {
  for (const [schemaName, propertyName] of [
    ['CustomerCreateRequest', 'customer_number'],
    ['SiteCreateRequest', 'site_number'],
  ]) {
    const schema = schemas[schemaName]
    assert.deepEqual(schema.properties[propertyName].type, ['string', 'null'])
    assert.equal(schema.properties[propertyName].maxLength, 50)
    assert.equal(schema.required?.includes(propertyName) ?? false, false)
  }

  assert.equal(schemas.SiteUpdateRequest.properties.site_number.type, 'string')
  assert.equal(schemas.SiteUpdateRequest.properties.site_number.maxLength, 50)
  assert.equal(
    schemas.SiteUpdateRequest.required?.includes('site_number') ?? false,
    false
  )

  for (const schemaName of ['CustomerCreateRequest', 'SiteCreateRequest']) {
    assert.deepEqual(schemas[schemaName].properties.is_active.type, [
      'boolean',
      'null',
    ])
    assert.equal(schemas[schemaName].properties.is_active.default, true)
    assert.equal(
      schemas[schemaName].required?.includes('is_active') ?? false,
      false
    )
  }
  assert.deepEqual(schemas.SiteCreateRequest.properties.contact.anyOf, [
    { $ref: '#/components/schemas/Contact' },
    { type: 'null' },
  ])
  assert.match(
    paths['/customers'].post.description,
    /customer_number.*omitted or null.*generat(?:ed|es)/is
  )
  assert.match(
    paths['/sites'].post.description,
    /site_number.*omitted or null.*generat(?:ed|es)/is
  )
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
    assert.equal(
      activity.subject?.name ?? null,
      null,
      'employee creation audit subjects must not expose a personal name'
    )
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
  assert.equal(
    schemas.Customer.required.includes('customer_establishments'),
    true,
    'customer responses must always include customer_establishments, including when empty'
  )
  assert.deepEqual(schemas.Customer.properties.customer_establishments, {
    type: 'array',
    description:
      'Customer-to-establishment assignments with local contact data. Always present; empty when the customer has no assignments. No organizational-unit relationships are exposed.',
    items: {
      $ref: '#/components/schemas/CustomerEstablishment',
    },
  })

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

test('documents embedded customer-establishment assignments in customer responses', () => {
  const listResponse = paths['/customers'].get.responses['200'].content[
    'application/json'
  ]
  const detailResponse = paths['/customers/{customer}'].get.responses['200']
    .content['application/json']

  for (const response of [listResponse, detailResponse]) {
    const customer = response.examples.withCustomerEstablishment.value.data
    const customers = Array.isArray(customer) ? customer : [customer]

    for (const item of customers) {
      assert.ok(Array.isArray(item.customer_establishments))
      assert.equal(
        Object.hasOwn(item.customer_establishments[0], 'organizational_unit_id'),
        false
      )
      assert.equal(
        Object.hasOwn(item.customer_establishments[0], 'organizational_unit'),
        false
      )
    }
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

test('keeps tenant-local domain lifecycle independent from OU role flags', () => {
  const domainDescriptions = [
    schemas.CustomerCreateRequest.properties.legal_entity_id.description,
    schemas.CustomerUpdateRequest.properties.legal_entity_id.description,
    schemas.EmployeeUpdateRequest.description,
    schemas.SiteUpdateRequest.description,
    paths['/customers'].post.description,
    paths['/customers/{customer}'].patch.description,
    paths['/customer-establishments'].post.description,
    paths['/sites'].post.description,
    paths['/employees'].post.description,
    paths['/employees/{employee}'].patch.description,
    paths['/lookups/legal-entities'].get.description,
    paths['/lookups/legal-entities/{legal_entity}/establishments'].get
      .description,
    paths['/lookups/establishments/{establishment}/customers'].get.description,
    paths['/lookups/establishments/{establishment}/customer-candidates'].get
      .description,
  ]
  for (const description of domainDescriptions) {
    assert.doesNotMatch(
      description,
      /active, assignable|assignable (?:Legal Entit|establishment)|(?:Legal Entit|establishment)[^.]*assignable/i
    )
  }

  const organizationalUnit =
    paths['/organizational-units/{organizational_unit}']
  assert.doesNotMatch(
    `${organizationalUnit.patch.description}\n${organizationalUnit.delete.description}`,
    /customers|customer-establishment|sites|employees/i
  )
  assert.equal(organizationalUnit.patch.responses['409'], undefined)
  assert.equal(
    organizationalUnit.delete.responses['409'].$ref,
    '#/components/responses/OrganizationalUnitHasChildrenConflict'
  )
  assert.doesNotMatch(changelogSource, /role-downgraded or deleted.*conflict/is)
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
  assert.deepEqual(schemas.Customer.properties.sites_count, {
    type: 'integer',
    minimum: 0,
    description:
      "Number of the customer's sites visible to the current caller. Present on customer list and detail responses.",
  })
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

test('keeps customer and site domain mutations outside OU entitlement', () => {
  const domainMutations = [
    [paths['/customers'].post, 'customers.create'],
    [paths['/customers/{customer}'].patch, 'customers.update'],
    [paths['/customers/{customer}'].delete, 'customers.delete'],
    [paths['/customer-establishments'].post, 'customers.update'],
    [
      paths['/customer-establishments/{customer_establishment}'].patch,
      'customers.update',
    ],
    [
      paths['/customer-establishments/{customer_establishment}'].delete,
      'customers.update',
    ],
    [paths['/sites'].post, 'sites.create'],
    [paths['/sites/{site}'].patch, 'sites.update'],
    [paths['/sites/{site}'].delete, 'sites.delete'],
  ]
  for (const [operation, permission] of domainMutations) {
    assert.match(
      operation.description,
      /OU scopes do not grant access to customer or site domain writes.*callers with any organizational scopes.*403/is
    )
    assert.match(
      operation.description,
      new RegExp(
        'unscoped callers require `' + permission.replace('.', '\\.') + '`',
        'i'
      )
    )
    assert.doesNotMatch(operation.description, /organizational write access/i)
    assert.equal(
      operation.responses['403'].$ref,
      '#/components/responses/Forbidden'
    )
  }

  assert.match(
    paths['/customers/{customer}'].patch.description,
    /legal_entity_id.*same-tenant, active, non-deleted Legal Entity/is
  )
  assert.match(
    schemas.SiteUpdateRequest.description,
    /resulting customer, Legal Entity, and establishment combination/is
  )
  assert.doesNotMatch(
    schemas.SiteUpdateRequest.description,
    /organizational scopes.*403/is
  )
})

test('documents customer record read authorization without OU entitlement', () => {
  for (const operation of [
    paths['/customers/{customer}'].get,
    paths['/customer-establishments/{customer_establishment}'].get,
  ]) {
    assert.match(
      operation.description,
      /active customer or site assignment.*customers\.read.*without organizational scopes.*OU scopes alone do not grant record access/is
    )
    assert.equal(
      operation.responses['403'].$ref,
      '#/components/responses/Forbidden'
    )
  }

  for (const operation of [
    paths['/customers'].get,
    paths['/customer-establishments'].get,
  ]) {
    assert.match(
      operation.description,
      /customers\.read.*without organizational scopes.*active customer or site assignment.*OU scope alone.*empty authorized collection/is
    )
    assert.equal(
      operation.responses['403'].$ref,
      '#/components/responses/Forbidden'
    )
  }
})

test('documents site record read authorization without OU entitlement', () => {
  assert.match(
    paths['/sites'].get.description,
    /sites\.read.*active customer or site assignment.*OU scope alone.*empty authorized collection/is
  )
  assert.equal(
    paths['/sites'].get.responses['403'].$ref,
    '#/components/responses/Forbidden'
  )

  assert.match(
    paths['/sites/{site}'].get.description,
    /sites\.read.*active customer or site assignment.*OU scopes alone do not grant record access/is
  )
  assert.equal(
    paths['/sites/{site}'].get.responses['403'].$ref,
    '#/components/responses/Forbidden'
  )
})

test('documents all employee subresource authorization after OU decoupling', () => {
  const noOuBoundary =
    /OU scopes do not grant access to domain employees.*organizational scopes.*403/is
  const qualificationOperations = [
    [
      paths['/employees/{employee}/qualifications'].get,
      'employee_qualification.read',
      true,
    ],
    [
      paths['/employees/{employee}/qualifications'].post,
      'employee_qualification.write',
      false,
    ],
    [
      paths['/employee-qualifications/{employeeQualification}'].get,
      'employee_qualification.read',
      true,
    ],
    [
      paths['/employee-qualifications/{employeeQualification}'].patch,
      'employee_qualification.write',
      false,
    ],
    [
      paths['/employee-qualifications/{employeeQualification}'].delete,
      'employee_qualification.write',
      false,
    ],
  ]
  const documentOperations = [
    [
      paths['/employees/{employee}/documents'].get,
      'employee_document.read',
      true,
    ],
    [
      paths['/employees/{employee}/documents'].post,
      'employee_document.write',
      false,
    ],
    [
      paths['/employees/{employee}/documents/{document}'].get,
      'employee_document.read',
      true,
    ],
    [
      paths['/employees/{employee}/documents/{document}'].delete,
      'employee_document.write',
      false,
    ],
    [
      paths['/employees/{employee}/documents/{document}/download'].get,
      'employee_document.read',
      true,
    ],
  ]

  for (const [operation, permission, selfService] of qualificationOperations) {
    assert.match(operation.description, noOuBoundary)
    assert.match(
      operation.description,
      new RegExp(permission.replace('.', '\\.'))
    )
    assert.equal(
      /\*\*Self-service:\*\*/i.test(operation.description),
      selfService
    )
    if (selfService) {
      assert.match(
        operation.description,
        /non-self callers.*organizational scopes.*403/is
      )
    }
    assert.equal(
      operation.responses['403'].$ref,
      '#/components/responses/SimpleForbidden'
    )
  }
  for (const [operation, permission, selfService] of documentOperations) {
    assert.match(operation.description, noOuBoundary)
    assert.match(
      operation.description,
      new RegExp(permission.replace('.', '\\.'))
    )
    assert.equal(
      /\*\*Self-service:\*\*/i.test(operation.description),
      selfService
    )
    if (selfService) {
      assert.match(
        operation.description,
        /non-self callers.*organizational scopes.*403/is
      )
    }
    assert.equal(
      operation.responses['403'].$ref,
      '#/components/responses/Forbidden'
    )
  }
  for (const schemaName of [
    'AttachQualificationRequest',
    'UpdateEmployeeQualificationRequest',
  ]) {
    assert.match(schemas[schemaName].description, noOuBoundary)
  }
})

test('keeps lookup eligibility and dependent relationship lifecycle rules explicit', () => {
  assert.match(
    paths['/lookups/legal-entities'].get.description,
    /customers\.create.*sites\.create.*employee\.create/i
  )
  assert.match(
    paths['/lookups/legal-entities/{legal_entity}/establishments'].get
      .description,
    /same tenant, active, non-deleted/i
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
    /active(?:,| and) non-deleted.*organizational write access/i
  )
  assert.match(
    paths['/employees/{employee}'].patch.description,
    /resulting.*same tenant.*Legal Entity.*active, non-deleted/i
  )
  assert.match(
    schemas.SiteUpdateRequest.description,
    /resulting.*existing customer-establishment link/i
  )
})

test('enforces lookup eligibility when assignment UUIDs are submitted directly', () => {
  assert.match(
    paths['/customer-establishments'].post.description,
    /active, non-deleted customer.*active, non-deleted establishment.*OU scopes do not grant.*organizational scopes.*403/is
  )
  assert.match(
    paths['/sites'].post.description,
    /active, non-deleted customer.*active, non-deleted Legal Entity and establishment.*OU scopes do not grant.*organizational scopes.*403/is
  )
  assert.match(
    schemas.SiteUpdateRequest.description,
    /active, non-deleted customer.*active, non-deleted Legal Entity and establishment.*existing customer-establishment link/is
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
    /customers\.create.*customers\.update.*sites\.create.*sites\.update.*employee\.write.*employee\.create.*employee\.update/i
  )
  assert.match(
    paths['/lookups/legal-entities/{legal_entity}/establishments'].get
      .description,
    /customers\.update.*sites\.create.*sites\.update.*employee\.write.*employee\.create.*employee\.update/i
  )
  assert.match(
    paths['/lookups/establishments/{establishment}/customers'].get.description,
    /sites\.create.*sites\.update.*active, non-deleted establishment.*authorized domain write access/i
  )
  assert.match(
    paths['/lookups/establishments/{establishment}/customer-candidates'].get
      .description,
    /customers\.update.*active, non-deleted establishment.*authorized domain write access/i
  )

  const linkPath = paths['/customer-establishments/{customer_establishment}']
  assert.match(linkPath.patch.description, /customers\.update/i)
  assert.match(linkPath.delete.description, /customers\.update/i)
  assert.match(
    paths['/employees/{employee}'].patch.description,
    /employee\.write.*employee\.update/i
  )
  assert.match(
    paths['/employees'].post.description,
    /employee\.write.*employee\.create/i
  )
})

test('names the link-management permission', () => {
  assert.match(
    paths['/customer-establishments'].post.description,
    /customers\.update/i
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

test('guard rejects incomplete or unsupported migrated list filters', () => {
  const candidate = structuredClone(contract)
  candidate.paths['/employees'].get.parameters = candidate.paths[
    '/employees'
  ].get.parameters.filter(({ name }) => name !== 'establishment_id')
  candidate.paths['/sites'].get.parameters.push({
    name: 'currently_valid',
    in: 'query',
    schema: { type: 'boolean' },
  })

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /GET \/employees collection filters/)
  assert.match(result.stderr, /GET \/sites collection filters/)
})

test('guard rejects dropped customer or site business identifier inputs', () => {
  const candidate = structuredClone(contract)
  delete candidate.components.schemas.CustomerCreateRequest.properties
    .customer_number
  delete candidate.components.schemas.SiteCreateRequest.properties.site_number
  delete candidate.components.schemas.CustomerCreateRequest.properties.is_active
  delete candidate.components.schemas.SiteCreateRequest.properties.is_active
  delete candidate.components.schemas.SiteUpdateRequest.properties.site_number
  candidate.components.schemas.SiteCreateRequest.properties.contact = {
    $ref: '#/components/schemas/Contact',
  }

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /CustomerCreateRequest\.customer_number/)
  assert.match(result.stderr, /SiteCreateRequest\.site_number/)
  assert.match(result.stderr, /CustomerCreateRequest\.is_active/)
  assert.match(result.stderr, /SiteCreateRequest\.is_active/)
  assert.match(result.stderr, /SiteCreateRequest\.contact/)
  assert.match(result.stderr, /SiteUpdateRequest\.site_number/)
})

test('guard rejects stale or privacy-widened employee creation audit examples', () => {
  const candidate = structuredClone(contract)
  const detailActivity =
    candidate.paths['/activity-logs/{activity}'].get.responses['200'].content[
      'application/json'
    ].examples.employeeCreation.value.data

  detailActivity.subject.name = 'John Doe'

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

test('guard rejects inherited OU lifecycle rules in tenant-local domains', () => {
  const candidate = structuredClone(contract)
  candidate.paths['/lookups/legal-entities'].get.description +=
    ' Legal Entities must be assignable.'
  candidate.paths[
    '/organizational-units/{organizational_unit}'
  ].patch.description +=
    ' Clearing roles is blocked while customers or employees reference the unit.'

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(
    result.stderr,
    /tenant-local domain.*organizational-unit assignability/i
  )
  assert.match(result.stderr, /organizational-unit lifecycle.*tenant-local/i)
})

test('guard rejects weakened lookup and permission invariants', () => {
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
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /GET linked customer lookups/)
  assert.match(result.stderr, /GET customer link candidates/)
  assert.match(result.stderr, /POST customer-establishment links/)
  assert.match(result.stderr, /PATCH customer-establishment links/)
  assert.match(result.stderr, /DELETE customer-establishment links/)
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
    candidate.paths[pathName].get.description = candidate.paths[
      pathName
    ].get.description.replace('`employee.update`', '`employee.read`')
  }
  candidate.paths[
    '/lookups/establishments/{establishment}/customers'
  ].get.description = candidate.paths[
    '/lookups/establishments/{establishment}/customers'
  ].get.description.replace(' or `sites.update`', '')
  delete candidate.paths['/customers/{customer}'].patch.responses['409']
  candidate.paths['/employees/{employee}'].patch.description = candidate.paths[
    '/employees/{employee}'
  ].patch.description.replace('`employee.update`', '`employee.read`')

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /GET Legal Entity lookups.*sites\.update/)
  assert.match(result.stderr, /GET establishment lookups.*sites\.update/)
  assert.match(result.stderr, /GET Legal Entity lookups.*employee\.update/)
  assert.match(result.stderr, /GET establishment lookups.*employee\.update/)
  assert.match(result.stderr, /GET linked customer lookups.*sites\.update/)
  assert.match(result.stderr, /PATCH employee assignments.*employee\.update/)
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

test('guard rejects false OU-domain lifecycle coupling', () => {
  const contradictoryChangelog = `${changelogSource}\nReferenced Legal Entities may not be role-downgraded or deleted; this conflict protects domain records.\n`

  const result = runGuard(contract, contradictoryChangelog)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(
    result.stderr,
    /CHANGELOG must not couple.*organizational-unit roles/i
  )
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

test('guard rejects OU-entitled customer and site record reads', () => {
  const candidate = structuredClone(contract)
  candidate.paths['/customers'].get.description =
    'Organizational scopes grant access to customer records.'
  candidate.paths['/customers/{customer}'].get.description =
    'Organizational scopes grant access to this customer.'
  candidate.paths['/sites'].get.description =
    'Organizational scopes grant access to site records.'
  candidate.paths['/sites/{site}'].get.description =
    'Organizational scopes grant access to this site.'

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /GET customer collections/)
  assert.match(result.stderr, /GET customer records/)
  assert.match(result.stderr, /GET site collections/)
  assert.match(result.stderr, /GET site records/)
})

test('guard rejects OU-entitled customer or site domain mutations', () => {
  const candidate = structuredClone(contract)
  const domainMutations = [
    candidate.paths['/customers'].post,
    candidate.paths['/customers/{customer}'].patch,
    candidate.paths['/customers/{customer}'].delete,
    candidate.paths['/customer-establishments'].post,
    candidate.paths['/customer-establishments/{customer_establishment}'].patch,
    candidate.paths['/customer-establishments/{customer_establishment}'].delete,
    candidate.paths['/sites'].post,
    candidate.paths['/sites/{site}'].patch,
    candidate.paths['/sites/{site}'].delete,
  ]
  domainMutations[0].description +=
    ' Organizational write access also grants this write.'
  domainMutations[1].description = domainMutations[1].description.replace(
    'unscoped callers require `customers.update`',
    'unscoped callers require `customers.read`'
  )
  for (const operation of domainMutations.slice(2)) {
    operation.description = operation.description.replace(
      /OU scopes do not grant access to customer or site domain writes/i,
      'OU scopes grant access to this domain write'
    )
  }
  candidate.paths['/customers/{customer}/archive'] = {
    post: {
      operationId: 'archiveCustomer',
      tags: ['Customers'],
      description:
        'Requires customers.update. Callers with organizational scopes receive 403.',
      responses: {
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  }

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  for (const label of [
    'POST customers',
    'PATCH customers',
    'DELETE customers',
    'POST customer-establishment links',
    'PATCH customer-establishment links',
    'DELETE customer-establishment links',
    'POST sites',
    'PATCH sites',
    'DELETE sites',
  ]) {
    assert.match(result.stderr, new RegExp(label))
  }
  assert.match(
    result.stderr,
    /POST \/customers\/\{customer\}\/archive.*no-OU domain mutation model/
  )
})

test('guard rejects stale OU-based employee subresource access', () => {
  const candidate = structuredClone(contract)
  candidate.paths['/employees/{employee}/qualifications'].post.description =
    'Users with organizational scopes see employees in their allowed units.'
  candidate.paths['/employees/{employee}/documents'].get.description =
    'Scoped managers see employee documents.'

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /employee qualification authorization/)
  assert.match(result.stderr, /employee document authorization/)
})

test('guard rejects missing or invented employee self-service exceptions', () => {
  const candidate = structuredClone(contract)
  candidate.paths['/employees/{employee}/documents'].get.description =
    candidate.paths['/employees/{employee}/documents'].get.description.replace(
      /\n\n\*\*Self-service:\*\*.*?(?=\n\n)/s,
      ''
    )
  candidate.paths['/employees/{employee}/qualifications'].post.description +=
    '\n\n**Self-service:** the employee may attach their own qualifications.'

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /employee qualification authorization/)
  assert.match(result.stderr, /employee document authorization/)
})

test('guard rejects unmodeled employee subresource operations', () => {
  const candidate = structuredClone(contract)
  candidate.paths['/employees/{employee}/qualifications'].put = structuredClone(
    candidate.paths['/employees/{employee}/qualifications'].post
  )
  candidate.paths['/employee-qualifications'] = {
    post: structuredClone(
      candidate.paths['/employees/{employee}/qualifications'].post
    ),
  }

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.equal(
    result.stderr.match(/unmodeled employee qualification operation/g)?.length,
    2
  )
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

test('guard rejects a closed customer response without its visible site count', () => {
  const candidate = structuredClone(contract)
  delete candidate.components.schemas.Customer.properties.sites_count

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /Customer\.sites_count/)
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
