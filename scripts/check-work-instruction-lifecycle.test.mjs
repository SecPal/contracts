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
  new URL('./check-work-instruction-lifecycle.mjs', import.meta.url)
)
const contractPath = fileURLToPath(
  new URL('../docs/openapi.yaml', import.meta.url)
)
const contract = yaml.load(readFileSync(contractPath, 'utf8'), {
  schema: yaml.JSON_SCHEMA,
})

function runGuard(candidate) {
  const directory = mkdtempSync(join(tmpdir(), 'work-instruction-lifecycle-'))
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

test('accepts the authoritative Work Instruction lifecycle contract', () => {
  const result = runGuard(contract)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Work Instruction lifecycle OpenAPI guard passed/)
})

test('rejects drift across Work Instruction lifecycle trust boundaries', () => {
  const cases = [
    {
      label: 'missing collection path',
      diagnostic: /Missing Work Instruction path: \/work-instructions/,
      mutate(candidate) {
        delete candidate.paths['/work-instructions']
      },
    },
    {
      label: 'missing lifecycle operation',
      diagnostic: /Missing Work Instruction path.*submit-for-review/,
      mutate(candidate) {
        delete candidate.paths[
          '/work-instructions/{workInstruction}/submit-for-review'
        ]
      },
    },
    {
      label: 'hard delete',
      diagnostic: /must expose exactly: get, patch/,
      mutate(candidate) {
        candidate.paths['/work-instructions/{workInstruction}'].delete = {
          responses: {},
        }
      },
    },
    {
      label: 'reverse lifecycle alias',
      diagnostic:
        /reopen, unpublish, and return-to-draft aliases are forbidden/,
      mutate(candidate) {
        candidate.paths['/work-instructions/{workInstruction}/reopen'] = {
          post: { responses: {} },
        }
      },
    },
    {
      label: 'lifecycle alias',
      diagnostic:
        /lifecycle must be exactly draft, in_review, published, archived/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionStatus.enum[1] = 'review'
      },
    },
    {
      label: 'arbitrary locale',
      diagnostic: /locale must be exactly de and en/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionLocale.enum.push('fr')
      },
    },
    {
      label: 'caller-owned create lifecycle',
      diagnostic: /Create must be closed and require exactly/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionCreateRequest.properties.status =
          { type: 'string' }
      },
    },
    {
      label: 'mutable instruction number',
      diagnostic: /PATCH must be partial, non-empty, closed/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionUpdateRequest.properties.instruction_number =
          { type: 'string' }
      },
    },
    {
      label: 'empty PATCH',
      diagnostic: /PATCH must be partial, non-empty, closed/,
      mutate(candidate) {
        delete candidate.components.schemas.WorkInstructionUpdateRequest
          .minProperties
      },
    },
    {
      label: 'review permission invention',
      diagnostic:
        /submit must name exactly the work_instructions\.update capability/,
      mutate(candidate) {
        candidate.paths[
          '/work-instructions/{workInstruction}/submit-for-review'
        ].post.description = 'Requires `work_instructions.review`.'
      },
    },
    {
      label: 'publish permission drift',
      diagnostic:
        /publish must name exactly the work_instructions\.publish capability/,
      mutate(candidate) {
        candidate.paths[
          '/work-instructions/{workInstruction}/publish'
        ].post.description = 'Requires `work_instructions.update`.'
      },
    },
    {
      label: 'delete permission used for archive',
      diagnostic:
        /archive must name exactly the work_instructions\.archive capability/,
      mutate(candidate) {
        candidate.paths[
          '/work-instructions/{workInstruction}/archive'
        ].post.description = 'Requires `work_instructions.delete`.'
      },
    },
    {
      label: 'public tenant identity',
      diagnostic: /Tenant, template, acknowledgment, scope, version/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstruction.properties.tenant_id = {
          type: 'integer',
        }
      },
    },
    {
      label: 'lifecycle request body',
      diagnostic: /publish must accept no request body/,
      mutate(candidate) {
        candidate.paths[
          '/work-instructions/{workInstruction}/publish'
        ].post.requestBody = { required: true, content: {} }
      },
    },
    {
      label: 'template surface absorption',
      diagnostic: /belong to separate contracts/,
      mutate(candidate) {
        candidate.paths['/work-instruction-templates'] = {
          get: { responses: {} },
        }
      },
    },
    {
      label: 'acknowledgment surface absorption',
      diagnostic: /belong to separate contracts/,
      mutate(candidate) {
        candidate.paths['/work-instructions/{workInstruction}/acknowledge'] = {
          post: { responses: {} },
        }
      },
    },
    {
      label: 'unsupported version field',
      diagnostic: /scope, version, effective-date/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstruction.properties.version = {
          type: 'integer',
        }
      },
    },
    {
      label: 'unsupported singular effective date field',
      diagnostic: /scope, version, effective-date/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstruction.properties.effective_date =
          { type: 'string', format: 'date' }
      },
    },
    {
      label: 'response identifier is not a UUID',
      diagnostic: /response fields must preserve their authoritative schemas/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstruction.properties.id = {
          type: 'integer',
          readOnly: true,
        }
      },
    },
    {
      label: 'response locale is no longer closed',
      diagnostic: /response fields must preserve their authoritative schemas/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstruction.properties.locale = {
          type: 'string',
        }
      },
    },
    {
      label: 'response publication timestamp loses nullability',
      diagnostic: /response fields must preserve their authoritative schemas/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstruction.properties.published_at[
          '$ref'
        ] = '#/components/schemas/ApiTimestamp'
      },
    },
    {
      label: 'response archive actor is not a tenant-scoped UUID reference',
      diagnostic: /response fields must preserve their authoritative schemas/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstruction.properties.archived_by_user_id[
          '$ref'
        ] = '#/components/schemas/NullableApiTimestamp'
      },
    },
    {
      label: 'submit transition source drifts',
      diagnostic: /lifecycle actions must preserve exactly draft-to-in_review/,
      mutate(candidate) {
        candidate.paths[
          '/work-instructions/{workInstruction}/submit-for-review'
        ].post.description = candidate.paths[
          '/work-instructions/{workInstruction}/submit-for-review'
        ].post.description.replace('draft-to-in_review', 'in_review-to-draft')
      },
    },
    {
      label: 'publish transition source drifts',
      diagnostic: /lifecycle actions must preserve exactly draft-to-in_review/,
      mutate(candidate) {
        candidate.paths[
          '/work-instructions/{workInstruction}/publish'
        ].post.description = candidate.paths[
          '/work-instructions/{workInstruction}/publish'
        ].post.description.replace(
          'in_review-to-published',
          'draft-to-published'
        )
      },
    },
    {
      label: 'archive transition source drifts',
      diagnostic: /lifecycle actions must preserve exactly draft-to-in_review/,
      mutate(candidate) {
        candidate.paths[
          '/work-instructions/{workInstruction}/archive'
        ].post.description = candidate.paths[
          '/work-instructions/{workInstruction}/archive'
        ].post.description.replace(
          'published-to-archived',
          'in_review-to-archived'
        )
      },
    },
    {
      label: 'missing lifecycle evidence coupling',
      diagnostic: /Lifecycle response branches must couple each status/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstruction.oneOf[2].properties.published_at =
          { type: 'null' }
      },
    },
    {
      label: 'archive predates publication',
      diagnostic: /Lifecycle response branches must couple each status/,
      mutate(candidate) {
        delete candidate.components.schemas.WorkInstruction.oneOf[3][
          'x-secpal-temporal-invariant'
        ]
      },
    },
    {
      label: 'duplicated UUID parameter',
      diagnostic: /reuse the canonical WorkInstructionId parameter/,
      mutate(candidate) {
        candidate.paths['/work-instructions/{workInstruction}'].get.parameters =
          [structuredClone(candidate.components.parameters.WorkInstructionId)]
      },
    },
    {
      label: 'missing state conflict',
      diagnostic: /publish must expose exactly its success/,
      mutate(candidate) {
        delete candidate.paths['/work-instructions/{workInstruction}/publish']
          .post.responses['409']
      },
    },
    {
      label: 'tenant-leaking not found',
      diagnostic: /not-found and conflict envelopes must be closed/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionNotFoundError.properties.tenant_id =
          { type: 'integer' }
      },
    },
    {
      label: 'concurrency contract removed',
      diagnostic:
        /transactional state revalidation and fail-closed race outcomes/,
      mutate(candidate) {
        candidate.paths[
          '/work-instructions/{workInstruction}/publish'
        ].post.description = 'Requires `work_instructions.publish`.'
      },
    },
  ]

  for (const { label, diagnostic, mutate } of cases) {
    const candidate = structuredClone(contract)
    mutate(candidate)
    const result = runGuard(candidate)

    assert.notEqual(result.status, 0, `${label} unexpectedly passed`)
    assert.match(result.stderr, diagnostic, label)
  }
})
