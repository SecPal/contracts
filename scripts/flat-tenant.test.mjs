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
  readFileSync(new URL('../docs/openapi.yaml', import.meta.url), 'utf8'),
  { schema: yaml.JSON_SCHEMA }
)
const { components, paths } = spec
const { schemas } = components
const schemaRef = (name) => `#/components/schemas/${name}`
const periodsPath = '/employees/{employee}/employment-periods'
const historyPath = '/employees/{employee}/establishment-assignments'
const evidencePath = '/employees/{employee}/personnel-evidence'
const termsPath = `${periodsPath}/{period}/applicable-terms`

test('keeps employment periods, terms, and establishment assignments independent', () => {
  const {
    Employee,
    EmploymentPeriod,
    EmploymentTermsVersion,
    EmployeeEstablishmentAssignment,
  } = schemas
  assert.ok(EmploymentPeriod, 'missing EmploymentPeriod')
  assert.ok(EmploymentTermsVersion, 'missing EmploymentTermsVersion')
  assert.ok(EmployeeEstablishmentAssignment, 'missing establishment history')
  assert.ok(EmploymentPeriod.required.includes('employee_id'))
  assert.ok(EmploymentTermsVersion.required.includes('employment_period_id'))
  assert.ok(EmploymentTermsVersion.required.includes('effective_from'))
  assert.ok(EmploymentTermsVersion.required.includes('evidence_id'))
  assert.ok(EmployeeEstablishmentAssignment.required.includes('establishment'))
  assert.equal(
    EmployeeEstablishmentAssignment.properties.establishment.$ref,
    schemaRef('HistoricalEstablishment')
  )
  assert.ok(
    schemas.EmploymentPeriodCreateRequest.required.includes('initial_terms')
  )
  assert.ok(
    schemas.EmploymentPeriodCreateRequest.required.includes('establishment_id')
  )
  assert.match(
    paths[periodsPath].post.description,
    /period.*terms.*assignment atomically/is
  )
  assert.match(
    paths[historyPath].get.description,
    /facts effective at the requested instant/i
  )
  assert.ok(paths[periodsPath].post.responses['409'])
  assert.ok(paths[historyPath].post.responses['409'])
  assert.ok(paths[termsPath].get.responses['409'])
  for (const path of [periodsPath, historyPath, termsPath, evidencePath]) {
    assert.ok(paths[path].get.responses['404'], path)
  }
  for (const schema of [
    Employee,
    schemas.EmployeeCreateRequest,
    schemas.EmployeeUpdateRequest,
  ]) {
    for (const field of [
      'legal_entity_id',
      'establishment_id',
      'contract_start_date',
      'contract_type',
      'weekly_hours',
      'monthly_hours',
    ]) {
      assert.equal(schema.properties[field], undefined, field)
    }
  }
})

test('derives tenant from the active membership and disallows hierarchy selectors', () => {
  for (const [path, item] of Object.entries(paths)) {
    assert.doesNotMatch(
      path,
      /organizational-units|legal-entities|customer-candidates/
    )
    for (const operation of [
      item,
      item.get,
      item.post,
      item.patch,
      item.put,
      item.delete,
    ].filter(Boolean)) {
      for (const parameter of operation.parameters ?? []) {
        const definition = parameter.$ref
          ? components.parameters[parameter.$ref.split('/').at(-1)]
          : parameter
        assert.doesNotMatch(
          definition?.name ?? '',
          /^(?:x-tenant|tenant_id|legal_entity_id|organizational_unit_id)$/i,
          path
        )
      }
    }
  }
  for (const name of [
    'CustomerCreateRequest',
    'CustomerUpdateRequest',
    'SiteCreateRequest',
    'SiteUpdateRequest',
    'CustomerEstablishmentCreateRequest',
    'EmploymentPeriodCreateRequest',
    'EmployeeEstablishmentAssignmentCreateRequest',
  ]) {
    const schema = schemas[name]
    assert.equal(schema.additionalProperties, false, name)
    assert.equal(schema.properties.tenant_id, undefined, name)
    assert.equal(schema.properties.legal_entity_id, undefined, name)
  }
})

test('limits encrypted search to exact authorized lookup and gates personnel evidence', () => {
  const filter = components.parameters.EmployeeSearchFilter
  assert.match(filter.description, /exact/i)
  assert.match(filter.description, /authorized/i)
  const evidence = schemas.PersonnelEvidence
  assert.ok(evidence, 'missing personnel evidence projection')
  assert.match(evidence.description, /permission.*scope.*classification/is)
  for (const schema of [
    schemas.PersonnelDocumentEvidence,
    schemas.PersonnelTerminationEvidence,
    schemas.EmployeeDocumentResource,
  ]) {
    assert.equal(schema.additionalProperties, false)
    for (const field of ['file_path', 'ciphertext', 'blind_index', 'key_id']) {
      assert.equal(schema.properties[field], undefined, field)
    }
  }
})

test('validates new wire examples and rejects tenancy hints, aliases, and sensitive metadata', () => {
  const candidate = structuredClone(spec)
  const requests = [
    [periodsPath, 'EmploymentPeriodCreateRequest'],
    [historyPath, 'EmployeeEstablishmentAssignmentCreateRequest'],
    ['/customer-establishments', 'CustomerEstablishmentCreateRequest'],
    ['/sites', 'SiteCreateRequest'],
  ]
  for (const [path, name] of requests) {
    const value = schemas[name]['x-validation-examples'].accepted[0].value
    const foreignId =
      schemas[name]['x-validation-examples'].rejected[0].value.establishment_id
    candidate.paths[path].post.requestBody.content[
      'application/json'
    ].examples = {
      [`${name}Allowed`]: { value },
      [`${name}ForeignResourceIdAsTenant`]: {
        value: { ...value, tenant_id: foreignId },
      },
      [`${name}LegacyOwner`]: {
        value: { ...value, legal_entity_id: foreignId },
      },
    }
  }
  const terms =
    candidate.paths[termsPath].get.responses['200'].content['application/json']
  const validTerms = terms.example
  delete terms.example
  terms.examples = {
    applicable: { value: validTerms },
    mutableEmployeeTerms: {
      value: { ...validTerms, contract_start_date: '2026-08-01' },
    },
    leakedTermKey: { value: { ...validTerms, key_id: 'hidden' } },
  }
  const evidence =
    candidate.paths[evidencePath].get.responses['200'].content[
      'application/json'
    ]
  const [draft] = evidence.example
  const { termination_milestone: _, ...withoutMilestone } = draft
  delete evidence.example
  evidence.examples = {
    authorizedDraft: { value: [draft] },
    missingMilestone: { value: [withoutMilestone] },
    leakedEvidenceStorage: { value: [{ ...draft, file_path: 'private.pdf' }] },
    agreementWithTermination: { value: [{ ...draft, kind: 'agreement' }] },
  }

  const directory = mkdtempSync(join(tmpdir(), 'flat-tenant-'))
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
      {
        encoding: 'utf8',
      }
    )
    const diagnostics = result.stdout + result.stderr
    assert.equal(result.status, 1, diagnostics)
    const names = requests.map(([, name]) => name)
    for (const name of [
      ...names.flatMap((name) => [
        `${name}ForeignResourceIdAsTenant`,
        `${name}LegacyOwner`,
      ]),
      'mutableEmployeeTerms',
      'leakedTermKey',
      'missingMilestone',
      'leakedEvidenceStorage',
      'agreementWithTermination',
    ]) {
      assert.ok(
        diagnostics.includes(`examples/${name}/value`),
        `Expected rejection for ${name}\n${diagnostics}`
      )
    }
    for (const name of [
      ...names.map((name) => `${name}Allowed`),
      'applicable',
      'authorizedDraft',
    ]) {
      assert.ok(
        !diagnostics.includes(`examples/${name}/value`),
        `Expected acceptance for ${name}\n${diagnostics}`
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
