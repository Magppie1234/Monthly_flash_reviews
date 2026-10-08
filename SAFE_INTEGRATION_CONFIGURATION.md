# Safe Integration Configuration

## Non-negotiable source boundary

Zoho CRM is read-only. `server.js`, `scripts/discover-zoho.js`, `scripts/sync-gaps.js`, and `sync/pull-zoho.js` may authenticate and read authorized source data. They must not create, update, delete, merge, convert, transition, send messages, run source buttons, or invoke any other write-capable source action.

The server enforces this by rejecting every Zoho request method except `GET` and `HEAD`. All 19 discovered custom buttons and all 40 widget registrations remain disabled locally because their complete behavior and side effects are not yet proven.

## Secrets

- Keep `.env`, `.access-code`, `.crm-sql-secret`, `.private/`, exports, attachments, screenshots, and logs out of version control.
- Maintain restrictive file permissions (`600` for credential/evidence files and `700` for private directories).
- Never place refresh tokens, client secrets, database secrets, or access codes in URLs, screenshots, reports, browser-visible configuration, console logs, or support messages.
- Use separate credentials and sandbox destinations when implementing external messages, webhooks, telephony, WhatsApp, email, or third-party widgets.
- Rotate any credential immediately if it is exposed.

`database/schema.sql` is intentionally sanitized and contains the placeholder `__REPLACE_AT_DEPLOYMENT__`. Replace it only in the authorized deployment session; do not commit the substituted migration.

## OAuth scope changes

Add only the least-privileged read scope required for the next documented blocker. The current Blueprint detail gap requires the read-only transition metadata scope `ZohoCRM.settings.transitions.read`. After changing scope, rerun discovery and verify the target organization before using the new evidence.

Do not add broad write scopes to solve a read-only discovery problem.

## Local writes

Local record changes are allowed only in the replica database. New local records use a `local-...` identifier so they cannot be mistaken for source records. Metadata validation rejects unknown, read-only, malformed, and invalid picklist values before persistence. Active Blueprint state fields cannot be patched directly.

## Authentication and permissions

`ACCESS_CODE` provides only a shared gate. It is suitable for a trusted workstation but is not equivalent to Zoho authentication, profiles, roles, field permissions, sharing rules, territories, groups, or record ownership.

Before network deployment, select an identity provider, provision users explicitly, map each user to the discovered permission model, and test both allowed and denied actions at module, record, field, and transition levels.

## Reconciliation and deletion

Never delete local rows solely because a module count exceeds Zoho. Compare immutable source IDs, local-only identifiers, relationships, attachments, notes, and audit history first. Use a reversible tombstone or archive only after approval. Any current aggregate count excess, including the unresolved Leads scope, remains preserved until an immutable-ID audit establishes the exact reason.
