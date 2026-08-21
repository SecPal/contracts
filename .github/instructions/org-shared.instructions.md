---
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: AGPL-3.0-or-later
name: Contracts Runtime Overlay
description: Delegates generic governance and preserves Contracts-specific constraints.
applyTo: '**'
---

# Contracts Runtime Overlay

This file auto-applies to all files in this repository.

- `AGENTS.md` is the authoritative runtime baseline for this repository.
  `.github/copilot-instructions.md` is only a compatibility mirror.
- `SecPal/.github/docs/work-graph-contract.md` is the single organization-wide
  owner of generic graph, delivery, finding, replanning, review, evidence, and
  stop-condition semantics. Do not restate them in this overlay.
- Preserve Contracts-specific OpenAPI 3.1 ownership, `$ref` reuse, compatibility,
  validation, domain, action-pinning, narrow-matcher, and dependency-override
  constraints from `AGENTS.md`.
- Use meaningful failing contract evidence for observable OpenAPI changes where
  it can prove the changed contract. Existing structural evidence may suffice
  for governance prose and behavior-preserving changes.
- Never bypass hooks or force-push.
- Keep GitHub communication in English and reference files and lines instead of
  pasting large code blocks.
- Do not add AI self-references, generated-by text, tool promotion, or AI
  attribution unless the task explicitly requires documenting AI tooling.
- Keep changes repository-local and apply the domain policy from `AGENTS.md`.
