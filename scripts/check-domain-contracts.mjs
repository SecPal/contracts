#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'

const contractPath = resolve(process.argv[2] ?? 'docs/openapi.yaml')
const contract = yaml.load(readFileSync(contractPath, 'utf8'))
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

function containsRequiredStructure(actual, required) {
  if (Array.isArray(required)) {
    return (
      Array.isArray(actual) &&
      actual.length >= required.length &&
      required.every((value, index) =>
        containsRequiredStructure(actual[index], value)
      )
    )
  }

  if (required !== null && typeof required === 'object') {
    return (
      actual !== null &&
      typeof actual === 'object' &&
      !Array.isArray(actual) &&
      Object.entries(required).every(([key, value]) =>
        containsRequiredStructure(actual[key], value)
      )
    )
  }

  return Object.is(actual, required)
}

function satisfiesUniqueBy(schema, value) {
  const uniqueBy = schema?.['x-unique-by']
  if (
    !Array.isArray(value) ||
    !Array.isArray(uniqueBy) ||
    uniqueBy.length === 0
  ) {
    return false
  }

  const seen = new Set()
  for (const item of value) {
    if (
      typeof item !== 'object' ||
      item === null ||
      Array.isArray(item) ||
      uniqueBy.some((field) => !Object.hasOwn(item, field))
    ) {
      return false
    }
    const key = JSON.stringify(uniqueBy.map((field) => item[field]))
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

const membershipList = schemas.MembershipContext?.properties?.memberships
const membershipExamples = Object.values(
  paths['/auth/membership-context']?.get?.responses?.['200']?.content?.[
    'application/json'
  ]?.examples ?? {}
)

if (
  JSON.stringify(membershipList?.['x-unique-by']) !==
    JSON.stringify(['membership_id']) ||
  membershipExamples.length === 0 ||
  !membershipExamples.every((example) =>
    satisfiesUniqueBy(membershipList, example?.value?.memberships)
  )
) {
  errors.push(
    'Membership context must represent each membership_id once in its validated wire examples.'
  )
}

const membershipUniqueByValidation = membershipList?.['x-unique-by-validation']
const deniedMembershipLists =
  membershipList?.['x-uniqueness-examples']?.rejected

if (
  membershipList?.uniqueItems !== true ||
  membershipUniqueByValidation?.validator !== 'secpal-keyed-uniqueness' ||
  membershipUniqueByValidation?.authority !==
    'SecPal semantic validation and server enforcement' ||
  membershipUniqueByValidation?.json_schema_scope !==
    'uniqueItems compares complete array items only' ||
  membershipUniqueByValidation?.violation?.status !== 500 ||
  membershipUniqueByValidation?.violation?.action !== 'reject-entire-context' ||
  !Array.isArray(deniedMembershipLists) ||
  !deniedMembershipLists.some(
    ({ value, status }) =>
      value?.length === 2 &&
      value[0]?.membership_id === value[1]?.membership_id &&
      value[0]?.status !== value[1]?.status &&
      !satisfiesUniqueBy(membershipList, value) &&
      status === membershipUniqueByValidation.violation.status
  )
) {
  errors.push(
    'Membership context must reject duplicate membership_id before publishing any partial context or credential.'
  )
}

function matchesSchemaPattern(schema, value) {
  try {
    return (
      schema?.type === 'string' &&
      typeof value === 'string' &&
      new RegExp(schema.pattern, 'u').test(value)
    )
  } catch {
    return false
  }
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

function requireScopedDomainMutations(rules) {
  const coveredOperations = new Set()
  const mutationMethods = new Set(['post', 'put', 'patch', 'delete'])
  const domainTags = new Set(['Customers', 'Sites'])
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
    if (
      !description.includes(permission) ||
      !/effective (?:membership )?scope/i.test(description) ||
      !/active Tenant/i.test(description) ||
      operation?.responses?.['403']?.$ref !== forbiddenRef
    ) {
      errors.push(
        `${label} must keep its permission, active Tenant scope, and 403 response aligned.`
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
          `${method.toUpperCase()} ${pathName} must be covered by the customer/site scoped domain mutation model.`
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
  requiresClassification = false,
}) {
  const coveredOperations = new Set()
  const effectiveScope = /effective (?:membership )?scope/i
  const selfServiceMarker = /\*\*Self-service:\*\*/i
  const selfService =
    /\*\*Self-service:\*\* requires an explicitly granted permission with effective linked Employee scope/i

  for (const rule of rules) {
    const description = rule.operation?.description ?? ''
    if (rule.operation) {
      coveredOperations.add(rule.operation)
    }
    if (
      !effectiveScope.test(description) ||
      !description.includes(rule.permission) ||
      selfServiceMarker.test(description) !== rule.selfService ||
      (rule.selfService && !selfService.test(description)) ||
      (requiresClassification &&
        !/document classification/i.test(description)) ||
      rule.operation?.responses?.['403']?.$ref !== rule.forbiddenRef
    ) {
      errors.push(
        `${familyLabel} authorization must keep ${rule.label} permission, effective Employee scope, and 403 response aligned.`
      )
    }
  }

  for (const rule of schemaRules) {
    const description = schemas[rule.schemaName]?.description ?? ''
    if (
      !effectiveScope.test(description) ||
      !description.includes(rule.permission) ||
      selfServiceMarker.test(description)
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
    const observesForeignTarget = workflow.tenantEvidence
    const hasTenantEvidence = (example, sameTenant) =>
      uuidValue(example?.active_tenant_id) &&
      uuidValue(example?.target_tenant_id) &&
      (example.active_tenant_id.toLowerCase() ===
        example.target_tenant_id.toLowerCase()) ===
        sameTenant
    if (
      !hasValidEvidence(accepted) ||
      !hasValidEvidence(rejected) ||
      !rejectedStatuses.includes(rejected?.status) ||
      (observesForeignTarget &&
        (!hasTenantEvidence(accepted, true) ||
          !hasTenantEvidence(rejected, false) ||
          accepted.active_tenant_id.toLowerCase() !==
            rejected.active_tenant_id.toLowerCase()))
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

function rejectRetiredHierarchyFields(schemaName) {
  const properties = schemas[schemaName]?.properties ?? {}
  for (const propertyName of [
    'organizational_unit_id',
    'organizational_unit',
    'legal_entity_id',
    'parent_id',
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
  !/limited to a Site.*only authorized links/i.test(
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
  'EmploymentPeriod',
  'EmploymentTermsVersion',
  'Establishment',
  'HistoricalEstablishment',
  'EmployeeEstablishmentAssignment',
  'CustomerEstablishment',
  'CustomerEstablishmentCreateRequest',
  'CustomerEstablishmentUpdateRequest',
]) {
  rejectRetiredHierarchyFields(schemaName)
}

const retiredHierarchyPath =
  /^\/(?:organizational-units|legal-entities|lookups\/legal-entities)(?:\/|$)|\/customer-candidates$/
for (const [path, item] of Object.entries(paths)) {
  if (retiredHierarchyPath.test(path)) {
    errors.push(`${path} exposes a retired hierarchy or matching endpoint.`)
  }
  for (const operation of [
    item,
    item.get,
    item.post,
    item.patch,
    item.put,
    item.delete,
  ]) {
    for (const parameter of operation?.parameters ?? []) {
      if (
        /^(?:X-Tenant|tenant_id|legal_entity_id|organizational_unit_id)$/i.test(
          resolveParameter(parameter)?.name ?? ''
        )
      ) {
        errors.push(
          `${path} must not accept ${resolveParameter(parameter).name} as a selector.`
        )
      }
    }
  }
}
for (const name of [
  'EmployeeCreateRequest',
  'EmployeeUpdateRequest',
  'CustomerCreateRequest',
  'CustomerUpdateRequest',
  'CustomerEstablishmentCreateRequest',
  'CustomerEstablishmentUpdateRequest',
  'SiteCreateRequest',
  'SiteUpdateRequest',
  'EmploymentPeriodCreateRequest',
  'InitialEmploymentTerms',
  'EmployeeEstablishmentAssignmentCreateRequest',
]) {
  const schema = schemas[name]
  if (
    schema?.additionalProperties !== false ||
    Object.hasOwn(schema.properties ?? {}, 'tenant_id')
  ) {
    errors.push(
      `${name} must reject caller-supplied Tenant authority and unknown properties.`
    )
  }
}

const employeeCreationAuditExamples = collectMatchingObjects(
  paths,
  (value) =>
    value.subject_type === 'App\\Models\\Employee' && value.event === 'created'
)
const forbiddenEmployeeAuditFields = [
  'organizational_unit_id',
  'legal_entity_id',
  'establishment_id',
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
      activity.subject?.name != null ||
      forbiddenEmployeeAuditFields.some((field) =>
        Object.hasOwn(attributes, field)
      )
    )
  })
) {
  errors.push(
    'All employee creation audit examples must use employee_changes, and exclude hierarchy, assignment and personal-name values.'
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

for (const schemaName of ['Site', 'SiteCreateRequest']) {
  requireUuid(schemaName, 'customer_id', true)
  requireUuid(schemaName, 'establishment_id', true)
}
for (const propertyName of ['customer_id', 'establishment_id']) {
  requireUuid('SiteUpdateRequest', propertyName, false)
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
    parameters: ['page', 'per_page', 'status', 'search', 'establishment_id'],
    uuidFields: ['establishment_id'],
    searchPattern: /exact.*employee email or employee number.*authorized/i,
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
requireScopedDomainMutations(customerSiteDomainMutations)

const assignmentLookups = {
  linkedCustomers: {
    label: 'GET linked customer lookups',
    operation: paths['/lookups/establishments/{establishment}/customers']?.get,
  },
}

requireAssignmentWorkflows(
  [
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
      tenantEvidence: true,
      operation: paths['/customer-establishments']?.post,
      requestSchema: 'CustomerEstablishmentCreateRequest',
      relationshipFields: ['customer_id', 'establishment_id'],
      permission: 'customers.update',
      lookups: [],
    },
    {
      label: 'POST site assignments',
      tenantEvidence: true,
      operation: paths['/sites']?.post,
      requestSchema: 'SiteCreateRequest',
      relationshipFields: ['customer_id', 'establishment_id'],
      permission: 'sites.create',
      lookups: ['linkedCustomers'],
    },
    {
      label: 'PATCH site assignments',
      tenantEvidence: true,
      operation: paths['/sites/{site}']?.patch,
      requestSchema: 'SiteUpdateRequest',
      relationshipFields: ['customer_id', 'establishment_id'],
      permission: 'sites.update',
      lookups: ['linkedCustomers'],
    },
    {
      label: 'POST employment periods',
      tenantEvidence: true,
      operation: paths['/employees/{employee}/employment-periods']?.post,
      requestSchema: 'EmploymentPeriodCreateRequest',
      relationshipFields: ['establishment_id'],
      permission: 'explicit effective permission',
      rejectedStatuses: [404],
      lookups: [],
    },
    {
      label: 'POST establishment assignments',
      tenantEvidence: true,
      operation: paths['/employees/{employee}/establishment-assignments']?.post,
      requestSchema: 'EmployeeEstablishmentAssignmentCreateRequest',
      relationshipFields: ['establishment_id'],
      permission: 'explicit write permission',
      rejectedStatuses: [404],
      lookups: [],
    },
  ],
  assignmentLookups
)

requireContractRules([
  {
    label: 'POST customer-establishment links',
    text: paths['/customer-establishments']?.post?.description,
    patterns: [
      /active, non-deleted customer/i,
      /active, non-deleted establishment/i,
      /same Tenant/i,
    ],
  },
  {
    label: 'POST site relationships',
    text: paths['/sites']?.post?.description,
    patterns: [
      /active, non-deleted customer/i,
      /active establishment/i,
      /same-Tenant/i,
      /existing customer-establishment link/i,
    ],
  },
  {
    label: 'PATCH site relationships',
    text: schemas.SiteUpdateRequest?.description,
    patterns: [
      /resulting/i,
      /active, non-deleted customer/i,
      /active establishment/i,
      /active Tenant/i,
      /customer-establishment link/i,
    ],
  },
  ...[
    ['GET customer collections', paths['/customers']?.get, 'customers.read'],
    [
      'GET customer-establishment collections',
      paths['/customer-establishments']?.get,
      'customers.read',
    ],
    [
      'GET customer records',
      paths['/customers/{customer}']?.get,
      'customers.read',
    ],
    [
      'GET customer-establishment links',
      customerEstablishmentPath.get,
      'customers.read',
    ],
    ['GET site collections', paths['/sites']?.get, 'sites.read'],
    ['GET site records', paths['/sites/{site}']?.get, 'sites.read'],
  ].map(([label, operation, permission]) => ({
    label,
    text: operation?.description,
    patterns: [
      new RegExp(permission.replace('.', '\\.')),
      /effective.*scope/is,
    ],
    response: {
      operation,
      status: '403',
      ref: '#/components/responses/Forbidden',
    },
  })),
  {
    label: 'GET linked customer lookups',
    text: assignmentLookups.linkedCustomers.operation?.description,
    patterns: [
      /active, non-deleted establishment/i,
      /authorized domain write access/i,
      /active, non-deleted customers/i,
      /existing customer-establishment link/i,
    ],
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
  requiresClassification: true,
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
const transactionalCustomerUpdateRequest = schemas.CustomerUpdateRequest ?? {}
if (
  transactionalCustomerEditRequest.type !== 'object' ||
  transactionalCustomerEditRequest.additionalProperties !== false ||
  JSON.stringify(transactionalCustomerEditRequest.required) !==
    JSON.stringify(['customer', 'customer_establishments']) ||
  JSON.stringify(
    Object.keys(transactionalCustomerEditRequest.properties ?? {})
  ) !== JSON.stringify(['customer', 'customer_establishments']) ||
  transactionalCustomerEditAssignments?.type !== 'array' ||
  transactionalCustomerEditAssignments.uniqueItems !== true ||
  transactionalCustomerEditAssignments.items?.$ref !==
    '#/components/schemas/CustomerTransactionalEditEstablishmentRequest'
) {
  errors.push(
    'CustomerTransactionalEditRequest must remain closed and reuse the customer update and customer-establishment request contracts for one complete desired collection.'
  )
}

if (
  transactionalCustomerUpdateRequest.type !== 'object' ||
  transactionalCustomerUpdateRequest.additionalProperties !== false
) {
  errors.push(
    'CustomerUpdateRequest must remain closed because it is the transactional customer payload schema.'
  )
}

const transactionalEstablishmentRequest =
  schemas.CustomerTransactionalEditEstablishmentRequest ?? {}
const transactionalEstablishmentCreateRequest =
  schemas.CustomerEstablishmentCreateRequest ?? {}
if (
  transactionalEstablishmentCreateRequest.type !== 'object' ||
  transactionalEstablishmentCreateRequest.additionalProperties !== false
) {
  errors.push(
    'CustomerEstablishmentCreateRequest must remain closed because it is the transactional assignment item schema.'
  )
}
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
const rejectedTransactionalCollections =
  transactionalCollectionUniqueness.rejected ?? []
const transactionalUniqueByValidation =
  transactionalCustomerEditAssignments?.['x-unique-by-validation'] ?? {}
const expectedTransactionalUniquenessViolation = {
  status: 422,
  field: 'customer_establishments',
  message: 'Each establishment may be assigned at most once.',
}
const transactionalUniquenessCategories = [
  'exact-duplicate',
  'different-contact-name',
  'different-phone',
  'different-email',
  'different-comments',
]
if (
  transactionalCustomerEditAssignments?.uniqueItems !== true ||
  JSON.stringify(transactionalCustomerEditAssignments?.['x-unique-by']) !==
    JSON.stringify(['establishment_id']) ||
  JSON.stringify(transactionalUniqueByValidation) !==
    JSON.stringify({
      validator: 'secpal-keyed-uniqueness',
      authority: 'SecPal semantic validation and server enforcement',
      json_schema_scope: 'uniqueItems compares complete array items only',
      violation: expectedTransactionalUniquenessViolation,
    }) ||
  !satisfiesUniqueBy(
    transactionalCustomerEditAssignments,
    acceptedTransactionalCollection
  ) ||
  acceptedTransactionalCollection[0]?.email !==
    acceptedTransactionalCollection[1]?.email ||
  JSON.stringify(
    rejectedTransactionalCollections.map((example) => example.category)
  ) !== JSON.stringify(transactionalUniquenessCategories) ||
  rejectedTransactionalCollections.some(
    (example) =>
      satisfiesUniqueBy(transactionalCustomerEditAssignments, example?.value) ||
      JSON.stringify({
        status: example?.status,
        field: example?.field,
        message: example?.message,
      }) !== JSON.stringify(expectedTransactionalUniquenessViolation)
  ) ||
  JSON.stringify(rejectedTransactionalCollections[0]?.value?.[0]) !==
    JSON.stringify(rejectedTransactionalCollections[0]?.value?.[1]) ||
  [
    ['different-contact-name', 'contact_name'],
    ['different-phone', 'phone'],
    ['different-email', 'email'],
    ['different-comments', 'comments'],
  ].some(([category, field]) => {
    const value = rejectedTransactionalCollections.find(
      (example) => example.category === category
    )?.value
    return (
      value?.length !== 2 ||
      value[0]?.establishment_id !== value[1]?.establishment_id ||
      value[0]?.[field] === value[1]?.[field]
    )
  })
) {
  errors.push(
    'Transactional customer edit establishment-key uniqueness must retain uniqueItems, authenticate x-unique-by, execute SecPal keyed validation over payloads, and return the deterministic 422 for exact and differing-contact duplicates.'
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
const customerGet = paths['/customers/{customer}']?.get
const strongCustomerGetEtagSemantics =
  customerGet?.['x-strong-etag-semantics'] ?? {}
const transactionalCustomerEditEtagSemantics =
  transactionalCustomerEdit?.['x-etag-precondition-semantics'] ?? {}
const strongEntityTag = schemas.StrongEntityTag ?? {}
const strongEntityTagRef = '#/components/schemas/StrongEntityTag'
const expectedStrongEntityTag = {
  type: 'string',
  description:
    'Canonical strong HTTP entity-tag syntax: a quoted opaque tag without the weak `W/` prefix or control characters.',
  pattern: '^"[!#-~\\u0080-\\u00FF]*"$',
  example: '"customer-edit-8f14e45fceea167a5a36dedd4bea2543"',
}
if (
  customerGetEtag?.schema?.$ref !== strongEntityTagRef ||
  transactionalCustomerEditIfMatch?.schema?.$ref !== strongEntityTagRef ||
  JSON.stringify(strongEntityTag) !== JSON.stringify(expectedStrongEntityTag) ||
  !matchesSchemaPattern(strongEntityTag, '"opaque-tag"') ||
  matchesSchemaPattern(strongEntityTag, 'W/"accepted-weak"') ||
  ['W/"opaque-tag"', 'opaque-tag', '"unterminated', '"bad\u0001tag"'].some(
    (value) => matchesSchemaPattern(strongEntityTag, value)
  )
) {
  errors.push(
    'Customer GET ETag and transactional PUT If-Match must share the canonical strong entity-tag schema and reject weak, unquoted, unterminated, and control-character values.'
  )
}
if (
  transactionalCustomerEditIfMatch?.in !== 'header' ||
  transactionalCustomerEditIfMatch.required !== true ||
  !customerGetEtag ||
  !/strong entity tag/i.test(customerGetEtag.description ?? '') ||
  transactionalCustomerEdit?.requestBody?.content?.['application/json']?.schema
    ?.$ref !== '#/components/schemas/CustomerTransactionalEditRequest' ||
  transactionalCustomerEdit?.responses?.['200']?.content?.['application/json']
    ?.schema?.$ref !==
    '#/components/schemas/CustomerTransactionalEditResponse' ||
  transactionalCustomerEdit?.responses?.['200']?.headers?.ETag !== undefined ||
  JSON.stringify(transactionalCustomerEditEtagSemantics) !==
    JSON.stringify({
      source_operation: 'GET /customers/{customer}',
      source_header: 'ETag',
      validator_strength: 'strong',
      representation_scope: 'entire actual 200 response representation',
      invalidated_by: 'any observable change to any emitted data member',
      initial_comparison_basis:
        'current actual emitted GET representation including current temporal state',
      temporal_boundary_before_initial_comparison:
        'reflected in current representation; older validator is stale',
      stale_response: '412 CustomerTransactionalEditStale',
      conservative_rejection:
        'represented changes unrelated to the mutation are stale',
      success_etag: 'absent',
      next_validator:
        'refetch GET /customers/{customer} and use its fresh ETag',
    }) ||
  transactionalCustomerEditEtagSemantics.representation_scope !==
    strongCustomerGetEtagSemantics.representation_scope ||
  transactionalCustomerEditEtagSemantics.invalidated_by !==
    strongCustomerGetEtagSemantics.invalidated_by ||
  !/exact strong .*ETag.*GET \/customers\/\{customer\}.*entire actual GET .*200.* representation.*any observable change to any emitted member.*stale.*412/is.test(
    transactionalCustomerEditIfMatch?.description ?? ''
  ) ||
  !/entire actual GET .*200.* response.*any observable change to any member.*stale.*412.*represented change unrelated to the requested mutation.*successful transactional PUT does not return an .*ETag.*refetch .*GET \/customers\/\{customer\}.*fresh strong .*ETag/is.test(
    transactionalCustomerEditDescription
  ) ||
  !/initial protected .*If-Match.*current actual emitted GET representation.*current temporal state.*temporal boundary crossed before that evaluation.*older validator is stale/is.test(
    transactionalCustomerEditDescription
  ) ||
  !/commit-coupling state revalidation protects persisted representation state and representation-visibility authority state.*operation authority remains valid.*rolls back.*412.*loss of required transactional-edit operation authority.*403.*not an .*If-Match.*stale condition.*wall-clock time alone after the successful initial comparison.*does not independently invalidate commit-coupling state revalidation.*no frozen wall clock is required/is.test(
    transactionalCustomerEditDescription
  ) ||
  !/reduced response does not provide an ETag.*refetch GET \/customers\/\{customer\}.*next conditional validator/is.test(
    transactionalCustomerEdit?.responses?.['200']?.description ?? ''
  )
) {
  errors.push(
    'The transactional customer edit must consume the same full-representation GET validator, return 412 when it is stale, omit a PUT-success ETag, and require a fresh GET for the next validator.'
  )
}

const transactionalEditSemantics =
  transactionalCustomerEdit?.['x-transactional-edit-semantics'] ?? {}
const expectedTransactionalEditSemantics = {
  request_validation: {
    malformed_or_protocol: {
      causes: [
        'malformed_or_unparseable_json',
        'request_syntax_or_protocol_failure',
      ],
      status: 400,
      response: '#/components/responses/BadRequest',
    },
    parsed_structural_or_domain: {
      status: 422,
      response:
        '#/components/responses/CustomerTransactionalEditValidationError',
      structural_errors: {
        request: {
          causes: ['extra_property'],
          field: 'request',
          message: 'The request body is invalid.',
        },
        customer: {
          causes: ['missing', 'null', 'non_object', 'extra_property'],
          field: 'customer',
          message: 'The customer payload is invalid.',
        },
        customer_establishments: {
          causes: ['missing', 'null', 'non_array'],
          field: 'customer_establishments',
          message: 'The assignment collection is invalid.',
        },
        customer_establishments_item: {
          causes: ['null', 'scalar', 'array', 'non_object', 'extra_property'],
          field: 'customer_establishments.<index>',
          message: 'The assignment item is invalid.',
        },
      },
      unknown_property_handling: {
        property_name_disclosed: false,
        dynamic_error_paths: false,
      },
    },
  },
  atomicity: {
    scope: ['customer', 'customer_establishments'],
    commit: 'success-only',
    non_success: 'rollback-complete-edit',
    if_match_commit_coupling: {
      required: true,
      state_revalidation_scope:
        'persisted representation state and representation-visibility authority state',
      concurrency_guarantee:
        'representation-affecting state mutations remain protected through commit',
      concurrent_representation_affecting_state_mutation: {
        mutation_scope:
          'persisted representation state or representation-visibility authority state',
        operation_authorization: 'remains-valid',
        commit: 'prohibited',
        rollback: 'complete-edit',
        status: 412,
        response: '#/components/responses/CustomerTransactionalEditStale',
      },
      wall_clock_only_after_successful_comparison:
        'does not invalidate the comparison or require 412 or rollback',
    },
  },
  authorization_revalidation: {
    scope: 'required transactional-edit operation authority',
    before_mutation: true,
    before_commit: true,
    failure: {
      status: 403,
      response: '#/components/responses/CustomerTransactionalEditForbidden',
      closed: true,
      rollback: 'complete-edit',
      classified_as_if_match_stale: false,
    },
  },
  assignment_eligibility: {
    required: {
      active: true,
      non_deleted: true,
      same_tenant: true,
      caller_authorized: true,
    },
    indistinguishable_invalid_states: [
      'missing',
      'inaccessible',
      'cross_tenant',
      'inactive',
      'deleted',
    ],
    failure: {
      status: 422,
      response:
        '#/components/responses/CustomerTransactionalEditValidationError',
      field: 'customer_establishments.<index>.establishment_id',
      message: 'The selected establishment is invalid.',
      distinguish_states: false,
      disclosure: 'none',
    },
  },
  dependency_conflicts: {
    remove_link_used_by_site: 'rejected',
    failure: {
      status: 409,
      response: '#/components/responses/CustomerTransactionalEditConflict',
      dependent_resource_disclosure: false,
    },
  },
  authorization_precedence: {
    required_authority: {
      customers_update: true,
      tenant_scoped_customers_read: true,
      active_membership: true,
      complete_snapshot_authority: true,
    },
    operation_authorization_before_path_lookup: true,
    unauthorized: {
      path_states: ['existing', 'missing', 'tenant_inaccessible'],
      status: 403,
      response: '#/components/responses/CustomerTransactionalEditForbidden',
      path_existence_lookup: 'prohibited',
      resource_existence_disclosure: 'none',
      indistinguishable: true,
    },
    authorized: {
      path_lookup: 'tenant_scoped',
      indistinguishable_states: ['missing', 'tenant_inaccessible'],
      status: 404,
      response: '#/components/responses/CustomerTransactionalEditNotFound',
      indistinguishable: true,
    },
    state_matrix: [
      { authorized: false, path_state: 'existing', status: 403, lookup: false },
      { authorized: false, path_state: 'missing', status: 403, lookup: false },
      {
        authorized: false,
        path_state: 'tenant_inaccessible',
        status: 403,
        lookup: false,
      },
      {
        authorized: true,
        path_state: 'existing',
        status: 'continue',
        lookup: true,
      },
      { authorized: true, path_state: 'missing', status: 404, lookup: true },
      {
        authorized: true,
        path_state: 'tenant_inaccessible',
        status: 404,
        lookup: true,
      },
    ],
  },
  failure_precedence: {
    ordered_stages: [
      'authentication',
      'operation_authorization',
      'tenant_scoped_customer_lookup',
      'if_match_precondition',
      'request_content_schema_and_domain_validation',
      'dependency_conflicts',
      'mutation',
    ],
    stages: {
      authentication: {
        failure_status: 401,
        response: '#/components/responses/Unauthorized',
      },
      operation_authorization: {
        failure_status: 403,
        response: '#/components/responses/CustomerTransactionalEditForbidden',
        path_customer_lookup_permitted: false,
      },
      tenant_scoped_customer_lookup: {
        missing_status: 404,
        tenant_inaccessible_status: 404,
        response: '#/components/responses/CustomerTransactionalEditNotFound',
        missing_and_tenant_inaccessible_indistinguishable: true,
      },
      if_match_precondition: {
        stale_status: 412,
        response: '#/components/responses/CustomerTransactionalEditStale',
        later_stages_evaluated_when_stale: false,
      },
      request_content_schema_and_domain_validation: {
        malformed_or_unparseable_status: 400,
        malformed_response: '#/components/responses/BadRequest',
        parsed_schema_or_domain_failure_status: 422,
        parsed_failure_response:
          '#/components/responses/CustomerTransactionalEditValidationError',
      },
      dependency_conflicts: {
        failure_status: 409,
        response: '#/components/responses/CustomerTransactionalEditConflict',
      },
      mutation: {
        reached_only_after_prior_stages_pass: true,
      },
    },
    mixed_failure_state_matrix: [
      { case: 'authentication_failure', status: 401 },
      {
        case: 'operation_authorization_failure_any_state',
        status: 403,
        path_customer_lookup: false,
      },
      {
        case: 'authorized_missing_stale_invalid',
        status: 404,
      },
      {
        case: 'authorized_tenant_inaccessible_stale_invalid',
        status: 404,
        same_as: 'authorized_missing_stale_invalid',
      },
      {
        case: 'existing_stale_malformed',
        status: 412,
      },
      {
        case: 'existing_stale_parsed_invalid',
        status: 412,
      },
      {
        case: 'existing_stale_dependency_conflict',
        status: 412,
      },
      {
        case: 'existing_current_malformed',
        status: 400,
      },
      {
        case: 'existing_current_parsed_invalid_dependency_conflict',
        status: 422,
      },
      {
        case: 'existing_current_valid_dependency_conflict',
        status: 409,
      },
      {
        case: 'existing_current_valid_no_dependency_conflict',
        status: 'mutation',
      },
    ],
  },
  contract_runtime_boundary: {
    contract_proof:
      'normative contract cannot weaken while maintained validation passes',
    runtime_proof_owner: 'SecPal/api#1332',
    runtime_obligations: [
      'transaction rollback',
      'authorization revalidation',
      'assignment eligibility',
      'dependency conflicts',
      'request validation routing',
      'authorization-before-lookup',
      'failure precedence',
    ],
  },
  authority_classification: {
    machine_readable_material_groups: [
      'atomicity',
      'authorization_revalidation',
      'assignment_eligibility',
      'dependency_conflicts',
      'request_validation',
      'authorization_precedence',
      'failure_precedence',
    ],
    prose_only_material_invariants: 0,
    guard_false_confidence: 0,
    material_x_extensions_without_executable_authority: 0,
  },
}
if (
  !containsRequiredStructure(
    transactionalEditSemantics,
    expectedTransactionalEditSemantics
  ) ||
  transactionalEditSemantics.authorization_revalidation?.failure?.response !==
    transactionalCustomerEdit?.responses?.['403']?.$ref ||
  transactionalEditSemantics.assignment_eligibility?.failure?.response !==
    transactionalCustomerEdit?.responses?.['422']?.$ref ||
  transactionalEditSemantics.dependency_conflicts?.failure?.response !==
    transactionalCustomerEdit?.responses?.['409']?.$ref ||
  transactionalEditSemantics.request_validation?.malformed_or_protocol
    ?.response !== transactionalCustomerEdit?.responses?.['400']?.$ref ||
  transactionalEditSemantics.request_validation?.parsed_structural_or_domain
    ?.response !== transactionalCustomerEdit?.responses?.['422']?.$ref ||
  transactionalEditSemantics.authorization_precedence?.unauthorized
    ?.response !== transactionalCustomerEdit?.responses?.['403']?.$ref ||
  transactionalEditSemantics.authorization_precedence?.authorized?.response !==
    transactionalCustomerEdit?.responses?.['404']?.$ref ||
  transactionalEditSemantics.failure_precedence?.stages?.authentication
    ?.response !== transactionalCustomerEdit?.responses?.['401']?.$ref ||
  transactionalEditSemantics.failure_precedence?.stages?.operation_authorization
    ?.response !== transactionalCustomerEdit?.responses?.['403']?.$ref ||
  transactionalEditSemantics.failure_precedence?.stages
    ?.tenant_scoped_customer_lookup?.response !==
    transactionalCustomerEdit?.responses?.['404']?.$ref ||
  transactionalEditSemantics.failure_precedence?.stages?.if_match_precondition
    ?.response !== transactionalCustomerEdit?.responses?.['412']?.$ref ||
  transactionalEditSemantics.failure_precedence?.stages
    ?.request_content_schema_and_domain_validation?.malformed_response !==
    transactionalCustomerEdit?.responses?.['400']?.$ref ||
  transactionalEditSemantics.failure_precedence?.stages
    ?.request_content_schema_and_domain_validation?.parsed_failure_response !==
    transactionalCustomerEdit?.responses?.['422']?.$ref ||
  transactionalEditSemantics.failure_precedence?.stages?.dependency_conflicts
    ?.response !== transactionalCustomerEdit?.responses?.['409']?.$ref
) {
  errors.push(
    'Transactional customer edit machine-readable transactional semantics must exactly preserve closed extra-property 422 routing, structural 400/422 routing, deterministic failure precedence, atomic success-only commit and rollback, authorization revalidation with closed 403, neutral assignment eligibility with dedicated field-level 422, any-Site dependency conflicts with dedicated 409, authorization before path lookup, the contract/runtime boundary, PROSE_ONLY_MATERIAL_INVARIANTS=0, material extension executable authority, and guard false-confidence=0.'
  )
}

const aggregateGetAuthorization =
  customerGet?.['x-aggregate-etag-authorization-examples'] ?? {}
const transactionalPutAuthorization =
  transactionalCustomerEdit?.['x-authorization-examples'] ?? {}
const acceptedAggregateGet = aggregateGetAuthorization.accepted?.[0]
const rejectedAggregateGet = aggregateGetAuthorization.rejected?.[0]
const acceptedTransactionalPut = transactionalPutAuthorization.accepted?.[0]
const rejectedTransactionalPut = transactionalPutAuthorization.rejected?.[0]
if (
  acceptedAggregateGet?.active_membership !== true ||
  acceptedAggregateGet?.tenant_scope !== true ||
  acceptedAggregateGet?.complete_assignment_visibility !== true ||
  acceptedAggregateGet?.aggregate_etag !== true ||
  rejectedAggregateGet?.site_assignment_only !== true ||
  rejectedAggregateGet?.complete_assignment_visibility !== false ||
  rejectedAggregateGet?.aggregate_etag !== false ||
  acceptedTransactionalPut?.active_membership !== true ||
  acceptedTransactionalPut?.tenant_scope !== true ||
  acceptedTransactionalPut?.customers_update !== true ||
  acceptedTransactionalPut?.customers_read !== true ||
  acceptedTransactionalPut?.complete_assignment_visibility !== true ||
  rejectedTransactionalPut?.site_assignment_only !== true ||
  rejectedTransactionalPut?.complete_assignment_visibility !== false ||
  rejectedTransactionalPut?.status !== 403 ||
  !/aggregate ETag.*only.*customers\.read.*with effective Tenant scope.*complete customer-establishment collection/is.test(
    customerGet?.description ?? ''
  ) ||
  !/requires `customers\.update`, `customers\.read` with effective Tenant scope/is.test(
    transactionalCustomerEditDescription
  ) ||
  !/callers limited to a filtered or Site-scoped representation receive \*\*403\*\*/is.test(
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
    pattern: /^request$/,
    message: 'The request body is invalid.',
  },
  {
    pattern: /^customer$/,
    message: 'The customer payload is invalid.',
  },
  {
    pattern:
      /^customer\.(vat_id|name|billing_address(?:\.(?:street|city|postal_code|country|latitude|longitude))?|is_active)$/,
    message: 'The customer field is invalid.',
  },
  {
    pattern: /^customer_establishments$/,
    message: 'The assignment collection is invalid.',
  },
  {
    pattern: /^customer_establishments$/,
    message: 'Each establishment may be assigned at most once.',
  },
  {
    pattern: /^customer_establishments\.[0-9]+$/,
    message: 'The assignment item is invalid.',
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
    return (
      Array.isArray(messages) &&
      messages.length === 1 &&
      transactionalValidationErrorRules.some(
        ({ pattern, message }) => pattern.test(field) && messages[0] === message
      )
    )
  })
}

function acceptsTransactionalValidationEvidence(example) {
  if (!acceptsTransactionalValidationProblem(example?.value)) return false

  const categoryGroups = {
    'extra-property-request': 'request',
    'extra-property-customer': 'customer',
    'extra-property-assignment-item': 'customer_establishments_item',
    'extra-property-unrelated-field': 'request',
    'structural-customer': 'customer',
    'structural-collection': 'customer_establishments',
    'structural-item': 'customer_establishments_item',
  }
  const groupName = categoryGroups[example?.category]
  if (!groupName) return true

  const structural =
    transactionalEditSemantics.request_validation?.parsed_structural_or_domain
      ?.structural_errors?.[groupName]
  return (
    structural?.causes?.includes(example?.cause) === true &&
    JSON.stringify(example.value.errors) ===
      JSON.stringify({
        [structural.field.replace('<index>', '0')]: [structural.message],
      })
  )
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
  '^request$':
    '#/components/schemas/CustomerTransactionalEditInvalidRequestBodyErrors',
  '^customer$':
    '#/components/schemas/CustomerTransactionalEditInvalidCustomerPayloadErrors',
  '^customer\\.(vat_id|name|billing_address(?:\\.(?:street|city|postal_code|country|latitude|longitude))?|is_active)$':
    '#/components/schemas/CustomerTransactionalEditCustomerFieldErrors',
  '^customer_establishments$':
    '#/components/schemas/CustomerTransactionalEditAssignmentCollectionErrors',
  '^customer_establishments\\.[0-9]+$':
    '#/components/schemas/CustomerTransactionalEditInvalidAssignmentItemErrors',
  '^customer_establishments\\.[0-9]+\\.establishment_id$':
    '#/components/schemas/CustomerTransactionalEditInvalidEstablishmentErrors',
  '^customer_establishments\\.[0-9]+\\.customer_id$':
    '#/components/schemas/CustomerTransactionalEditInvalidCustomerErrors',
  '^customer_establishments\\.[0-9]+\\.(contact_name|phone|email|comments)$':
    '#/components/schemas/CustomerTransactionalEditInvalidContactFieldErrors',
}
const transactionalValidationFieldSchemas = {
  CustomerTransactionalEditInvalidRequestBodyErrors:
    'The request body is invalid.',
  CustomerTransactionalEditInvalidCustomerPayloadErrors:
    'The customer payload is invalid.',
  CustomerTransactionalEditCustomerFieldErrors:
    'The customer field is invalid.',
  CustomerTransactionalEditDuplicateTargetErrors:
    'Each establishment may be assigned at most once.',
  CustomerTransactionalEditInvalidAssignmentCollectionErrors:
    'The assignment collection is invalid.',
  CustomerTransactionalEditInvalidAssignmentItemErrors:
    'The assignment item is invalid.',
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
  JSON.stringify(
    schemas.CustomerTransactionalEditAssignmentCollectionErrors?.oneOf
  ) !==
    JSON.stringify([
      {
        $ref: '#/components/schemas/CustomerTransactionalEditDuplicateTargetErrors',
      },
      {
        $ref: '#/components/schemas/CustomerTransactionalEditInvalidAssignmentCollectionErrors',
      },
    ]) ||
  transactionalValidationExamples.accepted?.length !== 21 ||
  transactionalValidationExamples.accepted.some(
    (example) => !acceptsTransactionalValidationEvidence(example)
  ) ||
  JSON.stringify(
    transactionalValidationExamples.accepted
      .slice(0, 13)
      .map(({ category, cause }) => ({ category, cause }))
  ) !==
    JSON.stringify([
      { category: 'extra-property-request', cause: 'extra_property' },
      { category: 'extra-property-customer', cause: 'extra_property' },
      {
        category: 'extra-property-assignment-item',
        cause: 'extra_property',
      },
      { category: 'structural-customer', cause: 'missing' },
      { category: 'structural-customer', cause: 'null' },
      { category: 'structural-customer', cause: 'non_object' },
      { category: 'structural-collection', cause: 'missing' },
      { category: 'structural-collection', cause: 'null' },
      { category: 'structural-collection', cause: 'non_array' },
      { category: 'structural-item', cause: 'null' },
      { category: 'structural-item', cause: 'scalar' },
      { category: 'structural-item', cause: 'array' },
      { category: 'structural-item', cause: 'non_object' },
    ]) ||
  JSON.stringify(
    transactionalValidationExamples.accepted.flatMap((example) =>
      Object.keys(example?.value?.errors ?? {})
    )
  ) !==
    JSON.stringify([
      'request',
      'customer',
      'customer_establishments.0',
      'customer',
      'customer',
      'customer',
      'customer_establishments',
      'customer_establishments',
      'customer_establishments',
      'customer_establishments.0',
      'customer_establishments.0',
      'customer_establishments.0',
      'customer_establishments.0',
      'customer.name',
      'customer_establishments',
      'customer_establishments.0.establishment_id',
      'customer_establishments.0.customer_id',
      'customer_establishments.0.contact_name',
      'customer_establishments.0.phone',
      'customer_establishments.0.email',
      'customer_establishments.0.comments',
    ]) ||
  transactionalValidationExamples.rejected?.length !== 15 ||
  transactionalValidationExamples.rejected.some((example) =>
    acceptsTransactionalValidationEvidence(example)
  ) ||
  JSON.stringify(
    transactionalValidationExamples.rejected.map((example) => example.category)
  ) !==
    JSON.stringify([
      'top-level-property',
      'unexpected-error-key',
      'arbitrary-string',
      'cross-tenant-detail',
      'resource-existence-hint',
      'unexpected-assignment-field',
      'contact-arbitrary-string',
      'contact-tenant-disclosure',
      'contact-resource-disclosure',
      'contact-database-internal-text',
      'extra-property-root-disclosure',
      'extra-property-customer-disclosure',
      'extra-property-item-disclosure',
      'extra-property-dynamic-path',
      'extra-property-unrelated-field',
    ])
) {
  errors.push(
    'Transactional customer edit 422 must use its dedicated closed validation schema, map forbidden extra properties to fixed neutral request, customer, or assignment-item errors without disclosing names, accept only customer master-data and fixed transactional field errors, and reject arbitrary or tenant-disclosing keys, strings, details, hints, and properties.'
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
  JSON.stringify(transactionalNotFoundSchema.properties?.message?.enum) !==
    JSON.stringify(['Resource not found']) ||
  JSON.stringify(transactionalNotFoundSchema.properties?.code?.enum) !==
    JSON.stringify(['NOT_FOUND']) ||
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
  /malformed or unparseable JSON.*400.*syntactically valid JSON.*422/is,
  /complete desired.*customer_establishments.*collection/is,
  /one transaction/i,
  /absent existing pair is deleted/i,
  /each `establishment_id` may occur at most once/i,
  /duplicate establishment targets.*422/is,
  /missing, inaccessible, cross-tenant, inactive, and deleted assignment targets.*same information-poor.*422/is,
  /stale.*412/is,
  /authorization.*revalidated inside the transaction.*before commit/is,
  /stale authorization.*403/is,
  /non-success response rolls back the complete edit/is,
  /Site.*409.*without identifying the dependent resource/is,
  /before any path-customer lookup.*unauthorized existing, missing, and tenant-inaccessible IDs.*403.*without a path-existence lookup/is,
  /explicit permission and applicable effective membership scope/i,
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

for (const schemaName of ['CustomerLookup']) {
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
