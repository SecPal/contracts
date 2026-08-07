#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
const YAML_RESOLUTION_RETRY_DELAYS = [50, 100, 200]
const retrySignal = new Int32Array(new SharedArrayBuffer(4))

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

function isTransientYamlResolutionFailure(result) {
  return (
    result.status !== 0 &&
    /ERR_MODULE_NOT_FOUND/.test(result.stderr) &&
    /js-yaml/.test(result.stderr)
  )
}

function waitForYamlResolutionRetry(delay) {
  Atomics.wait(retrySignal, 0, 0, delay)
}

function runGuard(
  source,
  {
    spawn = spawnSync,
    waitForRetry = waitForYamlResolutionRetry,
    writeCandidate = writeFileSync,
  } = {}
) {
  const directory = mkdtempSync(join(tmpdir(), 'verified-endpoints-'))
  const candidatePath = join(directory, 'openapi.yaml')

  try {
    writeCandidate(candidatePath, source)

    const options = {
      encoding: 'utf8',
    }
    let result = spawn(process.execPath, [guardPath, candidatePath], options)

    for (const delay of YAML_RESOLUTION_RETRY_DELAYS) {
      if (!isTransientYamlResolutionFailure(result)) {
        break
      }

      waitForRetry(delay)
      result = spawn(process.execPath, [guardPath, candidatePath], options)
    }

    return result
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('removes the temporary directory when candidate creation fails', () => {
  let candidatePath

  assert.throws(
    () =>
      runGuard(contract, {
        writeCandidate(path) {
          candidatePath = path
          throw new Error('simulated candidate write failure')
        },
      }),
    /simulated candidate write failure/
  )

  assert.ok(candidatePath, 'expected runGuard to attempt candidate creation')
  assert.equal(existsSync(dirname(candidatePath)), false)
})

test('retries a transient js-yaml module resolution failure', () => {
  let calls = 0
  const retryDelays = []
  const result = runGuard(contract, {
    spawn() {
      calls += 1

      if (calls < 3) {
        return {
          status: 1,
          stderr:
            "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'js-yaml' imported from guard.mjs",
        }
      }

      return { status: 0, stderr: '', stdout: '' }
    },
    waitForRetry(delay) {
      retryDelays.push(delay)
    },
  })

  assert.equal(result.status, 0)
  assert.equal(calls, 3)
  assert.deepEqual(retryDelays, [50, 100])
})

test('stops retrying after the bounded js-yaml backoff', () => {
  let calls = 0
  const retryDelays = []
  const result = runGuard(contract, {
    spawn() {
      calls += 1
      return {
        status: 1,
        stderr:
          "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'js-yaml' imported from guard.mjs",
      }
    },
    waitForRetry(delay) {
      retryDelays.push(delay)
    },
  })

  assert.equal(result.status, 1)
  assert.equal(calls, 4)
  assert.deepEqual(retryDelays, [50, 100, 200])
})

test('does not retry other guard failures', () => {
  let calls = 0
  const result = runGuard(contract, {
    spawn() {
      calls += 1
      return {
        status: 1,
        stderr:
          "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'unrelated-package' imported from guard.mjs",
      }
    },
  })

  assert.equal(result.status, 1)
  assert.equal(calls, 1)
})

test('accepts the repository contract', () => {
  const result = runGuard(contract)

  assert.equal(result.status, 0, result.stderr)
})

test('documents the current-password step-up for passkey enrollment', () => {
  const passkeyStepUp =
    parsedContract.components.schemas.PasskeyCurrentPasswordStepUpRequest
  const registrationStart =
    parsedContract.paths['/me/passkeys/challenges/registration'].post
  const registrationVerificationOperation =
    parsedContract.paths[
      '/me/passkeys/challenges/registration/{challengeId}/verify'
    ].post
  const registrationVerification =
    parsedContract.components.schemas.PasskeyRegistrationVerificationRequest
  const registrationVerificationStepUp = registrationVerification.allOf?.find(
    (schema) =>
      schema.$ref === '#/components/schemas/PasskeyCurrentPasswordStepUpRequest'
  )
  const registrationVerificationCredential =
    registrationVerification.allOf?.find(
      (schema) => schema.properties?.credential
    )

  assert.deepEqual(passkeyStepUp.required, ['current_password'])
  assert.equal(passkeyStepUp.properties.current_password.type, 'string')
  assert.equal(passkeyStepUp.properties.current_password.format, 'password')
  assert.equal(passkeyStepUp.properties.current_password.writeOnly, true)
  assert.equal(registrationStart.requestBody.required, true)
  assert.equal(
    registrationStart.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/PasskeyCurrentPasswordStepUpRequest'
  )
  assert.equal(
    registrationStart.responses['422'].$ref,
    '#/components/responses/ValidationError'
  )
  assert.ok(registrationStart.requestBody.content['application/json'].examples)
  assert.equal(
    registrationVerificationOperation.requestBody.content['application/json']
      .schema.$ref,
    '#/components/schemas/PasskeyRegistrationVerificationRequest'
  )
  assert.equal(registrationVerificationOperation.requestBody.required, true)
  assert.ok(
    registrationVerificationOperation.requestBody.content['application/json']
      .examples
  )
  assert.ok(
    registrationVerificationStepUp,
    'Passkey enrollment verification must reuse the current-password step-up schema'
  )
  assert.equal(registrationVerificationCredential.type, 'object')
  assert.deepEqual(registrationVerificationCredential.required, ['credential'])
  assert.equal(
    registrationVerificationCredential.properties.credential.$ref,
    '#/components/schemas/PasskeyRegistrationCredential'
  )
  assert.deepEqual(registrationVerificationCredential.properties.label.type, [
    'string',
    'null',
  ])
  assert.equal(
    registrationVerificationCredential.properties.label.maxLength,
    100
  )
})

test('rejects passkey enrollment contract invariant regressions', () => {
  const mutations = [
    {
      invariant: 'current_password remains required',
      apply(candidate) {
        candidate.components.schemas.PasskeyCurrentPasswordStepUpRequest.required =
          []
      },
    },
    {
      invariant: 'only current_password is required by the step-up schema',
      apply(candidate) {
        candidate.components.schemas.PasskeyCurrentPasswordStepUpRequest.required.push(
          'unexpected'
        )
      },
    },
    {
      invariant: 'current_password remains a string',
      apply(candidate) {
        candidate.components.schemas.PasskeyCurrentPasswordStepUpRequest.properties.current_password.type =
          'integer'
      },
    },
    {
      invariant: 'current_password retains the password format',
      apply(candidate) {
        delete candidate.components.schemas.PasskeyCurrentPasswordStepUpRequest
          .properties.current_password.format
      },
    },
    {
      invariant: 'current_password remains write-only',
      apply(candidate) {
        candidate.components.schemas.PasskeyCurrentPasswordStepUpRequest.properties.current_password.writeOnly = false
      },
    },
    {
      invariant: 'challenge creation request body remains required',
      apply(candidate) {
        candidate.paths[
          '/me/passkeys/challenges/registration'
        ].post.requestBody.required = false
      },
    },
    {
      invariant: 'challenge creation reuses the password step-up schema',
      apply(candidate) {
        candidate.paths[
          '/me/passkeys/challenges/registration'
        ].post.requestBody.content['application/json'].schema = {
          type: 'object',
        }
      },
    },
    {
      invariant: 'challenge creation documents validation errors',
      apply(candidate) {
        candidate.paths['/me/passkeys/challenges/registration'].post.responses[
          '422'
        ].$ref = '#/components/responses/Conflict'
      },
    },
    {
      invariant: 'verification request body remains required',
      apply(candidate) {
        candidate.paths[
          '/me/passkeys/challenges/registration/{challengeId}/verify'
        ].post.requestBody.required = false
      },
    },
    {
      invariant: 'verification reuses its canonical request schema',
      apply(candidate) {
        candidate.paths[
          '/me/passkeys/challenges/registration/{challengeId}/verify'
        ].post.requestBody.content['application/json'].schema.$ref =
          '#/components/schemas/PasskeyCurrentPasswordStepUpRequest'
      },
    },
    {
      invariant: 'verification reuses the password step-up schema',
      apply(candidate) {
        candidate.components.schemas.PasskeyRegistrationVerificationRequest.allOf =
          candidate.components.schemas.PasskeyRegistrationVerificationRequest.allOf.slice(
            1
          )
      },
    },
    {
      invariant: 'verification retains the credential object branch',
      apply(candidate) {
        candidate.components.schemas.PasskeyRegistrationVerificationRequest.allOf =
          candidate.components.schemas.PasskeyRegistrationVerificationRequest.allOf.slice(
            0,
            1
          )
      },
    },
    {
      invariant: 'verification credential branch remains an object',
      apply(candidate) {
        candidate.components.schemas.PasskeyRegistrationVerificationRequest.allOf[1].type =
          'array'
      },
    },
    {
      invariant: 'verification keeps credential required',
      apply(candidate) {
        candidate.components.schemas.PasskeyRegistrationVerificationRequest.allOf[1].required =
          []
      },
    },
    {
      invariant: 'verification keeps label optional',
      apply(candidate) {
        candidate.components.schemas.PasskeyRegistrationVerificationRequest.allOf[1].required.push(
          'label'
        )
      },
    },
    {
      invariant: 'verification label remains nullable',
      apply(candidate) {
        candidate.components.schemas.PasskeyRegistrationVerificationRequest.allOf[1].properties.label.type =
          'string'
      },
    },
    {
      invariant: 'verification label retains its maximum length',
      apply(candidate) {
        candidate.components.schemas.PasskeyRegistrationVerificationRequest.allOf[1].properties.label.maxLength = 255
      },
    },
    {
      invariant: 'verification reuses the registration credential schema',
      apply(candidate) {
        candidate.components.schemas.PasskeyRegistrationVerificationRequest.allOf[1].properties.credential.$ref =
          '#/components/schemas/PasskeyAuthenticationCredential'
      },
    },
    {
      invariant: 'challenge creation example includes current_password',
      apply(candidate) {
        delete candidate.paths['/me/passkeys/challenges/registration'].post
          .requestBody.content['application/json'].examples
          .current_password_step_up.value.current_password
      },
    },
    {
      invariant: 'verification example includes current_password',
      apply(candidate) {
        delete candidate.paths[
          '/me/passkeys/challenges/registration/{challengeId}/verify'
        ].post.requestBody.content['application/json'].examples
          .verify_registration.value.current_password
      },
    },
    {
      invariant: 'verification example includes credential',
      apply(candidate) {
        delete candidate.paths[
          '/me/passkeys/challenges/registration/{challengeId}/verify'
        ].post.requestBody.content['application/json'].examples
          .verify_registration.value.credential
      },
    },
  ]

  for (const mutation of mutations) {
    const candidate = structuredClone(parsedContract)
    mutation.apply(candidate)

    const result = runGuard(yaml.dump(candidate))

    assert.notEqual(result.status, 0, `${mutation.invariant}: ${result.stdout}`)
    assert.match(result.stderr, /passkey enrollment/i)
  }
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

function collectSchemaVersions(candidate) {
  const schemaVersions = []
  const notificationInstallation =
    candidate.paths['/me/notification-installations/{installationId}']?.put
  const canonicalExampleCollections = [
    candidate.components.responses.NotificationInstallationConflict?.content[
      'application/json'
    ]?.examples,
    notificationInstallation?.requestBody?.content?.['application/json']
      ?.examples,
    notificationInstallation?.responses?.['200']?.content?.['application/json']
      ?.examples,
    notificationInstallation?.responses?.['201']?.content?.['application/json']
      ?.examples,
    candidate.paths['/bootstrap']?.get?.responses?.['200']?.content?.[
      'application/json'
    ]?.examples,
  ]

  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item)
      }

      return
    }

    if (value === null || typeof value !== 'object') {
      return
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if (key === 'schema_version' && Number.isInteger(nestedValue)) {
        schemaVersions.push(nestedValue)
      }

      visit(nestedValue)
    }
  }

  for (const examples of canonicalExampleCollections) {
    visit(examples)
  }

  return schemaVersions
}

test('permits exactly integer schema 4 for every runtime schema version', () => {
  const schemaVersionProperties = [
    parsedContract.components.schemas.NotificationRuntimeState.properties
      .schema_version,
    parsedContract.components.schemas.NotificationRuntimeStateConflictDetails
      .properties.schema_version,
    parsedContract.components.schemas.BootstrapCompatibility.properties
      .schema_version,
  ]
  const schemaVersions = collectSchemaVersions(parsedContract)

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

test('limits the schema-version inventory to canonical runtime examples', () => {
  const candidate = structuredClone(parsedContract)
  candidate.info['x-unrelated-contract'] = { schema_version: 3 }

  assert.deepEqual([...new Set(collectSchemaVersions(candidate))], [4])
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
