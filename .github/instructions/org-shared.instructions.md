---
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: AGPL-3.0-or-later
name: Contracts Runtime Overlay
description: Reinforces the contracts repository baseline when working on files in this repo.
applyTo: '**'
---

# Contracts Runtime Overlay

- Treat `.github/copilot-instructions.md` in this repo as the authoritative runtime baseline.
- Do not rely on cross-repo inheritance, comments, or external config files being loaded.
- Enforce SecPal core rules while editing any file: fail fast, no bypass, one
  topic per change, immediate issue creation for out-of-scope findings, and
  `CHANGELOG.md` updates for real changes.
- Use only `secpal.app` and `secpal.dev`.
- Keep changes repo-local, minimal, and consistent with OpenAPI 3.1, Redocly validation, and contract-first design.
