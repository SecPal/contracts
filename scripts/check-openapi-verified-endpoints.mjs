#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

/**
 * Regression guard: fail if docs/openapi.yaml omits verified API operations
 * or regresses their critical contract invariants (membership and identity +
 * German address reference data + employee documents + qualification catalog +
 * employee qualifications + employee compliance alerts +
 * onboarding upload idempotency +
 * passkey enrollment and deletion password step-up + canonical schema-4
 * bootstrap and notification runtime metadata).
 *
 * Usage: node scripts/check-openapi-verified-endpoints.mjs <path-to-openapi.yaml>
 */

import fs from 'fs'
import path from 'path'
import { isDeepStrictEqual } from 'node:util'
import * as yaml from 'js-yaml'

/** @type {readonly [method: string, pathTemplate: string][]} */
const REQUIRED_OPERATIONS = [
  ['get', '/addresses/de/streets'],
  ['get', '/addresses/de/localities'],
  ['get', '/addresses/de/status'],
  ['get', '/employees/compliance-alerts'],
  ['get', '/employees/{employee}/documents'],
  ['post', '/employees/{employee}/documents'],
  ['get', '/employees/{employee}/documents/{document}'],
  ['get', '/employees/{employee}/documents/{document}/download'],
  ['delete', '/employees/{employee}/documents/{document}'],
  ['get', '/qualifications'],
  ['post', '/qualifications'],
  ['get', '/qualifications/{qualification}'],
  ['patch', '/qualifications/{qualification}'],
  ['delete', '/qualifications/{qualification}'],
  ['get', '/employees/{employee}/qualifications'],
  ['post', '/employees/{employee}/qualifications'],
  ['get', '/employee-qualifications/{employeeQualification}'],
  ['patch', '/employee-qualifications/{employeeQualification}'],
  ['delete', '/employee-qualifications/{employeeQualification}'],
  ['post', '/onboarding/submissions/{submission}/files'],
  ['post', '/me/passkeys/challenges/registration'],
  ['post', '/me/passkeys/challenges/registration/{challengeId}/verify'],
  ['delete', '/me/passkeys/{credentialId}'],
]

const readSecurity = [{ BearerAuth: [] }, { SessionAuth: [] }]
const writeSecurity = [{ BearerAuth: [] }, { SessionAuth: [], CsrfToken: [] }]
const browserWriteSecurity = [{ SessionAuth: [], CsrfToken: [] }]
const nativeWriteSecurity = [{ BearerAuth: [] }]

const MEMBERSHIP_IDENTITY_OPERATIONS = [
  ['get', '/auth/membership-context', readSecurity],
  [
    'put',
    '/auth/membership-context',
    browserWriteSecurity,
    '409',
    'MembershipUnavailable',
  ],
  [
    'put',
    '/auth/token/membership-context',
    nativeWriteSecurity,
    '409',
    'MembershipUnavailable',
  ],
  ['put', '/me/membership-preference', writeSecurity],
  ['get', '/memberships/{membershipId}/access-assignments', readSecurity],
  ['post', '/memberships/{membershipId}/access-assignments', writeSecurity],
  [
    'delete',
    '/memberships/{membershipId}/access-assignments/{assignmentId}',
    writeSecurity,
  ],
  ['post', '/invitations', writeSecurity, '202', 'IdentityRequestAccepted'],
  [
    'post',
    '/auth/invitations/{operationId}/accept',
    writeSecurity,
    '409',
    'IdentityOperationUnavailable',
  ],
  [
    'post',
    '/auth/invitations/{operationId}/register',
    [],
    '409',
    'IdentityOperationUnavailable',
  ],
  [
    'post',
    '/auth/password-reset-requests',
    [],
    '202',
    'IdentityRequestAccepted',
  ],
  [
    'post',
    '/auth/password-reset-requests/{operationId}/consume',
    [],
    '409',
    'IdentityOperationUnavailable',
  ],
  [
    'post',
    '/auth/email/verification-notification',
    writeSecurity,
    '202',
    'IdentityRequestAccepted',
  ],
  [
    'post',
    '/auth/email/verifications/{operationId}/consume',
    [],
    '409',
    'IdentityOperationUnavailable',
  ],
  ['post', '/me/email-change-requests/passkey-challenge', writeSecurity],
  [
    'post',
    '/me/email-change-requests',
    writeSecurity,
    '202',
    'IdentityRequestAccepted',
  ],
  [
    'post',
    '/auth/email-change-requests/{operationId}/consume',
    [],
    '409',
    'IdentityOperationUnavailable',
  ],
]

const AUTHENTICATION_OPERATIONS = [
  ['post', '/auth/login'],
  ['post', '/auth/token'],
  ['post', '/auth/token/passkeys/challenges'],
  ['post', '/auth/token/passkeys/challenges/{challengeId}/verify'],
  ['post', '/auth/passkeys/challenges'],
  ['post', '/auth/passkeys/challenges/{challengeId}/verify'],
  ['post', '/auth/mfa-challenges/{challengeId}/verify'],
  ['post', '/auth/logout'],
  ['post', '/auth/logout-all'],
  ['get', '/me'],
  ['get', '/me/mfa'],
  ['delete', '/me/mfa'],
  ['post', '/me/mfa/totp/enrollment'],
  ['post', '/me/mfa/totp/enrollment/confirm'],
  ['post', '/me/mfa/recovery-codes/regenerate'],
  ['get', '/me/passkeys'],
  ['post', '/me/passkeys/challenges/registration'],
  ['post', '/me/passkeys/challenges/registration/{challengeId}/verify'],
  ['delete', '/me/passkeys/{credentialId}'],
]

const target = process.argv[2]
if (!target) {
  console.error(
    'Usage: node scripts/check-openapi-verified-endpoints.mjs <path-to-openapi.yaml>'
  )
  process.exit(2)
}

const abs = path.resolve(target)
let raw
try {
  raw = fs.readFileSync(abs, 'utf8')
} catch (e) {
  console.error(`Cannot read OpenAPI file: ${abs}`)
  console.error(e)
  process.exit(2)
}

let doc
try {
  doc = yaml.load(raw, { schema: yaml.JSON_SCHEMA })
} catch (e) {
  console.error(`Invalid YAML: ${abs}`)
  console.error(e)
  process.exit(2)
}

const paths =
  doc && typeof doc.paths === 'object' && doc.paths !== null ? doc.paths : {}
const missing = []

const operationKeys = new Set()
for (const [method, pathKey] of [
  ...REQUIRED_OPERATIONS,
  ...AUTHENTICATION_OPERATIONS,
  ...MEMBERSHIP_IDENTITY_OPERATIONS,
]) {
  const label = `${method.toUpperCase()} ${pathKey}`
  operationKeys.add(label)
  if (paths[pathKey]?.[method] == null) {
    missing.push(label)
  }
}

if (missing.length) {
  console.error(
    'OpenAPI verified-endpoint presence guard failed. Missing operations:'
  )
  for (const line of missing) {
    console.error(`  - ${line}`)
  }
  process.exit(1)
}

const schemas = doc?.components?.schemas ?? {}
const componentParameters = doc?.components?.parameters ?? {}
const responses = doc?.components?.responses ?? {}
const customer = schemas.Customer ?? {}
const customerCreateRequest = schemas.CustomerCreateRequest ?? {}
const customerCreateRequestBody = paths['/customers']?.post?.requestBody ?? {}
const customerCreateSchema =
  customerCreateRequestBody?.content?.['application/json']?.schema ?? {}
const customerUpdateRequestBody =
  paths['/customers/{customer}']?.patch?.requestBody ?? {}
const customerUpdateSchema =
  customerUpdateRequestBody?.content?.['application/json']?.schema ?? {}
const customerUpdateRequest = schemas.CustomerUpdateRequest ?? {}
const employeeComplianceAlerts = paths['/employees/compliance-alerts']?.get
const onboardingSubmissionFileUpload =
  paths['/onboarding/submissions/{submission}/files']?.post
const onboardingSubmissionFileUploadRequest =
  schemas.UploadOnboardingSubmissionFileRequest ?? {}
const passkeyRegistrationStart =
  paths['/me/passkeys/challenges/registration']?.post
const passkeyRegistrationVerification =
  paths['/me/passkeys/challenges/registration/{challengeId}/verify']?.post
const passkeyDeletion = paths['/me/passkeys/{credentialId}']?.delete
const passkeyCurrentPasswordStepUp =
  schemas.PasskeyCurrentPasswordStepUpRequest ?? {}
const passkeyRegistrationVerificationRequest =
  schemas.PasskeyRegistrationVerificationRequest ?? {}
const contractErrors = []
const canonicalLogout = paths['/auth/logout']?.post ?? {}
const canonicalLogoutSecurityAlternatives = writeSecurity

for (const [
  method,
  pathKey,
  security,
  status,
  response,
] of MEMBERSHIP_IDENTITY_OPERATIONS) {
  const operation = paths[pathKey][method]
  const label = `${method.toUpperCase()} ${pathKey}`
  if (
    !Array.isArray(operation.security) ||
    operation.security.length !== security.length ||
    !security.every((expected) =>
      operation.security.some((actual) => isDeepStrictEqual(actual, expected))
    )
  ) {
    contractErrors.push(
      `${label} must preserve its membership and identity authentication modes.`
    )
  }
  if (
    response &&
    operation.responses?.[status]?.$ref !== `#/components/responses/${response}`
  ) {
    contractErrors.push(
      `${label} must reuse the neutral ${status} ${response} response.`
    )
  }
}

const identityNoStore = doc.components?.headers?.IdentityNoStore
if (
  identityNoStore?.required !== true ||
  identityNoStore?.schema?.const !== 'no-store'
) {
  contractErrors.push('IdentityNoStore must require Cache-Control: no-store.')
}

const uncachedIdentityResponses = [
  ['post', '/auth/login', '200'],
  ['post', '/auth/login', '202'],
  ['post', '/auth/token', '201'],
  ['post', '/auth/token', '202'],
  ['post', '/auth/token/passkeys/challenges', '201'],
  ['post', '/auth/token/passkeys/challenges/{challengeId}/verify', '200'],
  ['post', '/auth/passkeys/challenges', '201'],
  ['post', '/auth/passkeys/challenges/{challengeId}/verify', '200'],
  ['post', '/auth/mfa-challenges/{challengeId}/verify', '200'],
  ['get', '/auth/membership-context', '200'],
  ['put', '/auth/membership-context', '200'],
  ['put', '/auth/token/membership-context', '200'],
  ['post', '/me/email-change-requests/passkey-challenge', '201'],
]
for (const [method, pathKey, status] of uncachedIdentityResponses) {
  const header =
    paths[pathKey][method].responses?.[status]?.headers?.['Cache-Control']
  if (header?.$ref !== '#/components/headers/IdentityNoStore') {
    contractErrors.push(
      `${method.toUpperCase()} ${pathKey} ${status} must require Cache-Control: no-store.`
    )
  }
}

const membershipAccessPaths = new Set(
  MEMBERSHIP_IDENTITY_OPERATIONS.map(([, pathKey]) => pathKey).filter(
    (pathKey) => pathKey.startsWith('/memberships/')
  )
)
for (const pathKey of Object.keys(paths)) {
  if (
    (/\/(?:tenant-memberships|access-assignments)(?:\/|$)/.test(pathKey) &&
      !membershipAccessPaths.has(pathKey)) ||
    /^\/permissions(?:\/|$)/.test(pathKey) ||
    pathKey === '/me/organizational-scopes' ||
    /^\/roles(?:\/|$)/.test(pathKey) ||
    /^\/users\/\{[^/]+\}\/(?:roles|permissions)(?:\/|$)/.test(pathKey)
  ) {
    contractErrors.push(
      `${pathKey} is a retired user-based authorization path.`
    )
  }
}

if (paths['/auth/session/logout'] !== undefined) {
  contractErrors.push(
    'POST /auth/session/logout is retired and must not be published.'
  )
}

if (
  canonicalLogout.operationId !== 'logoutCurrentAuthContext' ||
  !/browser sessions/i.test(canonicalLogout.description ?? '') ||
  !/bearer-token clients revoke the current personal access token/i.test(
    canonicalLogout.description ?? ''
  ) ||
  canonicalLogout.responses?.['200']?.content?.['application/json']?.schema
    ?.$ref !== '#/components/schemas/SimpleMessageResponse'
) {
  contractErrors.push(
    'POST /auth/logout must remain the canonical session and bearer-token logout operation.'
  )
}

if (
  !Array.isArray(canonicalLogout.security) ||
  canonicalLogout.security.length !==
    canonicalLogoutSecurityAlternatives.length ||
  !canonicalLogoutSecurityAlternatives.every((expectedAlternative) =>
    canonicalLogout.security.some((actualAlternative) =>
      isDeepStrictEqual(actualAlternative, expectedAlternative)
    )
  )
) {
  contractErrors.push(
    'POST /auth/logout must preserve the canonical /auth/logout security alternatives: BearerAuth, or SessionAuth with CsrfToken.'
  )
}

const onboardingUploadIdempotencyKey =
  onboardingSubmissionFileUploadRequest.properties?.idempotency_key ?? {}
const onboardingUploadConflict =
  responses.OnboardingUploadIdempotencyConflict ?? {}
const onboardingUploadValidation =
  responses.OnboardingUploadMissingDocumentSubtype ?? {}

if (
  onboardingSubmissionFileUpload?.requestBody?.content?.['multipart/form-data']
    ?.schema?.$ref !==
    '#/components/schemas/UploadOnboardingSubmissionFileRequest' ||
  onboardingSubmissionFileUploadRequest.required?.includes('idempotency_key') ||
  onboardingUploadIdempotencyKey.type !== 'string' ||
  onboardingUploadIdempotencyKey.minLength !== 32 ||
  onboardingUploadIdempotencyKey.maxLength !== 64 ||
  onboardingUploadIdempotencyKey.pattern !== '^[A-Za-z0-9_-]+$' ||
  onboardingSubmissionFileUpload?.responses?.['200']?.content?.[
    'application/json'
  ]?.schema?.$ref !==
    '#/components/schemas/OnboardingSubmissionFileUploadResponse' ||
  onboardingSubmissionFileUpload?.responses?.['201']?.content?.[
    'application/json'
  ]?.schema?.$ref !==
    '#/components/schemas/OnboardingSubmissionFileUploadResponse' ||
  onboardingSubmissionFileUpload?.responses?.['409']?.$ref !==
    '#/components/responses/OnboardingUploadIdempotencyConflict' ||
  onboardingSubmissionFileUpload?.responses?.['422']?.$ref !==
    '#/components/responses/OnboardingUploadMissingDocumentSubtype' ||
  !onboardingUploadConflict.description?.includes('different upload') ||
  !onboardingUploadConflict.description?.includes(
    'remains reserved after its attachment was deleted'
  ) ||
  onboardingUploadConflict.content?.['application/json']?.schema?.$ref !==
    '#/components/schemas/SimpleMessageResponse' ||
  onboardingUploadConflict.content?.['application/json']?.example?.message !==
    'The upload idempotency key was already used for a different upload.' ||
  onboardingUploadValidation.description !==
    'Validation Error - Invalid onboarding upload request' ||
  onboardingUploadValidation.content?.['application/json']?.schema?.$ref !==
    '#/components/schemas/ValidationProblem' ||
  onboardingUploadValidation.content?.['application/json']?.examples
    ?.invalidIdempotencyKey?.value?.errors?.idempotency_key?.[0] !==
    'The idempotency key field format is invalid.'
) {
  contractErrors.push(
    'Onboarding file upload must preserve its optional bounded idempotency key, 200 exact-replay, 201 creation, message-only 409 conflict, and 422 validation contracts.'
  )
}

const passkeyRegistrationStartRequestBody =
  passkeyRegistrationStart?.requestBody ?? {}
const passkeyRegistrationVerificationRequestBody =
  passkeyRegistrationVerification?.requestBody ?? {}
const passkeyDeletionRequestBody = passkeyDeletion?.requestBody ?? {}
const passkeyDeletionExample =
  passkeyDeletionRequestBody.content?.['application/json']?.examples
    ?.current_password_step_up?.value
const passkeyRegistrationVerificationStepUp =
  passkeyRegistrationVerificationRequest.allOf?.find(
    (schema) =>
      schema?.$ref ===
      '#/components/schemas/PasskeyCurrentPasswordStepUpRequest'
  )
const passkeyRegistrationVerificationCredential =
  passkeyRegistrationVerificationRequest.allOf?.find(
    (schema) => schema?.properties?.credential
  )

if (
  !isDeepStrictEqual(passkeyCurrentPasswordStepUp.required, [
    'current_password',
  ]) ||
  passkeyCurrentPasswordStepUp.properties?.current_password?.type !==
    'string' ||
  passkeyCurrentPasswordStepUp.properties?.current_password?.format !==
    'password' ||
  passkeyCurrentPasswordStepUp.properties?.current_password?.writeOnly !==
    true ||
  passkeyRegistrationStartRequestBody.required !== true ||
  passkeyRegistrationStartRequestBody.content?.['application/json']?.schema
    ?.$ref !== '#/components/schemas/PasskeyCurrentPasswordStepUpRequest' ||
  passkeyRegistrationStart.responses?.['422']?.$ref !==
    '#/components/responses/ValidationError' ||
  passkeyRegistrationVerificationRequestBody.required !== true ||
  passkeyRegistrationVerificationRequestBody.content?.['application/json']
    ?.schema?.$ref !==
    '#/components/schemas/PasskeyRegistrationVerificationRequest' ||
  !passkeyRegistrationVerificationStepUp ||
  passkeyRegistrationVerificationCredential?.type !== 'object' ||
  !isDeepStrictEqual(passkeyRegistrationVerificationCredential.required, [
    'credential',
  ]) ||
  passkeyRegistrationVerificationCredential.properties?.credential?.$ref !==
    '#/components/schemas/PasskeyRegistrationCredential' ||
  !isDeepStrictEqual(
    passkeyRegistrationVerificationCredential.properties?.label?.type,
    ['string', 'null']
  ) ||
  passkeyRegistrationVerificationCredential.properties?.label?.maxLength !== 100
) {
  contractErrors.push(
    'Passkey enrollment must preserve the required bodies, validation response, password step-up, credential, and optional label contracts.'
  )
}

if (
  passkeyDeletionRequestBody.required !== true ||
  passkeyDeletionRequestBody.content?.['application/json']?.schema?.$ref !==
    '#/components/schemas/PasskeyCurrentPasswordStepUpRequest' ||
  !matchesSchema(
    passkeyDeletionRequestBody.content?.['application/json']?.schema,
    passkeyDeletionExample
  ) ||
  !/drop bodies on `DELETE` requests/i.test(
    passkeyDeletion?.description ?? ''
  ) ||
  !/Content-Type: application\/json/.test(passkeyDeletion?.description ?? '') ||
  passkeyDeletion.responses?.['422']?.$ref !==
    '#/components/responses/ValidationError' ||
  passkeyDeletion.responses?.['429']?.$ref !==
    '#/components/responses/SimpleTooManyRequests'
) {
  contractErrors.push(
    'Passkey deletion must preserve its required current-password step-up body, schema-valid example, DELETE-body transport guidance, validation response, and message-only throttling response.'
  )
}

const canonicalSchemaVersionComponents = [
  'NotificationRuntimeState',
  'NotificationRuntimeStateConflictDetails',
  'BootstrapCompatibility',
]
const canonicalSchemaVersionSchemaKeywords = new Set([
  'type',
  'const',
  'description',
  'example',
])

for (const schemaName of canonicalSchemaVersionComponents) {
  const schemaVersion = schemas[schemaName]?.properties?.schema_version
  const unexpectedKeywords = Object.keys(schemaVersion ?? {}).filter(
    (keyword) => !canonicalSchemaVersionSchemaKeywords.has(keyword)
  )

  if (
    schemaVersion?.type !== 'integer' ||
    schemaVersion?.const !== 4 ||
    schemaVersion?.example !== 4 ||
    unexpectedKeywords.length > 0
  ) {
    contractErrors.push(
      `${schemaName}.schema_version must define canonical schema version integer 4 as its only valid value and example, without additional validation constraints.`
    )
  }
}

function verifyCanonicalSchemaVersionExampleValues(candidate) {
  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      verifyCanonicalSchemaVersionExampleValues(item)
    }

    return
  }

  if (candidate === null || typeof candidate !== 'object') {
    return
  }

  for (const [key, value] of Object.entries(candidate)) {
    if (key === 'schema_version' && value !== 4) {
      contractErrors.push(
        'Every concrete runtime and bootstrap schema version value must be integer 4.'
      )
    }

    verifyCanonicalSchemaVersionExampleValues(value)
  }
}

const notificationInstallation =
  paths['/me/notification-installations/{installationId}']?.put
const canonicalSchemaVersionExampleCollections = [
  responses.NotificationInstallationConflict?.content?.['application/json']
    ?.examples,
  notificationInstallation?.requestBody?.content?.['application/json']
    ?.examples,
  notificationInstallation?.responses?.['200']?.content?.['application/json']
    ?.examples,
  notificationInstallation?.responses?.['201']?.content?.['application/json']
    ?.examples,
  paths['/bootstrap']?.get?.responses?.['200']?.content?.['application/json']
    ?.examples,
]

for (const examples of canonicalSchemaVersionExampleCollections) {
  verifyCanonicalSchemaVersionExampleValues(examples)
}

const parameterRefPrefix = '#/components/parameters/'
const resolveParameter = (parameter) => {
  if (!parameter?.$ref?.startsWith(parameterRefPrefix)) return parameter
  return componentParameters[parameter.$ref.slice(parameterRefPrefix.length)]
}
const hasExactlyParameterRefs = (actual, expected) =>
  actual.length === expected.length &&
  isDeepStrictEqual(
    actual.map((parameter) => parameter?.$ref).sort(),
    [...expected].sort()
  )

const employeeListParameterRefs = [
  '#/components/parameters/EmployeePage',
  '#/components/parameters/EmployeePerPage',
  '#/components/parameters/EmployeeStatusFilter',
  '#/components/parameters/EmployeeSearchFilter',
  '#/components/parameters/EmployeeEstablishmentFilter',
]
const employeeComplianceAlertParameterRefs = [
  ...employeeListParameterRefs.slice(0, 3),
  '#/components/parameters/EmployeeComplianceStatusFilter',
  ...employeeListParameterRefs.slice(3),
]
const employeeListParameters = paths['/employees']?.get?.parameters ?? []
const employeeComplianceAlertParameterEntries =
  employeeComplianceAlerts?.parameters ?? []

if (
  !hasExactlyParameterRefs(employeeListParameters, employeeListParameterRefs) ||
  !hasExactlyParameterRefs(
    employeeComplianceAlertParameterEntries,
    employeeComplianceAlertParameterRefs
  )
) {
  contractErrors.push(
    'GET /employees and GET /employees/compliance-alerts must reuse exactly the effective page, per_page, status, compliance_status, search, and establishment_id query parameter components applicable to each operation.'
  )
}

const employeeComplianceAlertParameters =
  employeeComplianceAlertParameterEntries.map(resolveParameter)
const expectedEmployeeComplianceAlertParameters = {
  page: {
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
  },
  per_page: {
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 15 },
  },
  status: {
    in: 'query',
    required: false,
    schema: { $ref: '#/components/schemas/EmployeeStatus' },
  },
  compliance_status: {
    in: 'query',
    required: false,
    schema: { $ref: '#/components/schemas/EmployeeComplianceAlertStatus' },
  },
  search: {
    in: 'query',
    required: false,
    schema: { type: 'string', maxLength: 255 },
  },
  establishment_id: {
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  },
}

for (const [name, expected] of Object.entries(
  expectedEmployeeComplianceAlertParameters
)) {
  const matches = employeeComplianceAlertParameters.filter(
    (parameter) => parameter?.name === name
  )
  const actual = matches[0]
  if (
    matches.length !== 1 ||
    !isDeepStrictEqual(
      {
        in: actual?.in,
        required: actual?.required,
        schema: actual?.schema,
      },
      expected
    )
  ) {
    contractErrors.push(
      `GET /employees/compliance-alerts ${name} must match the verified API query contract.`
    )
  }
}

const complianceStatusSchema = schemas.EmployeeComplianceAlertStatus ?? {}
const complianceStatusParameter = employeeComplianceAlertParameters.find(
  (parameter) => parameter?.name === 'compliance_status'
)
if (
  complianceStatusSchema.type !== 'string' ||
  complianceStatusSchema.enum?.join(',') !== 'warning,critical,expired'
) {
  contractErrors.push(
    'EmployeeComplianceAlertStatus must allow exactly warning, critical, and expired.'
  )
}

if (
  !/highest active alert severity/i.test(
    employeeComplianceAlerts?.description ?? ''
  ) ||
  !/highest active alert severity/i.test(
    complianceStatusParameter?.description ?? ''
  ) ||
  !/highest active employee compliance-alert severity/i.test(
    complianceStatusSchema.description ?? ''
  )
) {
  contractErrors.push(
    'GET /employees/compliance-alerts must describe compliance_status as the highest active alert severity for each employee.'
  )
}

const employee = schemas.Employee ?? {}
const employeeCreateRequest = schemas.EmployeeCreateRequest ?? {}
const employeeUpdateRequest = schemas.EmployeeUpdateRequest ?? {}
const employeeAdditionalCertification =
  schemas.EmployeeAdditionalCertification ?? {}
const alertDocument = schemas.EmployeeComplianceAlertDocument ?? {}
const employeeResourceProperties = [
  'id',
  'tenant_id',
  'employee_number',
  'first_name',
  'last_name',
  'full_name',
  'date_of_birth',
  'email',
  'phone',
  'bwr_id',
  'bwr_status',
  'bwr_registered_at',
  'bwr_submission_date',
  'bwr_notes',
  'gender',
  'birth_name',
  'previous_names',
  'birth_city',
  'birth_country',
  'nationalities',
  'addresses',
  'current_address',
  'structured_address',
  'emergency_contacts',
  'intended_activities',
  'id_document_type',
  'id_document_number',
  'id_document_expiry',
  'id_document_copy_deleted_at',
  'tax_id',
  'social_security_number',
  'status',
  'health_insurance_type',
  'health_insurance_provider',
  'health_insurance_number',
  'sachkunde_type',
  'sachkunde_certificate',
  'sachkunde_ihk_number',
  'sachkunde_exam_date',
  'sachkunde_issued_date',
  'work_permit_type',
  'work_permit_number',
  'work_permit_expiry',
  'work_permit_issued_by',
  'work_permit_copy_deleted_at',
  'firearms_license_number',
  'firearms_license_expiry',
  'firearms_license_issued_by',
  'first_aid_cert_number',
  'first_aid_cert_date',
  'first_aid_cert_expiry',
  'fire_safety_cert_date',
  'fire_safety_cert_expiry',
  'evacuation_cert_date',
  'evacuation_cert_expiry',
  'additional_certifications',
  'residence_permit_type',
  'residence_permit_number',
  'residence_permit_expiry',
  'requires_work_permit',
  'has_valid_work_authorization',
  'expiring_documents',
  'criminal_record_status',
  'criminal_record_check_date',
  'user_id',
  'user_account_active',
  'user_account_activated_at',
  'user_account_deactivated_at',
  'onboarding_completed',
  'onboarding_steps',
  'onboarding_started_at',
  'onboarding_completed_at',
  'onboarding_workflow',
  'onboarding_invitation',
  'user',
  'qualifications',
  'documents',
  'created_at',
  'updated_at',
  'deleted_at',
]
const conditionallyOmittedEmployeeProperties =
  'addresses current_address id_document_number tax_id social_security_number health_insurance_number sachkunde_ihk_number work_permit_number firearms_license_number first_aid_cert_number residence_permit_number user qualifications documents'.split(
    ' '
  )
const requiredEmployeeResourceProperties = employeeResourceProperties.filter(
  (property) => !conditionallyOmittedEmployeeProperties.includes(property)
)
const sensitiveEmployeeProperties =
  'id_document_number tax_id social_security_number health_insurance_number sachkunde_ihk_number work_permit_number firearms_license_number first_aid_cert_number residence_permit_number'.split(
    ' '
  )
const conditionallyLoadedEmployeeRelationships = [
  'addresses',
  'current_address',
  'user',
  'qualifications',
  'documents',
]
const workPermitTypes = [
  'none',
  'temporary',
  'permanent',
  'blue_card',
  'seasonal',
  'student',
]
const expectedWorkPermitTypeShape = {
  type: ['string', 'null'],
  enum: workPermitTypes,
}
const contractShape = (value) => {
  if (Array.isArray(value)) return value.map(contractShape)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['description', 'example'].includes(key))
      .map(([key, entry]) => [key, contractShape(entry)])
  )
}
const expectedEmployeeResourcePropertyShapes = {
  id_document_type: {
    type: ['string', 'null'],
    enum: ['passport', 'id_card', 'residence_permit'],
  },
  id_document_number: { type: ['string', 'null'] },
  id_document_expiry: { type: ['string', 'null'], format: 'date' },
  id_document_copy_deleted_at: {
    $ref: '#/components/schemas/NullableApiTimestamp',
  },
  work_permit_issued_by: { type: ['string', 'null'], maxLength: 255 },
  work_permit_copy_deleted_at: {
    $ref: '#/components/schemas/NullableApiTimestamp',
  },
  work_permit_type: expectedWorkPermitTypeShape,
  firearms_license_number: { type: ['string', 'null'] },
  firearms_license_expiry: { type: ['string', 'null'], format: 'date' },
  firearms_license_issued_by: {
    type: ['string', 'null'],
    maxLength: 255,
  },
  first_aid_cert_number: { type: ['string', 'null'] },
  first_aid_cert_date: { type: ['string', 'null'], format: 'date' },
  first_aid_cert_expiry: { type: ['string', 'null'], format: 'date' },
  fire_safety_cert_date: { type: ['string', 'null'], format: 'date' },
  fire_safety_cert_expiry: { type: ['string', 'null'], format: 'date' },
  evacuation_cert_date: { type: ['string', 'null'], format: 'date' },
  evacuation_cert_expiry: { type: ['string', 'null'], format: 'date' },
  additional_certifications: {
    type: 'array',
    items: { $ref: '#/components/schemas/EmployeeAdditionalCertification' },
  },
  requires_work_permit: { type: 'boolean' },
  has_valid_work_authorization: { type: 'boolean' },
  qualifications: {
    type: 'array',
    items: { $ref: '#/components/schemas/EmployeeQualificationResource' },
  },
  documents: {
    type: 'array',
    items: { $ref: '#/components/schemas/EmployeeDocumentResource' },
  },
}
const actualEmployeeResourcePropertyShapes = Object.fromEntries(
  Object.keys(expectedEmployeeResourcePropertyShapes).map((property) => [
    property,
    contractShape(employee.properties?.[property]),
  ])
)
const expectedEmployeeAdditionalCertificationShape = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', maxLength: 255 },
    number: { type: ['string', 'null'], maxLength: 255 },
    issued_date: { type: ['string', 'null'] },
    expiry_date: { type: ['string', 'null'] },
    issuer: { type: ['string', 'null'], maxLength: 255 },
  },
}
if (
  !isDeepStrictEqual(
    Object.keys(employee.properties ?? {}).sort(),
    [...employeeResourceProperties].sort()
  ) ||
  !isDeepStrictEqual(
    [...(employee.required ?? [])].sort(),
    [...requiredEmployeeResourceProperties].sort()
  ) ||
  !isDeepStrictEqual(
    actualEmployeeResourcePropertyShapes,
    expectedEmployeeResourcePropertyShapes
  ) ||
  !isDeepStrictEqual(
    contractShape(employeeCreateRequest.properties?.work_permit_type),
    expectedWorkPermitTypeShape
  ) ||
  !isDeepStrictEqual(
    contractShape(employeeUpdateRequest.properties?.work_permit_type),
    expectedWorkPermitTypeShape
  ) ||
  !isDeepStrictEqual(
    contractShape(employeeAdditionalCertification),
    expectedEmployeeAdditionalCertificationShape
  ) ||
  sensitiveEmployeeProperties.some(
    (property) =>
      !/employees\.read_sensitive/.test(
        employee.properties?.[property]?.description ?? ''
      )
  ) ||
  conditionallyLoadedEmployeeRelationships.some(
    (property) =>
      !/omitted/i.test(employee.properties?.[property]?.description ?? '')
  ) ||
  !/employees\.read_sensitive/.test(
    employee.properties?.additional_certifications?.description ?? ''
  ) ||
  !/employees\.read_sensitive/.test(
    employeeAdditionalCertification.properties?.number?.description ?? ''
  )
) {
  contractErrors.push(
    'Employee must inventory every EmployeeResource field, including permission-gated identifiers and conditionally loaded relationships.'
  )
}

const expectedAlertDocumentProperties = {
  type: {
    type: 'string',
    enum: [
      'work_permit',
      'residence_permit',
      'id_document',
      'firearms_license',
      'first_aid_certificate',
      'fire_safety_certificate',
      'evacuation_certificate',
      'additional_certification',
    ],
  },
  label: {
    type: 'string',
    description: 'Human-readable document or certification label.',
  },
  expiry: { type: 'string', format: 'date' },
  status: { $ref: '#/components/schemas/EmployeeComplianceAlertStatus' },
  days_until_expiry: { type: 'integer', minimum: -30, maximum: 30 },
}
if (
  !employee.required?.includes('expiring_documents') ||
  !isDeepStrictEqual(employee.properties?.expiring_documents, {
    type: 'array',
    items: { $ref: '#/components/schemas/EmployeeComplianceAlertDocument' },
  }) ||
  alertDocument.type !== 'object' ||
  alertDocument.additionalProperties !== false ||
  !isDeepStrictEqual(alertDocument.required, [
    'type',
    'label',
    'expiry',
    'status',
    'days_until_expiry',
  ]) ||
  !isDeepStrictEqual(alertDocument.properties, expectedAlertDocumentProperties)
) {
  contractErrors.push(
    'Employee.expiring_documents must expose the complete verified employee compliance-alert document contract.'
  )
}

if (
  !isDeepStrictEqual(employeeComplianceAlerts?.security, [
    { BearerAuth: [] },
  ]) ||
  employeeComplianceAlerts?.responses?.['200']?.content?.['application/json']
    ?.schema?.$ref !== '#/components/schemas/EmployeeCollectionResponse' ||
  employeeComplianceAlerts?.responses?.['401']?.$ref !==
    '#/components/responses/Unauthorized' ||
  employeeComplianceAlerts?.responses?.['403']?.$ref !==
    '#/components/responses/Forbidden' ||
  employeeComplianceAlerts?.responses?.['422']?.$ref !==
    '#/components/responses/ValidationError' ||
  employeeComplianceAlerts?.responses?.['500']?.$ref !==
    '#/components/responses/InternalServerError'
) {
  contractErrors.push(
    'GET /employees/compliance-alerts must reuse the authenticated employee collection and standard error responses.'
  )
}

const isNullableVatId = (schema) =>
  Array.isArray(schema?.type) &&
  schema.type.includes('string') &&
  schema.type.includes('null') &&
  schema.maxLength === 32

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isUuid = (value) => typeof value === 'string' && uuidPattern.test(value)

function matchesType(type, value) {
  if (type === 'null') return value === null
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number'
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }
  return false
}

function matchesSchema(schema, value) {
  if (!schema || typeof schema !== 'object') return false

  if (schema.$ref) {
    const prefix = '#/components/schemas/'
    if (!schema.$ref.startsWith(prefix)) return false
    return matchesSchema(schemas[schema.$ref.slice(prefix.length)], value)
  }
  if (
    schema.anyOf &&
    !schema.anyOf.some((entry) => matchesSchema(entry, value))
  ) {
    return false
  }
  if (
    schema.allOf &&
    !schema.allOf.every((entry) => matchesSchema(entry, value))
  ) {
    return false
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false
  if (schema.enum && !schema.enum.includes(value)) return false

  const declaredTypes = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : []
  if (
    declaredTypes.length > 0 &&
    !declaredTypes.some((type) => matchesType(type, value))
  ) {
    return false
  }
  if (value === null) {
    return declaredTypes.length === 0 || declaredTypes.includes('null')
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      return false
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      return false
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false
    if (schema.format === 'uuid' && !isUuid(value)) return false
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return false
    if (schema.maximum !== undefined && value > schema.maximum) return false
  }
  if (Array.isArray(value) && schema.items) {
    if (!value.every((entry) => matchesSchema(schema.items, entry)))
      return false
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    if (
      (schema.required ?? []).some(
        (property) => !Object.hasOwn(value, property)
      )
    ) {
      return false
    }
    for (const [property, propertyValue] of Object.entries(value)) {
      const propertySchema = schema.properties?.[property]
      if (propertySchema && !matchesSchema(propertySchema, propertyValue))
        return false
      if (!propertySchema && schema.additionalProperties === false) return false
    }
  }

  return true
}

const passkeyRegistrationStartExample =
  passkeyRegistrationStartRequestBody.content?.['application/json']?.examples
    ?.current_password_step_up?.value
const passkeyRegistrationVerificationExample =
  passkeyRegistrationVerificationRequestBody.content?.['application/json']
    ?.examples?.verify_registration?.value

if (
  !matchesSchema(
    passkeyRegistrationStartRequestBody.content?.['application/json']?.schema,
    passkeyRegistrationStartExample
  ) ||
  !matchesSchema(
    passkeyRegistrationVerificationRequestBody.content?.['application/json']
      ?.schema,
    passkeyRegistrationVerificationExample
  )
) {
  contractErrors.push(
    'Passkey enrollment request examples must include a valid current-password step-up.'
  )
}

if (
  customer.required?.includes('vat_id') ||
  !isNullableVatId(customer.properties?.vat_id)
) {
  contractErrors.push(
    'Customer.vat_id must be a nullable string response field with maxLength 32.'
  )
}

if (
  customerCreateRequest.required?.includes('vat_id') ||
  !isNullableVatId(customerCreateRequest.properties?.vat_id)
) {
  contractErrors.push(
    'CustomerCreateRequest.vat_id must be an optional nullable string field with maxLength 32.'
  )
}

if (
  customerUpdateRequest.required?.includes('vat_id') ||
  !isNullableVatId(customerUpdateRequest.properties?.vat_id)
) {
  contractErrors.push(
    'PATCH /customers/{customer} vat_id must be an optional nullable string field with maxLength 32.'
  )
}

if (
  customerCreateRequestBody.required !== true ||
  customerCreateSchema?.$ref !== '#/components/schemas/CustomerCreateRequest' ||
  customerCreateRequest.additionalProperties !== false ||
  Object.hasOwn(customerCreateRequest.properties ?? {}, 'legal_entity_id')
) {
  contractErrors.push(
    'POST /customers must require and reference CustomerCreateRequest as a closed Tenant-owned request.'
  )
}

const customerResponseRef = '#/components/schemas/Customer'
for (const [label, responseSchema] of [
  [
    'GET /customers',
    paths['/customers']?.get?.responses?.['200']?.content?.['application/json']
      ?.schema?.properties?.data?.items,
  ],
  [
    'POST /customers',
    paths['/customers']?.post?.responses?.['201']?.content?.['application/json']
      ?.schema?.properties?.data,
  ],
  [
    'GET /customers/{customer}',
    paths['/customers/{customer}']?.get?.responses?.['200']?.content?.[
      'application/json'
    ]?.schema?.properties?.data,
  ],
  [
    'PATCH /customers/{customer}',
    paths['/customers/{customer}']?.patch?.responses?.['200']?.content?.[
      'application/json'
    ]?.schema?.properties?.data,
  ],
]) {
  if (responseSchema?.$ref !== customerResponseRef) {
    contractErrors.push(`${label} must return the Customer schema.`)
  }
}

if (
  customerUpdateRequestBody.required !== true ||
  customerUpdateSchema?.$ref !== '#/components/schemas/CustomerUpdateRequest' ||
  customerUpdateRequest.additionalProperties !== false ||
  Object.hasOwn(customerUpdateRequest.properties ?? {}, 'legal_entity_id')
) {
  contractErrors.push(
    'PATCH /customers/{customer} must require and reference CustomerUpdateRequest as a closed Tenant-owned request.'
  )
}

if (contractErrors.length) {
  console.error('OpenAPI verified-endpoint contract guard failed:')
  for (const line of contractErrors) {
    console.error(`  - ${line}`)
  }
  process.exit(1)
}

console.log(
  `Verified-endpoint presence guard OK (${operationKeys.size} operations).`
)
