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

const spec = yaml.load(
  readFileSync(new URL('../docs/openapi.yaml', import.meta.url), 'utf8')
)
const paths = spec.paths
const contextPath = '/auth/membership-context'
const nativeContextPath = '/auth/token/membership-context'
const assignmentsPath = '/memberships/{membershipId}/access-assignments'
const emailChangePath = '/me/email-change-requests'
const json = (operation, status) =>
  operation.responses[status].content['application/json']
const request = (operation) => operation.requestBody.content['application/json']

test('keeps browser switching separate from bearer replacement and neutral stale targets', () => {
  const browserSwitch = paths[contextPath]?.put
  const nativeSwitch = paths[nativeContextPath]?.put
  assert.ok(browserSwitch, 'missing browser membership switch')
  assert.ok(nativeSwitch, 'missing native membership switch')
  assert.deepEqual(browserSwitch.security, [{ SessionAuth: [], CsrfToken: [] }])
  assert.deepEqual(nativeSwitch.security, [{ BearerAuth: [] }])
  assert.deepEqual(request(browserSwitch).schema, request(nativeSwitch).schema)
  assert.equal(
    json(browserSwitch, '200').schema.$ref,
    '#/components/schemas/MembershipContext'
  )
  assert.equal(
    json(nativeSwitch, '200').schema.$ref,
    '#/components/schemas/NativeMembershipSwitchResponse'
  )
  assert.deepEqual(
    browserSwitch.responses['409'],
    nativeSwitch.responses['409']
  )
})

test('validates sign-in membership selection for password, MFA, and passkey completion', () => {
  const schemas = spec.components.schemas
  for (const response of [
    schemas.SessionLoginResponse,
    schemas.TokenLoginResponse,
    schemas.PasskeySessionLoginResponse,
    schemas.PasskeyTokenLoginResponse,
    ...schemas.CompletedLoginResponse.oneOf,
  ]) {
    assert.ok(response.required.includes('membership_context'))
    assert.equal(
      response.properties.membership_context.$ref,
      '#/components/schemas/SignInMembershipContext'
    )
  }
  for (const removed of [
    '/me/organizational-scopes',
    '/roles',
    '/users/{user}/roles',
    '/users/{user}/permissions',
  ]) {
    assert.equal(paths[removed], undefined, removed)
  }
})

test('binds email-change step-up to the authenticated credential flow', () => {
  const challenge = paths[`${emailChangePath}/passkey-challenge`]?.post
  const change = paths[emailChangePath].post
  assert.ok(challenge, 'missing context-bound email-change passkey challenge')
  assert.deepEqual(challenge.security, [
    { BearerAuth: [] },
    { SessionAuth: [], CsrfToken: [] },
  ])
  assert.deepEqual(change.security, challenge.security)
  assert.equal(
    json(challenge, '201').schema.$ref,
    '#/components/schemas/EmailChangePasskeyChallenge'
  )
  const proof = spec.components.schemas.EmailChangeRequest
  assert.deepEqual(proof.required, [
    'email',
    'current_password',
    'second_factor',
  ])
  assert.equal(proof.properties.current_password.writeOnly, true)
  assert.deepEqual(
    proof.properties.second_factor.oneOf.map(
      (branch) => branch.properties.method.const
    ),
    ['totp', 'passkey']
  )
})

test('validates allowed and denied wire values with the locked OpenAPI validator', () => {
  assert.ok(paths[contextPath]?.get, 'missing membership context projection')
  const context = json(paths[contextPath].get, '200')
  const {
    globalOnly,
    singleActive,
    chooseAfterSignIn,
    resumeLast,
    staleResume,
  } = context.examples
  assert.equal(globalOnly.value.memberships[0].status, 'planned')
  assert.equal(globalOnly.value.memberships[0].selected, false)
  const [active] = singleActive.value.memberships
  assert.equal(active.selected, true)
  assert.equal(Object.hasOwn(active, 'employee_id'), false)
  assert.equal(chooseAfterSignIn.value.preference, 'ask')
  assert.ok(chooseAfterSignIn.value.memberships.length > 1)
  assert.ok(
    chooseAfterSignIn.value.memberships.every(({ selected }) => !selected)
  )
  assert.equal(resumeLast.value.preference, 'resume_last')
  assert.equal(resumeLast.value.memberships[0].selected, true)
  assert.ok(staleResume.value.memberships.every(({ selected }) => !selected))

  const candidate = structuredClone(spec)
  const candidateContext = json(candidate.paths[contextPath].get, '200')
  for (const status of ['suspended', 'ended', 'planned']) {
    candidateContext.examples[`${status}Selected`] = {
      value: { ...singleActive.value, memberships: [{ ...active, status }] },
    }
  }
  candidateContext.examples.singleWithoutActivation = {
    value: {
      ...singleActive.value,
      memberships: [{ ...active, selected: false }],
    },
  }
  const explicitSelection = structuredClone(chooseAfterSignIn.value)
  explicitSelection.memberships[0].selected = true
  candidateContext.examples.readAfterExplicitSelection = {
    value: explicitSelection,
  }
  candidateContext.examples.doubleSelection = {
    value: {
      ...explicitSelection,
      memberships: explicitSelection.memberships.map((entry) => ({
        ...entry,
        selected: true,
      })),
    },
  }
  candidateContext.examples.tenantAlias = {
    value: { ...singleActive.value, tenant_id: active.membership_id },
  }
  const signIn = (membershipContext) => ({
    value: {
      user: {
        id: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Ada',
        email: 'ada@secpal.app',
        emailVerified: true,
      },
      membership_context: membershipContext,
    },
  })
  json(candidate.paths['/auth/login'].post, '200').examples = {
    signedInGlobalOnly: signIn(globalOnly.value),
    signedInWithOne: signIn(singleActive.value),
    signedInAsk: signIn(chooseAfterSignIn.value),
    signedInResume: signIn(resumeLast.value),
    signedInStaleResume: signIn(staleResume.value),
    loginAskWithAutomaticSelection: signIn(explicitSelection),
  }

  const switchBody = request(candidate.paths[contextPath].put)
  switchBody.examples = {
    tenantOverride: {
      value: {
        membership_id: active.membership_id,
        tenant_id: active.membership_id,
      },
    },
  }
  const grant = request(paths[assignmentsPath].post).examples.multipleTargets
    .value
  request(candidate.paths[assignmentsPath].post).examples = {
    emptyScope: { value: { ...grant, scopes: [] } },
    missingTarget: { value: { ...grant, scopes: [{ kind: 'site' }] } },
    tenantScopeOverride: {
      value: {
        ...grant,
        scopes: [{ kind: 'tenant', target_id: active.membership_id }],
      },
    },
  }
  const emailChange = request(candidate.paths[emailChangePath].post)
  const totpProof = emailChange.examples.totpProof.value
  emailChange.examples.missingSecondFactor = {
    value: {
      email: totpProof.email,
      current_password: totpProof.current_password,
    },
  }
  emailChange.examples.missingCurrentPassword = {
    value: { email: totpProof.email, second_factor: totpProof.second_factor },
  }
  emailChange.examples.bearerAsProof = {
    value: {
      ...totpProof,
      second_factor: { method: 'bearer', token: 'test-token' },
    },
  }
  const reset =
    candidate.paths['/auth/password-reset-requests'].post.responses['202']
  const response =
    candidate.components.responses[reset.$ref.split('/').at(-1)].content[
      'application/json'
    ]
  response.examples = {
    deliveryDisclosure: {
      value: { ...response.example, delivery_status: 'queued' },
    },
  }
  delete response.example

  const directory = mkdtempSync(join(tmpdir(), 'membership-identity-'))
  try {
    const file = join(directory, 'openapi.yaml')
    const config = join(directory, 'redocly.yaml')
    writeFileSync(file, yaml.dump(candidate))
    writeFileSync(config, 'rules:\n  no-invalid-media-type-examples: error\n')
    const cli = fileURLToPath(
      new URL('../node_modules/.bin/redocly', import.meta.url)
    )
    const result = spawnSync(
      process.execPath,
      [cli, 'lint', '--config', config, file],
      { encoding: 'utf8' }
    )
    const diagnostics = result.stdout + result.stderr
    assert.equal(result.status, 1, diagnostics)
    for (const name of [
      'suspendedSelected',
      'endedSelected',
      'plannedSelected',
      'doubleSelection',
      'loginAskWithAutomaticSelection',
      'singleWithoutActivation',
      'tenantAlias',
      'tenantOverride',
      'emptyScope',
      'missingTarget',
      'tenantScopeOverride',
      'deliveryDisclosure',
      'missingSecondFactor',
      'missingCurrentPassword',
      'bearerAsProof',
    ]) {
      assert.ok(
        diagnostics.includes(`examples/${name}/value`),
        `Validator did not identify ${name}:\n${diagnostics}`
      )
    }
    for (const name of [
      ...Object.keys(context.examples),
      'readAfterExplicitSelection',
      'signedInGlobalOnly',
      'signedInWithOne',
      'signedInAsk',
      'signedInResume',
      'signedInStaleResume',
      'totpProof',
      'passkeyProof',
    ]) {
      assert.ok(
        !diagnostics.includes(`examples/${name}/value`),
        `Validator rejected ${name}`
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
