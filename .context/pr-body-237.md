## Observed defect

The published contract typed `AuthenticatedUser.id` as `integer` with a numeric example, while the SecPal API stores account primary keys as UUIDs on `users.id`. That disagreed with other user identifiers already modeled as UUID strings (for example `EmployeeUserSummary.id` and `Employee.user_id`) and risked incorrect generated clients and runtime validators.

**Evidence (implementation):** In the linked SecPal API workspace, `database/migrations/0001_01_01_000000_create_users_table.php` defines `users.id` with `$table->uuid('id')->primary()`.

There is no separate automated contract test that failed in-repo; the mismatch was semantic drift between the OpenAPI component and the shipped schema, as tracked in #237.

## What this PR changes

- `docs/openapi.yaml`: `components.schemas.AuthenticatedUser.properties.id` is now `type: string`, `format: uuid`, with a UUID example consistent with other user ID examples in the spec.
- `CHANGELOG.md`: recorded under [Unreleased] → Fixed.

## Validations already run (local)

- `npm ci` (local `node_modules` matched the lockfile so `prevalidate` / Redocly CLI sync checks pass)
- `npm run validate` (`redocly lint`, `scripts/check-openapi-verified-endpoints.mjs`, Prettier `--check` on `md`/`yml`/`yaml`/`json`)

## Linked workspace (read-only context)

- SecPal API (Polyscope clone): `/home/secpal/.polyscope/clones/47d112dd/snowy-bee` — used only to confirm `users.id` column type; no edits were made outside this contracts repository.

## Before marking ready for review

- Complete a final self-review in the GitHub PR view; this PR is intentionally opened as **draft** first and should only be marked ready when that review finds zero issues.
- Confirm required GitHub Actions checks are green (this environment does not replace CI on the default branch protections).

Closes #237.
