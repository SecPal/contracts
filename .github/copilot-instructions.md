<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# SecPal/contracts review instructions

Follow the repository runtime instructions in [AGENTS.md](../AGENTS.md) and the
applicable [focused instructions](instructions/).

- Review OpenAPI changes for caller compatibility, authorization, schema and
  error semantics, complete operation coverage and valid examples.
- Require evidence for observable contract changes at the smallest boundary
  that could detect the regression. Check the Redocly and Node validation
  surfaces when they own the affected rule.
- Reject broadened policy matchers or dependency and workflow changes that
  relax review, immutable pins, least privilege or intentional security pins.
- Ground findings in the changed code, a violated contract and its impact.
  Verify signature and provenance claims against the actual GitHub PR commit.
