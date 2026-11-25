// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as yaml from 'js-yaml'

test('business addresses support the same separate house number as employee addresses', () => {
  const { components } = yaml.load(
    readFileSync(new URL('../docs/openapi.yaml', import.meta.url), 'utf8'),
    { schema: yaml.JSON_SCHEMA }
  )
  const { Address, EmployeeAddressInput } = components.schemas
  assert.deepEqual(Address.properties.house_number.type, ['string', 'null'])
  assert.equal(
    Address.properties.house_number.maxLength,
    EmployeeAddressInput.properties.house_number.maxLength
  )
  assert.ok(!Address.required.includes('house_number'))
})
