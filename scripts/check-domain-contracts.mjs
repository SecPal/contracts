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
const componentParameters = contract?.components?.parameters ?? {}
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
const parameterRefPrefix = '#/components/parameters/'
const resolveParameter = (parameter) => {
  if (!parameter?.$ref?.startsWith(parameterRefPrefix)) return parameter
  return componentParameters[parameter.$ref.slice(parameterRefPrefix.length)]
}

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

  for (const {
    label,
    operation,
    permission,
    forbiddenRef = '#/components/responses/Forbidden',
  } of rules) {
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
      operation?.responses?.['403']?.$ref !== forbiddenRef
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
    const parameters = (rule.operation?.parameters ?? []).map(resolveParameter)
    const parameterNames = parameters.map((parameter) => parameter?.name)
    const searchDescription =
      parameters.find((parameter) => parameter?.name === 'search')
        ?.description ?? ''
    const invalidUuidFilter = rule.uuidFields.some((field) => {
      const parameter = parameters.find(
        (candidate) => candidate?.name === field
      )
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
    'contract_id',
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
    const rejectedStatuses = workflow.rejectedStatuses ?? [409, 422]
    if (
      !hasValidEvidence(accepted) ||
      !hasValidEvidence(rejected) ||
      !rejectedStatuses.includes(rejected?.status)
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
  'sites',
  'assignments',
  'customer_establishments',
  'created_at',
  'updated_at',
  'deleted_at',
])
const resourceSchemaInventories = {
  Customer: customerAllowedProperties,
  Site: new Set([
    'id',
    'customer_id',
    'legal_entity_id',
    'establishment_id',
    'site_number',
    'name',
    'type',
    'address',
    'full_address',
    'contact',
    'access_instructions',
    'notes',
    'metadata',
    'is_active',
    'is_expired',
    'valid_from',
    'valid_until',
    'customer',
    'assignments',
    'assigned_users_count',
    'cost_centers_count',
    'created_at',
    'updated_at',
    'deleted_at',
  ]),
}
for (const [schemaName, expectedProperties] of Object.entries(
  resourceSchemaInventories
)) {
  const actualProperties = new Set(
    Object.keys(schemas[schemaName]?.properties ?? {})
  )
  if (
    actualProperties.size !== expectedProperties.size ||
    [...expectedProperties].some(
      (propertyName) => !actualProperties.has(propertyName)
    )
  ) {
    errors.push(
      `${schemaName} must inventory every field emitted by its resource.`
    )
  }
}
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
const conditionalResourceFields = {
  Customer: {
    sites_count: 'NonNegativeRelationshipCount',
    sites: 'CustomerSitesRelationship',
    assignments: 'CustomerAssignmentsRelationship',
    customer_establishments: 'CustomerEstablishmentRelationship',
  },
  Site: {
    customer: 'SiteCustomerRelationship',
    assignments: 'SiteAssignmentsRelationship',
    assigned_users_count: 'NonNegativeRelationshipCount',
    cost_centers_count: 'NonNegativeRelationshipCount',
  },
}
for (const [schemaName, fields] of Object.entries(conditionalResourceFields)) {
  for (const [fieldName, componentName] of Object.entries(fields)) {
    const property = schemas[schemaName]?.properties?.[fieldName]
    if (
      property?.$ref !== `#/components/schemas/${componentName}` ||
      schemas[schemaName]?.required?.includes(fieldName)
    ) {
      errors.push(
        `${schemaName}.${fieldName} must be an optional reusable conditional-resource field.`
      )
    }
  }
}

const relationshipSchemas = [
  'CustomerSitesRelationship',
  'CustomerAssignmentsRelationship',
  'CustomerEstablishmentRelationship',
  'SiteCustomerRelationship',
  'SiteAssignmentsRelationship',
]
for (const schemaName of relationshipSchemas) {
  if (
    !/eager loaded.*omitted otherwise/i.test(
      schemas[schemaName]?.description ?? ''
    )
  ) {
    errors.push(
      `${schemaName} must document eager-loading presence and omission.`
    )
  }
}

for (const [schemaName, itemSchemaName] of [
  ['CustomerAssignmentsRelationship', 'EmbeddedCustomerAssignment'],
  ['SiteAssignmentsRelationship', 'EmbeddedSiteAssignment'],
]) {
  if (
    schemas[schemaName]?.items?.$ref !==
    `#/components/schemas/${itemSchemaName}`
  ) {
    errors.push(`${schemaName} must use ${itemSchemaName} items.`)
  }
}

const assignmentSchemaProperties = {
  EmbeddedCustomerAssignment: [
    'id',
    'customer_id',
    'user_id',
    'role',
    'valid_from',
    'valid_until',
    'notes',
    'is_active',
    'user',
    'created_at',
    'updated_at',
  ],
  EmbeddedSiteAssignment: [
    'id',
    'site_id',
    'user_id',
    'role',
    'valid_from',
    'valid_until',
    'notes',
    'is_active',
    'user',
    'created_at',
    'updated_at',
  ],
  CustomerAssignment: [
    'id',
    'role',
    'is_active',
    'valid_from',
    'valid_until',
    'notes',
    'user',
    'customer',
    'created_at',
    'updated_at',
  ],
  SiteAssignment: [
    'id',
    'role',
    'is_active',
    'valid_from',
    'valid_until',
    'notes',
    'user',
    'site',
    'created_at',
    'updated_at',
  ],
}
for (const [schemaName, expectedProperties] of Object.entries(
  assignmentSchemaProperties
)) {
  const schema = schemas[schemaName]
  if (
    schema?.type !== 'object' ||
    schema.additionalProperties !== false ||
    JSON.stringify(Object.keys(schema.properties ?? {})) !==
      JSON.stringify(expectedProperties) ||
    JSON.stringify(schema.required) !== JSON.stringify(expectedProperties) ||
    Object.hasOwn(schema.properties ?? {}, 'is_primary')
  ) {
    errors.push(`${schemaName} must match its runtime assignment resource.`)
  }
}
for (const schemaName of [
  'EmbeddedCustomerAssignment',
  'EmbeddedSiteAssignment',
]) {
  const userId = schemas[schemaName]?.properties?.user_id
  if (
    JSON.stringify(userId?.type) !== JSON.stringify(['string', 'null']) ||
    userId?.format !== 'uuid' ||
    !/user was deleted.*history is preserved/i.test(userId?.description ?? '')
  ) {
    errors.push(
      `${schemaName}.user_id must preserve nullable deleted-user history.`
    )
  }
}
if (
  schemas.AssignmentUser?.type !== 'object' ||
  schemas.AssignmentUser.additionalProperties !== false ||
  JSON.stringify(Object.keys(schemas.AssignmentUser.properties ?? {})) !==
    JSON.stringify(['id', 'name', 'email']) ||
  JSON.stringify(schemas.AssignmentUser.required) !==
    JSON.stringify(['id', 'name', 'email'])
) {
  errors.push('AssignmentUser must remain a closed minimal user response.')
}

const relationshipCount = schemas.NonNegativeRelationshipCount
if (
  relationshipCount?.type !== 'integer' ||
  relationshipCount.minimum !== 0 ||
  !/counted.*omitted otherwise/i.test(relationshipCount?.description ?? '')
) {
  errors.push(
    'NonNegativeRelationshipCount must be a non-negative count emitted only when counted.'
  )
}

const customerEstablishments = schemas.CustomerEstablishmentRelationship
if (
  customerEstablishments?.items?.$ref !==
    '#/components/schemas/CustomerEstablishment' ||
  !/visible to the current caller/i.test(
    customerEstablishments?.description ?? ''
  ) ||
  !/site-only access.*active site assignments/i.test(
    customerEstablishments?.description ?? ''
  )
) {
  errors.push(
    'CustomerEstablishmentRelationship must preserve caller-visible assignment filtering.'
  )
}

const customerList = paths['/customers']?.get
const customerCreate = paths['/customers']?.post
const customerDetail = paths['/customers/{customer}']?.get
const customerUpdateOperation = paths['/customers/{customer}']?.patch
const customerSites = paths['/customers/{customer}/sites']?.get
if (
  !/eager loads.*assignments.*customer_establishments.*does not eager load.*sites/is.test(
    customerList?.description ?? ''
  )
) {
  errors.push(
    'GET /customers relationship presence must match its eager-loaded assignments and customer establishments.'
  )
}
for (const [label, operation] of [
  ['POST /customers', customerCreate],
  ['PATCH /customers/{customer}', customerUpdateOperation],
]) {
  if (
    !/eager loads.*customer_establishments.*sites.*assignments.*count.*omitted/is.test(
      operation?.description ?? ''
    )
  ) {
    errors.push(
      `${label} relationship presence must document its customer-establishment-only expansion.`
    )
  }
}
if (
  !/eager loads.*assignments.*customer.*counts.*omitted/is.test(
    customerSites?.description ?? ''
  )
) {
  errors.push(
    'GET /customers/{customer}/sites relationship presence must match its eager-loaded assignments.'
  )
}

function hasValidCustomerEstablishments(customer) {
  return (
    Array.isArray(customer?.customer_establishments) &&
    customer.customer_establishments.every(
      (assignment) =>
        uuidValue(assignment?.id) &&
        uuidValue(assignment?.customer_id) &&
        uuidValue(assignment?.establishment_id) &&
        assignment.customer_id === customer.id &&
        !Object.hasOwn(assignment, 'organizational_unit_id') &&
        !Object.hasOwn(assignment, 'organizational_unit')
    )
  )
}

const listCustomerExamples = Object.values(
  customerList?.responses?.['200']?.content?.['application/json']?.examples ??
    {}
).flatMap((example) => example?.value?.data ?? [])
if (
  listCustomerExamples.length === 0 ||
  listCustomerExamples.some(
    (customer) =>
      !Number.isInteger(customer?.sites_count) ||
      customer.sites_count < 0 ||
      !Array.isArray(customer?.assignments) ||
      Object.hasOwn(customer, 'sites') ||
      !hasValidCustomerEstablishments(customer)
  )
) {
  errors.push(
    'GET /customers response examples must include valid counts and eager-loaded assignments/customer establishments while omitting sites.'
  )
}

const detailCustomerExamples = Object.values(
  customerDetail?.responses?.['200']?.content?.['application/json']?.examples ??
    {}
).map((example) => example?.value?.data)
if (
  detailCustomerExamples.length === 0 ||
  detailCustomerExamples.some(
    (customer) =>
      !Number.isInteger(customer?.sites_count) ||
      customer.sites_count < 0 ||
      !Array.isArray(customer?.sites) ||
      customer.sites.length !== customer.sites_count ||
      !Array.isArray(customer?.assignments) ||
      !hasValidCustomerEstablishments(customer)
  )
) {
  errors.push(
    'GET /customers/{customer} response examples must keep expanded relationships and sites_count coherent.'
  )
}

for (const fieldName of ['access_instructions', 'notes']) {
  const field = schemas.Site?.properties?.[fieldName]
  if (
    JSON.stringify(field?.type) !== JSON.stringify(['string', 'null']) ||
    schemas.Site?.required?.includes(fieldName) ||
    !/authorized to update.*omitted/i.test(field?.description ?? '')
  ) {
    errors.push(
      `Site.${fieldName} must remain nullable, update-authorized, and omitted for unauthorized callers.`
    )
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

const paginatedEmployeeUpdateActivity =
  paths['/activity-logs']?.get?.responses?.['200']?.content?.[
    'application/json'
  ]?.examples?.paginatedResponse?.value?.data?.[2]
const paginatedEmployeeUpdateSubject =
  paginatedEmployeeUpdateActivity?.subject ?? {}
if (
  paginatedEmployeeUpdateActivity?.subject_type !== 'App\\Models\\Employee' ||
  paginatedEmployeeUpdateActivity?.log_name !== 'employee_changes' ||
  paginatedEmployeeUpdateActivity?.description !== 'updated' ||
  paginatedEmployeeUpdateActivity?.event !== 'updated' ||
  paginatedEmployeeUpdateActivity?.properties !== null ||
  forbiddenEmployeeAuditFields.some((field) =>
    Object.hasOwn(paginatedEmployeeUpdateSubject, field)
  )
) {
  errors.push(
    'Paginated employee activity examples must document the supported employee_changes update event with metadata-free properties and exclude personal-name values.'
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
    label: 'PUT transactional customer edit',
    operation: paths['/customers/{customer}/transactional-edit']?.put,
    permission: 'customers.update',
    forbiddenRef: '#/components/responses/CustomerTransactionalEditForbidden',
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
      label: 'POST Contract customer association',
      operation: paths['/contracts']?.post,
      requestSchema: 'ContractCreateRequest',
      relationshipFields: ['customer_id'],
      permission: 'contracts.create',
      rejectedStatuses: [404],
      lookups: [],
    },
    {
      label: 'PATCH Contract customer association',
      operation: paths['/contracts/{contract}']?.patch,
      requestSchema: 'ContractUpdateRequest',
      relationshipFields: ['customer_id'],
      permission: 'contracts.update',
      rejectedStatuses: [404, 409],
      lookups: [],
    },
    {
      label: 'POST Service Booking Contract association',
      operation: paths['/service-bookings']?.post,
      requestSchema: 'ServiceBookingCreateRequest',
      relationshipFields: ['contract_id'],
      permission: 'service_bookings.create',
      rejectedStatuses: [404],
      lookups: [],
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
const siteInclude = paths['/sites/{site}']?.get?.parameters?.find(
  (parameter) => resolveParameter(parameter)?.name === 'include'
)
if (siteInclude) {
  errors.push('GET /sites/{site} must not expose include.')
}
const siteAssignmentRequestSchemas = [
  paths['/sites/{site}/assignments']?.post?.requestBody?.content?.[
    'application/json'
  ]?.schema,
  paths['/site-assignments/{siteAssignment}']?.patch?.requestBody?.content?.[
    'application/json'
  ]?.schema,
]
if (
  siteAssignmentRequestSchemas.some((schema) =>
    Object.hasOwn(schema?.properties ?? {}, 'is_primary')
  ) ||
  /is_primary/i.test(
    paths['/site-assignments/{siteAssignment}']?.patch?.description ?? ''
  )
) {
  errors.push('Site assignment requests must not advertise stale is_primary.')
}
for (const pathName of [
  '/customers/{customer}/assignments',
  '/sites/{site}/assignments',
]) {
  const role = paths[pathName]?.get?.parameters
    ?.map(resolveParameter)
    .find((parameter) => parameter?.name === 'role')
  if (
    role?.in !== 'query' ||
    role.required !== false ||
    role.schema?.type !== 'string' ||
    role.schema.maxLength !== 100
  ) {
    errors.push(
      'Customer and site assignment collection filters must expose the runtime role filter.'
    )
  }
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

const transactionalCustomerEditPath =
  paths['/customers/{customer}/transactional-edit'] ?? {}
const transactionalCustomerEdit = transactionalCustomerEditPath.put
const transactionalCustomerEditOperations = Object.values(paths).flatMap(
  (pathItem) =>
    Object.values(pathItem ?? {}).filter(
      (operation) =>
        operation?.operationId === 'transactionallyEditCustomer' ||
        operation?.requestBody?.content?.['application/json']?.schema?.$ref ===
          '#/components/schemas/CustomerTransactionalEditRequest'
    )
)
if (
  transactionalCustomerEditOperations.length !== 1 ||
  transactionalCustomerEdit?.operationId !== 'transactionallyEditCustomer'
) {
  errors.push(
    'Exactly one PUT /customers/{customer}/transactional-edit operation must own the transactional customer edit contract.'
  )
}

const transactionalCustomerEditRequest =
  schemas.CustomerTransactionalEditRequest ?? {}
const transactionalCustomerEditAssignments =
  transactionalCustomerEditRequest.properties?.customer_establishments
if (
  transactionalCustomerEditRequest.type !== 'object' ||
  transactionalCustomerEditRequest.additionalProperties !== false ||
  JSON.stringify(transactionalCustomerEditRequest.required) !==
    JSON.stringify(['customer', 'customer_establishments']) ||
  JSON.stringify(
    Object.keys(transactionalCustomerEditRequest.properties ?? {})
  ) !== JSON.stringify(['customer', 'customer_establishments']) ||
  transactionalCustomerEditRequest.properties?.customer?.$ref !==
    '#/components/schemas/CustomerUpdateRequest' ||
  transactionalCustomerEditAssignments?.type !== 'array' ||
  transactionalCustomerEditAssignments.uniqueItems !== true ||
  transactionalCustomerEditAssignments.items?.$ref !==
    '#/components/schemas/CustomerTransactionalEditEstablishmentRequest'
) {
  errors.push(
    'CustomerTransactionalEditRequest must remain closed and reuse the customer update and customer-establishment request contracts for one complete desired collection.'
  )
}

const transactionalEstablishmentRequest =
  schemas.CustomerTransactionalEditEstablishmentRequest ?? {}
const transactionalContactSemantics =
  transactionalEstablishmentRequest['x-contact-field-semantics'] ?? {}
const transactionalContactExamples =
  transactionalEstablishmentRequest['x-contact-field-examples'] ?? {}
const transactionalContactFields = [
  'contact_name',
  'phone',
  'email',
  'comments',
]
const retainedContactExamples = transactionalContactExamples.retained ?? []
const newContactExamples = transactionalContactExamples.new ?? []
if (
  JSON.stringify(transactionalEstablishmentRequest.allOf) !==
    JSON.stringify([
      { $ref: '#/components/schemas/CustomerEstablishmentCreateRequest' },
    ]) ||
  JSON.stringify(transactionalContactSemantics.fields) !==
    JSON.stringify(transactionalContactFields) ||
  JSON.stringify(transactionalContactSemantics.membership) !==
    JSON.stringify({
      present_existing_pair: 'retain',
      present_new_pair: 'create',
      absent_existing_pair: 'delete subject to conflict rules',
    }) ||
  JSON.stringify(transactionalContactSemantics.retained_pair) !==
    JSON.stringify({
      omitted: 'preserve stored value',
      null: 'clear to null',
      value: 'replace stored value',
    }) ||
  JSON.stringify(transactionalContactSemantics.new_pair) !==
    JSON.stringify({
      omitted: 'initialize null',
      null: 'initialize null',
      value: 'initialize supplied value',
    }) ||
  retainedContactExamples.length !== transactionalContactFields.length ||
  newContactExamples.length !== transactionalContactFields.length ||
  transactionalContactFields.some((field) => {
    const retained = retainedContactExamples.find(
      (example) => example.field === field
    )
    const created = newContactExamples.find(
      (example) => example.field === field
    )
    return (
      retained?.omitted !== true ||
      retained?.omitted_result !== retained?.stored_value ||
      retained?.null !== null ||
      retained?.null_result !== null ||
      retained?.value === undefined ||
      retained?.value_result !== retained?.value ||
      created?.omitted !== true ||
      created?.omitted_result !== null ||
      created?.null !== null ||
      created?.null_result !== null ||
      created?.value === undefined ||
      created?.value_result !== created?.value
    )
  })
) {
  errors.push(
    'Transactional customer-establishment contact semantics must reuse the create contract and prove replace-all membership plus retained omission/preserve, null/clear, value/replace, and new omission/null initialization for all four contact fields.'
  )
}

const transactionalCollectionUniqueness =
  transactionalCustomerEditAssignments?.['x-uniqueness-examples'] ?? {}
const acceptedTransactionalCollection =
  transactionalCollectionUniqueness.accepted?.[0]?.value ?? []
const rejectedTransactionalCollection =
  transactionalCollectionUniqueness.rejected?.[0] ?? {}
if (
  JSON.stringify(transactionalCustomerEditAssignments?.['x-unique-by']) !==
    JSON.stringify(['establishment_id']) ||
  acceptedTransactionalCollection.length !== 2 ||
  acceptedTransactionalCollection[0]?.establishment_id ===
    acceptedTransactionalCollection[1]?.establishment_id ||
  acceptedTransactionalCollection[0]?.email !==
    acceptedTransactionalCollection[1]?.email ||
  rejectedTransactionalCollection.value?.length !== 2 ||
  rejectedTransactionalCollection.value[0]?.establishment_id !==
    rejectedTransactionalCollection.value[1]?.establishment_id ||
  rejectedTransactionalCollection.value[0]?.email ===
    rejectedTransactionalCollection.value[1]?.email ||
  rejectedTransactionalCollection.status !== 422
) {
  errors.push(
    'Transactional customer edit establishment-key uniqueness must remain machine-readable and prove distinct accepted keys plus a rejected duplicate with different local contact data.'
  )
}

const transactionalCustomerEditRequiredRelationships =
  schemas.CustomerTransactionalEditRequiredRelationships ?? {}
const transactionalCustomerEditResult =
  schemas.CustomerTransactionalEditResult ?? {}
const transactionalCustomerEditResponse =
  schemas.CustomerTransactionalEditResponse ?? {}
if (
  JSON.stringify(transactionalCustomerEditResult.allOf) !==
    JSON.stringify([
      { $ref: '#/components/schemas/Customer' },
      {
        $ref: '#/components/schemas/CustomerTransactionalEditRequiredRelationships',
      },
    ]) ||
  JSON.stringify(transactionalCustomerEditRequiredRelationships.required) !==
    JSON.stringify(['customer_establishments']) ||
  transactionalCustomerEditRequiredRelationships.properties
    ?.customer_establishments?.$ref !==
    '#/components/schemas/CustomerEstablishmentRelationship' ||
  transactionalCustomerEditResponse.type !== 'object' ||
  transactionalCustomerEditResponse.additionalProperties !== false ||
  JSON.stringify(transactionalCustomerEditResponse.required) !==
    JSON.stringify(['data']) ||
  transactionalCustomerEditResponse.properties?.data?.$ref !==
    '#/components/schemas/CustomerTransactionalEditResult'
) {
  errors.push(
    'The transactional customer edit response must be closed and reuse Customer plus the required complete CustomerEstablishment relationship.'
  )
}

const transactionalProjectionExamples =
  transactionalCustomerEditRequiredRelationships['x-validation-examples'] ?? {}
const acceptedTransactionalProjection =
  transactionalProjectionExamples.accepted?.[0]?.value
const rejectedTransactionalProjections =
  transactionalProjectionExamples.rejected ?? []
if (
  transactionalCustomerEditRequiredRelationships.properties?.sites !== false ||
  transactionalCustomerEditRequiredRelationships.properties?.assignments !==
    false ||
  transactionalCustomerEditRequiredRelationships.properties?.sites_count !==
    false ||
  JSON.stringify(Object.keys(acceptedTransactionalProjection ?? {})) !==
    JSON.stringify(['customer_establishments']) ||
  JSON.stringify(
    rejectedTransactionalProjections.map((example) =>
      Object.keys(example?.value ?? {}).find(
        (property) => property !== 'customer_establishments'
      )
    )
  ) !== JSON.stringify(['sites', 'assignments', 'sites_count'])
) {
  errors.push(
    'The transactional customer edit committed response projection must require the complete relationship while rejecting sites, assignments, and sites_count.'
  )
}

const transactionalCustomerEditDescription =
  transactionalCustomerEdit?.description ?? ''
const transactionalCustomerEditIfMatch =
  transactionalCustomerEdit?.parameters?.find(
    (parameter) => parameter?.name === 'If-Match'
  )
const customerGetEtag =
  paths['/customers/{customer}']?.get?.responses?.['200']?.headers?.ETag
if (
  transactionalCustomerEditIfMatch?.in !== 'header' ||
  transactionalCustomerEditIfMatch.required !== true ||
  transactionalCustomerEditIfMatch.schema?.type !== 'string' ||
  !customerGetEtag ||
  !/strong entity tag/i.test(customerGetEtag.description ?? '') ||
  transactionalCustomerEdit?.requestBody?.content?.['application/json']?.schema
    ?.$ref !== '#/components/schemas/CustomerTransactionalEditRequest' ||
  transactionalCustomerEdit?.responses?.['200']?.content?.['application/json']
    ?.schema?.$ref !==
    '#/components/schemas/CustomerTransactionalEditResponse' ||
  !transactionalCustomerEdit?.responses?.['200']?.headers?.ETag
) {
  errors.push(
    'The transactional customer edit must require the aggregate GET entity tag and return the committed response with its successor ETag.'
  )
}

const customerGet = paths['/customers/{customer}']?.get
const aggregateGetAuthorization =
  customerGet?.['x-aggregate-etag-authorization-examples'] ?? {}
const transactionalPutAuthorization =
  transactionalCustomerEdit?.['x-authorization-examples'] ?? {}
const strongCustomerGetEtagSemantics =
  customerGet?.['x-strong-etag-semantics'] ?? {}
const acceptedAggregateGet = aggregateGetAuthorization.accepted?.[0]
const rejectedAggregateGet = aggregateGetAuthorization.rejected?.[0]
const acceptedTransactionalPut = transactionalPutAuthorization.accepted?.[0]
const rejectedTransactionalPut = transactionalPutAuthorization.rejected?.[0]
if (
  acceptedAggregateGet?.complete_assignment_visibility !== true ||
  acceptedAggregateGet?.aggregate_etag !== true ||
  rejectedAggregateGet?.site_assignment_only !== true ||
  rejectedAggregateGet?.complete_assignment_visibility !== false ||
  rejectedAggregateGet?.aggregate_etag !== false ||
  acceptedTransactionalPut?.customers_update !== true ||
  acceptedTransactionalPut?.customers_read !== true ||
  acceptedTransactionalPut?.complete_assignment_visibility !== true ||
  rejectedTransactionalPut?.site_assignment_only !== true ||
  rejectedTransactionalPut?.complete_assignment_visibility !== false ||
  rejectedTransactionalPut?.status !== 403 ||
  !/aggregate ETag.*only.*customers\.read.*without organizational scopes.*complete customer-establishment collection/is.test(
    customerGet?.description ?? ''
  ) ||
  !/requires `customers\.update`, `customers\.read` without organizational scopes/is.test(
    transactionalCustomerEditDescription
  ) ||
  !/assignment-only and site-only callers receive \*\*403\*\*/is.test(
    transactionalCustomerEditDescription
  )
) {
  errors.push(
    'Transactional customer edit complete-snapshot authorization must gate the aggregate GET ETag and PUT on authority that guarantees complete assignment visibility, including a rejected site-only case.'
  )
}

if (
  JSON.stringify(strongCustomerGetEtagSemantics) !==
    JSON.stringify({
      representation_scope: 'entire actual 200 response representation',
      invalidated_by: 'any observable change to any emitted data member',
      includes: [
        'customer master data',
        'customer_establishments',
        'sites',
        'assignments',
        'sites_count',
        'every other emitted field',
      ],
      put_precondition: 'conservative 412 is intentional',
    }) ||
  !/strong ETag represents the entire actual .*200.* response representation.*any observable change to any emitted data member invalidates it.*customer master data.*customer_establishments.*sites.*assignments.*sites_count.*every other emitted field.*conservatively return .*412/is.test(
    customerGet?.description ?? ''
  ) ||
  !/strong entity tag for the entire actual .*200.* response representation.*every observable change to any emitted member invalidates it/is.test(
    customerGetEtag?.description ?? ''
  )
) {
  errors.push(
    'The strong customer GET ETag must cover the entire GET representation and invalidate on every observable emitted-data change.'
  )
}

const transactionalCustomerEditResponseRefs = {
  400: '#/components/responses/BadRequest',
  401: '#/components/responses/Unauthorized',
  403: '#/components/responses/CustomerTransactionalEditForbidden',
  404: '#/components/responses/CustomerTransactionalEditNotFound',
  409: '#/components/responses/CustomerTransactionalEditConflict',
  412: '#/components/responses/CustomerTransactionalEditStale',
  422: '#/components/responses/CustomerTransactionalEditValidationError',
  500: '#/components/responses/InternalServerError',
}
if (
  Object.entries(transactionalCustomerEditResponseRefs).some(
    ([status, responseRef]) =>
      transactionalCustomerEdit?.responses?.[status]?.$ref !== responseRef
  )
) {
  errors.push(
    'The transactional customer edit must retain complete authentication, authorization, tenant-safe, conflict, stale, and validation responses.'
  )
}

function acceptsFixedClosedError(schema, value) {
  if (
    schema?.type !== 'object' ||
    schema.additionalProperties !== false ||
    JSON.stringify(schema.required) !== JSON.stringify(['message', 'code']) ||
    JSON.stringify(Object.keys(schema.properties ?? {})) !==
      JSON.stringify(['message', 'code']) ||
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(['message', 'code'])
  ) {
    return false
  }

  return Object.entries(schema.properties).every(
    ([property, propertySchema]) =>
      propertySchema?.type === 'string' &&
      propertySchema.enum?.includes(value[property]) === true
  )
}

const transactionalValidationErrorRules = [
  {
    pattern:
      /^customer\.(legal_entity_id|vat_id|name|billing_address(?:\.(?:street|city|postal_code|country|latitude|longitude))?|is_active)$/,
    message: 'The customer field is invalid.',
  },
  {
    pattern: /^customer_establishments$/,
    message: 'Each establishment may be assigned at most once.',
  },
  {
    pattern: /^customer_establishments\.[0-9]+\.establishment_id$/,
    message: 'The selected establishment is invalid.',
  },
  {
    pattern: /^customer_establishments\.[0-9]+\.customer_id$/,
    message: 'The selected customer is invalid.',
  },
  {
    pattern:
      /^customer_establishments\.[0-9]+\.(contact_name|phone|email|comments)$/,
    message: 'The contact field is invalid.',
  },
]

function acceptsTransactionalValidationProblem(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value)) !==
      JSON.stringify(['message', 'errors']) ||
    value.message !== 'The given data was invalid.' ||
    typeof value.errors !== 'object' ||
    value.errors === null ||
    Array.isArray(value.errors) ||
    Object.keys(value.errors).length === 0
  ) {
    return false
  }

  return Object.entries(value.errors).every(([field, messages]) => {
    const rule = transactionalValidationErrorRules.find(({ pattern }) =>
      pattern.test(field)
    )
    return (
      rule !== undefined &&
      Array.isArray(messages) &&
      messages.length === 1 &&
      messages[0] === rule.message
    )
  })
}

const transactionalCustomerEditForbidden =
  responses.CustomerTransactionalEditForbidden ?? {}
const transactionalCustomerEditForbiddenMedia =
  transactionalCustomerEditForbidden.content?.['application/json'] ?? {}
const transactionalCustomerEditForbiddenSchema =
  schemas.CustomerTransactionalEditForbiddenError ?? {}
const transactionalCustomerEditForbiddenExamples =
  transactionalCustomerEditForbiddenSchema['x-validation-examples'] ?? {}
const fixedTransactionalCustomerEditForbidden = {
  message: 'Insufficient permissions',
  code: 'FORBIDDEN',
}
if (
  transactionalCustomerEdit?.responses?.['403']?.$ref !==
    '#/components/responses/CustomerTransactionalEditForbidden' ||
  transactionalCustomerEditForbiddenMedia.schema?.$ref !==
    '#/components/schemas/CustomerTransactionalEditForbiddenError' ||
  JSON.stringify(transactionalCustomerEditForbiddenMedia.example) !==
    JSON.stringify(fixedTransactionalCustomerEditForbidden) ||
  JSON.stringify(
    transactionalCustomerEditForbiddenSchema.properties?.message
  ) !==
    JSON.stringify({ type: 'string', enum: ['Insufficient permissions'] }) ||
  JSON.stringify(transactionalCustomerEditForbiddenSchema.properties?.code) !==
    JSON.stringify({ type: 'string', enum: ['FORBIDDEN'] }) ||
  !acceptsFixedClosedError(
    transactionalCustomerEditForbiddenSchema,
    transactionalCustomerEditForbiddenExamples.accepted?.[0]?.value
  ) ||
  transactionalCustomerEditForbiddenExamples.rejected?.length !== 2 ||
  transactionalCustomerEditForbiddenExamples.rejected.some((example) =>
    acceptsFixedClosedError(
      transactionalCustomerEditForbiddenSchema,
      example?.value
    )
  ) ||
  !Object.hasOwn(
    transactionalCustomerEditForbiddenExamples.rejected?.[0]?.value ?? {},
    'details'
  ) ||
  !Object.hasOwn(
    transactionalCustomerEditForbiddenExamples.rejected?.[1]?.value ?? {},
    'denied_scope'
  )
) {
  errors.push(
    'Transactional customer edit must retain its fixed authorization denial payload, dedicated response/schema references, closed code/message-only shape, and rejected disclosure examples.'
  )
}

const transactionalValidationResponse =
  responses.CustomerTransactionalEditValidationError ?? {}
const transactionalValidationMedia =
  transactionalValidationResponse.content?.['application/json'] ?? {}
const transactionalValidationSchema =
  schemas.CustomerTransactionalEditValidationProblem ?? {}
const transactionalValidationErrors =
  transactionalValidationSchema.properties?.errors ?? {}
const transactionalValidationExamples =
  transactionalValidationSchema['x-validation-examples'] ?? {}
const transactionalValidationPatterns = {
  '^customer\\.(legal_entity_id|vat_id|name|billing_address(?:\\.(?:street|city|postal_code|country|latitude|longitude))?|is_active)$':
    '#/components/schemas/CustomerTransactionalEditCustomerFieldErrors',
  '^customer_establishments$':
    '#/components/schemas/CustomerTransactionalEditDuplicateTargetErrors',
  '^customer_establishments\\.[0-9]+\\.establishment_id$':
    '#/components/schemas/CustomerTransactionalEditInvalidEstablishmentErrors',
  '^customer_establishments\\.[0-9]+\\.customer_id$':
    '#/components/schemas/CustomerTransactionalEditInvalidCustomerErrors',
  '^customer_establishments\\.[0-9]+\\.(contact_name|phone|email|comments)$':
    '#/components/schemas/CustomerTransactionalEditInvalidContactFieldErrors',
}
const transactionalValidationFieldSchemas = {
  CustomerTransactionalEditCustomerFieldErrors:
    'The customer field is invalid.',
  CustomerTransactionalEditDuplicateTargetErrors:
    'Each establishment may be assigned at most once.',
  CustomerTransactionalEditInvalidEstablishmentErrors:
    'The selected establishment is invalid.',
  CustomerTransactionalEditInvalidCustomerErrors:
    'The selected customer is invalid.',
  CustomerTransactionalEditInvalidContactFieldErrors:
    'The contact field is invalid.',
}
if (
  transactionalCustomerEdit?.responses?.['422']?.$ref !==
    '#/components/responses/CustomerTransactionalEditValidationError' ||
  transactionalValidationMedia.schema?.$ref !==
    '#/components/schemas/CustomerTransactionalEditValidationProblem' ||
  transactionalValidationSchema.type !== 'object' ||
  transactionalValidationSchema.additionalProperties !== false ||
  JSON.stringify(transactionalValidationSchema.required) !==
    JSON.stringify(['message', 'errors']) ||
  JSON.stringify(
    Object.keys(transactionalValidationSchema.properties ?? {})
  ) !== JSON.stringify(['message', 'errors']) ||
  JSON.stringify(transactionalValidationSchema.properties?.message) !==
    JSON.stringify({
      type: 'string',
      enum: ['The given data was invalid.'],
    }) ||
  transactionalValidationErrors.type !== 'object' ||
  transactionalValidationErrors.minProperties !== 1 ||
  transactionalValidationErrors.additionalProperties !== false ||
  JSON.stringify(
    Object.fromEntries(
      Object.entries(transactionalValidationErrors.patternProperties ?? {}).map(
        ([pattern, schema]) => [pattern, schema?.$ref]
      )
    )
  ) !== JSON.stringify(transactionalValidationPatterns) ||
  Object.entries(transactionalValidationFieldSchemas).some(
    ([schemaName, message]) => {
      const schema = schemas[schemaName] ?? {}
      return (
        schema.type !== 'array' ||
        schema.minItems !== 1 ||
        schema.maxItems !== 1 ||
        JSON.stringify(schema.items) !==
          JSON.stringify({ type: 'string', enum: [message] })
      )
    }
  ) ||
  transactionalValidationExamples.accepted?.length !== 8 ||
  transactionalValidationExamples.accepted.some(
    (example) => !acceptsTransactionalValidationProblem(example?.value)
  ) ||
  JSON.stringify(
    transactionalValidationExamples.accepted.flatMap((example) =>
      Object.keys(example?.value?.errors ?? {})
    )
  ) !==
    JSON.stringify([
      'customer.name',
      'customer_establishments',
      'customer_establishments.0.establishment_id',
      'customer_establishments.0.customer_id',
      'customer_establishments.0.contact_name',
      'customer_establishments.0.phone',
      'customer_establishments.0.email',
      'customer_establishments.0.comments',
    ]) ||
  transactionalValidationExamples.rejected?.length !== 11 ||
  transactionalValidationExamples.rejected.some((example) =>
    acceptsTransactionalValidationProblem(example?.value)
  ) ||
  JSON.stringify(
    transactionalValidationExamples.rejected.map((example) => example.category)
  ) !==
    JSON.stringify([
      'top-level-property',
      'unexpected-error-key',
      'arbitrary-string',
      'cross-tenant-detail',
      'wrong-legal-entity-detail',
      'resource-existence-hint',
      'unexpected-assignment-field',
      'contact-arbitrary-string',
      'contact-tenant-disclosure',
      'contact-resource-disclosure',
      'contact-database-internal-text',
    ])
) {
  errors.push(
    'Transactional customer edit 422 must use its dedicated closed validation schema, accept only customer master-data and fixed transactional field errors, and reject arbitrary or tenant-disclosing keys, strings, details, hints, and properties.'
  )
}

const transactionalNotFoundResponse =
  responses.CustomerTransactionalEditNotFound ?? {}
const transactionalNotFoundMedia =
  transactionalNotFoundResponse.content?.['application/json'] ?? {}
const transactionalNotFoundSchema =
  schemas.CustomerTransactionalEditNotFoundError ?? {}
const transactionalNotFoundExamples =
  transactionalNotFoundSchema['x-validation-examples'] ?? {}
const fixedTransactionalNotFound = {
  message: 'Resource not found',
  code: 'NOT_FOUND',
}
if (
  transactionalCustomerEdit?.responses?.['404']?.$ref !==
    '#/components/responses/CustomerTransactionalEditNotFound' ||
  transactionalNotFoundMedia.schema?.$ref !==
    '#/components/schemas/CustomerTransactionalEditNotFoundError' ||
  JSON.stringify(transactionalNotFoundMedia.example) !==
    JSON.stringify(fixedTransactionalNotFound) ||
  !acceptsFixedClosedError(
    transactionalNotFoundSchema,
    transactionalNotFoundExamples.accepted?.[0]?.value
  ) ||
  !acceptsFixedClosedError(
    transactionalNotFoundSchema,
    transactionalNotFoundExamples.accepted?.[1]?.value
  ) ||
  JSON.stringify(transactionalNotFoundExamples.accepted?.[0]?.value) !==
    JSON.stringify(transactionalNotFoundExamples.accepted?.[1]?.value) ||
  transactionalNotFoundExamples.rejected?.length !== 6 ||
  transactionalNotFoundExamples.rejected.some((example) =>
    acceptsFixedClosedError(transactionalNotFoundSchema, example?.value)
  ) ||
  JSON.stringify(
    transactionalNotFoundExamples.rejected.map((example) => example.category)
  ) !==
    JSON.stringify([
      'message-drift',
      'code-drift',
      'details',
      'tenant-id',
      'existence-hint',
      'extra-property',
    ])
) {
  errors.push(
    'Transactional customer edit 404 must retain its dedicated response/schema references and one fixed closed missing-or-inaccessible payload without details, tenant IDs, existence hints, or extra properties.'
  )
}

for (const [responseName, schemaName, message, code] of [
  [
    'CustomerTransactionalEditConflict',
    'CustomerTransactionalEditConflictError',
    'The customer edit conflicts with the current resource state.',
    'CUSTOMER_EDIT_CONFLICT',
  ],
  [
    'CustomerTransactionalEditStale',
    'CustomerTransactionalEditStaleError',
    'The customer edit snapshot is stale.',
    'CUSTOMER_EDIT_STALE',
  ],
]) {
  const response = responses[responseName] ?? {}
  const responseMedia = response.content?.['application/json'] ?? {}
  const errorSchema = schemas[schemaName] ?? {}
  if (
    responseMedia.schema?.$ref !== `#/components/schemas/${schemaName}` ||
    JSON.stringify(responseMedia.example) !==
      JSON.stringify({ message, code }) ||
    !acceptsFixedClosedError(errorSchema, { message, code }) ||
    JSON.stringify(errorSchema.properties?.message?.enum) !==
      JSON.stringify([message]) ||
    JSON.stringify(errorSchema.properties?.code?.enum) !==
      JSON.stringify([code])
  ) {
    errors.push(
      'Transactional customer edit fixed closed conflict and stale payloads must retain their dedicated response schema references, exact examples and enums, and required code/message-only object shapes.'
    )
  }
}

const transactionalCustomerEditSemantics = [
  /complete desired.*customer_establishments.*collection/is,
  /one transaction/i,
  /absent existing pair is deleted/i,
  /each `establishment_id` may occur at most once/i,
  /duplicate establishment targets.*422/is,
  /missing, inaccessible, cross-tenant, wrong-Legal-Entity, inactive, and deleted assignment targets.*same information-poor.*422/is,
  /stale tag.*412/is,
  /authorization.*revalidated inside the transaction.*before commit/is,
  /stale authorization.*403/is,
  /non-success response rolls back the complete edit/is,
  /Site.*409.*without identifying the dependent resource/is,
  /OU scopes do not grant access to customer or site domain writes/i,
  /separate `CustomerEstablishment` CRUD operations.*not a second transactional customer-edit path/is,
]
if (
  transactionalCustomerEditSemantics.some(
    (pattern) => !pattern.test(transactionalCustomerEditDescription)
  )
) {
  errors.push(
    'The transactional customer edit must retain atomic reconciliation, deterministic conflicts, authorization revalidation, tenant-safe failures, Site boundaries, and separate CRUD semantics.'
  )
}

const duplicateTargetExample =
  responses.CustomerTransactionalEditValidationError?.content?.[
    'application/json'
  ]?.examples?.duplicateEstablishmentTarget?.value
const invalidAssignmentExample =
  responses.CustomerTransactionalEditValidationError?.content?.[
    'application/json'
  ]?.examples?.invalidAssignment?.value
const customerMismatchRequest =
  transactionalCustomerEditRequest['x-validation-examples']?.rejected?.[0]
const customerMismatchResponse =
  responses.CustomerTransactionalEditValidationError?.content?.[
    'application/json'
  ]?.examples?.customerMismatch?.value
if (
  duplicateTargetExample?.errors?.customer_establishments?.[0] !==
    'Each establishment may be assigned at most once.' ||
  invalidAssignmentExample?.errors?.[
    'customer_establishments.0.establishment_id'
  ]?.[0] !== 'The selected establishment is invalid.'
) {
  errors.push(
    'Transactional customer edit validation examples must distinguish duplicate targets from a neutral invalid assignment.'
  )
}

if (
  customerMismatchRequest?.status !== 422 ||
  !uuidValue(customerMismatchRequest?.path_customer_id) ||
  !uuidValue(
    customerMismatchRequest?.value?.customer_establishments?.[0]?.customer_id
  ) ||
  customerMismatchRequest?.path_customer_id ===
    customerMismatchRequest?.value?.customer_establishments?.[0]?.customer_id ||
  customerMismatchResponse?.errors?.[
    'customer_establishments.0.customer_id'
  ]?.[0] !== 'The selected customer is invalid.' ||
  !/different nested customer ID.*neutral \*\*422\*\*.*never used to select or mutate a customer/is.test(
    transactionalCustomerEditDescription
  )
) {
  errors.push(
    'Transactional customer edit path and body customer identity must reject mismatches with deterministic neutral 422 evidence and never act on the nested ID.'
  )
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
