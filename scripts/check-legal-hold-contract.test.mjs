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
  new URL('./check-legal-hold-contract.mjs', import.meta.url)
)
const contractPath = fileURLToPath(
  new URL('../docs/openapi.yaml', import.meta.url)
)
const contract = yaml.load(readFileSync(contractPath, 'utf8'), {
  schema: yaml.JSON_SCHEMA,
})

function runGuard(candidate) {
  const directory = mkdtempSync(join(tmpdir(), 'legal-hold-contract-'))
  const candidatePath = join(directory, 'openapi.yaml')

  try {
    writeFileSync(candidatePath, yaml.dump(candidate, { lineWidth: 100 }))
    return spawnSync(process.execPath, [guardPath, candidatePath], {
      encoding: 'utf8',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function rejectsContract(mutator, diagnostic) {
  const candidate = structuredClone(contract)
  mutator(candidate)
  const result = runGuard(candidate)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, diagnostic)
}

test('accepts the authoritative Legal Hold contract', () => {
  const result = runGuard(contract)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Legal Hold OpenAPI contract guard passed/)
})

test('rejects a missing required Legal Hold capability', () => {
  rejectsContract((candidate) => {
    delete candidate.paths['/legal-holds'].get
  }, /\/legal-holds must expose exactly/)
})

test('rejects incorrect success status or response shapes', () => {
  rejectsContract((candidate) => {
    const operation = candidate.paths['/legal-holds'].post
    operation.responses['204'] = { description: 'Created without a body.' }
    delete operation.responses['201']
  }, /create must return only 201 with LegalHoldResponse/)
})

test('rejects a missing Legal Hold operation ID', () => {
  rejectsContract((candidate) => {
    delete candidate.paths['/legal-holds/{legalHold}'].get.operationId
  }, /operation IDs must be present and unique/)
})

test('rejects delete, reopen, expiry, or bulk-release surfaces', () => {
  for (const pathKey of [
    '/legal-holds/{legalHold}/delete',
    '/legal-holds/{legalHold}/reopen',
    '/legal-holds/{legalHold}/expiry',
    '/legal-holds/bulk-release',
  ]) {
    rejectsContract((candidate) => {
      candidate.paths[pathKey] = { post: { responses: {} } }
    }, /only the five canonical paths/)
  }
})

test('rejects caller-controlled tenant input', () => {
  rejectsContract((candidate) => {
    const request = candidate.components.schemas.LegalHoldCreateRequest
    request.properties.tenant_id = { type: 'integer' }
  }, /must never accept tenant_id/)
})

test('rejects stale lifecycle states', () => {
  rejectsContract((candidate) => {
    candidate.components.schemas.LegalHoldStatus.enum.push('expired')
  }, /exactly active and released/)
})

test('rejects stale create inputs', () => {
  rejectsContract((candidate) => {
    const request = candidate.components.schemas.LegalHoldCreateRequest
    request.properties.case_type = { type: 'string' }
  }, /Create accepts exactly required case_reference and justification/)
})

test('rejects whitespace-only business inputs', () => {
  for (const removePattern of [
    (candidate) => {
      delete candidate.components.schemas.LegalHoldJustification.pattern
    },
    (candidate) => {
      delete candidate.components.schemas.LegalHoldCommonFields.properties
        .case_reference.pattern
    },
    (candidate) => {
      delete candidate.components.schemas.LegalHoldCreateRequest.properties
        .case_reference.pattern
    },
  ]) {
    rejectsContract(removePattern, /must reject whitespace-only values/)
  }
})

test('rejects bulk Activity attachment input', () => {
  rejectsContract((candidate) => {
    const request = candidate.components.schemas.LegalHoldAttachRequest
    request.properties = {
      activity_ids: { type: 'array', items: { type: 'integer' } },
    }
    request.required = ['activity_ids']
  }, /exactly one required positive integer activity_id/)
})

test('rejects optional detach or release justification', () => {
  for (const schemaName of [
    'LegalHoldDetachRequest',
    'LegalHoldReleaseRequest',
  ]) {
    rejectsContract((candidate) => {
      candidate.components.schemas[schemaName].required = []
    }, /requires exactly one bounded justification/)
  }
})

test('rejects missing mutation-state conflict semantics', () => {
  rejectsContract((candidate) => {
    delete candidate.paths['/legal-holds/{legalHold}/attachments'].post
      .responses['409']
  }, /attach must document 409 state conflicts/)
})

test('rejects missing malformed-input semantics', () => {
  rejectsContract((candidate) => {
    delete candidate.paths['/legal-holds/{legalHold}/release'].post.responses[
      '422'
    ]
  }, /release must document malformed input as 422/)
})

test('rejects an unauthenticated Legal Hold operation', () => {
  rejectsContract((candidate) => {
    delete candidate.paths['/legal-holds'].get.security
  }, /must require BearerAuth/)
})

test('rejects an existence-revealing resource response', () => {
  rejectsContract((candidate) => {
    candidate.components.responses.LegalHoldNotFound.description =
      'The requested resource was not found.'
  }, /must conceal foreign-tenant and nonexistent targets/)
})

test('rejects a permissive information-poor response payload', () => {
  rejectsContract((candidate) => {
    candidate.components.responses.LegalHoldNotFound.content[
      'application/json'
    ].schema.$ref = '#/components/schemas/Error'
  }, /must use a closed neutral payload/)
})

test('rejects internal response fields', () => {
  rejectsContract((candidate) => {
    candidate.components.schemas.LegalHoldCommonFields.properties.tenant_id = {
      type: 'integer',
    }
  }, /must exclude tenant, actor, audit, hash, and storage internals/)
})

test('rejects uncommitted or audit-optional mutation semantics', () => {
  rejectsContract((candidate) => {
    candidate.paths['/legal-holds'].post.description =
      'Creates a Legal Hold and requires `legal_holds.create`.'
  }, /committed audit atomicity/)
})

test('rejects retention-contract drift', () => {
  rejectsContract((candidate) => {
    candidate.paths[
      '/legal-holds/{legalHold}/attachments/{attachment}/detach'
    ].post.description = candidate.paths[
      '/legal-holds/{legalHold}/attachments/{attachment}/detach'
    ].post.description.replace(
      'does not protect the Activity',
      'removes evidence'
    )
  }, /preserve the accepted retention contract/)
})

test('rejects release-state schema contradictions', () => {
  for (const removeConstraint of [
    (candidate) => {
      delete candidate.components.schemas.LegalHoldCommonFields.allOf
    },
    (candidate) => {
      candidate.components.schemas.LegalHold.allOf.pop()
    },
  ]) {
    rejectsContract(removeConstraint, /must couple release metadata to status/)
  }
})
