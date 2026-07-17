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
const uuidValue = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )

function requireContractRules(rules) {
  for (const { label, text: value, patterns = [], response } of rules) {
    if (patterns.some((pattern) => !pattern.test(value ?? ''))) {
      errors.push(`${label} must document its complete domain invariant.`)
    }
    if (
      response &&
      response.operation?.responses?.[response.status]?.$ref !== response.ref
    ) {
      errors.push(
        `${label} must use ${response.ref} for HTTP ${response.status}.`
      )
    }
  }
}

function requireAssignmentWorkflows(workflows, lookups) {
  const relationshipFields = new Set([
    'customer_id',
    'legal_entity_id',
    'establishment_id',
  ])
  const coveredOperations = new Set(workflows.map(({ operation }) => operation))
  const requiredLookupPermissions = new Map(
    Object.keys(lookups).map((lookupName) => [lookupName, new Set()])
  )

  for (const workflow of workflows) {
    const expectedRequestRef = `#/components/schemas/${workflow.requestSchema}`
    const actualRequestRef =
      workflow.operation?.requestBody?.content?.['application/json']?.schema
        ?.$ref
    if (actualRequestRef !== expectedRequestRef) {
      errors.push(
        `${workflow.label} must use ${expectedRequestRef} as its request contract.`
      )
    }

    const properties = schemas[workflow.requestSchema]?.properties ?? {}
    const missingFields = workflow.relationshipFields.filter(
      (field) => !Object.hasOwn(properties, field)
    )
    if (missingFields.length > 0) {
      errors.push(
        `${workflow.label} must expose relationship fields: ${missingFields.join(', ')}.`
      )
    }

    if (
      !(workflow.operation?.description ?? '').includes(workflow.permission)
    ) {
      errors.push(`${workflow.label} must require ${workflow.permission}.`)
    }

    for (const lookupName of workflow.lookups) {
      const permissions = requiredLookupPermissions.get(lookupName)
      if (!permissions) {
        errors.push(
          `${workflow.label} references unknown lookup ${lookupName}.`
        )
        continue
      }
      permissions.add(workflow.permission)
    }
  }

  for (const [pathName, pathItem] of Object.entries(paths)) {
    for (const method of ['post', 'put', 'patch']) {
      const operation = pathItem?.[method]
      const requestContract =
        operation?.requestBody?.content?.['application/json']?.schema
      const requestSchema = requestContract?.$ref
        ? schemas[requestContract.$ref.split('/').at(-1)]
        : requestContract
      const writesRelationship = Object.keys(
        requestSchema?.properties ?? {}
      ).some((field) => relationshipFields.has(field))
      if (writesRelationship && !coveredOperations.has(operation)) {
        errors.push(
          `${method.toUpperCase()} ${pathName} writes domain relationships and must be represented in the assignment workflow model.`
        )
      }
    }
  }

  for (const [lookupName, lookup] of Object.entries(lookups)) {
    const description = lookup.operation?.description ?? ''
    for (const permission of requiredLookupPermissions.get(lookupName) ?? []) {
      if (!description.includes(permission)) {
        errors.push(`${lookup.label} must authorize ${permission}.`)
      }
    }
  }
}

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
  for (const propertyName of [
    'organizational_unit_id',
    'organizational_unit',
  ]) {
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
if (schemas.Customer?.additionalProperties !== false) {
  errors.push('Customer must remain a closed master-data response schema.')
}
for (const propertyName of Object.keys(schemas.Customer?.properties ?? {})) {
  if (!customerAllowedProperties.has(propertyName)) {
    errors.push(
      `Customer must not expose non-master-data field ${propertyName}.`
    )
  }
}

const customerGet = paths['/customers/{customer}']?.get
if (
  (customerGet?.parameters ?? []).some(
    (parameter) => parameter?.name === 'include'
  ) ||
  /optional relationships/i.test(customerGet?.description ?? '')
) {
  errors.push(
    'GET /customers/{customer} must not advertise relationships that the closed Customer response cannot represent.'
  )
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
  if (
    parameters.some((parameter) => parameter?.name === 'organizational_unit_id')
  ) {
    errors.push(
      `GET ${pathName} must not expose an organizational_unit_id filter.`
    )
  }
}

const customerEstablishment = schemas.CustomerEstablishment ?? {}
const customerEstablishmentEmailExample =
  customerEstablishment.properties?.email?.example
if (
  typeof customerEstablishmentEmailExample !== 'string' ||
  !customerEstablishmentEmailExample.endsWith('@secpal.dev')
) {
  errors.push(
    'CustomerEstablishment.email must use the approved secpal.dev example domain.'
  )
}

const customerEstablishmentCollection =
  schemas.CustomerEstablishmentCollectionResponse ?? {}
if (
  customerEstablishmentCollection.additionalProperties !== false ||
  JSON.stringify(customerEstablishmentCollection.required) !==
    JSON.stringify(['data', 'links', 'meta']) ||
  customerEstablishmentCollection.properties?.links?.$ref !==
    '#/components/schemas/PaginationLinks' ||
  customerEstablishmentCollection.properties?.meta?.$ref !==
    '#/components/schemas/PaginationMeta'
) {
  errors.push(
    'CustomerEstablishmentCollectionResponse must include pagination links and metadata.'
  )
}

const customerEstablishmentPath =
  paths['/customer-establishments/{customer_establishment}'] ?? {}
const customerEstablishmentParameter = customerEstablishmentPath.parameters
if (
  !Array.isArray(customerEstablishmentParameter) ||
  customerEstablishmentParameter.length !== 1 ||
  customerEstablishmentParameter[0]?.name !== 'customer_establishment' ||
  customerEstablishmentParameter[0]?.in !== 'path' ||
  customerEstablishmentParameter[0]?.required !== true ||
  !uuidProperty(customerEstablishmentParameter[0]?.schema) ||
  ['get', 'patch', 'delete'].some((method) =>
    (customerEstablishmentPath[method]?.parameters ?? []).some(
      (parameter) => parameter?.name === 'customer_establishment'
    )
  )
) {
  errors.push(
    'Customer establishment operations must share one path-level UUID parameter.'
  )
}

function hasTenantConsistentDomainExamples(schemaName) {
  const schema = schemas[schemaName] ?? {}
  const examples = schema['x-validation-examples'] ?? {}
  const accepted = examples.accepted?.[0]
  const rejected = examples.rejected?.[0]
  const requiredPayloadIsPresent = (example) =>
    schema.required?.every((property) =>
      Object.hasOwn(example?.value ?? {}, property)
    )
  const tenantIds = (example) =>
    Object.entries(example ?? {})
      .filter(([key, value]) => key.endsWith('_tenant_id') && value)
      .map(([, value]) => value)
  const relatedLegalEntityIds = (example) =>
    Object.entries(example ?? {})
      .filter(([key, value]) => key.endsWith('_legal_entity_id') && value)
      .map(([, value]) => value)
  const assignmentIds = (example) =>
    ['customer_id', 'legal_entity_id', 'establishment_id']
      .filter((property) => Object.hasOwn(example?.value ?? {}, property))
      .map((property) => example.value[property])
  const identifiersAreUuids = (example) =>
    [
      ...tenantIds(example),
      ...relatedLegalEntityIds(example),
      ...assignmentIds(example),
    ].every(uuidValue)
  const isConsistent = (example) =>
    new Set(tenantIds(example)).size === 1 &&
    relatedLegalEntityIds(example).every(
      (value) => value === example?.value?.legal_entity_id
    )
  const isInconsistent = (example) =>
    new Set(tenantIds(example)).size > 1 ||
    relatedLegalEntityIds(example).some(
      (value) => value !== example?.value?.legal_entity_id
    )

  return (
    requiredPayloadIsPresent(accepted) &&
    requiredPayloadIsPresent(rejected) &&
    uuidProperty(schema.properties?.legal_entity_id) &&
    uuidProperty(schema.properties?.establishment_id) &&
    identifiersAreUuids(accepted) &&
    identifiersAreUuids(rejected) &&
    isConsistent(accepted) &&
    rejected?.status === 422 &&
    isInconsistent(rejected)
  )
}

for (const schemaName of ['SiteCreateRequest', 'EmployeeCreateRequest']) {
  if (!hasTenantConsistentDomainExamples(schemaName)) {
    errors.push(
      `${schemaName} must retain accepted and rejected tenant-consistent domain-assignment examples.`
    )
  }
}

for (const schemaName of ['EmployeeCreateRequest', 'EmployeeUpdateRequest']) {
  if (schemas[schemaName]?.additionalProperties !== false) {
    errors.push(`${schemaName} must remain closed to obsolete OU fields.`)
  }
}

function hasTenantConsistentCustomerEstablishmentExamples() {
  const schema = schemas.CustomerEstablishmentCreateRequest ?? {}
  const examples = schema['x-validation-examples'] ?? {}
  const accepted = examples.accepted?.[0]
  const rejected = examples.rejected?.[0]
  const payloadIsPresent = (example) =>
    ['customer_id', 'establishment_id'].every((property) =>
      Object.hasOwn(example?.value ?? {}, property)
    )
  const tenantIds = (example) => [
    example?.customer_tenant_id,
    example?.establishment_tenant_id,
  ]
  const legalEntityIds = (example) => [
    example?.customer_legal_entity_id,
    example?.establishment_legal_entity_id,
  ]
  const isValid = (example) =>
    payloadIsPresent(example) &&
    [
      ...tenantIds(example),
      ...legalEntityIds(example),
      example?.value?.customer_id,
      example?.value?.establishment_id,
    ].every(uuidValue)

  return (
    isValid(accepted) &&
    isValid(rejected) &&
    tenantIds(accepted)[0] === tenantIds(accepted)[1] &&
    legalEntityIds(accepted)[0] === legalEntityIds(accepted)[1] &&
    rejected?.status === 422 &&
    (tenantIds(rejected)[0] !== tenantIds(rejected)[1] ||
      legalEntityIds(rejected)[0] !== legalEntityIds(rejected)[1])
  )
}

if (!hasTenantConsistentCustomerEstablishmentExamples()) {
  errors.push(
    'CustomerEstablishmentCreateRequest must retain accepted and rejected tenant-consistent link examples.'
  )
}

const customerUpdate = paths['/customers/{customer}']?.patch
const customerDelete = paths['/customers/{customer}']?.delete
const customerEstablishmentDelete = customerEstablishmentPath.delete
const organizationalUnitUpdate =
  paths['/organizational-units/{organizational_unit}']?.patch
const organizationalUnitDelete =
  paths['/organizational-units/{organizational_unit}']?.delete

const assignmentLookups = {
  legalEntities: {
    label: 'GET Legal Entity lookups',
    operation: paths['/lookups/legal-entities']?.get,
  },
  establishments: {
    label: 'GET establishment lookups',
    operation:
      paths['/lookups/legal-entities/{legal_entity}/establishments']?.get,
  },
  linkedCustomers: {
    label: 'GET linked customer lookups',
    operation: paths['/lookups/establishments/{establishment}/customers']?.get,
  },
  customerLinkCandidates: {
    label: 'GET customer link candidates',
    operation:
      paths['/lookups/establishments/{establishment}/customer-candidates']?.get,
  },
}

requireAssignmentWorkflows(
  [
    {
      label: 'POST customer assignments',
      operation: paths['/customers']?.post,
      requestSchema: 'CustomerCreateRequest',
      relationshipFields: ['legal_entity_id'],
      permission: 'customers.create',
      lookups: ['legalEntities'],
    },
    {
      label: 'PATCH customer assignments',
      operation: customerUpdate,
      requestSchema: 'CustomerUpdateRequest',
      relationshipFields: ['legal_entity_id'],
      permission: 'customers.update',
      lookups: ['legalEntities'],
    },
    {
      label: 'POST customer-establishment assignments',
      operation: paths['/customer-establishments']?.post,
      requestSchema: 'CustomerEstablishmentCreateRequest',
      relationshipFields: ['customer_id', 'establishment_id'],
      permission: 'customers.update',
      lookups: ['legalEntities', 'establishments', 'customerLinkCandidates'],
    },
    {
      label: 'POST site assignments',
      operation: paths['/sites']?.post,
      requestSchema: 'SiteCreateRequest',
      relationshipFields: [
        'customer_id',
        'legal_entity_id',
        'establishment_id',
      ],
      permission: 'sites.create',
      lookups: ['legalEntities', 'establishments', 'linkedCustomers'],
    },
    {
      label: 'PATCH site assignments',
      operation: paths['/sites/{site}']?.patch,
      requestSchema: 'SiteUpdateRequest',
      relationshipFields: [
        'customer_id',
        'legal_entity_id',
        'establishment_id',
      ],
      permission: 'sites.update',
      lookups: ['legalEntities', 'establishments', 'linkedCustomers'],
    },
    {
      label: 'POST employee assignments',
      operation: paths['/employees']?.post,
      requestSchema: 'EmployeeCreateRequest',
      relationshipFields: ['legal_entity_id', 'establishment_id'],
      permission: 'employees.create',
      lookups: ['legalEntities', 'establishments'],
    },
    {
      label: 'PATCH employee assignments',
      operation: paths['/employees/{employee}']?.patch,
      requestSchema: 'EmployeeUpdateRequest',
      relationshipFields: ['legal_entity_id', 'establishment_id'],
      permission: 'employees.update',
      lookups: ['legalEntities', 'establishments'],
    },
  ],
  assignmentLookups
)

requireContractRules([
  {
    label: 'POST employee assignments',
    text: paths['/employees']?.post?.description,
    patterns: [
      /active, assignable, non-deleted/i,
      /organizational write access/i,
    ],
  },
  {
    label: 'PATCH employee assignments',
    text: paths['/employees/{employee}']?.patch?.description,
    patterns: [
      /resulting.*same tenant.*Legal Entity/i,
      /active, assignable, non-deleted/i,
    ],
  },
  {
    label: 'POST customer-establishment links',
    text: paths['/customer-establishments']?.post?.description,
    patterns: [
      /customers\.update/i,
      /active, non-deleted customer/i,
      /active, assignable, non-deleted establishment/i,
      /organizational write access/i,
    ],
  },
  {
    label: 'POST site assignments',
    text: paths['/sites']?.post?.description,
    patterns: [
      /active, non-deleted customer/i,
      /active, assignable, non-deleted/i,
      /organizational write access/i,
      /existing customer-establishment link/i,
    ],
  },
  {
    label: 'PATCH site assignments',
    text: schemas.SiteUpdateRequest?.description,
    patterns: [
      /resulting/i,
      /active, non-deleted customer/i,
      /active, assignable, non-deleted/i,
      /organizational write access/i,
      /existing customer-establishment link/i,
    ],
  },
  {
    label: 'PATCH customer-establishment links',
    text: customerEstablishmentPath.patch?.description,
    patterns: [/customers\.update/i],
  },
  {
    label: 'GET Legal Entity lookups',
    text: assignmentLookups.legalEntities.operation?.description,
    patterns: [/same tenant, active, assignable, non-deleted/i],
  },
  {
    label: 'GET establishment lookups',
    text: assignmentLookups.establishments.operation?.description,
    patterns: [/same tenant, active, assignable, non-deleted/i],
  },
  {
    label: 'GET linked customer lookups',
    text: assignmentLookups.linkedCustomers.operation?.description,
    patterns: [
      /active, assignable, non-deleted establishment/i,
      /organizational write access/i,
      /active, non-deleted customers/i,
      /existing customer-establishment link/i,
    ],
  },
  {
    label: 'GET customer link candidates',
    text: assignmentLookups.customerLinkCandidates.operation?.description,
    patterns: [
      /active, assignable, non-deleted establishment/i,
      /same tenant and Legal Entity/i,
      /active, non-deleted customers/i,
      /not yet linked/i,
      /organizational write access/i,
    ],
  },
])

requireContractRules([
  {
    label: 'PATCH customer Legal Entity reassignment',
    text: customerUpdate?.description,
    patterns: [/no customer-establishment links or sites/i],
    response: {
      operation: customerUpdate,
      status: '409',
      ref: '#/components/responses/Conflict',
    },
  },
  {
    label: 'DELETE customer-establishment links',
    text: customerEstablishmentDelete?.description,
    patterns: [/customers\.update/i, /blocked.*sites/i],
    response: {
      operation: customerEstablishmentDelete,
      status: '409',
      ref: '#/components/responses/Conflict',
    },
  },
  {
    label: 'DELETE customers',
    text: customerDelete?.description,
    patterns: [/customer-establishment links or sites/i],
    response: {
      operation: customerDelete,
      status: '409',
      ref: '#/components/responses/Conflict',
    },
  },
  {
    label: 'PATCH organizational-unit roles',
    text: organizationalUnitUpdate?.description,
    patterns: [
      /is_legal_entity.*is_establishment/i,
      /referenced.*customers.*customer-establishment links.*sites.*employees/i,
    ],
    response: {
      operation: organizationalUnitUpdate,
      status: '409',
      ref: '#/components/responses/Conflict',
    },
  },
  {
    label: 'DELETE organizational units',
    text: organizationalUnitDelete?.description,
    patterns: [/customers, customer-establishment links, sites, or employees/i],
    response: {
      operation: organizationalUnitDelete,
      status: '409',
      ref: '#/components/responses/OrganizationalUnitDeletionConflict',
    },
  },
])
const siteIncludes = paths['/sites/{site}']?.get?.parameters?.find(
  (parameter) => parameter?.name === 'include'
)?.schema?.enum
if (siteIncludes?.some((value) => /organizational/i.test(value))) {
  errors.push(
    'GET /sites/{site} must not expose an organizational-unit include.'
  )
}

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
  [
    '/lookups/establishments/{establishment}/customer-candidates',
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
