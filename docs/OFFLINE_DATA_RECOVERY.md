# Offline data recovery — 7 September 2026

## Operating contract

Target Zoho organisation: `60046349006`. Use saved files only. No Zoho sync, source writes, outbound calls/messages, or production cutover. Keep Monthly Flash Review unchanged. Restoring module navigation does not constitute full functional Zoho parity.

## Corrected dataset

| Dataset | Saved rows | Provenance and limitations |
| --- | ---: | --- |
| Raw Leads (`Leads`) | 22,239 | Correct-org local dashboard/hand-over snapshots; transformed payloads, not full raw export parity |
| Qualified Leads (`Contacts`) | 4,922 | Preserve 3,854 existing saved records; append 1,068 previously absent IDs from the historical export |
| Orders (`Deals`) | 5,768 | Full historical CSV dated 9 August 2026; original legacy API module `Potentials` |
| Tasks | 11,393 | Correct-org saved hand-over data; not the newer historical connected-database total |
| Calls | 51,925 | Correct-org compact cache, lastSync 1 August 2026; missing source detail/recording URLs are not reconstructed |
| Visits (`Visit_Module`) | 6,531 | CSV dated 8 August 2026 |
| Product Details (`Product_Details1`) | 5,896 | CSV dated 9 August 2026; displayed through exact parent subform mapping |
| Visit–Order links (`Service_A_X_Orders`) | 13,483 | CSV dated 9 August 2026 |
| **Total** | **122,157** | Multiple dates; not a common-epoch/current-source completeness assertion |

153 captured module definitions and 386 saved-view list definitions remain preserved. Existing source navigation flags expose 27 eligible ordinary data-module tabs. Generated subform/linking datasets retain their source classification. Unrecovered payloads return an unavailable state and null totals, not false empty-module claims.

## Correction to earlier recovery

`/Users/apple/Downloads/dashboards_vercel/local_server.py` declares organisation `60038775297`, not the target. Its `.api_cache` contributed foreign-prefix `8870640…` records to the earlier bundle: 12,400 Leads, 5,003 Deals, and 28,000 Calls. Previous totals based on that bundle are invalid for the target CRM. This source has been removed from the builder; it was not deleted from disk. The mixed bundle is retained for investigation only in `.private/checkpoints/excluded-mixed-organisation-snapshot-20260907.tar.gz`; it is **not** a safe production rollback target.

The corrected source namespace is validated against the known target's `1032257…` record IDs. This is an additional guard alongside source package/org/module evidence, not an independent universal Zoho org-identification algorithm. Future legitimate namespace changes require reviewed source evidence, not bypassing validation.

## Source artifacts and verification

- `/Users/apple/Downloads/Zoho_CRM_Complete_AI_Continuation_Pack_2026-08-10.zip`: its `LIVE_CRM_STATE.md` declares the target org; embedded `FILE_MANIFEST.tsv` checksums validate five private CSV exports.
- `.private/zoho-discovery/latest.json`: captured module identities, fields, lookup paths, source navigation flags, and organisation timezone; capture dated 29 August 2026.
- `/Users/apple/Downloads/Magppie-360-Handoff`: explicit target-org README/source; compact Calls mapper preserves duration in seconds.
- Recovery output: `.private/recovered-exports/2026-08-10-full/{raw,records,mapping}`, `manifest.json`, `source-evidence.md`, and `reconciliation.json`. Files contain private CRM data and must not be publicly published.
- `scripts/recover-offline-export.py`: verifies raw hashes, exact IDs, unambiguous field names, lookup IDs, dates and decimals. Keeps unmapped source columns in raw/mapping artifacts. Never guesses IDs or product/commercial values.
- `scripts/audit-offline-recovery.py`: independently compares every mapped cell and complete source ID sets. All five exports match; 2,638,035 mapped cells have zero discrepancies.
- Five audited nonblank parent paths resolve completely: Visits→Qualified Leads 6,531; Product Details→Qualified Leads 5,896; Product Details→Orders 5,204; Visit–Order links→Visits 13,483; Visit–Order links→Orders 13,483. The 692 blank Product Detail order lookups remain blank. Duplicate Visit–Order pairs: zero.
- Focused Node contracts: five passing tests across `offline-module-availability.test.js` and `offline-recovered-data.test.js`. Python recovery contracts: four passing tests. Full suite previously passed 901 tests with one skip; focused tests passed again after subform hydration.

## Remaining limitations and next work

1. Eleven source headers are not safely mapped: Contacts `Opportunity Name`, `BD.id`, `BD`; Deals `Lead-Created-Time`; Visits `Change Log Time`; Product Details owner ID/name, `Last Activity Time`, `Currency`, `Exchange Rate`; Visit–Order links `Change Log Time`. Preserve their raw values; require authoritative mapping evidence.
2. Existing Contacts take precedence over export rows with the same ID; this deliberately preserves saved records, but is not a field-by-field freshness merge. Current module dates do not establish every record's source date.
3. The snapshot header's original timestamp is derived partly from filesystem modification times. Treat per-source/export notices as freshness evidence; do not call it a fresh September Zoho sync.
4. Original subform row order is not verified. No order is fabricated.
5. Notes, attachment bodies, most related datasets, saved-view criteria execution, full raw field parity, permissions, durable edits, Blueprints/workflows, integrations and operational parity remain incomplete in this offline runtime. Recording playback cannot be claimed from the recovered compact Calls cache.
6. The old Supabase hostname returned `ENOTFOUND` during a bounded read-only recovery check. Code-only hand-over archives do not replace its missing full database backup. Continue searching authorized local backups before considering any source reconnection.

## Safety and reproducibility

The schema-v4 builder/runtime validates org identity, module identity, unique string IDs, known target namespace, record counts and payload hashes. Rebuild through `npm run snapshot:build` and `npm run snapshot:build:deployment`; both use existing local files only. The server uses `server-offline.js`. Do not start `server.js` or sync commands while the user's pause is in effect.

Monthly Flash Review SHA-256 must remain `2cd40fba4ee5d3485a43bc559df9297a6eaccb5a2cce15b389d4f1ff33fd1677`. No Flash Review source or user storage was changed during this recovery.
