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
  new URL('./check-work-instruction-content-library.mjs', import.meta.url)
)
const contractPath = fileURLToPath(
  new URL('../docs/openapi.yaml', import.meta.url)
)
const contract = yaml.load(readFileSync(contractPath, 'utf8'), {
  schema: yaml.JSON_SCHEMA,
})

function runGuard(candidate) {
  const directory = mkdtempSync(join(tmpdir(), 'work-instruction-content-'))
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

test('accepts the authoritative Work Instruction content-library contract', () => {
  const result = runGuard(contract)

  assert.equal(result.status, 0, result.stderr)
  assert.match(
    result.stdout,
    /Work Instruction content-library OpenAPI guard passed/
  )
})

test('rejects drift across content-library ownership and localization boundaries', () => {
  const cases = [
    {
      label: 'missing Standard Block collection',
      diagnostic: /Missing content-library path: \/standard-blocks/,
      mutate(candidate) {
        delete candidate.paths['/standard-blocks']
      },
    },
    {
      label: 'template delete route',
      diagnostic: /must expose exactly: get, put/,
      mutate(candidate) {
        candidate.paths[
          '/work-instruction-templates/{workInstructionTemplate}'
        ].delete = { responses: {} }
      },
    },
    {
      label: 'Standard Block mutation route',
      diagnostic: /must expose exactly: get/,
      mutate(candidate) {
        candidate.paths['/standard-blocks'].post = { responses: {} }
      },
    },
    {
      label: 'translation-row route',
      diagnostic: /translation-row and mutation aliases are forbidden/,
      mutate(candidate) {
        candidate.paths['/work-instruction-template-translations'] = {
          get: { responses: {} },
        }
      },
    },
    {
      label: 'plural translation-row route alias',
      diagnostic: /translation-row and mutation aliases are forbidden/,
      mutate(candidate) {
        candidate.paths['/work-instruction-templates-translations'] = {
          get: { responses: {} },
        }
      },
    },
    {
      label: 'singular Standard Block route alias',
      diagnostic: /translation-row and mutation aliases are forbidden/,
      mutate(candidate) {
        candidate.paths['/standard-block/{standardBlock}'] = {
          get: { responses: {} },
        }
      },
    },
    {
      label: 'operation identifier drift',
      diagnostic: /must use operationId listWorkInstructionTemplates/,
      mutate(candidate) {
        candidate.paths['/work-instruction-templates'].get.operationId =
          'listTemplates'
      },
    },
    {
      label: 'template permission namespace invention',
      diagnostic: /must name exactly the work_instructions\.create capability/,
      mutate(candidate) {
        candidate.paths['/work-instruction-templates'].post.description =
          'Requires `work_instruction_templates.create`.'
      },
    },
    {
      label: 'Standard Block permission drift',
      diagnostic: /must name exactly the work_instructions\.read capability/,
      mutate(candidate) {
        candidate.paths['/standard-blocks'].get.description =
          'Requires `work_instructions.update`.'
      },
    },
    {
      label: 'extra search filter',
      diagnostic: /expose only page=1, per_page=15/,
      mutate(candidate) {
        candidate.paths['/work-instruction-templates'].get.parameters.push({
          name: 'search',
          in: 'query',
          schema: { type: 'string' },
        })
      },
    },
    {
      label: 'non-integer pagination parameter',
      diagnostic: /expose only page=1, per_page=15/,
      mutate(candidate) {
        candidate.paths['/standard-blocks'].get.parameters[0].schema.type =
          'number'
      },
    },
    {
      label: 'inherited path-level parameter',
      diagnostic: /Path Items must not define inherited parameters/,
      mutate(candidate) {
        candidate.paths['/work-instruction-templates'].parameters = [
          {
            name: 'tenant_id',
            in: 'query',
            schema: { type: 'integer' },
          },
        ]
      },
    },
    {
      label: 'category ordering',
      diagnostic: /ordering must be created_at DESC then id DESC/,
      mutate(candidate) {
        candidate.paths['/standard-blocks'].get.description = candidate.paths[
          '/standard-blocks'
        ].get.description.replace('created_at DESC, then id DESC', 'key ASC')
      },
    },
    {
      label: 'missing locale query',
      diagnostic: /expose only page=1, per_page=15/,
      mutate(candidate) {
        candidate.paths['/standard-blocks'].get.parameters.pop()
      },
    },
    {
      label: 'independent locale hierarchy',
      diagnostic:
        /preferred-locale, Accept-Language, application-default hierarchy/,
      mutate(candidate) {
        candidate.components.parameters.WorkInstructionContentLocaleQuery.description =
          'Defaults to German.'
      },
    },
    {
      label: 'unsupported locale',
      diagnostic: /Content locales must be exactly de and en/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionContentLocale.enum.push(
          'fr'
        )
      },
    },
    {
      label: 'open translation keys',
      diagnostic: /closed de\/en snapshot/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionTemplateTranslations.additionalProperties = true
      },
    },
    {
      label: 'pattern-based schema widening',
      diagnostic: /must not use patternProperties/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionTemplate.patternProperties =
          {
            '^tenant_': { type: 'integer' },
          }
      },
    },
    {
      label: 'empty translation snapshot',
      diagnostic: /at least one and at most two translations/,
      mutate(candidate) {
        delete candidate.components.schemas.WorkInstructionTemplateTranslations
          .minProperties
      },
    },
    {
      label: 'translation row identifier exposure',
      diagnostic: /exactly required nonblank title/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionTranslation.properties.id =
          {
            type: 'string',
            format: 'uuid',
          }
      },
    },
    {
      label: 'blank title accepted',
      diagnostic: /exactly required nonblank title/,
      mutate(candidate) {
        delete candidate.components.schemas.WorkInstructionTranslation
          .properties.title.pattern
      },
    },
    {
      label: 'localized projection missing fallback flag',
      diagnostic: /Localized content must expose actual locale/,
      mutate(candidate) {
        delete candidate.components.schemas.WorkInstructionLocalizedContent
          .properties.fallback_used
      },
    },
    {
      label: 'localized locale loses actual-locale meaning',
      diagnostic: /Localized content must expose actual locale/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionLocalizedContent.properties.locale.description =
          'Requested locale.'
      },
    },
    {
      label: 'fallback semantics removed',
      diagnostic: /deterministic fail-closed fallback semantics/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionLocalizedContent.description =
          'Localized content.'
      },
    },
    {
      label: 'tenant identity exposure',
      diagnostic: /must expose exactly id, translations, localized/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionTemplate.properties.tenant_id =
          { type: 'integer' }
      },
    },
    {
      label: 'category field invention',
      diagnostic: /must expose exactly stable key/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionStandardBlock.properties.category =
          { type: 'string' }
      },
    },
    {
      label: 'system template model invention',
      diagnostic: /must expose exactly id, translations, localized/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionTemplate.properties.is_system_template =
          { type: 'boolean' }
      },
    },
    {
      label: 'lifecycle coupling',
      diagnostic: /must expose exactly id, translations, localized/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionTemplate.properties.status =
          {
            type: 'string',
          }
      },
    },
    {
      label: 'acknowledgment coupling',
      diagnostic: /must expose exactly stable key/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionStandardBlock.properties.acknowledgment_count =
          { type: 'integer' }
      },
    },
    {
      label: 'caller-controlled lock',
      diagnostic: /Template writes must accept exactly/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionTemplateTranslationsRequest.properties.locked =
          { type: 'boolean' }
      },
    },
    {
      label: 'alternate request media type',
      diagnostic: /same closed translations request/,
      mutate(candidate) {
        candidate.paths[
          '/work-instruction-templates/{workInstructionTemplate}'
        ].put.requestBody.content['text/plain'] = {
          schema: { type: 'string' },
        }
      },
    },
    {
      label: 'unlocked Standard Block',
      diagnostic: /derived read-only locked=true/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionStandardBlock.properties.locked.const = false
      },
    },
    {
      label: 'mutable Standard Block key',
      diagnostic: /derived read-only locked=true/,
      mutate(candidate) {
        delete candidate.components.schemas.WorkInstructionStandardBlock
          .properties.key.readOnly
      },
    },
    {
      label: 'oversized Standard Block key',
      diagnostic: /derived read-only locked=true/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionStandardBlock.properties.key.maxLength = 255
      },
    },
    {
      label: 'replacement changed to PATCH',
      diagnostic: /must expose exactly: get, put/,
      mutate(candidate) {
        const item =
          candidate.paths[
            '/work-instruction-templates/{workInstructionTemplate}'
          ]
        item.patch = item.put
        delete item.put
      },
    },
    {
      label: 'replacement loses complete snapshot semantics',
      diagnostic: /complete atomic PUT/,
      mutate(candidate) {
        candidate.paths[
          '/work-instruction-templates/{workInstructionTemplate}'
        ].put.description = 'Requires `work_instructions.update`.'
      },
    },
    {
      label: 'conflict response invention',
      diagnostic: /without 409/,
      mutate(candidate) {
        candidate.paths[
          '/work-instruction-templates/{workInstructionTemplate}'
        ].put.responses['409'] = {
          $ref: '#/components/responses/WorkInstructionConflict',
        }
      },
    },
    {
      label: 'non-UUID identifier',
      diagnostic: /required UUID/,
      mutate(candidate) {
        candidate.components.parameters.WorkInstructionStandardBlockId.schema.format =
          'int64'
      },
    },
    {
      label: 'tenant-leaking not found',
      diagnostic: /404 must be closed, neutral/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionContentNotFoundError.properties.tenant_id =
          { type: 'integer' }
      },
    },
    {
      label: 'rewired not-found response payload',
      diagnostic: /response components must bind closed payloads/,
      mutate(candidate) {
        candidate.components.responses.WorkInstructionContentNotFound.content[
          'application/json'
        ].schema.$ref = '#/components/schemas/Error'
      },
    },
    {
      label: 'open-ended server error payload',
      diagnostic: /500 must be closed, neutral/,
      mutate(candidate) {
        candidate.components.schemas.WorkInstructionContentServerError.properties.details =
          {
            type: 'object',
            additionalProperties: true,
          }
      },
    },
    {
      label: 'data-integrity failure omission',
      diagnostic: /Every content operation must fail closed/,
      mutate(candidate) {
        candidate.paths['/standard-blocks/{standardBlock}'].get.description =
          'Returns a system-global immutable Standard Block with `locked: true` and requires `work_instructions.read`.'
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
