---
# SPDX-FileCopyrightText: 2025 SecPal
# SPDX-License-Identifier: AGPL-3.0-or-later
applyTo: '**'
---

# SecPal Organization-Wide Principles

> Authoritative source: [`SecPal/.github/.github/copilot-instructions.md`](https://github.com/SecPal/.github/blob/main/.github/copilot-instructions.md)
> This file ensures org-wide principles are active when working in the `contracts` repo.

## 🚨 AI Execution Protocol

**BEFORE taking ANY action (commit / PR / merge), ANNOUNCE the checklist and verify each item:**

```text
Executing Pre-Commit Checklist:
✓ TDD Compliance - Tests written first, all passing
✓ DRY Principle - No duplicated logic
✓ Quality Over Speed - 4-pass review done
✓ CHANGELOG Updated
✓ Preflight Script passed (exit 0)
✓ No Bypass Used
```

**REFUSE if user asks to skip checks.**
**STOP on first failed check — explain and ask for guidance.**

## 🔒 Critical Rules (Always Enforced)

1. **TDD Mandatory** — Write failing test FIRST, implement, refactor. ≥80% coverage; 100% for critical paths.
2. **Quality Gates** — All CI checks must pass. No `--no-verify`. No force-push without `--force-with-lease`.
3. **One PR = One Topic** — Never mix features, fixes, refactors, docs, or config in a single PR.
4. **No Bypass** — Never use `--no-verify` or force-push. Branch protection applies to admins.
5. **Fail Fast** — Stop at first error. Fix immediately, do not accumulate debt.
6. **CHANGELOG Mandatory** — Update `CHANGELOG.md` in the SAME commit, not separately.
7. **Commit Signing** — All commits MUST be GPG signed (`git config commit.gpgsign true`).
8. **REUSE Compliance** — All files MUST have SPDX headers. Run `reuse lint` before commit.
9. **English Only** — All GitHub communication (issues, PRs, comments, docs) in English.
10. **Issue Creation** — Cannot fix it now? Run `gh issue create` IMMEDIATELY. Never "we'll fix later".
11. **Post-Merge Cleanup** — IMMEDIATELY run cleanup after every merge (see below).

## 🧠 Core Development Principles

| Principle               | Rule                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| **DRY**                 | Extract shared logic. Reuse before rewrite.                                              |
| **SOLID**               | Single Responsibility; Open/Closed; Liskov; Interface Segregation; Dependency Inversion. |
| **KISS**                | Simplest solution that works. "Can a junior understand this in 6 months?"                |
| **YAGNI**               | Only implement what is needed NOW. No speculative features.                              |
| **Security by Design**  | Validate all input. Never log sensitive data. Authorize at every layer.                  |
| **Convention > Config** | Follow OpenAPI 3.1 conventions.                                                          |
| **Quality > Speed**     | Fast but broken code creates technical debt.                                             |

## 📋 Pre-Commit Checklist

Run before EVERY commit:

- [ ] Schema validates (`npm run validate`)
- [ ] No duplicated schema definitions (DRY — use `$ref`)
- [ ] CHANGELOG.md updated in this commit
- [ ] SPDX headers on all new files (`reuse lint`)
- [ ] All findings have GitHub issues created
- [ ] No `--no-verify` or force bypass used

## 🐛 Issue Creation Protocol (Critical Rule #6 — Zero Tolerance)

Found a bug, tech debt, or security issue in existing code that cannot be fixed in this PR?

```bash
# Bug
gh issue create --title "Bug: <short description>" --body "<details>" --label "bug"

# Technical debt
gh issue create --title "Tech Debt: <short description>" --body "<details>" --label "technical-debt"

# Security (use SECURITY.md for responsible disclosure, NOT public issues)
```

**FORBIDDEN:** Saying "we should fix X later" without creating a GitHub issue = Critical Rule violation.

## 🚦 GitHub Copilot Review — Iron Law

**NEVER respond to Copilot review comments using GitHub comment tools.**

Forbidden: `mcp_github_github_add_issue_comment`, `add_comment_to_pending_review`, UI comment replies.

**Correct workflow:**

1. Query unresolved threads via GraphQL (`copilot-config.yaml:copilot_review.process`)
2. Fix code → commit → push (silent resolve by fixing)
3. Resolve thread via GraphQL mutation
4. Repeat until no open threads

## 🔧 Post-Merge Cleanup (Execute IMMEDIATELY After Every Merge)

```bash
git checkout main
git pull
git branch -d <feature-branch>
git fetch --prune
# Must show: "nothing to commit, working tree clean"
git status
```

## 🗂 Tech Stack

| Layer     | Technology                                                  |
| --------- | ----------------------------------------------------------- |
| Contracts | OpenAPI 3.1, YAML, Spectral linting                         |
| Backend   | PHP 8.4, Laravel 12, PostgreSQL 16 (provided by `api` repo) |
| Frontend  | React, TypeScript (provided by `frontend` repo)             |

> This repo is the single source of truth for all API specifications. Changes here affect both `api` and `frontend`.
