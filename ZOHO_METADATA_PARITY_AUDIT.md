# Zoho CRM Metadata Parity Audit

Status: **Blocked**. This is a read-only, metadata-only audit. All successfully captured field, layout, custom-view list, and related-list definitions are now mirrored locally, but incomplete source responses and unavailable executable definitions still prevent production parity.

## Exact captured parity

| Area | Captured source definitions | Local definitions | Matched | Source-only | Local-only | Drift | Successful source requests | Status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Modules | 153 | 153 | 153 | 0 | 0 | 0 | 1/1 | Reconciled |
| Fields | 2,377 | 2,377 | 2,377 | 0 | 0 | 0 | 121/122 | Blocked |
| Layouts | 70 | 70 | 70 | 0 | 0 | 0 | 75/122 | Blocked |
| Picklists | 387 | 381 | 381 | 6 | 0 | 0 | field 121/122; global 1/1 | Blocked |
| Pipelines | 0 | 0 | 0 | 0 | 0 | 0 | 1/70 | Blocked |
| Custom views | 386 | 386 | 386 | 0 | 0 | 2 | 121/122 | Blocked |
| Related lists | 375 | 375 | 375 | 0 | 0 | 0 | 121/122 | Blocked |

The source column counts definitions present in the existing discovery snapshot. Where source requests failed, it is not an estimate of the inaccessible definitions. Exact status-code counts and affected module scopes are retained in the sanitized JSON artifact.

Picklists comprise 381 captured field-level definitions and 6 global definitions, compared with 381 local field-level definitions and 0 local global definitions. Captured field option values total 31,807 at source and 31,807 locally. The global-list response did not include option values.

The two custom-view drift cases are changes to the shared `default` flag. Source-only view criteria or local-only enrichment attributes are not called drift: comparison is limited to semantic attributes captured on both sides.

Custom-view list metadata contains executable criteria bodies for 0/386 captured rows. Rows without criteria remain visibly unavailable and are never treated as unfiltered views.

Pipeline zero-versus-zero is not parity. Only 1 of 70 captured pipeline requests succeeded, that response contained no definitions, and the remaining 69 requests failed.

## Blockers

- Captured source evidence remains incomplete: field 1/122 failed requests; layout 47/122 failed requests; custom-view 1/122 failed requests; related-list 1/122 failed requests. Definitions behind failed scopes are unknown.
- 2 matched custom-view definitions differ on shared semantic attributes.
- 386 captured custom-view list rows do not include executable criteria bodies and remain fail-closed.
- Pipeline evidence is incomplete: 69 of 70 captured requests failed, with 0 source and 0 local definitions available for comparison.
- 6 captured global picklist definitions are absent locally, and the captured global catalog does not include option values.

## Safety boundary

- Existing private discovery evidence was read without making a source request.
- The local database query selects only approved `crm_meta` keys; no CRM records or identity catalogs are queried.
- This audit run performs no source or local metadata writes and never deletes definitions. Missing-only hydration is a separate guarded command with exact-organization verification.
- Public evidence contains aggregate counts and safe module API scopes only. It excludes records, identities, raw IDs, links, credentials, private locations, and hashes.

## Decision

Keep failed source scopes, custom-view criteria bodies, pipeline definitions, and global picklist values fail-closed. Never infer missing definitions or treat an incomplete view as unfiltered.
