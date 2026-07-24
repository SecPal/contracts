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

const guardPath = fileURLToPath(
  new URL('./check-openapi-verified-endpoints.mjs', import.meta.url)
)
const contractPath = fileURLToPath(
  new URL('../docs/openapi.yaml', import.meta.url)
)
const contract = readFileSync(contractPath, 'utf8')

const parsedContract = yaml.load(contract)
const organizationalUnitListParameters =
  parsedContract.paths['/organizational-units'].get.parameters

function resolveParameter(candidate, parameter) {
  const prefix = '#/components/parameters/'
  if (parameter?.$ref?.startsWith(prefix)) {
    return candidate.components.parameters[parameter.$ref.slice(prefix.length)]
  }

  return parameter
}

function employeeComplianceAlertParameter(candidate, name) {
  const parameter = candidate.paths[
    '/employees/compliance-alerts'
  ].get.parameters
    .map((entry) => resolveParameter(candidate, entry))
    .find((entry) => entry?.name === name)

  assert.ok(parameter, `Missing employee compliance-alert parameter ${name}`)

  return parameter
}

function organizationalUnitListParameter(parameters, name) {
  const parameter = parameters.find(
    (candidate) => candidate.name === name && candidate.in === 'query'
  )

  assert.ok(
    parameter,
    `GET /organizational-units must define the ${name} query parameter`
  )

  return parameter
}

function organizationalUnitWireExamples(parameter, name) {
  const wireExamples = parameter['x-wire-examples']

  assert.ok(
    wireExamples,
    `GET /organizational-units ${name} must define x-wire-examples`
  )

  return wireExamples
}

function runGuard(source) {
  const directory = mkdtempSync(join(tmpdir(), 'verified-endpoints-'))
  const candidatePath = join(directory, 'openapi.yaml')
  writeFileSync(candidatePath, source)

  try {
    return spawnSync(process.execPath, [guardPath, candidatePath], {
      encoding: 'utf8',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('accepts the repository contract', () => {
  const result = runGuard(contract)

  assert.equal(result.status, 0, result.stderr)
})

test('omits retired Android enrollment and provisioning contracts', () => {
  const serialized = JSON.stringify(parsedContract)
  const retiredPaths = [
    '/android-enrollment-sessions',
    '/android-enrollment-sessions/{session}',
    '/android-enrollment-sessions/{session}/revoke',
    '/android/bootstrap/exchange',
  ]
  const retiredSchemas = [
    'AndroidEnrollmentMode',
    'AndroidEnrollmentSessionStatus',
    'AndroidProvisioningProfile',
    'AndroidEnrollmentSession',
    'AndroidProvisioningOperatorExtras',
    'AndroidProvisioningQrPayload',
    'AndroidEnrollmentSessionCreateRequest',
    'AndroidEnrollmentSessionResponse',
    'AndroidEnrollmentSessionCreateResponse',
    'AndroidEnrollmentSessionCollectionResponse',
    'AndroidEnrollmentSessionRevokeRequest',
    'AndroidBootstrapExchangeRequest',
    'AndroidBootstrapExchangeResponse',
  ]

  for (const path of retiredPaths) {
    assert.equal(
      parsedContract.paths[path],
      undefined,
      `${path} must be absent`
    )
  }

  for (const schema of retiredSchemas) {
    assert.equal(
      parsedContract.components.schemas[schema],
      undefined,
      `${schema} must be absent`
    )
  }

  assert.doesNotMatch(serialized, /managed_android_enrollment/)
})

function schemaVersionValueIsValid(schema, value) {
  if (schema?.type === 'integer' && !Number.isInteger(value)) {
    return false
  }

  if (Object.hasOwn(schema ?? {}, 'const') && schema.const !== value) {
    return false
  }

  if (schema?.enum && !schema.enum.includes(value)) {
    return false
  }

  if (schema?.minimum !== undefined && value < schema.minimum) {
    return false
  }

  if (schema?.maximum !== undefined && value > schema.maximum) {
    return false
  }

  return true
}

const invalidSchemaVersionValues = [
  3,
  1,
  5,
  -1,
  4.5,
  '4',
  null,
  true,
  [4],
  { value: 4 },
]

test('permits exactly integer schema 4 for every runtime schema version', () => {
  const schemaVersions = []
  const schemaVersionProperties = [
    parsedContract.components.schemas.NotificationRuntimeState.properties
      .schema_version,
    parsedContract.components.schemas.NotificationRuntimeStateConflictDetails
      .properties.schema_version,
    parsedContract.components.schemas.BootstrapCompatibility.properties
      .schema_version,
  ]
  function collectSchemaVersions(candidate) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        collectSchemaVersions(item)
      }

      return
    }

    if (candidate === null || typeof candidate !== 'object') {
      return
    }

    for (const [key, value] of Object.entries(candidate)) {
      if (key === 'schema_version' && Number.isInteger(value)) {
        schemaVersions.push(value)
      }

      collectSchemaVersions(value)
    }
  }

  collectSchemaVersions(parsedContract)

  assert.ok(schemaVersions.length > 0, 'expected schema_version examples')
  assert.deepEqual([...new Set(schemaVersions)], [4])

  for (const schema of schemaVersionProperties) {
    assert.equal(schema.type, 'integer')
    assert.equal(schema.const, 4)
    assert.equal(schema.example, 4)
    assert.equal(schemaVersionValueIsValid(schema, 4), true)

    for (const invalidValue of invalidSchemaVersionValues) {
      assert.equal(
        schemaVersionValueIsValid(schema, invalidValue),
        false,
        `schema_version must reject ${JSON.stringify(invalidValue)}`
      )
    }
  }
})

test('rejects every noncanonical schema-version value in endpoint examples', () => {
  for (const invalidValue of invalidSchemaVersionValues) {
    const candidate = structuredClone(parsedContract)
    candidate.paths[
      '/me/notification-installations/{installationId}'
    ].put.requestBody.content[
      'application/json'
    ].examples.androidFcmRegistered.value.runtime.schema_version = invalidValue

    const result = runGuard(yaml.dump(candidate))

    assert.notEqual(
      result.status,
      0,
      `schema_version ${JSON.stringify(invalidValue)}: ${result.stdout}`
    )
    assert.match(result.stderr, /schema version/i)
  }
})

test('rejects schema 3 in every canonical example surface', () => {
  const mutations = [
    (candidate) => {
      candidate.components.responses.NotificationInstallationConflict.content[
        'application/json'
      ].examples.staleAndroidFcmRuntime.value.details.schema_version = 3
    },
    (candidate) => {
      candidate.paths[
        '/me/notification-installations/{installationId}'
      ].put.requestBody.content[
        'application/json'
      ].examples.androidFcmRegistered.value.runtime.schema_version = 3
    },
    (candidate) => {
      candidate.paths[
        '/me/notification-installations/{installationId}'
      ].put.responses['200'].content[
        'application/json'
      ].examples.androidFcmCredentialRotated.value.data.runtime.schema_version =
        3
    },
    (candidate) => {
      candidate.paths[
        '/me/notification-installations/{installationId}'
      ].put.responses['201'].content[
        'application/json'
      ].examples.androidFcmRegistered.value.data.runtime.schema_version = 3
    },
    (candidate) => {
      candidate.paths['/bootstrap'].get.responses['200'].content[
        'application/json'
      ].examples.supportedAndroidClient.value.data.compatibility.schema_version =
        3
    },
  ]

  for (const mutate of mutations) {
    const candidate = structuredClone(parsedContract)
    mutate(candidate)

    const result = runGuard(yaml.dump(candidate))

    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, /schema version/i)
  }
})

test('ignores schema-version values outside the canonical runtime surfaces', () => {
  const candidate = structuredClone(parsedContract)
  candidate.info['x-unrelated-contract'] = {
    schema_version: 3,
  }

  const result = runGuard(yaml.dump(candidate))

  assert.equal(result.status, 0, result.stderr)
})

test('rejects noncanonical runtime schema-version constraints', () => {
  const schemaNames = [
    'NotificationRuntimeState',
    'NotificationRuntimeStateConflictDetails',
    'BootstrapCompatibility',
  ]
  const mutations = [
    (schema) => (schema.const = 3),
    (schema) => delete schema.const,
    (schema) => (schema.type = 'number'),
    (schema) => (schema.example = 3),
    (schema) => (schema.maximum = 3),
    (schema) => (schema.not = { const: 4 }),
  ]

  for (const schemaName of schemaNames) {
    for (const mutate of mutations) {
      const candidate = structuredClone(parsedContract)
      mutate(candidate.components.schemas[schemaName].properties.schema_version)

      const result = runGuard(yaml.dump(candidate))

      assert.notEqual(result.status, 0, `${schemaName}: ${result.stdout}`)
      assert.match(result.stderr, /schema version/i)
    }
  }
})

test('preserves the public Android release metadata contracts', () => {
  const schemas = parsedContract.components.schemas
  const latestPath =
    parsedContract.paths['/android/channels/{channel}/latest.json']
  const versionedPath =
    parsedContract.paths['/android/releases/{version}/metadata.json']

  assert.deepEqual(schemas.AndroidReleaseChannel.enum, [
    'managed_device',
    'direct_apk',
    'github_release',
    'obtainium',
  ])

  assert.equal(latestPath.get.operationId, 'getLatestAndroidReleaseMetadata')
  assert.deepEqual(latestPath.get.tags, ['Android Distribution'])
  assert.deepEqual(latestPath.get.security, [])
  assert.equal(
    latestPath.get.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/AndroidLatestReleaseMetadataResponse'
  )
  assert.deepEqual(Object.keys(latestPath.get.responses), [
    '200',
    '404',
    '429',
    '500',
  ])

  assert.equal(
    versionedPath.get.operationId,
    'getVersionedAndroidReleaseMetadata'
  )
  assert.deepEqual(versionedPath.get.tags, ['Android Distribution'])
  assert.deepEqual(versionedPath.get.security, [])
  assert.equal(
    versionedPath.get.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/AndroidVersionedReleaseMetadataResponse'
  )
  assert.deepEqual(Object.keys(versionedPath.get.responses), [
    '200',
    '404',
    '429',
    '500',
  ])

  assert.equal(
    schemas.AndroidLatestReleaseMetadataResponse.properties.data.$ref,
    '#/components/schemas/AndroidLatestReleaseMetadata'
  )
  assert.equal(
    schemas.AndroidVersionedReleaseMetadataResponse.properties.data.$ref,
    '#/components/schemas/AndroidVersionedReleaseMetadata'
  )
})

test('rejects EmployeeResource response field inventory drift', () => {
  const mutations = [
    (candidate) =>
      delete candidate.components.schemas.Employee.properties
        .additional_certifications,
    (candidate) =>
      (candidate.components.schemas.Employee.properties.schema_only_field = {
        type: 'string',
      }),
  ]

  for (const mutate of mutations) {
    const candidate = structuredClone(parsedContract)
    mutate(candidate)

    const result = runGuard(yaml.dump(candidate))

    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, /EmployeeResource field/i)
  }
})

test('rejects EmployeeResource requiredness and relationship drift', () => {
  const mutations = [
    (candidate) =>
      (candidate.components.schemas.Employee.properties.qualifications.items = {
        $ref: '#/components/schemas/QualificationResource',
      }),
    (candidate) =>
      candidate.components.schemas.Employee.required.push('documents'),
    (candidate) =>
      (candidate.components.schemas.Employee.required =
        candidate.components.schemas.Employee.required.filter(
          (property) => property !== 'requires_work_permit'
        )),
    (candidate) =>
      (candidate.components.schemas.Employee.properties.firearms_license_number.description =
        'Decrypted firearms-license number.'),
    (candidate) =>
      (candidate.components.schemas.Employee.properties.addresses.description =
        'Employee address records.'),
  ]

  for (const mutate of mutations) {
    const candidate = structuredClone(parsedContract)
    mutate(candidate)

    const result = runGuard(yaml.dump(candidate))

    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, /EmployeeResource field/i)
  }
})

test('rejects EmployeeResource response schema-shape drift', () => {
  const mutations = [
    (candidate) =>
      (candidate.components.schemas.Employee.properties.employment_end_date = {
        type: ['string', 'null'],
        format: 'date',
        description:
          'Lifecycle-managed employment end date used for retention calculations.',
      }),
    (candidate) =>
      (candidate.components.schemas.Employee.properties.requires_work_permit = {
        type: 'string',
      }),
    (candidate) =>
      (candidate.components.schemas.Employee.properties.work_permit_type.enum =
        ['unlimited', 'limited', 'none']),
    (candidate) =>
      (candidate.components.schemas.EmployeeCreateRequest.properties.work_permit_type.enum =
        ['unlimited', 'limited', 'none']),
    (candidate) =>
      candidate.components.schemas.EmployeeUpdateRequest.properties.work_permit_type.enum.pop(),
    (candidate) =>
      (candidate.components.schemas.EmployeeAdditionalCertification.properties.expiry_date.format =
        'date'),
    (candidate) =>
      delete candidate.components.schemas.MicrosecondApiTimestamp.pattern,
  ]

  for (const mutate of mutations) {
    const candidate = structuredClone(parsedContract)
    mutate(candidate)

    const result = runGuard(yaml.dump(candidate))

    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, /EmployeeResource field/i)
  }
})

test('rejects a missing employee compliance-alert collection operation', () => {
  const candidate = structuredClone(parsedContract)
  delete candidate.paths['/employees/compliance-alerts']

  const result = runGuard(yaml.dump(candidate))

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /GET \/employees\/compliance-alerts/)
})

test('rejects employee compliance-alert filters that drift from the API', () => {
  const candidate = structuredClone(parsedContract)
  const parameters =
    candidate.paths['/employees/compliance-alerts'].get.parameters
  candidate.paths['/employees/compliance-alerts'].get.parameters =
    parameters.filter(
      (parameter) =>
        resolveParameter(candidate, parameter)?.name !== 'compliance_status'
    )

  const result = runGuard(yaml.dump(candidate))

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /effective.*compliance_status/i)
})

test('rejects employee compliance-alert parameter schema drift', () => {
  const mutations = [
    ['page', (parameter) => (parameter.schema.minimum = 0)],
    ['per_page', (parameter) => (parameter.schema.maximum = 1000)],
    ['status', (parameter) => (parameter.schema = { type: 'integer' })],
    ['search', (parameter) => (parameter.schema.maxLength = 256)],
    ['legal_entity_id', (parameter) => delete parameter.schema.format],
    ['establishment_id', (parameter) => (parameter.in = 'header')],
  ]

  for (const [name, mutate] of mutations) {
    const candidate = structuredClone(parsedContract)
    mutate(employeeComplianceAlertParameter(candidate, name))

    const result = runGuard(yaml.dump(candidate))

    assert.notEqual(result.status, 0, `${name}: ${result.stdout}`)
    assert.match(result.stderr, new RegExp(name, 'i'))
  }
})

test('rejects unsupported employee compliance-alert severity values', () => {
  const candidate = structuredClone(parsedContract)
  candidate.components.schemas.EmployeeComplianceAlertStatus.enum = ['warning']

  const result = runGuard(yaml.dump(candidate))

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /warning, critical, and expired/i)
})

test('rejects an untyped employee compliance-alert payload', () => {
  const candidate = structuredClone(parsedContract)
  delete candidate.components.schemas.Employee.properties.expiring_documents

  const result = runGuard(yaml.dump(candidate))

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /expiring_documents/i)
})

test('rejects employee compliance-alert payload schema drift', () => {
  const mutations = [
    (candidate) =>
      candidate.components.schemas.Employee.required.splice(
        candidate.components.schemas.Employee.required.indexOf(
          'expiring_documents'
        ),
        1
      ),
    (candidate) =>
      (candidate.components.schemas.EmployeeComplianceAlertDocument.properties.status =
        { type: 'string' }),
    (candidate) =>
      (candidate.components.schemas.EmployeeComplianceAlertDocument.properties.days_until_expiry.maximum = 31),
  ]

  for (const mutate of mutations) {
    const candidate = structuredClone(parsedContract)
    mutate(candidate)

    const result = runGuard(yaml.dump(candidate))

    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, /expiring_documents/i)
  }
})

test('rejects optional authentication and response contract drift', () => {
  const mutations = [
    (operation) => operation.security.push({}),
    (operation) =>
      (operation.responses['200'].content['application/json'].schema.$ref =
        '#/components/schemas/EmployeeResponse'),
    (operation) =>
      (operation.responses['401'].$ref = '#/components/responses/BadRequest'),
    (operation) =>
      (operation.responses['403'].$ref = '#/components/responses/BadRequest'),
    (operation) =>
      (operation.responses['422'].$ref = '#/components/responses/BadRequest'),
    (operation) =>
      (operation.responses['500'].$ref = '#/components/responses/BadRequest'),
  ]

  for (const mutate of mutations) {
    const candidate = structuredClone(parsedContract)
    mutate(candidate.paths['/employees/compliance-alerts'].get)

    const result = runGuard(yaml.dump(candidate))

    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, /authenticated.*standard error responses/i)
  }
})

test('rejects an OU deletion response without the direct-child conflict', () => {
  const candidate = structuredClone(parsedContract)
  candidate.paths[
    '/organizational-units/{organizational_unit}'
  ].delete.responses['409'].$ref = '#/components/responses/Conflict'

  const result = runGuard(yaml.dump(candidate))

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /direct-child conflict response/i)
})

test('defines organizational-unit filters as booleans', () => {
  for (const name of ['is_active', 'is_assignable']) {
    const parameter = organizationalUnitListParameter(
      organizationalUnitListParameters,
      name
    )

    assert.deepEqual(parameter.schema, {
      type: 'boolean',
    })
  }
})

test('documents empty organizational-unit boolean filters as omitted', () => {
  for (const name of ['is_active', 'is_assignable']) {
    const parameter = organizationalUnitListParameter(
      organizationalUnitListParameters,
      name
    )

    assert.equal(parameter.allowEmptyValue, true)
    assert.match(
      parameter.description,
      /Omitted or empty values do not apply the filter\./
    )
  }
})

test('rejects organizational-unit boolean filters without empty wire allowance', () => {
  for (const name of ['is_active', 'is_assignable']) {
    const candidate = structuredClone(parsedContract)
    const parameter = organizationalUnitListParameter(
      candidate.paths['/organizational-units'].get.parameters,
      name
    )
    delete parameter.allowEmptyValue

    const result = runGuard(yaml.dump(candidate))

    assert.notEqual(result.status, 0, `${name}: ${result.stdout}`)
  }
})

test('rejects organizational-unit boolean filters without dual wire encoding', () => {
  const candidate = contract.replaceAll(
    'Omitted or empty values do not apply the filter. Non-empty query-string values may be `1` or `true` for `true`, and `0` or `false` for `false`. No other non-empty values are accepted.',
    'Filter by independent administrative status.'
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects organizational-unit boolean filters without both numeric wire values', () => {
  const candidate = contract.replaceAll("value: '0'", "value: '1'")
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects organizational-unit boolean filters without both textual wire values', () => {
  const candidate = contract.replaceAll("value: 'false'", "value: 'true'")
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects organizational-unit boolean filters with inverted numeric wire examples', () => {
  const candidate = contract
    .replaceAll("value: '1'", 'value: __placeholder__')
    .replaceAll("value: '0'", "value: '1'")
    .replaceAll('value: __placeholder__', "value: '0'")
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('accepts additional organizational-unit wire examples with allowed values', () => {
  const candidate = structuredClone(parsedContract)

  for (const name of ['is_active', 'is_assignable']) {
    const parameter = organizationalUnitListParameter(
      candidate.paths['/organizational-units'].get.parameters,
      name
    )
    const wireExamples = organizationalUnitWireExamples(parameter, name)
    wireExamples.additional_text_true = { value: 'true' }
  }

  const result = runGuard(yaml.dump(candidate))

  assert.equal(result.status, 0, result.stderr)
})

test('rejects organizational-unit boolean filters with unrelated wire values', () => {
  for (const name of ['is_active', 'is_assignable']) {
    const candidate = structuredClone(parsedContract)
    const parameter = organizationalUnitListParameter(
      candidate.paths['/organizational-units'].get.parameters,
      name
    )
    const wireExamples = organizationalUnitWireExamples(parameter, name)
    wireExamples.unsupported = { value: 'yes' }

    const result = runGuard(yaml.dump(candidate))

    assert.notEqual(result.status, 0, `${name}: ${result.stdout}`)
  }
})

test('accepts schema-valid nullable example fields', () => {
  const candidate = contract.replaceAll(
    '              name: ACME Corporation GmbH\n',
    '              name: ACME Corporation GmbH\n              vat_id: null\n'
  )
  const result = runGuard(candidate)

  assert.equal(result.status, 0, result.stderr)
})

test('rejects non-UUID Legal Entity assignment examples', () => {
  const candidate = contract.replaceAll(
    "legal_entity_id: '770e8400-e29b-41d4-a716-446655440002'",
    'legal_entity_id: not-a-uuid'
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects contradictory accepted and rejected Legal Entity IDs', () => {
  const candidate = contract.replaceAll(
    "legal_entity_id: '770e8400-e29b-41d4-a716-446655440002'",
    "legal_entity_id: '770e8400-e29b-41d4-a716-446655440000'"
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

for (const [kind, legalEntityId] of [
  ['accepted', '770e8400-e29b-41d4-a716-446655440000'],
  ['rejected', '770e8400-e29b-41d4-a716-446655440002'],
]) {
  test(`reports malformed ${kind} assignment examples without throwing`, () => {
    const candidate = contract.replaceAll(
      `            value:\n              legal_entity_id: '${legalEntityId}'`,
      `            malformed_value:\n              legal_entity_id: '${legalEntityId}'`
    )
    const result = runGuard(candidate)

    assert.equal(result.status, 1, result.stderr)
    assert.doesNotMatch(result.stderr, /TypeError/)
  })
}

test('compares Legal Entity UUIDs case-insensitively', () => {
  const candidate = contract.replaceAll(
    "legal_entity_id: '770e8400-e29b-41d4-a716-446655440002'",
    "legal_entity_id: '770E8400-E29B-41D4-A716-446655440000'"
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects malformed tenant metadata', () => {
  const candidate = contract.replaceAll(
    "legal_entity_tenant_id: '660e8400-e29b-41d4-a716-446655440002'",
    'legal_entity_tenant_id: not-a-uuid'
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('compares tenant UUIDs case-insensitively', () => {
  const candidate = contract.replaceAll(
    "legal_entity_tenant_id: '660e8400-e29b-41d4-a716-446655440002'",
    "legal_entity_tenant_id: '660E8400-E29B-41D4-A716-446655440001'"
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects assignment examples missing required request fields', () => {
  const candidate = contract.replaceAll('              billing_address:\n', '')
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects assignment examples with invalid required field types', () => {
  const candidate = contract.replaceAll(
    '              name: ACME Corporation GmbH',
    '              name: null'
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})

test('rejects assignment examples that violate nested request schemas', () => {
  const candidate = contract.replaceAll(
    '                country: DE',
    '                country: 123'
  )
  const result = runGuard(candidate)

  assert.notEqual(result.status, 0, result.stdout)
})
