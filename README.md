# MAGPPIE CRM Local Replica

This repository runs a metadata-driven local CRM at [http://localhost:3100](http://localhost:3100). The interactive application uses the local database. Zoho is treated as a read-only source for discovery and replication.

This is a usable, tested local replica, but it is **not yet a verified complete Zoho CRM replacement**. The exact open gaps are maintained in `ZOHO_LIMITATIONS_AND_BLOCKERS.md` and `ZOHO_CRM_COVERAGE_MATRIX.md`.

## Start

```bash
npm ci
npm start
```

Then open [http://localhost:3100](http://localhost:3100). The default port can be changed with `CLONE_PORT`.

Use `LOCAL_SETUP.md` for environment and database requirements. Never commit `.env`, `.access-code`, `.crm-sql-secret`, `.private/`, exports, attachments, or customer data.

## Verification

```bash
npm run check
npm test
npm run qa:local
npm audit --omit=dev
```

The current verification baseline includes a successful `npm run check`, 881 passing unit and contract tests, and one explicitly skipped disposable-PostgreSQL Blueprint transaction gate (882 total), a complete warmed live-QA pass, all 33 integration contract tests, and `npm audit --omit=dev` with zero vulnerabilities. The safe QA returned 153 module definitions, 5 active Blueprint modules, and 19 custom buttons. Immediately after restart, two attempts received the explicit cold replication-evidence fallback and a later attempt received one transient HTTP 500 from the cold data-completeness read; no write was attempted, and the complete identical QA rerun passed once the read paths were warm. The data-completeness current-set digest now stays on the `(module, id)` key instead of opening roughly 88,000 source-record JSON bodies. Its identical local SELECT may retry once only for an exact PostgreSQL `57014` statement timeout or the helper's own exact bounded client timeout; caller cancellations and generic failures are never retried. This improves reliability but does not turn cold paths into a millisecond guarantee. The attachment manifest also matched its sanitized baseline exactly: 78,758 source IDs, 78,756 absent local IDs, and zero migrated bodies.

`qa:local` performs safe live checks. Its POST requests either exercise preview-only/read-only assistant tools or deliberately use invalid and non-executable inputs that must be rejected before any local write. The assistant contract now defines seven reviewed deterministic questions: Lead-status counts, overdue Tasks, required Lead fields, a preview-only Lead draft, generic module counts, grouped counts through a reviewed non-private categorical field, and grouped counts where a separately reviewed safe filter field is empty. The seventh form is `Count records in <module> by <safe-group-field> where <safe-filter-field> is empty`; ambiguous or private fields fail closed and execute zero tools. QA also rejects credential-shaped prompts, invalid record creation, unknown Blueprint transitions, policy-blocked Blueprint transitions, and a policy-eligible transition with incomplete mandatory inputs before persistence. Phase details for all 202 transitions across 7 Blueprints remain checked, including Tasks at 5/5 with all five policy blocked; 5/202 transitions are policy eligible, zero are atomically runtime-ready, and 197 are policy blocked. The three reviewed Contacts paths are `Approve/Disapprove Quote` → `Raw Quote`, `Raw Quote` → `Ringing No Response`, and `Revised Design Discussion` → `Revised Design Discussion1`. All are manual, non-common, `All Users`, criteria-free, action-free, and preserve identical actual/display state values; Raw Quotation additionally enforces one required calendar date and one optional whole-number amount. QA also resolves a real AMS record through the single unambiguous active layout and verifies the exact policy-blocked Assign Technician widget contract. It never submits a successful transition, provider action, attachment transfer, or Zoho write.

The dedicated `#/analytics` Analytics Command Center uses one bounded, SELECT-only aggregate plan over approved local replica tables. Its GET-only overview covers reviewed date windows, Lead/Contact/Deal stage mixes, Calls and Events activity, Task health, six-module inventory, freshness, metadata coverage, and reconciliation quality. The backend contract also provides an aggregate-only period comparison for exactly five metrics: `Leads.Created_Time`, `Contacts.Created_Time`, `Deals.Created_Time`, `Calls.Call_Start_Time`, and `Events.Start_DateTime`. Each selected 1–366-day Asia/Kolkata calendar range is compared with the immediately preceding equal-length range, returning `current_count`, `previous_count`, `absolute_change`, and `percentage_change`; the percentage is `null` when the previous count is zero. The response returns `Data Not Available` when required metadata is missing and contains no customer rows or identifiers. Desktop and 390 px browser verification rendered all five comparison cards without horizontal overflow or browser errors. A shared high-level cold-read coordinator prevents uncached Analytics and assistant permission discovery from competing for the database statement budget while leaving cache hits and ordinary CRM APIs ungated. The aggregate now scans the six reviewed modules once, and both Analytics and permission-scoped assistant aggregates may repeat that same local SELECT once only after the exact PostgreSQL `57014` statement-timeout signature or the helper's own exact bounded client timeout; each attempt has an 18-second client ceiling, while caller cancellations and generic failures are not retried. The latest stored isolated, source-disabled contention probe passed with Analytics returning HTTP 200 and all five metrics in 14,630 ms, while the assistant returned HTTP 200 and the exact 41-module scope in 26,789 ms. These cold timings vary materially between runs. A partial covering index is included in the bootstrap and existing-database migration, but it is not installed on the connected database and no runtime improvement is claimed from it. A prior full 366-day request took 10.3 seconds uncached and 9 ms after caching, so the evidence does not support claiming that every request completes in milliseconds. Cross-module conversion, stage velocity, attribution, forecast accuracy, historical snapshot movement, and native Zoho report/result parity remain unsupported rather than being inferred.

The first-class `#/blueprints` and `#/workflows` Studio surfaces expose the captured automation evidence without implying execution parity. Blueprint Studio presents all 7 Blueprints, 175 states, 202 transitions, 245 connections, 187 During inputs, 111 mandatory inputs, and 60 After actions; 5 transitions are policy eligible, zero are atomically runtime-ready, and 197 are policy blocked. Every policy-eligible transition is bound to a separate reviewed contract policy; owner, phase, path, state, input, action, or evidence drift automatically makes it policy blocked. Mandatory During fields must be submitted explicitly, calendar dates must be real dates, the Zoho `-None-` sentinel is rejected, and integer fields cannot be silently truncated. Blueprint selection requires the stored record layout or one uniquely active captured module layout; it never guesses among multiple layouts. The former split record-patch/Note/rollback/asynchronous-log path has been removed from Blueprint POST. An enabled execution can issue only one immutable call to the staged atomic record/Note/audit RPC, and only after a fresh bounded verifier confirms the exact signature, defaults, settings, owner, full direct ACL, absence of unintended inherited EXECUTE, staged body, and pre-lock fail-closed canary, plus a separate server-owned request-principal, Blueprint-authorization, and audit-actor binding decision. GET readiness uses bounded positive/negative TTLs, every execution forces a fresh timed verification, and timeout or drift fails closed before RPC. The global public-error boundary sanitizes unknown database, RPC, Zoho, and internal failures, while reviewed atomic failures remain bounded and stale-state versus stale-`Modified_Time` conflicts remain distinguishable. A success receipt is accepted only when its record, state, every patch scalar, and exact microsecond `Modified_Time` match the immutable request. The migration is staged and not installed automatically. The latest live verifier evidence says the RPC is absent, and the production identity/authorization/actor-binding provider is deterministically unavailable, so exact SQL alone still leaves all five policy-eligible forms inspection-only. Disposable-PostgreSQL concurrency, rollback, lock-timeout, and sequential-transition execution remain an explicitly blocked acceptance gate; atomic transition parity is not claimed. Workflow Studio presents all 44 captured rules, including 39 active rules; 4 are complete plan-only rules and 35 remain blocked active. Two active function definitions have been reviewed and one exact adapter deterministically plans the Contacts expected-closing-date counter, accepts only a bounded whole-number current value or `null`, and emits no write. `Mark Visit As Conducted` remains blocked because its authoritative function parameter-to-field bindings are not captured. Fresh browser checks at 817 × 837, 390 × 844, and 320 × 844 showed the exact 4-plan-eligible/35-blocked-active boundary and one adapter without horizontal overflow or browser log errors. Both surfaces support search and filters, keep unavailable behavior visibly blocked, and render dynamic catalog text without trusting captured markup.

The 12 supplied widget ZIPs have a separate defensive runtime-compatibility classification: 9 implemented read-only previews, zero remaining preview candidates, and 3 reviewed, contract-blocked quarantines. All five bounded archive reviews are complete and zero remain pending. Estimate, Assign Technician, Designer Form, Payment Milestone, Revise Quote, Revise-Approve Quote-Any Stage, and Closure New retain their exact calculation, draft, relationship, and Blueprint-evidence contracts. Deploy Team is bound to its exact Contacts Standard-layout view-button registration and re-attests the complete `All_Orders`, direct Deal, Visit/link-field, and Installation Visit Blueprint evidence; it currently fails closed because `Visit_Module.Client_Address` is read-only. Handover To Post Team is bound to the exact parent and child Final Handover transitions, their During and After requirements, complete relationship/direct Deal evidence, and current AMS schemas; it can show requirements only because no active reviewed AMS transition enters `Planned`. Closure Order Stage Update remains quarantined because its exact parent/During/attachment contract is unproven. Handover to Post Design remains quarantined because the current 35 label-only candidate placements do not establish an authoritative widget-ID-bearing parent binding. Sunrooof Mark Closures remains quarantined pending credential rotation and accepted cross-organization CRM, WorkDrive, privacy, commercial, pagination, idempotency, rollback, file, rendering, logging, and accessibility contracts. The implemented previews are anonymous, immutable, responsive, and read-only; they perform no CRM write, Blueprint continuation, workflow trigger, outbound request, SDK/provider call, storage/file/logging action, protected-value use, or captured-source execution. Zero supplied packages are classified as full local runtime parity.

## Read-only discovery and replication

```bash
npm run discover:zoho
npm run sync:gaps
npm run build:ui-inventories
npm run inventory:widgets
npm run inventory:workflow-runtime
npm run inventory:permissions
npm run inventory:rules-layouts
npm run hydrate:metadata
npm run audit:metadata -- --snapshot .private/zoho-discovery/latest.json
npm run reconcile:notes
npm run reconcile:task-subforms
npm run attachments:replicate
npm run verify:blueprint-rpc
npm run verify:deletion-archive
npm run verify:delta-sync-lease
npm run verify:payment-milestone-snapshot-rpc
```

- `discover:zoho` reads source metadata and counts, verifies the configured organization, updates the coverage artifacts, and stores raw evidence under the ignored `.private/` directory.
- `sync:gaps` performs restartable GET-only imports for the explicitly configured gap datasets.
- `build:ui-inventories` converts private UI discovery evidence into a data-free, fail-closed report/dashboard coverage artifact.
- `inventory:widgets` validates the complete source widget registration/package inventory offline and regenerates its data-free behavior catalog. The reviewed runtime overlay separately preserves the 9-implemented/0-candidate/3-contract-blocked classification and 5/5 completed bounded reviews for the 12 supplied ZIPs.
- `inventory:workflow-runtime` rebuilds the fail-closed 44-rule catalog from the exact local captured metadata; four reviewed rules can emit deterministic plans, while every workflow write remains disabled.
- `inventory:permissions` rebuilds the sanitized source role/profile/field-permission catalog and the explicit local enforcement-gap assessment without contacting Zoho.
- `inventory:rules-layouts` rebuilds the sanitized historical rule/layout evidence and a separate exact, SELECT-only audit of the current hydrated local fields, layouts, and custom views.
- `hydrate:metadata` defaults to a missing-only dry run against the private captured snapshot. Its separately reviewed `--apply` mode inserts only absent metadata scopes after verifying the exact organization; it never overwrites or deletes local metadata.
- `audit:metadata -- --snapshot .private/zoho-discovery/latest.json` compares the named private source snapshot with local metadata through SELECT-only local queries; it never creates an updater or mutates either system.
- `reconcile:notes` is permanently audit-only. Its default mode performs GET-only source enumeration and a SELECT-only local comparison without persistence; `npm run reconcile:notes -- --audit` may atomically replace only the permission-restricted, sanitized private zero-gap audit. It has no record-apply mode and never logs or persists raw IDs or payloads. `reconcile:task-subforms` defaults to GET-only comparison; its separately reviewed `--apply` mode can only add source-present/local-missing rows and never deletes local rows.
- `verify:blueprint-rpc` performs a bounded fixed catalog-only check of the staged atomic Blueprint function and runs its non-mutating protected-field rejection canary only after the exact signature, defaults, settings, owner, direct ACL, effective-role boundary, staged body, and pre-lock ordering all match. It never installs DDL and does not satisfy the separate identity/authorization/actor-binding gate.
- `verify:deletion-archive` checks the staged source-deletion archive, lease, and RPC contract without installing DDL or starting a source-deletion run. It is expected to report not ready while the migration is absent or any activation gate is unresolved.
- `verify:delta-sync-lease` checks the dedicated active-record lease/state table and its acquire, renew, compare-and-swap save, release, and public state-read RPCs through a fixed, read-only catalog query. It never installs DDL or starts a sync.
- `verify:payment-milestone-snapshot-rpc` checks the dedicated atomic `Payment_Milestones` snapshot RPC, nullable `source_seen_at` column, exact function body/ACL boundary, and one deliberately rejected non-mutating canary. It never installs DDL or writes a CRM row.
- `attachments:replicate` defaults to a GET-only attachment-metadata dry-run. See `ATTACHMENT_REPLICATION.md` before any private-bucket metadata apply or bounded byte transfer.

The token exchange uses OAuth as required, but CRM source requests are hard-blocked in code unless their method is `GET` or `HEAD`.

## Authenticated Setup process evidence

The Automation page combines the historical API capture with a separate sanitized, authenticated, read-only Setup UI audit. As observed on 2026-08-31, Zoho shows zero configured Pipelines and zero Approval Processes. Validation Rules are verified empty for Leads, Products, Quotes, Sales Orders, Purchase Orders, Invoices, Campaigns, and Vendors. The other 20 configurable modules remain explicitly unresolved; six were rate-limited and fourteen have not yet been audited. This evidence performed no source or local mutation and cannot enable an unresolved rule path.

## Replication truth and freshness

The Automation page now exposes a sanitized evidence catalog for all 122 API-supported datasets. It classifies one dataset—Tasks—as same-epoch active-ID reconciled without a count-scope gap and keeps the other 121 unresolved. The catalog records 37 observed source counts, 85 unavailable counts, 22 generated datasets, and 12 observed-zero counts; unavailable counts remain `null`, and neither generated nor observed-zero scopes are promoted to complete. This catalog is an audit boundary only and does not authorize adding modules to the 16-dataset scheduler.

The 15-minute active-record scheduler covers 16 explicitly configured record modules out of 122 API-supported modules. It is a bounded incremental refresh, not evidence that all 122 modules or all Zoho CRM surfaces are current. The remaining 106 API-supported modules are outside the scheduled record set. Attachment bodies and attachment-metadata refresh, metadata/configuration, native reports, dashboards, and generated child datasets are also outside this delta contract and retain their separate audits or blockers.

Production scheduling is declared in `vercel.json` as `GET /api/cron/delta-sync` every 15 minutes. This frequency requires Vercel Pro and runs only on production deployments. The endpoint requires the exact `Authorization: Bearer <CRON_SECRET>` header before the CRM access gate and returns only aggregate status flags. Query parameters, cookies, `ACCESS_CODE`, and `CRM_SQL_SECRET` are never cron credentials. The real `CRON_SECRET` must be configured separately in the Vercel Production environment; it is not stored in this repository.

Vercel Cron delivery is best effort and a failed invocation is not retried automatically. Every active-record run now requires the dedicated database lease and revision-fenced persisted state from `database/migrations/20260830_delta_sync_lease_state.sql`; overlap is rejected across serverless instances and state saves use compare-and-swap revision checks. Source/record work has a 35-second soft cutoff, while lease acquisition, state checkpointing, and release have a separate 55-second hard cutoff inside the 60-second Vercel function limit. This lets a bounded partial run save its cursor safely instead of losing progress when source work times out. `Payment_Milestones`, which has no source `Modified_Time`, uses a bounded double-scan and the separate atomic RPC in `database/migrations/20260830_payment_milestone_snapshot_rpc.sql`. Before any source or record work, a zero-write invalid-batch canary must prove that RPC is present with its exact rejection contract. Until both migrations are installed and verified, the runner stops before source/record effects and the public trust card says that sync safety setup is pending rather than claiming an operational schedule. In Vercel mode the card ignores process-local `started` and `running` flags and reports completion history only from the fenced persisted state.

A separate source-deletion engine and SQL archive/lease contract are staged and covered by focused tests, but deletion processing is disabled at runtime. The Zoho deleted-record endpoint documents support for 15 of the 16 scheduled modules and does not document `Notes`, so Notes deletion parity is unsupported. No source-deletion DDL has been installed and no live source-deletion run has occurred. Activation requires the exact source-organization lock to be present and verified, the staged SQL to be installed and pass its verifier, the singleton lease path to be operational, an exact starting baseline for every included module, explicit per-module feature enablement, and fresh complete operational evidence across the full 15-module scope. Until every gate is satisfied, deletion readiness must remain disabled and cannot be classified as `reconciled_current`.

Public replication health uses only these classifications: `reconciled_current`, `ahead_of_audit_recheck_required`, `behind_source`, `partial_refresh`, and `unsupported_scope`. `reconciled_current` requires exact source and local evidence from the same audit or recheck epoch. A later local digest match against a frozen source audit proves only that the local set still matches that older audited set, so it remains `ahead_of_audit_recheck_required` until a new same-epoch source recheck completes. A module error or partial page/record run makes the overall run partial; it cannot be promoted to global success. The last completed run and last globally successful run are persisted separately. Public health contains aggregate counts and timestamps only—never record IDs, names, emails, phone numbers, URLs, digests, credentials, or record bodies.

The latest Notes audit completed at `2026-08-30T16:38:39.339Z` and compared the source and local ID sets in the same run: 67,798 active source Notes, 67,798 local source-derived Notes, and zero source-only or local-only gaps. The separately observed Notes count endpoint returned 67,948 in that run, a 150-row aggregate-scope difference that is not treated as an active-record gap. The Tasks/child audit completed at `2026-08-30T16:00:09.934Z`: Tasks are exact at 12,422/12,422; all 7,827 enumerable child rows match; and 4,737 additional child count-only rows remain unavailable because the active records API exposes neither IDs nor payloads for them. Private SHA-256 evidence is accepted only when its completion timestamp exactly matches the corresponding public configuration timestamp; digests never enter the public configuration or response.

These are timestamped evidence snapshots, not a complete-CRM parity guarantee. A 15-minute schedule does not imply that every source change becomes visible within exactly 15 minutes, and warmed millisecond measurements do not establish an all-requests millisecond service level.

## Architecture

- `server.js`: Express API, local validation, local CRUD, read-only source boundary, dashboard queries, and fail-closed local Blueprint execution for fully specified transitions.
- `public/`: responsive single-page CRM interface.
- `lib/crm-analytics-overview.js`: aggregate-only Analytics Command Center query contract, bounded date filters, five-metric equal-period comparison in Asia/Kolkata, privacy-safe dimensions, freshness, and reconciliation quality.
- `lib/cold-read-coordinator.js`: single-concurrency admission control for actual uncached Analytics and assistant permission-scope loads; warm reads and ordinary CRM routes bypass it.
- `lib/local-read-retry.js`: shared two-attempt, 18-second-per-attempt local SELECT guard that retries only the exact PostgreSQL statement-timeout signature or its own exact bounded client timeout, while respecting caller cancellation.
- `scripts/qa-cold-read-contention.js`: repeatable isolated, source-disabled cold-start regression for concurrent Analytics and assistant permission-scope reads; persists only safe timings, response status, build metadata, and aggregate counts.
- `lib/blueprint-studio.js` and `lib/workflow-studio.js`: source-backed, read-only catalog builders for the first-class `#/blueprints` and `#/workflows` Studio surfaces, including exact states, transitions, phases, actions, execution plans, and blockers.
- `lib/crm-validation.js`: metadata-driven backend validation.
- `lib/crm-agent*.js`: permission-scoped CRM assistant, seven reviewed deterministic questions, reviewed local tools, keyless mode, and preview-only creation drafts.
- `lib/widget-runtime-compatibility.js`, `public/estimate-widget-preview.js`, and the other reviewed preview modules under `public/`: fail-closed widget classification plus nine separate read-only previews; CRM writes, captured source, protected values, Blueprint continuation, and outbound access remain disabled.
- `lib/on-demand-attachment-access.js`: unmounted, fail-closed Zoho attachment streaming foundation; activation blockers are documented separately.
- `lib/zoho-deletion-sync.js` and `lib/source-deletion-readiness.js`: staged, fail-closed deletion discovery and aggregate readiness contracts for the 15 documented scheduled modules; runtime execution remains disabled.
- `sync/pull-zoho.js`: restartable source-to-local import.
- `scripts/`: discovery, targeted sync, UI-inventory generation, and QA.
- `config/`: generated Blueprint graph, captured transition-phase requirements, and fail-closed custom-button definitions.
- `database/schema.sql`: sanitized Supabase bootstrap for the current tables, RPC/helper functions, constraints, indexes, RLS state, and grants. It contains no customer rows. Existing-database changes are staged separately in `database/migrations/`, including the analytics covering index, source-deletion archive, active-record delta lease/state contract, and `Payment_Milestones` atomic snapshot RPC. The two active-record scheduler migrations are not installed in the connected production database.
- Supabase: current local-replica data store; the complete schema contract is listed in `LOCAL_SETUP.md`.

## Evidence package

- `ZOHO_SOURCE_INVENTORY.md`
- `ZOHO_CRM_COVERAGE_MATRIX.md`
- `ZOHO_DATA_DICTIONARY.md`
- `ZOHO_RELATIONSHIP_MAP.md`
- `ZOHO_BLUEPRINT_MATRIX.md`
- `ZOHO_AUTOMATION_INVENTORY.md`
- `ZOHO_PERMISSION_MATRIX.md`
- `LOCAL_PERMISSION_COVERAGE.md`
- `LOCAL_RULE_LAYOUT_COVERAGE.md`
- `ZOHO_METADATA_PARITY_AUDIT.md`
- `docs/task-subform-reconciliation.md`
- `docs/on-demand-attachment-access.md`
- `docs/blueprint-atomic-acceptance-gate.md`
- `CRM_ACCEPTANCE_REGISTER.md`
- `ZOHO_REPORT_DASHBOARD_INVENTORY.md`
- `ZOHO_WIDGET_BEHAVIOR_INVENTORY.md`
- `ZOHO_ACTIVE_FUNCTION_BEHAVIOR_INVENTORY.md`
- `ATTACHMENT_REPLICATION.md`
- `ZOHO_SETUP_UI_INVENTORY.md`
- `ZOHO_MIGRATION_MANIFEST.md`
- `ZOHO_RECONCILIATION_REPORT.md`
- `ZOHO_QA_REPORT.md`
- `ZOHO_LIMITATIONS_AND_BLOCKERS.md`

Raw responses, screenshots, and customer-level evidence remain private and excluded from version control.
