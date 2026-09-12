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

function resolveParameter(candidate, parameter) {
  const prefix = '#/components/parameters/'
  if (parameter?.$ref?.startsWith(prefix)) {
    return candidate.components.parameters[parameter.$ref.slice(prefix.length)]
  }

  return parameter
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

  return (
    schema.properties.message?.enum?.includes(value.message) === true &&
    schema.properties.code?.enum?.includes(value.code) === true
  )
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

function matchesSchemaPattern(schema, value) {
  return (
    schema?.type === 'string' &&
    typeof value === 'string' &&
    new RegExp(schema.pattern, 'u').test(value)
  )
}

const transactionalValidationErrorRules = [
  [/^request$/, 'The request body is invalid.'],
  [/^customer$/, 'The customer payload is invalid.'],
  [
    /^customer\.(legal_entity_id|vat_id|name|billing_address(?:\.(?:street|city|postal_code|country|latitude|longitude))?|is_active)$/,
    'The customer field is invalid.',
  ],
  [/^customer_establishments$/, 'The assignment collection is invalid.'],
  [
    /^customer_establishments$/,
    'Each establishment may be assigned at most once.',
  ],
  [/^customer_establishments\.[0-9]+$/, 'The assignment item is invalid.'],
  [
    /^customer_establishments\.[0-9]+\.establishment_id$/,
    'The selected establishment is invalid.',
  ],
  [
    /^customer_establishments\.[0-9]+\.customer_id$/,
    'The selected customer is invalid.',
  ],
  [
    /^customer_establishments\.[0-9]+\.(contact_name|phone|email|comments)$/,
    'The contact field is invalid.',
  ],
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
        ([pattern, message]) => pattern.test(field) && messages[0] === message
      )
    )
  })
}

function acceptsTransactionalValidationEvidence(example, semantics) {
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
    semantics.request_validation?.parsed_structural_or_domain
      ?.structural_errors?.[groupName]
  return (
    structural?.causes?.includes(example?.cause) === true &&
    JSON.stringify(example.value.errors) ===
      JSON.stringify({
        [structural.field.replace('<index>', '0')]: [structural.message],
      })
  )
}

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

test('defines one transactional customer edit aggregate contract', () => {
  const operation = paths['/customers/{customer}/transactional-edit']?.put
  const customerGet = paths['/customers/{customer}']?.get

  assert.ok(operation, 'transactional customer edit operation must exist')
  assert.equal(operation.operationId, 'transactionallyEditCustomer')
  assert.equal(
    operation.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/CustomerTransactionalEditRequest'
  )
  assert.equal(
    operation.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/CustomerTransactionalEditResponse'
  )
  assert.equal(
    operation.parameters.find((parameter) => parameter.name === 'If-Match')
      ?.required,
    true
  )
  assert.deepEqual(
    Object.keys(schemas.CustomerTransactionalEditRequest.properties),
    ['customer', 'customer_establishments']
  )
  assert.deepEqual(schemas.CustomerTransactionalEditRequest.required, [
    'customer',
    'customer_establishments',
  ])
  assert.equal(
    schemas.CustomerTransactionalEditRequest.properties.customer.$ref,
    '#/components/schemas/CustomerUpdateRequest'
  )
  assert.equal(
    schemas.CustomerTransactionalEditRequest.properties.customer_establishments
      .items.$ref,
    '#/components/schemas/CustomerTransactionalEditEstablishmentRequest'
  )
  const transactionalItem =
    schemas.CustomerTransactionalEditEstablishmentRequest
  assert.deepEqual(transactionalItem.allOf, [
    { $ref: '#/components/schemas/CustomerEstablishmentCreateRequest' },
  ])
  assert.deepEqual(transactionalItem['x-contact-field-semantics'], {
    fields: ['contact_name', 'phone', 'email', 'comments'],
    membership: {
      present_existing_pair: 'retain',
      present_new_pair: 'create',
      absent_existing_pair: 'delete subject to conflict rules',
    },
    retained_pair: {
      omitted: 'preserve stored value',
      null: 'clear to null',
      value: 'replace stored value',
    },
    new_pair: {
      omitted: 'initialize null',
      null: 'initialize null',
      value: 'initialize supplied value',
    },
  })
  for (const field of ['contact_name', 'phone', 'email', 'comments']) {
    const retained = transactionalItem[
      'x-contact-field-examples'
    ].retained.find((example) => example.field === field)
    const created = transactionalItem['x-contact-field-examples'].new.find(
      (example) => example.field === field
    )
    assert.equal(retained.omitted_result, retained.stored_value)
    assert.equal(retained.null_result, null)
    assert.equal(retained.value_result, retained.value)
    assert.equal(created.omitted_result, null)
    assert.equal(created.null_result, null)
    assert.equal(created.value_result, created.value)
  }
  assert.deepEqual(
    schemas.CustomerTransactionalEditRequest.properties.customer_establishments[
      'x-unique-by'
    ],
    ['establishment_id']
  )
  const assignmentCollection =
    schemas.CustomerTransactionalEditRequest.properties.customer_establishments
  assert.equal(assignmentCollection.uniqueItems, true)
  assert.deepEqual(assignmentCollection['x-unique-by-validation'], {
    validator: 'secpal-keyed-uniqueness',
    authority: 'SecPal semantic validation and server enforcement',
    json_schema_scope: 'uniqueItems compares complete array items only',
    violation: {
      status: 422,
      field: 'customer_establishments',
      message: 'Each establishment may be assigned at most once.',
    },
  })
  const collectionUniqueness =
    schemas.CustomerTransactionalEditRequest.properties.customer_establishments[
      'x-uniqueness-examples'
    ]
  assert.notEqual(
    collectionUniqueness.accepted[0].value[0].establishment_id,
    collectionUniqueness.accepted[0].value[1].establishment_id
  )
  assert.equal(
    collectionUniqueness.accepted[0].value[0].email,
    collectionUniqueness.accepted[0].value[1].email
  )
  assert.equal(
    satisfiesUniqueBy(
      assignmentCollection,
      collectionUniqueness.accepted[0].value
    ),
    true
  )
  assert.deepEqual(
    collectionUniqueness.rejected.map((example) => example.category),
    [
      'exact-duplicate',
      'different-contact-name',
      'different-phone',
      'different-email',
      'different-comments',
    ]
  )
  for (const example of collectionUniqueness.rejected) {
    assert.equal(satisfiesUniqueBy(assignmentCollection, example.value), false)
    assert.equal(example.status, 422)
    assert.equal(example.field, 'customer_establishments')
    assert.equal(
      example.message,
      'Each establishment may be assigned at most once.'
    )
  }
  assert.deepEqual(
    schemas.CustomerTransactionalEditResult.allOf.map((schema) => schema.$ref),
    [
      '#/components/schemas/Customer',
      '#/components/schemas/CustomerTransactionalEditRequiredRelationships',
    ]
  )
  assert.deepEqual(
    schemas.CustomerTransactionalEditRequiredRelationships.required,
    ['customer_establishments']
  )
  assert.equal(
    schemas.CustomerTransactionalEditRequiredRelationships.properties
      .customer_establishments.$ref,
    '#/components/schemas/CustomerEstablishmentRelationship'
  )
  assert.deepEqual(
    Object.entries(
      schemas.CustomerTransactionalEditRequiredRelationships.properties
    ).filter(([, schema]) => schema === false),
    [
      ['sites', false],
      ['assignments', false],
      ['sites_count', false],
    ]
  )
  const projectionExamples =
    schemas.CustomerTransactionalEditRequiredRelationships[
      'x-validation-examples'
    ]
  assert.deepEqual(Object.keys(projectionExamples.accepted[0].value), [
    'customer_establishments',
  ])
  assert.deepEqual(
    projectionExamples.rejected.map((example) =>
      Object.keys(example.value).find(
        (property) => property !== 'customer_establishments'
      )
    ),
    ['sites', 'assignments', 'sites_count']
  )
  const getAuthorization =
    customerGet['x-aggregate-etag-authorization-examples']
  assert.equal(
    getAuthorization.accepted[0].complete_assignment_visibility,
    true
  )
  assert.equal(getAuthorization.accepted[0].aggregate_etag, true)
  assert.equal(getAuthorization.rejected[0].site_assignment_only, true)
  assert.equal(getAuthorization.rejected[0].aggregate_etag, false)
  assert.deepEqual(customerGet['x-strong-etag-semantics'], {
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
  })
  assert.deepEqual(operation['x-etag-precondition-semantics'], {
    source_operation: 'GET /customers/{customer}',
    source_header: 'ETag',
    validator_strength: 'strong',
    representation_scope: 'entire actual 200 response representation',
    invalidated_by: 'any observable change to any emitted data member',
    stale_response: '412 CustomerTransactionalEditStale',
    conservative_rejection:
      'represented changes unrelated to the mutation are stale',
    success_etag: 'absent',
    next_validator: 'refetch GET /customers/{customer} and use its fresh ETag',
  })
  const strongEntityTag = schemas.StrongEntityTag
  const getEtagSchema = customerGet.responses['200'].headers.ETag.schema
  const ifMatchSchema = operation.parameters.find(
    (parameter) => parameter.name === 'If-Match'
  ).schema
  assert.deepEqual(getEtagSchema, {
    $ref: '#/components/schemas/StrongEntityTag',
  })
  assert.deepEqual(ifMatchSchema, {
    $ref: '#/components/schemas/StrongEntityTag',
  })
  assert.deepEqual(strongEntityTag, {
    type: 'string',
    description:
      'Canonical strong HTTP entity-tag syntax: a quoted opaque tag without the weak `W/` prefix or control characters.',
    pattern: '^"[!#-~\\u0080-\\u00FF]*"$',
    example: '"customer-edit-8f14e45fceea167a5a36dedd4bea2543"',
  })
  assert.equal(matchesSchemaPattern(strongEntityTag, '"opaque-tag"'), true)
  for (const invalid of [
    'W/"opaque-tag"',
    'opaque-tag',
    '"unterminated',
    '"bad\u0001tag"',
  ]) {
    assert.equal(matchesSchemaPattern(strongEntityTag, invalid), false)
  }
  assert.equal(operation.responses['200'].headers?.ETag, undefined)
  assert.deepEqual(operation['x-transactional-edit-semantics'], {
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
    },
    authorization_revalidation: {
      before_mutation: true,
      before_commit: true,
      failure: {
        status: 403,
        response: '#/components/responses/CustomerTransactionalEditForbidden',
        closed: true,
      },
    },
    assignment_eligibility: {
      required: {
        active: true,
        non_deleted: true,
        same_tenant: true,
        resulting_legal_entity: true,
        caller_authorized: true,
      },
      indistinguishable_invalid_states: [
        'missing',
        'inaccessible',
        'cross_tenant',
        'wrong_legal_entity',
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
      change_legal_entity_while_any_site_exists: {
        condition: {
          legal_entity_changes: true,
          remaining_customer_site_count: 'greater_than_zero',
        },
        result: 'rejected',
        no_site_category_bypass: true,
      },
      legal_entity_site_state_matrix: [
        {
          legal_entity_changes: false,
          remaining_customer_site_count: 'greater_than_zero',
          result: 'no-reassignment-conflict',
        },
        {
          legal_entity_changes: true,
          remaining_customer_site_count: 0,
          result: 'no-site-conflict',
        },
        {
          legal_entity_changes: true,
          remaining_customer_site_count: 1,
          result: 'rejected',
        },
        {
          legal_entity_changes: true,
          remaining_customer_site_count: 'greater_than_one',
          result: 'rejected',
        },
      ],
      failure: {
        status: 409,
        response: '#/components/responses/CustomerTransactionalEditConflict',
        dependent_resource_disclosure: false,
      },
    },
    authorization_precedence: {
      required_authority: {
        customers_update: true,
        unrestricted_customers_read: true,
        organizational_scopes: false,
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
        {
          authorized: false,
          path_state: 'existing',
          status: 403,
          lookup: false,
        },
        {
          authorized: false,
          path_state: 'missing',
          status: 403,
          lookup: false,
        },
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
  })
  const putAuthorization = operation['x-authorization-examples']
  assert.equal(
    putAuthorization.accepted[0].complete_assignment_visibility,
    true
  )
  assert.equal(putAuthorization.rejected[0].site_assignment_only, true)
  assert.equal(putAuthorization.rejected[0].status, 403)
  const authorizationDeniedResponse =
    contract.components.responses.CustomerTransactionalEditForbidden
  const authorizationDeniedSchema =
    schemas.CustomerTransactionalEditForbiddenError
  const authorizationDeniedMedia =
    authorizationDeniedResponse.content['application/json']
  assert.equal(
    authorizationDeniedMedia.schema.$ref,
    '#/components/schemas/CustomerTransactionalEditForbiddenError'
  )
  assert.deepEqual(authorizationDeniedMedia.example, {
    message: 'Insufficient permissions',
    code: 'FORBIDDEN',
  })
  assert.equal(
    acceptsFixedClosedError(
      authorizationDeniedSchema,
      authorizationDeniedSchema['x-validation-examples'].accepted[0].value
    ),
    true
  )
  for (const rejected of authorizationDeniedSchema['x-validation-examples']
    .rejected) {
    assert.equal(
      acceptsFixedClosedError(authorizationDeniedSchema, rejected.value),
      false
    )
  }
  const customerMismatch =
    schemas.CustomerTransactionalEditRequest['x-validation-examples']
      .rejected[0]
  assert.notEqual(
    customerMismatch.path_customer_id,
    customerMismatch.value.customer_establishments[0].customer_id
  )
  assert.equal(customerMismatch.status, 422)
  assert.deepEqual(
    ['403', '404', '409', '412', '422'].map(
      (status) => operation.responses[status].$ref
    ),
    [
      '#/components/responses/CustomerTransactionalEditForbidden',
      '#/components/responses/CustomerTransactionalEditNotFound',
      '#/components/responses/CustomerTransactionalEditConflict',
      '#/components/responses/CustomerTransactionalEditStale',
      '#/components/responses/CustomerTransactionalEditValidationError',
    ]
  )
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
    const response = contract.components.responses[responseName]
    assert.equal(
      response.content['application/json'].schema.$ref,
      `#/components/schemas/${schemaName}`
    )
    assert.deepEqual(response.content['application/json'].example, {
      message,
      code,
    })
    assert.deepEqual(schemas[schemaName].properties.message.enum, [message])
    assert.deepEqual(schemas[schemaName].properties.code.enum, [code])
    assert.equal(
      acceptsFixedClosedError(schemas[schemaName], { message, code }),
      true
    )
  }
  const mismatchResponse =
    contract.components.responses.CustomerTransactionalEditValidationError
      .content['application/json'].examples.customerMismatch.value
  assert.deepEqual(
    mismatchResponse.errors['customer_establishments.0.customer_id'],
    ['The selected customer is invalid.']
  )
  const validationResponse =
    contract.components.responses.CustomerTransactionalEditValidationError
  assert.equal(
    validationResponse.content['application/json'].schema.$ref,
    '#/components/schemas/CustomerTransactionalEditValidationProblem'
  )
  const validationExamples =
    schemas.CustomerTransactionalEditValidationProblem['x-validation-examples']
  assert.equal(validationExamples.accepted.length, 21)
  assert.deepEqual(
    validationExamples.accepted
      .slice(0, 13)
      .map(({ category, cause }) => ({ category, cause })),
    [
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
    ]
  )
  assert.equal(
    operation['x-transactional-edit-semantics'].request_validation
      .malformed_or_protocol.status,
    400
  )
  assert.equal(
    operation.responses['400'].$ref,
    '#/components/responses/BadRequest'
  )
  for (const example of validationExamples.accepted) {
    assert.equal(
      acceptsTransactionalValidationEvidence(
        example,
        operation['x-transactional-edit-semantics']
      ),
      true
    )
  }
  for (const example of validationExamples.rejected) {
    assert.equal(
      acceptsTransactionalValidationEvidence(
        example,
        operation['x-transactional-edit-semantics']
      ),
      false
    )
  }
  assert.deepEqual(
    validationExamples.rejected.map((example) => example.category),
    [
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
      'extra-property-root-disclosure',
      'extra-property-customer-disclosure',
      'extra-property-item-disclosure',
      'extra-property-dynamic-path',
      'extra-property-unrelated-field',
    ]
  )
  const notFoundResponse =
    contract.components.responses.CustomerTransactionalEditNotFound
  const notFoundSchema = schemas.CustomerTransactionalEditNotFoundError
  assert.equal(
    notFoundResponse.content['application/json'].schema.$ref,
    '#/components/schemas/CustomerTransactionalEditNotFoundError'
  )
  assert.deepEqual(notFoundResponse.content['application/json'].example, {
    message: 'Resource not found',
    code: 'NOT_FOUND',
  })
  assert.deepEqual(notFoundSchema.properties.message.enum, [
    'Resource not found',
  ])
  assert.deepEqual(notFoundSchema.properties.code.enum, ['NOT_FOUND'])
  const notFoundExamples = notFoundSchema['x-validation-examples']
  assert.deepEqual(
    notFoundExamples.accepted[0].value,
    notFoundExamples.accepted[1].value
  )
  for (const example of notFoundExamples.accepted) {
    assert.equal(acceptsFixedClosedError(notFoundSchema, example.value), true)
  }
  for (const example of notFoundExamples.rejected) {
    assert.equal(acceptsFixedClosedError(notFoundSchema, example.value), false)
  }
})

test('guard retains the aggregate edit baseline', () => {
  const candidate = structuredClone(contract)
  const operation =
    candidate.paths['/customers/{customer}/transactional-edit'].put
  operation.parameters = operation.parameters.filter(
    (parameter) => parameter.name !== 'If-Match'
  )
  operation.description =
    'Requires `customers.update`; unscoped callers require `customers.update`. OU scopes do not grant access to customer or site domain writes; callers with any organizational scopes receive 403.'
  operation.responses['422'] = {
    $ref: '#/components/responses/ValidationError',
  }

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /same full-representation GET validator/)
  assert.match(result.stderr, /tenant-safe failures/)
  assert.match(result.stderr, /complete authentication.*responses/)
})

test('guard rejects weakened transactional customer edit semantics', async (t) => {
  const mutations = [
    {
      name: 'F1 complete-snapshot authorization',
      expected: /complete-snapshot authorization/,
      mutate(candidate) {
        delete candidate.paths['/customers/{customer}'].get[
          'x-aggregate-etag-authorization-examples'
        ]
      },
    },
    {
      name: 'F1 strong ETag rejects subset-only coverage',
      expected: /entire GET representation/,
      mutate(candidate) {
        candidate.paths['/customers/{customer}'].get[
          'x-strong-etag-semantics'
        ].representation_scope =
          'customer master data and customer_establishments only'
      },
    },
    {
      name: 'F1 PUT rejects narrowed validator scope',
      expected: /same full-representation GET validator/,
      mutate(candidate) {
        candidate.paths['/customers/{customer}/transactional-edit'].put[
          'x-etag-precondition-semantics'
        ].representation_scope =
          'customer master data and customer_establishments only'
      },
    },
    {
      name: 'F1 PUT rejects a separate transactional aggregate ETag',
      expected: /same full-representation GET validator/,
      mutate(candidate) {
        candidate.paths['/customers/{customer}/transactional-edit'].put[
          'x-etag-precondition-semantics'
        ].source_operation = 'transactional aggregate validator'
      },
    },
    {
      name: 'F1 PUT success rejects a reintroduced ETag',
      expected: /same full-representation GET validator/,
      mutate(candidate) {
        candidate.paths[
          '/customers/{customer}/transactional-edit'
        ].put.responses['200'].headers = {
          ETag: { schema: { type: 'string' } },
        }
      },
    },
    {
      name: 'F1 PUT rejects reduced response as the next GET validator',
      expected: /same full-representation GET validator/,
      mutate(candidate) {
        candidate.paths['/customers/{customer}/transactional-edit'].put[
          'x-etag-precondition-semantics'
        ].next_validator =
          'use the reduced PUT 200 response ETag as the next GET validator'
      },
    },
    {
      name: 'F1 PUT requires fresh GET refetch semantics',
      expected: /same full-representation GET validator/,
      mutate(candidate) {
        delete candidate.paths['/customers/{customer}/transactional-edit'].put[
          'x-etag-precondition-semantics'
        ].next_validator
      },
    },
    {
      name: 'F1 GET and PUT scopes must agree',
      expected: /same full-representation GET validator/,
      mutate(candidate) {
        candidate.paths['/customers/{customer}'].get[
          'x-strong-etag-semantics'
        ].representation_scope = 'full customer aggregate representation'
      },
    },
    {
      name: 'ETag rejects an unrestricted GET header string',
      expected: /canonical strong entity-tag schema/,
      mutate(candidate) {
        candidate.paths['/customers/{customer}'].get.responses[
          '200'
        ].headers.ETag.schema = { type: 'string' }
      },
    },
    {
      name: 'ETag rejects an unrestricted PUT If-Match string',
      expected: /canonical strong entity-tag schema/,
      mutate(candidate) {
        candidate.paths[
          '/customers/{customer}/transactional-edit'
        ].put.parameters.find(
          (parameter) => parameter.name === 'If-Match'
        ).schema = {
          type: 'string',
        }
      },
    },
    {
      name: 'ETag rejects unrestricted behavior',
      expected: /canonical strong entity-tag schema/,
      mutate(candidate) {
        candidate.components.schemas.StrongEntityTag.pattern = '^.*$'
      },
    },
    {
      name: 'ETag rejects targeted accepted-weak widening',
      expected: /canonical strong entity-tag schema/,
      mutate(candidate) {
        candidate.components.schemas.StrongEntityTag.pattern =
          '^(?:"[!#-~\\u0080-\\u00FF]*"|W/"accepted-weak")$'
      },
    },
    {
      name: 'ETag rejects generic weak entity-tag acceptance',
      expected: /canonical strong entity-tag schema/,
      mutate(candidate) {
        candidate.components.schemas.StrongEntityTag.pattern =
          '^(?:W/)?"[!#-~\\u0080-\\u00FF]*"$'
      },
    },
    {
      name: 'ETag rejects unquoted acceptance',
      expected: /canonical strong entity-tag schema/,
      mutate(candidate) {
        candidate.components.schemas.StrongEntityTag.pattern =
          '^(?:"[!#-~\\u0080-\\u00FF]*"|unquoted)$'
      },
    },
    {
      name: 'ETag rejects unterminated acceptance',
      expected: /canonical strong entity-tag schema/,
      mutate(candidate) {
        candidate.components.schemas.StrongEntityTag.pattern =
          '^(?:"[!#-~\\u0080-\\u00FF]*"|"unterminated)$'
      },
    },
    {
      name: 'ETag rejects control-character acceptance',
      expected: /canonical strong entity-tag schema/,
      mutate(candidate) {
        candidate.components.schemas.StrongEntityTag.pattern = '^"[\\s\\S]*"$'
      },
    },
    {
      name: 'ETag rejects divergent GET and PUT schema authorities',
      expected: /canonical strong entity-tag schema/,
      mutate(candidate) {
        candidate.paths[
          '/customers/{customer}/transactional-edit'
        ].put.parameters.find(
          (parameter) => parameter.name === 'If-Match'
        ).schema = {
          $ref: '#/components/schemas/StringFilter',
        }
      },
    },
    ...[
      {
        name: 'atomic partial commit',
        mutate(semantics) {
          semantics.atomicity.commit = 'partial'
        },
      },
      {
        name: 'atomic unspecified commit',
        mutate(semantics) {
          delete semantics.atomicity.commit
        },
      },
      {
        name: 'atomic 4xx commit',
        mutate(semantics) {
          semantics.atomicity.commit = '4xx-commits'
        },
      },
      {
        name: 'atomic 5xx commit',
        mutate(semantics) {
          semantics.atomicity.commit = '5xx-commits'
        },
      },
      {
        name: 'atomic scope excludes relationships',
        mutate(semantics) {
          semantics.atomicity.scope = ['customer']
        },
      },
      {
        name: 'authorization before-mutation revalidation false',
        mutate(semantics) {
          semantics.authorization_revalidation.before_mutation = false
        },
      },
      {
        name: 'authorization before-commit revalidation false',
        mutate(semantics) {
          semantics.authorization_revalidation.before_commit = false
        },
      },
      {
        name: 'authorization revalidation removed',
        mutate(semantics) {
          delete semantics.authorization_revalidation
        },
      },
      {
        name: 'authorization failure ceases to be 403',
        mutate(semantics) {
          semantics.authorization_revalidation.failure.status = 401
        },
      },
      {
        name: 'authorization failure ceases to be closed',
        mutate(semantics) {
          semantics.authorization_revalidation.failure.closed = false
        },
      },
      {
        name: 'authorization failure loses dedicated response',
        mutate(semantics) {
          semantics.authorization_revalidation.failure.response =
            '#/components/responses/Forbidden'
        },
      },
      ...[
        'active',
        'non_deleted',
        'same_tenant',
        'resulting_legal_entity',
        'caller_authorized',
      ].flatMap((constraint) => [
        {
          name: `eligibility ${constraint} false`,
          mutate(semantics) {
            semantics.assignment_eligibility.required[constraint] = false
          },
        },
        {
          name: `eligibility ${constraint} absent`,
          mutate(semantics) {
            delete semantics.assignment_eligibility.required[constraint]
          },
        },
      ]),
      ...[
        'missing',
        'inaccessible',
        'cross_tenant',
        'wrong_legal_entity',
        'inactive',
        'deleted',
      ].map((state) => ({
        name: `eligibility invalid state ${state} removed`,
        mutate(semantics) {
          semantics.assignment_eligibility.indistinguishable_invalid_states =
            semantics.assignment_eligibility.indistinguishable_invalid_states.filter(
              (candidate) => candidate !== state
            )
        },
      })),
      {
        name: 'eligibility invalid state accepted',
        mutate(semantics) {
          semantics.assignment_eligibility.accepted_states = ['inactive']
        },
      },
      {
        name: 'eligibility invalid states distinguished',
        mutate(semantics) {
          semantics.assignment_eligibility.failure.distinguish_states = true
        },
      },
      {
        name: 'eligibility failure permits disclosure',
        mutate(semantics) {
          semantics.assignment_eligibility.failure.disclosure =
            'tenant and resource existence'
        },
      },
      {
        name: 'eligibility failure moved from establishment field',
        mutate(semantics) {
          semantics.assignment_eligibility.failure.field =
            'customer_establishments.<index>.customer_id'
        },
      },
      {
        name: 'eligibility failure ceases to be neutral 422',
        mutate(semantics) {
          semantics.assignment_eligibility.failure.status = 409
        },
      },
      {
        name: 'eligibility failure loses dedicated response',
        mutate(semantics) {
          semantics.assignment_eligibility.failure.response =
            '#/components/responses/ValidationError'
        },
      },
      {
        name: 'Site-linked removal becomes allowed',
        mutate(semantics) {
          semantics.dependency_conflicts.remove_link_used_by_site = 'allowed'
        },
      },
      {
        name: 'Site-linked removal becomes deletable',
        mutate(semantics) {
          semantics.dependency_conflicts.remove_link_used_by_site =
            'delete dependent Site'
        },
      },
      {
        name: 'Legal Entity reassignment conflict becomes allowed',
        mutate(semantics) {
          semantics.dependency_conflicts.change_legal_entity_while_any_site_exists.result =
            'allowed'
        },
      },
      {
        name: 'Legal Entity Site conflict weakens ANY Site to multiple Sites',
        mutate(semantics) {
          semantics.dependency_conflicts.change_legal_entity_while_any_site_exists.condition.remaining_customer_site_count =
            'greater_than_one'
        },
      },
      {
        name: 'Legal Entity Site conflict allows a single remaining Site',
        mutate(semantics) {
          semantics.dependency_conflicts.legal_entity_site_state_matrix[2].result =
            'allowed'
        },
      },
      {
        name: 'Legal Entity Site conflict permits a Site category bypass',
        mutate(semantics) {
          semantics.dependency_conflicts.change_legal_entity_while_any_site_exists.no_site_category_bypass = false
        },
      },
      {
        name: 'dependency conflict ceases to be 409',
        mutate(semantics) {
          semantics.dependency_conflicts.failure.status = 422
        },
      },
      {
        name: 'dependency conflict loses dedicated response',
        mutate(semantics) {
          semantics.dependency_conflicts.failure.response =
            '#/components/responses/Conflict'
        },
      },
      {
        name: 'dependency conflict permits resource disclosure',
        mutate(semantics) {
          semantics.dependency_conflicts.failure.dependent_resource_disclosure = true
        },
      },
      ...[
        ['customer', 'missing'],
        ['customer', 'null'],
        ['customer', 'non_object'],
        ['customer_establishments', 'missing'],
        ['customer_establishments', 'null'],
        ['customer_establishments', 'non_array'],
        ['customer_establishments_item', 'null'],
        ['customer_establishments_item', 'scalar'],
        ['customer_establishments_item', 'array'],
        ['customer_establishments_item', 'non_object'],
      ].map(([group, cause]) => ({
        name: `structural validation removes ${group} ${cause}`,
        mutate(semantics) {
          const structural =
            semantics.request_validation.parsed_structural_or_domain
              .structural_errors[group]
          structural.causes = structural.causes.filter(
            (candidate) => candidate !== cause
          )
        },
      })),
      ...[
        ['request', 'extra_property'],
        ['customer', 'extra_property'],
        ['customer_establishments_item', 'extra_property'],
      ].map(([group, cause]) => ({
        name: `extra-property validation removes ${group} ${cause}`,
        mutate(semantics) {
          const structural =
            semantics.request_validation.parsed_structural_or_domain
              .structural_errors[group]
          structural.causes = structural.causes.filter(
            (candidate) => candidate !== cause
          )
        },
      })),
      {
        name: 'extra-property root remaps to customer field',
        mutate(semantics) {
          semantics.request_validation.parsed_structural_or_domain.structural_errors.request.field =
            'customer'
        },
      },
      {
        name: 'extra-property names become disclosable',
        mutate(semantics) {
          semantics.request_validation.parsed_structural_or_domain.unknown_property_handling.property_name_disclosed = true
        },
      },
      {
        name: 'extra-property dynamic error paths become allowed',
        mutate(semantics) {
          semantics.request_validation.parsed_structural_or_domain.unknown_property_handling.dynamic_error_paths = true
        },
      },
      {
        name: 'failure precedence validation runs before If-Match',
        mutate(semantics) {
          const stages = semantics.failure_precedence.ordered_stages
          ;[stages[3], stages[4]] = [stages[4], stages[3]]
        },
      },
      {
        name: 'failure precedence conflicts run before If-Match',
        mutate(semantics) {
          const stages = semantics.failure_precedence.ordered_stages
          ;[stages[3], stages[5]] = [stages[5], stages[3]]
        },
      },
      {
        name: 'failure precedence conflicts run before validation',
        mutate(semantics) {
          const stages = semantics.failure_precedence.ordered_stages
          ;[stages[4], stages[5]] = [stages[5], stages[4]]
        },
      },
      {
        name: 'malformed JSON becomes 422',
        mutate(semantics) {
          semantics.request_validation.malformed_or_protocol.status = 422
        },
      },
      {
        name: 'parsed structural validation becomes 400',
        mutate(semantics) {
          semantics.request_validation.parsed_structural_or_domain.status = 400
        },
      },
      {
        name: 'structural customer remaps to unrelated field',
        mutate(semantics) {
          semantics.request_validation.parsed_structural_or_domain.structural_errors.customer.field =
            'customer.tenant_id'
        },
      },
      {
        name: 'structural collection weakens duplicate message',
        mutate(semantics) {
          semantics.request_validation.parsed_structural_or_domain.structural_errors.customer_establishments.message =
            'Each establishment may be assigned at most once.'
        },
      },
      {
        name: 'operation authorization runs after path lookup',
        mutate(semantics) {
          semantics.authorization_precedence.operation_authorization_before_path_lookup = false
        },
      },
      {
        name: 'unauthorized caller receives 404',
        mutate(semantics) {
          semantics.authorization_precedence.unauthorized.status = 404
        },
      },
      {
        name: 'unauthorized path existence lookup is permitted',
        mutate(semantics) {
          semantics.authorization_precedence.unauthorized.path_existence_lookup =
            'permitted'
        },
      },
      {
        name: 'unauthorized path states are distinguished',
        mutate(semantics) {
          semantics.authorization_precedence.unauthorized.indistinguishable = false
        },
      },
      {
        name: 'unauthorized response discloses existence',
        mutate(semantics) {
          semantics.authorization_precedence.unauthorized.resource_existence_disclosure =
            'path state'
        },
      },
      {
        name: 'authorized missing and inaccessible diverge',
        mutate(semantics) {
          semantics.authorization_precedence.authorized.indistinguishable = false
        },
      },
      {
        name: 'unauthorized matrix performs existing lookup',
        mutate(semantics) {
          semantics.authorization_precedence.state_matrix[0].lookup = true
        },
      },
      {
        name: 'unauthorized matrix distinguishes missing as 404',
        mutate(semantics) {
          semantics.authorization_precedence.state_matrix[1].status = 404
        },
      },
      {
        name: 'authorization precedence uses generic open 403',
        mutate(semantics) {
          semantics.authorization_precedence.unauthorized.response =
            '#/components/responses/Forbidden'
        },
      },
      {
        name: 'authorization precedence uses generic open 404',
        mutate(semantics) {
          semantics.authorization_precedence.authorized.response =
            '#/components/responses/NotFound'
        },
      },
      {
        name: 'failure precedence lookup runs before authorization',
        mutate(semantics) {
          const stages = semantics.failure_precedence.ordered_stages
          ;[stages[1], stages[2]] = [stages[2], stages[1]]
        },
      },
      {
        name: 'failure precedence evaluates later stages when stale',
        mutate(semantics) {
          semantics.failure_precedence.stages.if_match_precondition.later_stages_evaluated_when_stale = true
        },
      },
      ...[
        ['existing_stale_malformed', 400],
        ['existing_stale_parsed_invalid', 422],
        ['existing_stale_dependency_conflict', 409],
        ['existing_current_malformed', 422],
        ['existing_current_parsed_invalid_dependency_conflict', 409],
        ['existing_current_valid_dependency_conflict', 422],
        ['authorized_missing_stale_invalid', 412],
        ['authorized_tenant_inaccessible_stale_invalid', 412],
      ].map(([caseName, status]) => ({
        name: `failure precedence rejects ${caseName} as ${status}`,
        mutate(semantics) {
          semantics.failure_precedence.mixed_failure_state_matrix.find(
            (entry) => entry.case === caseName
          ).status = status
        },
      })),
      {
        name: 'failure precedence permits path lookup after failed authorization',
        mutate(semantics) {
          semantics.failure_precedence.stages.operation_authorization.path_customer_lookup_permitted = true
        },
      },
      {
        name: 'failure precedence substitutes open 403 response',
        mutate(semantics) {
          semantics.failure_precedence.stages.operation_authorization.response =
            '#/components/responses/Forbidden'
        },
      },
      {
        name: 'failure precedence substitutes open 404 response',
        mutate(semantics) {
          semantics.failure_precedence.stages.tenant_scoped_customer_lookup.response =
            '#/components/responses/NotFound'
        },
      },
      {
        name: 'contract-runtime boundary removed',
        mutate(semantics) {
          delete semantics.contract_runtime_boundary
        },
      },
      {
        name: 'material invariant becomes prose-only',
        mutate(semantics) {
          semantics.authority_classification.prose_only_material_invariants = 1
        },
      },
      {
        name: 'guard false-confidence becomes nonzero',
        mutate(semantics) {
          semantics.authority_classification.guard_false_confidence = 1
        },
      },
      {
        name: 'material extension lacks executable authority',
        mutate(semantics) {
          semantics.authority_classification.material_x_extensions_without_executable_authority = 1
        },
      },
    ].map((mutation) => ({
      name: `machine semantics reject ${mutation.name}`,
      expected: /machine-readable transactional semantics/,
      mutate(candidate) {
        mutation.mutate(
          candidate.paths['/customers/{customer}/transactional-edit'].put[
            'x-transactional-edit-semantics'
          ]
        )
      },
    })),
    {
      name: 'F1 deterministic denial rejects generic Forbidden',
      expected: /fixed authorization denial payload/,
      mutate(candidate) {
        candidate.paths[
          '/customers/{customer}/transactional-edit'
        ].put.responses['403'] = {
          $ref: '#/components/responses/Forbidden',
        }
      },
    },
    {
      name: 'F1 deterministic denial rejects schema replacement',
      expected: /fixed authorization denial payload/,
      mutate(candidate) {
        candidate.components.responses.CustomerTransactionalEditForbidden.content[
          'application/json'
        ].schema.$ref = '#/components/schemas/Error'
      },
    },
    {
      name: 'F1 deterministic denial rejects code mutation',
      expected: /fixed authorization denial payload/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditForbiddenError.properties.code.enum =
          ['CUSTOMER_EDIT_FORBIDDEN']
      },
    },
    {
      name: 'F1 deterministic denial rejects message mutation',
      expected: /fixed authorization denial payload/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditForbiddenError.properties.message.enum =
          ['The caller lacks complete assignment visibility.']
      },
    },
    {
      name: 'F1 deterministic denial rejects details disclosure',
      expected: /fixed authorization denial payload/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditForbiddenError.properties.details =
          { type: 'object' }
      },
    },
    {
      name: 'F1 deterministic denial rejects arbitrary disclosure fields',
      expected: /fixed authorization denial payload/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditForbiddenError.properties.denied_scope =
          { type: 'string' }
      },
    },
    {
      name: 'F2 rejects removed establishment-key uniqueness',
      expected: /establishment-key uniqueness/,
      mutate(candidate) {
        delete candidate.components.schemas.CustomerTransactionalEditRequest
          .properties.customer_establishments['x-unique-by']
      },
    },
    {
      name: 'F2 rejects changed establishment-key uniqueness',
      expected: /establishment-key uniqueness/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditRequest.properties.customer_establishments[
          'x-unique-by'
        ] = ['customer_id']
      },
    },
    {
      name: 'F2 rejects bypassed SecPal semantic validation',
      expected: /establishment-key uniqueness/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditRequest.properties.customer_establishments[
          'x-unique-by-validation'
        ].validator = 'json-schema-uniqueItems-only'
      },
    },
    {
      name: 'F2 rejects differing-contact duplicate acceptance',
      expected: /establishment-key uniqueness/,
      mutate(candidate) {
        const rejected =
          candidate.components.schemas.CustomerTransactionalEditRequest
            .properties.customer_establishments['x-uniqueness-examples']
            .rejected
        rejected.find(
          (example) => example.category === 'different-email'
        ).value[1].establishment_id = '780e8400-e29b-41d4-a716-446655440099'
      },
    },
    {
      name: 'F3 committed response projection',
      expected: /committed response projection/,
      mutate(candidate) {
        delete candidate.components.schemas
          .CustomerTransactionalEditRequiredRelationships.properties.sites
      },
    },
    ...[
      {
        name: 'F4 rejects response schema-ref drift',
        mutate(candidate) {
          candidate.components.responses.CustomerTransactionalEditConflict.content[
            'application/json'
          ].schema.$ref = '#/components/schemas/Error'
        },
      },
      {
        name: 'F4 rejects response example drift',
        mutate(candidate) {
          candidate.components.responses.CustomerTransactionalEditStale.content[
            'application/json'
          ].example.code = 'STALE'
        },
      },
      {
        name: 'F4 rejects enum drift',
        mutate(candidate) {
          candidate.components.schemas.CustomerTransactionalEditStaleError.properties.code.enum =
            ['STALE']
        },
      },
      {
        name: 'F4 rejects additionalProperties true',
        mutate(candidate) {
          candidate.components.schemas.CustomerTransactionalEditConflictError.additionalProperties = true
        },
      },
      {
        name: 'F4 rejects absent additionalProperties',
        mutate(candidate) {
          delete candidate.components.schemas
            .CustomerTransactionalEditStaleError.additionalProperties
        },
      },
      {
        name: 'F4 rejects a third property',
        mutate(candidate) {
          candidate.components.schemas.CustomerTransactionalEditConflictError.properties.details =
            { type: 'object' }
        },
      },
      {
        name: 'F4 rejects missing required message',
        mutate(candidate) {
          candidate.components.schemas.CustomerTransactionalEditConflictError.required =
            ['code']
        },
      },
      {
        name: 'F4 rejects missing required code',
        mutate(candidate) {
          candidate.components.schemas.CustomerTransactionalEditStaleError.required =
            ['message']
        },
      },
      {
        name: 'F4 rejects a non-object schema',
        mutate(candidate) {
          candidate.components.schemas.CustomerTransactionalEditConflictError.type =
            'array'
        },
      },
    ].map((mutation) => ({
      ...mutation,
      expected: /fixed closed conflict and stale payloads/,
    })),
    {
      name: 'F5 path and body customer identity',
      expected: /path and body customer identity/,
      mutate(candidate) {
        delete candidate.components.schemas.CustomerTransactionalEditRequest[
          'x-validation-examples'
        ]
      },
    },
    {
      name: 'A rejects generic transactional validation response',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        candidate.paths[
          '/customers/{customer}/transactional-edit'
        ].put.responses['422'] = {
          $ref: '#/components/responses/ValidationError',
        }
      },
    },
    {
      name: 'A rejects transactional validation schema substitution',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        candidate.components.responses.CustomerTransactionalEditValidationError.content[
          'application/json'
        ].schema.$ref = '#/components/schemas/ValidationProblem'
      },
    },
    {
      name: 'A rejects an open transactional validation envelope',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditValidationProblem.additionalProperties = true
      },
    },
    {
      name: 'extra-property 422 rejects missing request authority',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        delete candidate.components.schemas
          .CustomerTransactionalEditValidationProblem.properties.errors
          .patternProperties['^request$']
      },
    },
    {
      name: 'extra-property 422 rejects open request messages',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditInvalidRequestBodyErrors.items =
          { type: 'string' }
      },
    },
    {
      name: 'extra-property 422 rejects root property-name disclosure',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditInvalidRequestBodyErrors.items.enum =
          ['Unknown property secret_field.']
      },
    },
    {
      name: 'extra-property 422 preserves closed request schema',
      expected: /must remain closed/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditRequest.additionalProperties = true
      },
    },
    {
      name: 'extra-property 422 preserves closed customer update request schema',
      expected: /CustomerUpdateRequest must remain closed/,
      mutate(candidate) {
        candidate.components.schemas.CustomerUpdateRequest.additionalProperties = true
      },
    },
    {
      name: 'extra-property 422 preserves closed assignment create request schema',
      expected: /CustomerEstablishmentCreateRequest must remain closed/,
      mutate(candidate) {
        candidate.components.schemas.CustomerEstablishmentCreateRequest.additionalProperties = true
      },
    },
    ...[
      'extra-property-request',
      'extra-property-customer',
      'extra-property-assignment-item',
    ].map((category) => ({
      name: `extra-property 422 preserves accepted ${category} evidence`,
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        const examples =
          candidate.components.schemas
            .CustomerTransactionalEditValidationProblem['x-validation-examples']
            .accepted
        examples.splice(
          examples.findIndex((example) => example.category === category),
          1
        )
      },
    })),
    {
      name: 'A rejects arbitrary transactional validation strings',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditInvalidEstablishmentErrors.items.enum =
          ['Establishment 123 belongs to another tenant.']
      },
    },
    {
      name: 'A rejects missing contact-field validation variants',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        delete candidate.components.schemas
          .CustomerTransactionalEditValidationProblem.properties.errors
          .patternProperties[
          '^customer_establishments\\.[0-9]+\\.(contact_name|phone|email|comments)$'
        ]
      },
    },
    {
      name: 'A rejects contact-field message drift',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditInvalidContactFieldErrors.items.enum =
          ['The contact field failed an internal database constraint.']
      },
    },
    {
      name: 'structural 422 rejects missing customer field authority',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        delete candidate.components.schemas
          .CustomerTransactionalEditValidationProblem.properties.errors
          .patternProperties['^customer$']
      },
    },
    {
      name: 'structural 422 rejects missing indexed item authority',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        delete candidate.components.schemas
          .CustomerTransactionalEditValidationProblem.properties.errors
          .patternProperties['^customer_establishments\\.[0-9]+$']
      },
    },
    {
      name: 'structural 422 rejects open collection messages',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditInvalidAssignmentCollectionErrors.items =
          {
            type: 'string',
          }
      },
    },
    {
      name: 'structural 422 rejects customer disclosure message',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditInvalidCustomerPayloadErrors.items.enum =
          ['Customer from tenant 42 is invalid.']
      },
    },
    {
      name: 'structural 422 rejects unrelated field remapping',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditValidationProblem.properties.errors.patternProperties[
          '^customer.tenant_id$'
        ] =
          candidate.components.schemas.CustomerTransactionalEditValidationProblem.properties.errors.patternProperties[
            '^customer$'
          ]
      },
    },
    {
      name: 'structural 422 preserves duplicate collection message authority',
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditAssignmentCollectionErrors.oneOf =
          [
            {
              $ref: '#/components/schemas/CustomerTransactionalEditInvalidAssignmentCollectionErrors',
            },
          ]
      },
    },
    ...[
      ['structural-customer', 'missing'],
      ['structural-customer', 'null'],
      ['structural-customer', 'non_object'],
      ['structural-collection', 'missing'],
      ['structural-collection', 'null'],
      ['structural-collection', 'non_array'],
      ['structural-item', 'null'],
      ['structural-item', 'scalar'],
      ['structural-item', 'array'],
      ['structural-item', 'non_object'],
    ].map(([category, cause]) => ({
      name: `structural 422 preserves ${category} ${cause} evidence`,
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        const examples =
          candidate.components.schemas
            .CustomerTransactionalEditValidationProblem['x-validation-examples']
            .accepted
        examples.splice(
          examples.findIndex(
            (example) =>
              example.category === category && example.cause === cause
          ),
          1
        )
      },
    })),
    ...[
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
      'extra-property-root-disclosure',
      'extra-property-customer-disclosure',
      'extra-property-item-disclosure',
      'extra-property-dynamic-path',
      'extra-property-unrelated-field',
    ].map((category) => ({
      name: `A preserves rejected ${category} evidence`,
      expected: /dedicated closed validation schema/,
      mutate(candidate) {
        const examples =
          candidate.components.schemas
            .CustomerTransactionalEditValidationProblem['x-validation-examples']
            .rejected
        examples.splice(
          examples.findIndex((example) => example.category === category),
          1
        )
      },
    })),
    {
      name: 'B rejects generic transactional NotFound',
      expected: /dedicated response\/schema references/,
      mutate(candidate) {
        candidate.paths[
          '/customers/{customer}/transactional-edit'
        ].put.responses['404'] = {
          $ref: '#/components/responses/NotFound',
        }
      },
    },
    {
      name: 'B rejects transactional 404 schema substitution',
      expected: /dedicated response\/schema references/,
      mutate(candidate) {
        candidate.components.responses.CustomerTransactionalEditNotFound.content[
          'application/json'
        ].schema.$ref = '#/components/schemas/Error'
      },
    },
    {
      name: 'B rejects transactional 404 message drift',
      expected: /dedicated response\/schema references/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditNotFoundError.properties.message.enum =
          ['Customer exists in another tenant.']
      },
    },
    {
      name: 'B rejects transactional 404 code drift',
      expected: /dedicated response\/schema references/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditNotFoundError.properties.code.enum =
          ['CUSTOMER_NOT_FOUND']
      },
    },
    {
      name: 'B rejects appended transactional 404 message enum',
      expected: /dedicated response\/schema references/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditNotFoundError.properties.message.enum.push(
          'Customer not found'
        )
      },
    },
    {
      name: 'B rejects appended transactional 404 code enum',
      expected: /dedicated response\/schema references/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditNotFoundError.properties.code.enum.push(
          'CUSTOMER_NOT_FOUND'
        )
      },
    },
    ...[
      'message-drift',
      'code-drift',
      'details',
      'tenant-id',
      'existence-hint',
      'extra-property',
    ].map((category) => ({
      name: `B preserves rejected ${category} evidence`,
      expected: /dedicated response\/schema references/,
      mutate(candidate) {
        const examples =
          candidate.components.schemas.CustomerTransactionalEditNotFoundError[
            'x-validation-examples'
          ].rejected
        examples.splice(
          examples.findIndex((example) => example.category === category),
          1
        )
      },
    })),
    {
      name: 'C retains the create-contract overlay',
      expected: /contact semantics/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditEstablishmentRequest.allOf =
          []
      },
    },
    {
      name: 'C retains omission, null, and value semantics',
      expected: /contact semantics/,
      mutate(candidate) {
        candidate.components.schemas.CustomerTransactionalEditEstablishmentRequest[
          'x-contact-field-semantics'
        ].retained_pair.omitted = 'clear to null'
      },
    },
    ...['contact_name', 'phone', 'email', 'comments'].map((field) => ({
      name: `C preserves retained and new ${field} evidence`,
      expected: /contact semantics/,
      mutate(candidate) {
        const examples =
          candidate.components.schemas
            .CustomerTransactionalEditEstablishmentRequest[
            'x-contact-field-examples'
          ]
        examples.retained.find(
          (example) => example.field === field
        ).omitted_result = null
        examples.new.find((example) => example.field === field).null_result =
          'unexpected'
      },
    })),
  ]

  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      const candidate = structuredClone(contract)
      mutation.mutate(candidate)

      const result = runGuard(candidate)

      assert.notEqual(result.status, 0, result.stdout)
      assert.match(result.stderr, mutation.expected)
    })
  }
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
    const parameters = paths[path].get.parameters.map((parameter) =>
      resolveParameter(contract, parameter)
    )
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

test('guard rejects unsupported or privacy-widened employee activity examples', () => {
  const supportedActivity =
    contract.paths['/activity-logs'].get.responses['200'].content[
      'application/json'
    ].examples.paginatedResponse.value.data[2]

  assert.equal(
    supportedActivity.properties,
    null,
    'automatic employee update diffs are not exposed through properties'
  )

  const unsupportedEvent = structuredClone(contract)
  const unsupportedActivity =
    unsupportedEvent.paths['/activity-logs'].get.responses['200'].content[
      'application/json'
    ].examples.paginatedResponse.value.data[2]

  unsupportedActivity.log_name = 'employee'
  unsupportedActivity.description = 'Viewed Employee "Jane Smith"'
  unsupportedActivity.event = 'accessed'
  unsupportedActivity.properties = {}

  const unsupportedResult = runGuard(unsupportedEvent)

  assert.equal(unsupportedResult.status, 1)
  assert.match(unsupportedResult.stderr, /employee activity examples/i)

  const privacyWidened = structuredClone(contract)
  privacyWidened.paths['/activity-logs'].get.responses['200'].content[
    'application/json'
  ].examples.paginatedResponse.value.data[2].properties = {
    name: 'Jane Smith',
  }

  const privacyResult = runGuard(privacyWidened)

  assert.equal(privacyResult.status, 1)
  assert.match(privacyResult.stderr, /employee activity examples/i)

  const privacyWidenedSubject = structuredClone(contract)
  privacyWidenedSubject.paths['/activity-logs'].get.responses['200'].content[
    'application/json'
  ].examples.paginatedResponse.value.data[2].subject = {
    first_name: 'Jane',
  }

  const privacySubjectResult = runGuard(privacyWidenedSubject)

  assert.equal(privacySubjectResult.status, 1)
  assert.match(privacySubjectResult.stderr, /employee activity examples/i)

  const misplacedAutomaticDiff = structuredClone(contract)
  misplacedAutomaticDiff.paths['/activity-logs'].get.responses['200'].content[
    'application/json'
  ].examples.paginatedResponse.value.data[2].properties = {
    attributes: { status: 'active' },
    old: { status: 'on_leave' },
  }

  const misplacedDiffResult = runGuard(misplacedAutomaticDiff)

  assert.equal(misplacedDiffResult.status, 1)
  assert.match(misplacedDiffResult.stderr, /employee activity examples/i)

  const missingExample = structuredClone(contract)
  missingExample.paths['/activity-logs'].get.responses['200'].content[
    'application/json'
  ].examples.paginatedResponse.value.data = []

  const missingExampleResult = runGuard(missingExample)

  assert.equal(missingExampleResult.status, 1)
  assert.match(missingExampleResult.stderr, /employee activity examples/i)
})

test('moves local customer data to a unique customer establishment contract', () => {
  assert.equal(Object.hasOwn(schemas.Customer.properties, 'contact'), false)
  assert.equal(Object.hasOwn(schemas.Customer.properties, 'notes'), false)
  assert.equal(Object.hasOwn(schemas.Customer.properties, 'metadata'), false)
  assert.equal(
    schemas.Customer.required.includes('customer_establishments'),
    false,
    'customer_establishments must be omitted unless the relationship is eager loaded'
  )
  assert.deepEqual(schemas.Customer.properties.customer_establishments, {
    $ref: '#/components/schemas/CustomerEstablishmentRelationship',
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

test('models every conditional customer and site resource field', () => {
  const conditionalFields = {
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

  for (const [schemaName, fields] of Object.entries(conditionalFields)) {
    for (const [field, component] of Object.entries(fields)) {
      assert.deepEqual(schemas[schemaName].properties[field], {
        $ref: `#/components/schemas/${component}`,
      })
      assert.equal(
        schemas[schemaName].required.includes(field),
        false,
        `${schemaName}.${field} must remain optional`
      )
    }
  }

  assert.match(
    schemas.CustomerSitesRelationship.description,
    /eager loaded.*omitted otherwise/i
  )
  assert.match(
    schemas.CustomerEstablishmentRelationship.description,
    /visible to the current caller.*site-only access.*active site assignments/is
  )
  assert.match(
    schemas.SiteCustomerRelationship.description,
    /eager loaded.*omitted otherwise/i
  )
  assert.match(
    schemas.NonNegativeRelationshipCount.description,
    /counted.*omitted otherwise/i
  )
  for (const field of ['access_instructions', 'notes']) {
    assert.match(
      schemas.Site.properties[field].description,
      /authorized to update.*omitted/i
    )
    assert.equal(schemas.Site.required.includes(field), false)
  }
})

test('models embedded and dedicated assignment resources without stale fields', () => {
  assert.deepEqual(schemas.CustomerAssignmentsRelationship.items, {
    $ref: '#/components/schemas/EmbeddedCustomerAssignment',
  })
  assert.deepEqual(schemas.SiteAssignmentsRelationship.items, {
    $ref: '#/components/schemas/EmbeddedSiteAssignment',
  })

  const expectedProperties = {
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

  for (const [schemaName, properties] of Object.entries(expectedProperties)) {
    assert.equal(schemas[schemaName].additionalProperties, false)
    assert.deepEqual(Object.keys(schemas[schemaName].properties), properties)
    assert.equal(schemas[schemaName].required.includes('is_active'), true)
    assert.equal(
      Object.hasOwn(schemas[schemaName].properties, 'is_primary'),
      false
    )
  }

  assert.deepEqual(Object.keys(schemas.AssignmentUser.properties), [
    'id',
    'name',
    'email',
  ])
  assert.deepEqual(schemas.AssignmentUser.required, ['id', 'name', 'email'])
  assert.match(
    schemas.CustomerEstablishmentRelationship.description,
    /`customer_establishments` relationship/
  )

  for (const schemaName of [
    'EmbeddedCustomerAssignment',
    'EmbeddedSiteAssignment',
  ]) {
    assert.deepEqual(schemas[schemaName].properties.user_id, {
      type: ['string', 'null'],
      format: 'uuid',
      description:
        'Assigned user identifier. Null when the user was deleted but assignment history is preserved.',
    })
    assert.equal(schemas[schemaName].required.includes('user_id'), true)
    assert.equal(schemas[schemaName].required.includes('user'), true)
  }

  const siteAssignmentPost =
    paths['/sites/{site}/assignments'].post.requestBody.content[
      'application/json'
    ].schema
  const siteAssignmentPatch =
    paths['/site-assignments/{siteAssignment}'].patch.requestBody.content[
      'application/json'
    ].schema
  assert.equal(
    Object.hasOwn(siteAssignmentPost.properties, 'is_primary'),
    false
  )
  assert.equal(
    Object.hasOwn(siteAssignmentPatch.properties, 'is_primary'),
    false
  )
  assert.doesNotMatch(
    paths['/site-assignments/{siteAssignment}'].patch.description,
    /is_primary/i
  )

  for (const pathName of [
    '/customers/{customer}/assignments',
    '/sites/{site}/assignments',
  ]) {
    const role = paths[pathName].get.parameters.find(
      (parameter) => parameter.name === 'role'
    )
    assert.deepEqual(role.schema, {
      type: 'string',
      maxLength: 100,
    })
  }
})

test('documents endpoint-specific customer and site relationship presence', () => {
  assert.match(
    paths['/customers'].get.description,
    /eager loads.*assignments.*customer_establishments.*does not eager load.*sites/is
  )
  assert.match(
    paths['/customers'].post.description,
    /eager loads.*customer_establishments.*sites.*assignments.*count.*omitted/is
  )
  assert.match(
    paths['/customers/{customer}'].patch.description,
    /eager loads.*customer_establishments.*sites.*assignments.*count.*omitted/is
  )
  assert.match(
    paths['/customers/{customer}/sites'].get.description,
    /eager loads.*assignments.*customer.*counts.*omitted/is
  )

  const listExamples = Object.values(
    paths['/customers'].get.responses['200'].content['application/json']
      .examples
  )
  for (const example of listExamples) {
    for (const customer of example.value.data) {
      assert.ok(Array.isArray(customer.assignments))
      assert.ok(Array.isArray(customer.customer_establishments))
      assert.equal(Object.hasOwn(customer, 'sites'), false)
    }
  }

  const detailExamples = Object.values(
    paths['/customers/{customer}'].get.responses['200'].content[
      'application/json'
    ].examples
  )
  for (const example of detailExamples) {
    const customer = example.value.data
    assert.equal(customer.sites.length, customer.sites_count)
  }

  assert.equal(
    paths['/sites/{site}'].get.parameters.some(
      (parameter) => parameter.name === 'include'
    ),
    false
  )
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

test('keeps conditional customer fields reusable and documented', () => {
  assert.equal(schemas.Customer.additionalProperties, false)
  assert.deepEqual(schemas.Customer.properties.sites_count, {
    $ref: '#/components/schemas/NonNegativeRelationshipCount',
  })
  assert.match(
    paths['/customers/{customer}'].get.description,
    /eager loads.*sites.*assignments.*customer_establishments/is
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
    'ContractCreateRequest',
    'ContractUpdateRequest',
    'ServiceBookingCreateRequest',
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
    ['ContractUpdateRequest', ['customer_id']],
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

test('documents concealed Contract customer-association failures', () => {
  const createExamples = schemas.ContractCreateRequest['x-validation-examples']
  const updateExamples = schemas.ContractUpdateRequest['x-validation-examples']

  assert.equal(createExamples.rejected[0].status, 404)
  assert.equal(updateExamples.rejected[0].status, 404)
  assert.equal(updateExamples.rejected[1].status, 409)
})

test('documents concealed Service Booking Contract-association failures', () => {
  const examples = schemas.ServiceBookingCreateRequest['x-validation-examples']

  assert.equal(examples.rejected[0].status, 404)
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
  ].get.parameters.filter(
    (parameter) =>
      resolveParameter(candidate, parameter)?.name !== 'establishment_id'
  )
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

test('guard reports unresolved employee parameter components cleanly', () => {
  const candidate = structuredClone(contract)
  delete candidate.components.parameters.EmployeeEstablishmentFilter

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /GET \/employees collection filters/)
  assert.doesNotMatch(result.stderr, /TypeError/)
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
  for (const [schemaName, diagnostic] of [
    ['SiteUpdateRequest', /PATCH site assignments.*workflow evidence/],
    [
      'ContractUpdateRequest',
      /PATCH Contract customer association.*workflow evidence/,
    ],
  ]) {
    const candidate = structuredClone(contract)
    delete candidate.components.schemas[schemaName]['x-validation-examples']

    const result = runGuard(candidate)

    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, diagnostic)
  }
})

test('guard rejects distinguishable duplicate responses', () => {
  const candidate = structuredClone(contract)
  candidate.components.schemas.DuplicateResourceError.properties.message.enum =
    ['This email address already exists.']

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /neutral fixed shape/)
})

test('guard rejects a missing customer or site resource field', () => {
  const candidate = structuredClone(contract)
  delete candidate.components.schemas.Customer.properties.sites
  delete candidate.components.schemas.Site.properties.metadata

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /Customer\.sites/)
  assert.match(result.stderr, /Site must inventory every field/)
})

test('guard rejects a closed customer response without its visible site count', () => {
  const candidate = structuredClone(contract)
  delete candidate.components.schemas.Customer.properties.sites_count

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /Customer\.sites_count/)
})

test('guard rejects weakened conditional relationship and sensitive-field documentation', () => {
  const candidate = structuredClone(contract)
  candidate.components.schemas.CustomerEstablishmentRelationship.description =
    'Customer-to-establishment assignments.'
  candidate.components.schemas.Site.properties.access_instructions.description =
    'Instructions for accessing the site.'

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /CustomerEstablishmentRelationship/)
  assert.match(result.stderr, /Site\.access_instructions/)
})

test('guard rejects weakened conditional count and relationship schemas', () => {
  const candidate = structuredClone(contract)
  candidate.components.schemas.NonNegativeRelationshipCount.minimum = -1
  candidate.components.schemas.CustomerEstablishmentRelationship.items = {
    type: 'string',
  }

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /NonNegativeRelationshipCount/)
  assert.match(result.stderr, /CustomerEstablishmentRelationship/)
})

test('guard rejects assignment resource shapes that drift from runtime', () => {
  const candidate = structuredClone(contract)
  candidate.components.schemas.SiteAssignmentsRelationship.items = {
    $ref: '#/components/schemas/SiteAssignment',
  }
  candidate.components.schemas.EmbeddedCustomerAssignment.properties.user_id = {
    type: 'string',
    format: 'uuid',
  }
  candidate.components.schemas.SiteAssignment.required.push('is_primary')
  candidate.components.schemas.SiteAssignment.properties.is_primary = {
    type: 'boolean',
  }
  candidate.components.schemas.AssignmentUser.properties.created_at = {
    $ref: '#/components/schemas/ApiTimestamp',
  }

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /SiteAssignmentsRelationship/)
  assert.match(result.stderr, /EmbeddedCustomerAssignment/)
  assert.match(result.stderr, /SiteAssignment/)
  assert.match(result.stderr, /AssignmentUser/)
})

test('guard rejects customer endpoint presence and example drift', () => {
  const candidate = structuredClone(contract)
  candidate.paths['/customers'].get.description =
    'Retrieve a paginated list of customers.'
  const listCustomer =
    candidate.paths['/customers'].get.responses['200'].content[
      'application/json'
    ].examples.withVisibleSitesCount.value.data[0]
  delete listCustomer.assignments
  listCustomer.customer_establishments[0].customer_id =
    '550e8400-e29b-41d4-a716-446655440001'
  const detailCustomer =
    candidate.paths['/customers/{customer}'].get.responses['200'].content[
      'application/json'
    ].examples.withExpandedRelationships.value.data
  detailCustomer.sites_count = detailCustomer.sites.length + 1

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /GET \/customers relationship presence/)
  assert.match(result.stderr, /GET \/customers response examples/)
  assert.match(result.stderr, /GET \/customers\/{customer} response examples/)
})

test('guard rejects restored unsupported site includes and assignment fields', () => {
  const candidate = structuredClone(contract)
  candidate.paths['/sites/{site}'].get.parameters.push({
    name: 'include',
    in: 'query',
    schema: {
      type: 'string',
      enum: ['customer', 'assignments'],
    },
  })
  candidate.paths['/sites/{site}/assignments'].post.requestBody.content[
    'application/json'
  ].schema.properties.is_primary = { type: 'boolean' }
  candidate.paths['/sites/{site}/assignments'].get.parameters = candidate.paths[
    '/sites/{site}/assignments'
  ].get.parameters.filter((parameter) => parameter.name !== 'role')

  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /GET \/sites\/{site} must not expose include/)
  assert.match(result.stderr, /site assignment requests.*is_primary/i)
  assert.match(result.stderr, /assignment collection filters/i)
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
