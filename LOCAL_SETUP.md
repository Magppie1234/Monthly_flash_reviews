# Local Setup

## Prerequisites

- Node.js with the bundled `fetch` API (Node.js 18 or newer)
- npm
- Access to the already-provisioned local-replica Supabase project
- Optional read-only Zoho OAuth credentials for discovery and replication

## Environment

Copy `.env.example` to `.env` only when no real `.env` already exists. Populate values locally; never paste credentials into documentation, logs, source code, or chat.

```bash
chmod 600 .env .access-code .crm-sql-secret 2>/dev/null || true
npm ci
```

Required for the application database:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `CRM_SQL_SECRET`

Required only for source discovery/replication:

- `ZOHO_ACCOUNTS_URL`
- `ZOHO_API_DOMAIN`
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `ZOHO_CRM_ORG_ID`

Required for the production Vercel 15-minute delta-sync schedule:

- `CRON_SECRET` (a dedicated high-entropy Vercel Production environment value; never reuse `ACCESS_CODE` or `CRM_SQL_SECRET`)

Vercel invokes `GET /api/cron/delta-sync` only for production deployments and sends `Authorization: Bearer <CRON_SECRET>`. The route checks that exact header with a constant-time comparison before the interactive access gate. It never accepts a query parameter, cookie, access code, or database secret as cron authorization. Leave `CRON_SECRET` unset locally unless explicitly testing the protected route.

Required only for the separately approved attachment metadata apply or bounded byte transfer:

- `SUPABASE_SERVICE_ROLE_KEY`
- `ATTACHMENT_STORAGE_BUCKET` (must exist and explicitly be private)
- `ATTACHMENT_RESUMABLE_ADAPTER_MODULE` (required before transferring any file over 6 MB)

Optional for the natural-language CRM assistant:

- `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` (server only; never expose either value to the browser)
- `CRM_AGENT_MODEL` (defaults to the reviewed `openai/gpt-5.6-sol` Gateway model identifier)

Without a Gateway credential, Ask CRM remains usable in deterministic local mode. It exposes only reviewed prompts that pass the current mirrored module, field, profile, and exact-layout preflight. It never calls a model or external network in that mode, and record creation remains preview-only until the user explicitly submits the existing validated Create form.

Recommended for any reachable deployment:

- `ACCESS_CODE`: enables the current shared local access gate. This does not implement Zoho roles or profiles.

## Database contract

The current runtime expects these pre-existing tables:

- `crm_secret`
- `crm_records`
- `crm_meta`
- `crm_audit`

It also calls these pre-existing RPC functions:

- `crm_sql`
- `crm_derive`
- `crm_bulk_upsert`
- `crm_meta_upsert`
- `crm_insert`
- `crm_patch`
- `crm_log`

The sanitized bootstrap is `database/schema.sql`. It includes schema and code only—no CRM rows, metadata rows, customer data, or live secret value. Before applying it to a new Supabase project:

1. Replace `__REPLACE_AT_DEPLOYMENT__` with a new deployment-only secret.
2. Set the same value as `CRM_SQL_SECRET` in the application environment.
3. Apply the migration through an authorized Supabase SQL session.
4. Run the source discovery/import commands, then perform reconciliation.

The migration was structurally checked against the live schema but has not been restored into a clean disposable Supabase project in this phase.

Attachment replication uses the separate, service-role-only migration in `database/attachment-replication.sql`. Review `ATTACHMENT_REPLICATION.md` before applying it. The default attachment command is a metadata dry-run and does not transfer file bytes.

### Staged source-deletion contract

`database/migrations/20260830_source_deletion_archive.sql` and the matching definitions in `database/schema.sql` stage the local archive/RPC and singleton-lease contract used by the deletion engine. The contract is focused-test covered for 15 of the 16 scheduled modules. Zoho's deleted-record endpoint does not document `Notes`, so Notes deletion parity is unsupported. The runtime is disabled, no live deletion DDL has been installed, and no source-deletion run has occurred.

Do not enable deletion processing until all of these gates pass:

1. The existing `crm_meta.source_replication_lock` contains the exact verified source organization.
2. An authorized database administrator installs the staged SQL and `npm run verify:deletion-archive` verifies its exact tables, functions, settings, ownership, privileges, and fail-closed behavior.
3. The singleton lease can be acquired and released through the reviewed RPC contract.
4. Every one of the 15 supported modules has an exact starting baseline; do not seed a baseline to the current time or infer a deletion from an ordinary record-fetch failure.
5. Each supported module is enabled explicitly through its feature gate.
6. Fresh, complete operational evidence from a successful run covers all 15 supported modules before any health result is classified as `reconciled_current`.

`npm run verify:deletion-archive` does not install DDL or start deletion replication. Before installation, a not-ready result is expected and must remain a blocker rather than being bypassed.

## Run

```bash
npm start
```

Open [http://localhost:3100](http://localhost:3100), or the port configured by `CLONE_PORT`.

## Vercel production schedule

`vercel.json` schedules the existing active-record delta runner every 15 minutes with `*/15 * * * *`. That frequency requires a Vercel Pro plan; Hobby cron jobs cannot run every 15 minutes. Cron jobs run only on production deployments, not preview deployments or the local development server. Configure a dedicated `CRON_SECRET` in the Vercel Production environment before deploying. Do not add the value to source control, documentation, logs, or browser code.

The scheduled route and manual delta endpoint share one mandatory database-backed lease/state contract. Before production scheduling can be operational, an authorized database administrator must install `database/migrations/20260830_delta_sync_lease_state.sql` and `database/migrations/20260830_payment_milestone_snapshot_rpc.sql`, then run `npm run verify:delta-sync-lease` and `npm run verify:payment-milestone-snapshot-rpc` from an environment with the required read-only verification connection. The first migration provides cross-instance acquisition, renewal, compare-and-swap state saves, release, and aggregate state reads. The second provides the exact atomic full-batch path required for timestamp-less `Payment_Milestones` records. Runs fail closed when either contract is unavailable; the CRM UI reports sync safety setup pending instead of presenting the schedule as operational. A complete refresh returns 200, overlap returns 202, incomplete or unavailable refreshes return 503, and unexpected failures return a sanitized 500. Responses contain status and aggregate success flags only—never CRM record IDs, payloads, credentials, owner tokens, or raw provider/database errors.

The application stops source and record work after a 35-second soft cutoff, then retains a separate 55-second hard cutoff for lease acquisition, revision-fenced checkpointing, and release within the 60-second Vercel function limit. The mandatory zero-write `Payment_Milestones` invalid-batch canary runs before organization verification, source reads, source-lock creation, or record upserts; an absent or drifted snapshot RPC therefore stops the run before those effects. Vercel Cron delivery remains best effort and failed invocations are not retried automatically. The public replication-health schedule uses `scheduler_mode: "vercel-cron"` plus `externally_scheduled: true`; only an available fenced state contract permits `execution_fenced: true` and the `Scheduled by Vercel` label.

In Vercel mode, process-local `started` and `running` fields are not authoritative; last-completed and last-successful evidence must come from the revision-fenced persisted run state.

## Verify

With the server running:

```bash
npm run check
npm test
npm run qa:local
npm audit --omit=dev
```

Expected results for the current snapshot: all current unit and contract tests pass, live QA passes, and the production dependency audit reports zero vulnerabilities.

## Refresh safely

```bash
npm run discover:zoho
npm run sync:gaps
npm run build:ui-inventories
npm run inventory:widgets
npm run inventory:permissions
npm run inventory:rules-layouts
npm run hydrate:metadata
npm run audit:metadata -- --snapshot .private/zoho-discovery/latest.json
npm run export:local-schema
```

These commands are designed for read-only source access. They can add or refresh local replica rows but must never update, delete, transition, convert, send, or otherwise mutate Zoho CRM.
