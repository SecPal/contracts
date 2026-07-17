#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'

const contractPath = resolve(process.argv[2] ?? 'docs/openapi.yaml')
const changelogPath = resolve(process.argv[3] ?? 'CHANGELOG.md')
const contract = yaml.load(readFileSync(contractPath, 'utf8'))
const changelog = readFileSync(changelogPath, 'utf8')
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

function collectMatchingObjects(value, predicate, matches = []) {
  if (value === null || typeof value !== 'object') {
    return matches
  }
  if (predicate(value)) {
    matches.push(value)
  }
  for (const child of Object.values(value)) {
    collectMatchingObjects(child, predicate, matches)
  }
  return matches
}

function requireContractRules(rules) {
  for (const {
    label,
    text: value,
    patterns = [],
    forbiddenPatterns = [],
    response,
  } of rules) {
    if (patterns.some((pattern) => !pattern.test(value ?? ''))) {
      errors.push(`${label} must document its complete domain invariant.`)
    }
    if (forbiddenPatterns.some((pattern) => pattern.test(value ?? ''))) {
      errors.push(`${label} must not document a contradictory invariant.`)
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

function requireNoOuScopeDomainMutations(rules) {
  const coveredOperations = new Set()
  const mutationMethods = new Set(['post', 'put', 'patch', 'delete'])
  const domainTags = new Set(['Customers', 'Sites'])
  const noOuBoundary =
    /OU scopes do not grant access to customer or site domain writes.*callers with any organizational scopes.*403/is
  const contradictoryOuAccess = [
    /organizational write access/i,
    /OU scopes? (?:also )?grant access to (?:this|customer|site|the) domain write/i,
  ]

  for (const { label, operation, permission } of rules) {
    if (operation) {
      coveredOperations.add(operation)
    }
    const description = operation?.description ?? ''
    const unscopedPermission = new RegExp(
      'unscoped callers require `' + permission.replaceAll('.', '\\.') + '`',
      'i'
    )
    if (
      !noOuBoundary.test(description) ||
      !unscopedPermission.test(description) ||
      contradictoryOuAccess.some((pattern) => pattern.test(description)) ||
      operation?.responses?.['403']?.$ref !== '#/components/responses/Forbidden'
    ) {
      errors.push(
        `${label} must keep its permission, complete no-OU domain-write boundary, and 403 response aligned.`
      )
    }
  }

  for (const [pathName, pathItem] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (
        mutationMethods.has(method) &&
        operation?.tags?.some((tag) => domainTags.has(tag)) &&
        !coveredOperations.has(operation)
      ) {
        errors.push(
          `${method.toUpperCase()} ${pathName} must be covered by the customer/site no-OU domain mutation model.`
        )
      }
    }
  }
}

function requireEmployeeSubresourceAuthorization({
  familyLabel,
  pathPrefixes,
  rules,
  schemaRules = [],
}) {
  const coveredOperations = new Set()
  const noOuBoundary = /OU scopes do not grant access to domain employees/i
  const selfServiceMarker = /\*\*Self-service:\*\*/i
  const selfServiceBoundary = /non-self callers.*organizational scopes.*403/is
  const nonSelfServiceBoundary = /callers with any organizational scopes.*403/is
  const stalePatterns = [
    /allowed units/i,
    /scoped managers/i,
    /scope rules/i,
    /scope checks/i,
    /organizational checks/i,
    /organizational scope (?:is enforced|via)/i,
  ]

  for (const rule of rules) {
    const description = rule.operation?.description ?? ''
    if (rule.operation) {
      coveredOperations.add(rule.operation)
    }
    if (
      !noOuBoundary.test(description) ||
      !description.includes(rule.permission) ||
      selfServiceMarker.test(description) !== rule.selfService ||
      !(rule.selfService
        ? selfServiceBoundary.test(description)
        : nonSelfServiceBoundary.test(description)) ||
      stalePatterns.some((pattern) => pattern.test(description)) ||
      rule.operation?.responses?.['403']?.$ref !== rule.forbiddenRef
    ) {
      errors.push(
        `${familyLabel} authorization must keep ${rule.label} permission, no-OU boundary, and 403 response aligned.`
      )
    }
  }

  for (const rule of schemaRules) {
    const description = schemas[rule.schemaName]?.description ?? ''
    if (
      !noOuBoundary.test(description) ||
      !description.includes(rule.permission) ||
      !nonSelfServiceBoundary.test(description) ||
      selfServiceMarker.test(description) ||
      stalePatterns.some((pattern) => pattern.test(description))
    ) {
      errors.push(
        `${familyLabel} authorization must keep ${rule.schemaName} aligned with its operation.`
      )
    }
  }

  for (const [pathName, pathItem] of Object.entries(paths)) {
    if (
      !pathPrefixes.some(
        (prefix) => pathName === prefix || pathName.startsWith(`${prefix}/`)
      )
    ) {
      continue
    }
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = pathItem?.[method]
      if (operation && !coveredOperations.has(operation)) {
        errors.push(
          `unmodeled ${familyLabel} operation: ${method.toUpperCase()} ${pathName}.`
        )
      }
    }
  }
}

function requireCollectionFilterRules(rules) {
  for (const rule of rules) {
    const parameters = rule.operation?.parameters ?? []
    const parameterNames = parameters.map(({ name }) => name)
    const searchDescription =
      parameters.find(({ name }) => name === 'search')?.description ?? ''
    const invalidUuidFilter = rule.uuidFields.some((field) => {
      const parameter = parameters.find(({ name }) => name === field)
      return !uuidProperty(parameter?.schema)
    })

    if (
      JSON.stringify(parameterNames) !== JSON.stringify(rule.parameters) ||
      invalidUuidFilter ||
      !rule.searchPattern.test(searchDescription)
    ) {
      errors.push(
        `GET ${rule.path} collection filters must match the validated API parameters and search fields.`
      )
    }
  }
}

function requireUniquenessRules(rules) {
  const coveredSchemas = new Set(
    rules.map(({ resourceSchema }) => resourceSchema)
  )

  for (const rule of rules) {
    const resource = schemas[rule.resourceSchema] ?? {}
    const request = schemas[rule.requestSchema] ?? {}
    const examples = request['x-uniqueness-examples'] ?? {}
    const description = rule.operation?.description ?? ''
    const sameFields = (left, right, fields) =>
      fields.every((field) => left?.[field] === right?.[field])
    const sharesReusableValue = (left, right) =>
      rule.reusableFields.some(
        (field) => left?.[field] != null && left[field] === right?.[field]
      )
    const changesReusableValue = (left, right) =>
      rule.reusableFields.some(
        (field) => left?.[field] != null && left[field] !== right?.[field]
      )

    const acceptedEvidence = (examples.accepted ?? []).some(
      ({ existing, value }) =>
        !sameFields(existing, value, rule.uniqueBy) &&
        sharesReusableValue(existing, value)
    )
    const rejectedEvidence = (examples.rejected ?? []).some(
      ({ existing, value, status }) =>
        sameFields(existing, value, rule.uniqueBy) &&
        changesReusableValue(existing, value) &&
        status === 409
    )
    const documentsUniqueKey =
      rule.uniqueBy.every((field) => description.includes(field)) &&
      /pair/i.test(description)
    const excludesReusableIdentifiers =
      /without treating local contact data as a duplicate identifier/i.test(
        description
      )

    if (
      JSON.stringify(resource['x-unique-by']) !==
        JSON.stringify(rule.uniqueBy) ||
      !acceptedEvidence ||
      !rejectedEvidence ||
      !documentsUniqueKey ||
      !excludesReusableIdentifiers ||
      rule.operation?.responses?.['409']?.$ref !==
        '#/components/responses/DuplicateConflict'
    ) {
      errors.push(
        `${rule.label} must keep its composite key, reusable fields, evidence, description, and conflict response aligned.`
      )
    }
  }

  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (schema?.['x-unique-by'] && !coveredSchemas.has(schemaName)) {
      errors.push(
        `${schemaName} declares composite uniqueness and must be represented in the uniqueness model.`
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

    const examples =
      schemas[workflow.requestSchema]?.['x-validation-examples'] ?? {}
    const accepted = examples.accepted?.[0]
    const rejected = examples.rejected?.[0]
    const isUpdate = workflow.label.startsWith('PATCH ')
    const hasValidEvidence = (example) => {
      const submittedFields = workflow.relationshipFields.filter((field) =>
        Object.hasOwn(example?.value ?? {}, field)
      )
      const resultingFields = workflow.relationshipFields.filter((field) =>
        Object.hasOwn(example?.resulting ?? {}, field)
      )
      const identifiers = [
        ...submittedFields.map((field) => example.value[field]),
        ...resultingFields.map((field) => example.resulting[field]),
      ]
      return (
        (isUpdate
          ? submittedFields.length > 0 &&
            resultingFields.length === workflow.relationshipFields.length
          : submittedFields.length === workflow.relationshipFields.length) &&
        identifiers.every(uuidValue)
      )
    }
    if (
      !hasValidEvidence(accepted) ||
      !hasValidEvidence(rejected) ||
      ![409, 422].includes(rejected?.status)
    ) {
      errors.push(
        `${workflow.label} must retain complete positive and negative workflow evidence.`
      )
    }

    const permissions = workflow.permissions ?? [workflow.permission]
    const missingPermissions = permissions.filter(
      (permission) =>
        !(workflow.operation?.description ?? '').includes(permission)
    )
    if (missingPermissions.length > 0) {
      errors.push(
        `${workflow.label} must require ${missingPermissions.join(', ')}.`
      )
    }

    for (const lookupName of workflow.lookups) {
      const permissions = requiredLookupPermissions.get(lookupName)
      if (!permissions) {
        errors.push(
          `${workflow.label} references unknown lookup ${lookupName}.`
        )
        continue
      }
      for (const permission of workflow.permissions ?? [workflow.permission]) {
        permissions.add(permission)
      }
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

function requireOptionalString(
  schemaName,
  propertyName,
  maxLength,
  nullable = false
) {
  const schema = schemas[schemaName] ?? {}
  const property = schema.properties?.[propertyName]
  if (
    JSON.stringify(property?.type) !==
      JSON.stringify(nullable ? ['string', 'null'] : 'string') ||
    property.maxLength !== maxLength ||
    schema.required?.includes(propertyName)
  ) {
    errors.push(
      `${schemaName}.${propertyName} must remain an optional string with maxLength ${maxLength}.`
    )
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
  'sites_count',
  'customer_establishments',
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
const customerSitesCount = schemas.Customer?.properties?.sites_count
if (
  customerSitesCount?.type !== 'integer' ||
  customerSitesCount.minimum !== 0 ||
  schemas.Customer?.required?.includes('sites_count')
) {
  errors.push(
    'Customer.sites_count must remain an optional non-negative visible-site count.'
  )
}

const customerEstablishments =
  schemas.Customer?.properties?.customer_establishments
if (
  customerEstablishments?.type !== 'array' ||
  customerEstablishments?.items?.$ref !==
    '#/components/schemas/CustomerEstablishment' ||
  !schemas.Customer?.required?.includes('customer_establishments') ||
  !/always present.*empty/i.test(customerEstablishments?.description ?? '')
) {
  errors.push(
    'Customer.customer_establishments must be a required, always-present CustomerEstablishment array.'
  )
}

if (
  !/visible to the current caller/i.test(
    customerEstablishments?.description ?? ''
  ) ||
  !/site-only access.*active site assignments/i.test(
    customerEstablishments?.description ?? ''
  )
) {
  errors.push(
    'Customer must preserve caller-visible customer_establishments filtering for customer and site assignments.'
  )
}

for (const [label, response] of [
  [
    'GET /customers',
    paths['/customers']?.get?.responses?.['200']?.content?.[
      'application/json'
    ],
  ],
  [
    'GET /customers/{customer}',
    paths['/customers/{customer}']?.get?.responses?.['200']?.content?.[
      'application/json'
    ],
  ],
]) {
  const data = response?.examples?.withCustomerEstablishment?.value?.data
  const customers = Array.isArray(data) ? data : [data]
  const hasValidAssignments =
    customers.length > 0 &&
    customers.every(
      (customer) =>
        Array.isArray(customer?.customer_establishments) &&
        customer.customer_establishments.length > 0 &&
        customer.customer_establishments.every(
          (assignment) =>
            uuidValue(assignment?.id) &&
            uuidValue(assignment?.customer_id) &&
            uuidValue(assignment?.establishment_id) &&
            !Object.hasOwn(assignment, 'organizational_unit_id') &&
            !Object.hasOwn(assignment, 'organizational_unit')
        )
    )

  if (!hasValidAssignments) {
    errors.push(
      `${label} must include an OU-free customer_establishments response example.`
    )
  }

  const emptyData =
    response?.examples?.withoutCustomerEstablishments?.value?.data
  const customersWithoutAssignments = Array.isArray(emptyData)
    ? emptyData
    : [emptyData]
  if (
    customersWithoutAssignments.length === 0 ||
    customersWithoutAssignments.some(
      (customer) =>
        !Array.isArray(customer?.customer_establishments) ||
        customer.customer_establishments.length !== 0
    )
  ) {
    errors.push(
      `${label} must include an empty customer_establishments response example.`
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

const employeeCreationAuditExamples = collectMatchingObjects(
  paths,
  (value) =>
    value.subject_type === 'App\\Models\\Employee' && value.event === 'created'
)
const forbiddenEmployeeAuditFields = [
  'organizational_unit_id',
  'name',
  'first_name',
  'last_name',
  'email',
  'phone',
]
if (
  employeeCreationAuditExamples.length < 2 ||
  employeeCreationAuditExamples.some((activity) => {
    const attributes = activity.properties?.attributes ?? {}
    return (
      activity.log_name !== 'employee_changes' ||
      activity.description !== 'created' ||
      !uuidValue(attributes.legal_entity_id) ||
      !uuidValue(attributes.establishment_id) ||
      activity.subject?.name != null ||
      forbiddenEmployeeAuditFields.some((field) =>
        Object.hasOwn(attributes, field)
      )
    )
  })
) {
  errors.push(
    'All employee creation audit examples must use employee_changes, include domain assignment UUIDs, and exclude OU and employee personal-name values.'
  )
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

for (const [schemaName, propertyName, nullable] of [
  ['CustomerCreateRequest', 'customer_number', true],
  ['SiteCreateRequest', 'site_number', true],
  ['SiteUpdateRequest', 'site_number', false],
]) {
  requireOptionalString(schemaName, propertyName, 50, nullable)
}
const siteCreateIsActive = schemas.SiteCreateRequest?.properties?.is_active
if (
  JSON.stringify(siteCreateIsActive?.type) !==
    JSON.stringify(['boolean', 'null']) ||
  siteCreateIsActive.default !== true ||
  schemas.SiteCreateRequest?.required?.includes('is_active')
) {
  errors.push(
    'SiteCreateRequest.is_active must remain an optional nullable boolean defaulting to true.'
  )
}
const customerCreateIsActive =
  schemas.CustomerCreateRequest?.properties?.is_active
if (
  JSON.stringify(customerCreateIsActive?.type) !==
    JSON.stringify(['boolean', 'null']) ||
  customerCreateIsActive.default !== true ||
  schemas.CustomerCreateRequest?.required?.includes('is_active')
) {
  errors.push(
    'CustomerCreateRequest.is_active must remain an optional nullable boolean defaulting to true.'
  )
}
if (
  JSON.stringify(schemas.SiteCreateRequest?.properties?.contact?.anyOf) !==
  JSON.stringify([{ $ref: '#/components/schemas/Contact' }, { type: 'null' }])
) {
  errors.push(
    'SiteCreateRequest.contact must accept either Contact or the API-supported null value.'
  )
}
for (const [label, description, pattern] of [
  [
    'CustomerCreateRequest.customer_number',
    paths['/customers']?.post?.description,
    /customer_number.*omitted or null.*generat(?:ed|es)/is,
  ],
  [
    'SiteCreateRequest.site_number',
    paths['/sites']?.post?.description,
    /site_number.*omitted or null.*generat(?:ed|es)/is,
  ],
]) {
  if (!pattern.test(description ?? '')) {
    errors.push(`${label} must document its optional generated default.`)
  }
}

requireCollectionFilterRules([
  {
    path: '/customers',
    operation: paths['/customers']?.get,
    parameters: ['page', 'per_page', 'search', 'is_active'],
    uuidFields: [],
    searchPattern: /name and customer_number/i,
  },
  {
    path: '/sites',
    operation: paths['/sites']?.get,
    parameters: [
      'page',
      'per_page',
      'search',
      'customer_id',
      'establishment_id',
      'type',
      'is_active',
    ],
    uuidFields: ['customer_id', 'establishment_id'],
    searchPattern: /name and site_number/i,
  },
  {
    path: '/employees',
    operation: paths['/employees']?.get,
    parameters: [
      'page',
      'per_page',
      'status',
      'search',
      'legal_entity_id',
      'establishment_id',
    ],
    uuidFields: ['legal_entity_id', 'establishment_id'],
    searchPattern: /email and employee_number/i,
  },
])

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
const customerSiteDomainMutations = [
  {
    label: 'POST customers',
    operation: paths['/customers']?.post,
    permission: 'customers.create',
  },
  {
    label: 'PATCH customers',
    operation: customerUpdate,
    permission: 'customers.update',
  },
  {
    label: 'DELETE customers',
    operation: customerDelete,
    permission: 'customers.delete',
  },
  {
    label: 'POST customer-establishment links',
    operation: paths['/customer-establishments']?.post,
    permission: 'customers.update',
  },
  {
    label: 'PATCH customer-establishment links',
    operation: customerEstablishmentPath.patch,
    permission: 'customers.update',
  },
  {
    label: 'DELETE customer-establishment links',
    operation: customerEstablishmentDelete,
    permission: 'customers.update',
  },
  {
    label: 'POST sites',
    operation: paths['/sites']?.post,
    permission: 'sites.create',
  },
  {
    label: 'PATCH sites',
    operation: paths['/sites/{site}']?.patch,
    permission: 'sites.update',
  },
  {
    label: 'DELETE sites',
    operation: paths['/sites/{site}']?.delete,
    permission: 'sites.delete',
  },
]
requireNoOuScopeDomainMutations(customerSiteDomainMutations)

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
      permissions: ['employee.write', 'employee.create'],
      lookups: ['legalEntities', 'establishments'],
    },
    {
      label: 'PATCH employee assignments',
      operation: paths['/employees/{employee}']?.patch,
      requestSchema: 'EmployeeUpdateRequest',
      relationshipFields: ['legal_entity_id', 'establishment_id'],
      permissions: ['employee.write', 'employee.update'],
      lookups: ['legalEntities', 'establishments'],
    },
  ],
  assignmentLookups
)

const tenantDomainAssignablePattern =
  /active, assignable|assignable (?:Legal Entit|establishment)|(?:Legal Entit|establishment)[^.]*assignable/i

requireContractRules([
  {
    label: 'POST customer assignments',
    text: paths['/customers']?.post?.description,
    patterns: [/active, non-deleted/i],
    forbiddenPatterns: [
      /organizational write access/i,
      tenantDomainAssignablePattern,
    ],
  },
  {
    label: 'POST employee assignments',
    text: paths['/employees']?.post?.description,
    patterns: [/active(?:,| and) non-deleted/i, /organizational write access/i],
    forbiddenPatterns: [tenantDomainAssignablePattern],
  },
  {
    label: 'PATCH employee assignments',
    text: paths['/employees/{employee}']?.patch?.description,
    patterns: [/resulting.*same tenant.*Legal Entity/i, /active, non-deleted/i],
    forbiddenPatterns: [tenantDomainAssignablePattern],
  },
  {
    label: 'POST customer-establishment links',
    text: paths['/customer-establishments']?.post?.description,
    patterns: [
      /customers\.update/i,
      /active, non-deleted customer/i,
      /active, non-deleted establishment/i,
    ],
    forbiddenPatterns: [
      /organizational write access/i,
      tenantDomainAssignablePattern,
    ],
  },
  {
    label: 'POST site assignments',
    text: paths['/sites']?.post?.description,
    patterns: [
      /active, non-deleted customer/i,
      /active, non-deleted/i,
      /existing customer-establishment link/i,
    ],
    forbiddenPatterns: [
      /organizational write access/i,
      tenantDomainAssignablePattern,
    ],
  },
  {
    label: 'PATCH site assignments',
    text: schemas.SiteUpdateRequest?.description,
    patterns: [
      /resulting/i,
      /active, non-deleted customer/i,
      /active, non-deleted/i,
      /existing customer-establishment link/i,
    ],
    forbiddenPatterns: [
      /organizational write access/i,
      tenantDomainAssignablePattern,
    ],
  },
  ...[
    ['GET customer collections', paths['/customers']?.get],
    [
      'GET customer-establishment collections',
      paths['/customer-establishments']?.get,
    ],
  ].map(([label, operation]) => ({
    label,
    text: operation?.description,
    patterns: [
      /customers\.read.*without organizational scopes/is,
      /active customer or site assignment/is,
      /OU scope alone.*empty authorized collection/is,
    ],
    response: {
      operation,
      status: '403',
      ref: '#/components/responses/Forbidden',
    },
  })),
  ...[
    ['GET customer records', paths['/customers/{customer}']?.get],
    ['GET customer-establishment links', customerEstablishmentPath.get],
  ].map(([label, operation]) => ({
    label,
    text: operation?.description,
    patterns: [
      /active customer or site assignment/is,
      /customers\.read.*without organizational scopes/is,
      /OU scopes alone do not grant record access/is,
    ],
    response: {
      operation,
      status: '403',
      ref: '#/components/responses/Forbidden',
    },
  })),
  {
    label: 'GET site collections',
    text: paths['/sites']?.get?.description,
    patterns: [
      /sites\.read/is,
      /active customer or site assignment/is,
      /OU scope alone.*empty authorized collection/is,
    ],
    response: {
      operation: paths['/sites']?.get,
      status: '403',
      ref: '#/components/responses/Forbidden',
    },
  },
  {
    label: 'GET site records',
    text: paths['/sites/{site}']?.get?.description,
    patterns: [
      /sites\.read/is,
      /active customer or site assignment/is,
      /OU scopes alone do not grant record access/is,
    ],
    response: {
      operation: paths['/sites/{site}']?.get,
      status: '403',
      ref: '#/components/responses/Forbidden',
    },
  },
  {
    label: 'GET Legal Entity lookups',
    text: assignmentLookups.legalEntities.operation?.description,
    patterns: [/same tenant, active, non-deleted/i],
    forbiddenPatterns: [tenantDomainAssignablePattern],
  },
  {
    label: 'GET establishment lookups',
    text: assignmentLookups.establishments.operation?.description,
    patterns: [/same tenant, active, non-deleted/i],
    forbiddenPatterns: [tenantDomainAssignablePattern],
  },
  {
    label: 'GET linked customer lookups',
    text: assignmentLookups.linkedCustomers.operation?.description,
    patterns: [
      /active, non-deleted establishment/i,
      /authorized domain write access/i,
      /active, non-deleted customers/i,
      /existing customer-establishment link/i,
    ],
    forbiddenPatterns: [tenantDomainAssignablePattern],
  },
  {
    label: 'GET customer link candidates',
    text: assignmentLookups.customerLinkCandidates.operation?.description,
    patterns: [
      /active, non-deleted establishment/i,
      /same tenant and Legal Entity/i,
      /active, non-deleted customers/i,
      /not yet linked/i,
      /authorized domain write access/i,
    ],
    forbiddenPatterns: [tenantDomainAssignablePattern],
  },
])

requireEmployeeSubresourceAuthorization({
  familyLabel: 'employee qualification',
  pathPrefixes: [
    '/employees/{employee}/qualifications',
    '/employee-qualifications',
  ],
  rules: [
    {
      label: 'list',
      operation: paths['/employees/{employee}/qualifications']?.get,
      permission: 'employee_qualification.read',
      forbiddenRef: '#/components/responses/SimpleForbidden',
      selfService: true,
    },
    {
      label: 'attach',
      operation: paths['/employees/{employee}/qualifications']?.post,
      permission: 'employee_qualification.write',
      forbiddenRef: '#/components/responses/SimpleForbidden',
      selfService: false,
    },
    {
      label: 'show',
      operation: paths['/employee-qualifications/{employeeQualification}']?.get,
      permission: 'employee_qualification.read',
      forbiddenRef: '#/components/responses/SimpleForbidden',
      selfService: true,
    },
    {
      label: 'update',
      operation:
        paths['/employee-qualifications/{employeeQualification}']?.patch,
      permission: 'employee_qualification.write',
      forbiddenRef: '#/components/responses/SimpleForbidden',
      selfService: false,
    },
    {
      label: 'delete',
      operation:
        paths['/employee-qualifications/{employeeQualification}']?.delete,
      permission: 'employee_qualification.write',
      forbiddenRef: '#/components/responses/SimpleForbidden',
      selfService: false,
    },
  ],
  schemaRules: [
    {
      schemaName: 'AttachQualificationRequest',
      permission: 'employee_qualification.write',
    },
    {
      schemaName: 'UpdateEmployeeQualificationRequest',
      permission: 'employee_qualification.write',
    },
  ],
})

requireEmployeeSubresourceAuthorization({
  familyLabel: 'employee document',
  pathPrefixes: ['/employees/{employee}/documents'],
  rules: [
    {
      label: 'list',
      operation: paths['/employees/{employee}/documents']?.get,
      permission: 'employee_document.read',
      forbiddenRef: '#/components/responses/Forbidden',
      selfService: true,
    },
    {
      label: 'upload',
      operation: paths['/employees/{employee}/documents']?.post,
      permission: 'employee_document.write',
      forbiddenRef: '#/components/responses/Forbidden',
      selfService: false,
    },
    {
      label: 'show',
      operation: paths['/employees/{employee}/documents/{document}']?.get,
      permission: 'employee_document.read',
      forbiddenRef: '#/components/responses/Forbidden',
      selfService: true,
    },
    {
      label: 'delete',
      operation: paths['/employees/{employee}/documents/{document}']?.delete,
      permission: 'employee_document.write',
      forbiddenRef: '#/components/responses/Forbidden',
      selfService: false,
    },
    {
      label: 'download',
      operation:
        paths['/employees/{employee}/documents/{document}/download']?.get,
      permission: 'employee_document.read',
      forbiddenRef: '#/components/responses/Forbidden',
      selfService: true,
    },
  ],
})

requireContractRules([
  {
    label: 'PATCH customer Legal Entity reassignment',
    text: customerUpdate?.description,
    patterns: [
      /legal_entity_id.*same-tenant, active, non-deleted Legal Entity/is,
      /no customer-establishment links or sites/i,
    ],
    forbiddenPatterns: [
      /organizational write access/i,
      tenantDomainAssignablePattern,
    ],
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
])

const tenantLocalDomainDescriptions = [
  schemas.CustomerCreateRequest?.properties?.legal_entity_id?.description,
  schemas.CustomerUpdateRequest?.properties?.legal_entity_id?.description,
  schemas.EmployeeUpdateRequest?.description,
  schemas.SiteUpdateRequest?.description,
  paths['/customers']?.post?.description,
  customerUpdate?.description,
  paths['/customer-establishments']?.post?.description,
  paths['/sites']?.post?.description,
  paths['/employees']?.post?.description,
  paths['/employees/{employee}']?.patch?.description,
  ...Object.values(assignmentLookups).map(
    ({ operation }) => operation?.description
  ),
]
if (
  tenantLocalDomainDescriptions.some((description) =>
    tenantDomainAssignablePattern.test(description ?? '')
  )
) {
  errors.push(
    'The tenant-local domain must not inherit organizational-unit assignability.'
  )
}
const organizationalUnitPath =
  paths['/organizational-units/{organizational_unit}'] ?? {}
if (
  /customers|customer-establishment|sites|employees/i.test(
    `${organizationalUnitPath.patch?.description ?? ''}\n${organizationalUnitPath.delete?.description ?? ''}`
  ) ||
  responses.OrganizationalUnitDeletionConflict != null
) {
  errors.push(
    'Organizational-unit lifecycle must remain independent from tenant-local domain records.'
  )
}
if (/role-downgraded or deleted.*conflict/is.test(changelog)) {
  errors.push(
    'CHANGELOG must not couple tenant-local domain lifecycle to organizational-unit roles.'
  )
}
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
  JSON.stringify(expectedCustomerEstablishmentRequired)
) {
  errors.push('CustomerEstablishment must retain its required response fields.')
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

requireUniquenessRules([
  {
    label: 'CustomerEstablishment uniqueness',
    resourceSchema: 'CustomerEstablishment',
    requestSchema: 'CustomerEstablishmentCreateRequest',
    operation: paths['/customer-establishments']?.post,
    uniqueBy: ['customer_id', 'establishment_id'],
    reusableFields: ['contact_name', 'phone', 'email', 'comments'],
  },
])

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
