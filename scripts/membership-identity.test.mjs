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

test('uses one membership projection for password, MFA, and passkey completion', () => {
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
      '#/components/schemas/MembershipContext'
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
  assert.equal(globalOnly.value.active_membership, null)
  assert.equal(globalOnly.value.planned_memberships[0].status, 'planned')
  assert.equal(singleActive.value.active_membership.status, 'active')
  assert.equal(
    Object.hasOwn(singleActive.value.active_membership, 'employee_id'),
    false
  )
  assert.equal(chooseAfterSignIn.value.preference, 'ask')
  assert.ok(chooseAfterSignIn.value.selectable_memberships.length > 1)
  assert.equal(resumeLast.value.preference, 'resume_last')
  assert.ok(resumeLast.value.active_membership)
  assert.equal(staleResume.value.active_membership, null)

  const candidate = structuredClone(spec)
  const candidateContext = json(candidate.paths[contextPath].get, '200')
  const active = singleActive.value.active_membership
  candidateContext.examples.suspendedSelectable = {
    value: {
      ...chooseAfterSignIn.value,
      selectable_memberships: [{ ...active, status: 'suspended' }, active],
    },
  }
  candidateContext.examples.endedActive = {
    value: {
      ...singleActive.value,
      active_membership: { ...active, status: 'ended' },
    },
  }
  candidateContext.examples.plannedSelectable = {
    value: {
      ...chooseAfterSignIn.value,
      selectable_memberships: [{ ...active, status: 'planned' }, active],
    },
  }
  candidateContext.examples.singleWithoutActivation = {
    value: { ...singleActive.value, active_membership: null },
  }
  candidateContext.examples.tenantAlias = {
    value: { ...singleActive.value, tenant_id: active.membership_id },
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
      'suspendedSelectable',
      'endedActive',
      'plannedSelectable',
      'singleWithoutActivation',
      'tenantAlias',
      'tenantOverride',
      'emptyScope',
      'missingTarget',
      'tenantScopeOverride',
      'deliveryDisclosure',
    ]) {
      assert.ok(
        diagnostics.includes(`examples/${name}/value`),
        `Validator did not identify ${name}:\n${diagnostics}`
      )
    }
    for (const name of Object.keys(context.examples)) {
      assert.ok(
        !diagnostics.includes(`examples/${name}/value`),
        `Validator rejected ${name}`
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
