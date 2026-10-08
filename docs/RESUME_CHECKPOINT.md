# Resume checkpoint — 7 September 2026

## Objective and current steering

The goal is complete operational replacement of the actual Zoho organisation, as specified in `/Users/apple/.codex/attachments/a6b3ec12-df2b-401f-8630-92b21ff2dcc5/pasted-text-1.txt` (23 numbered sections). Read that objective before continuing. Current steering pauses Zoho connectivity and requests restoration of exact module structure using previously saved data. Preserve Monthly Flash Review exactly. Do not reactivate source sync to close discovery gaps without addressing that instruction.

## Authoritative state

- Project: `/Users/apple/Downloads/magppie-crm-clone`; no Git repository is present. Do not claim a commit or clean worktree.
- Default and Vercel backend: `server-offline.js`; connected implementation remains in `server.js` but is not the current default runtime.
- Local snapshot: `.private/offline-snapshot`; deployment bundle: `snapshot-data`. These contain customer data and must remain outside Git/public static serving.
- The offline builder reads existing local caches only. It preserves 153 source module definitions, 2,377 captured field definitions, and 386 captured saved-view list definitions. Existing UI filtering selects 27 eligible data tabs. Generated child/internal modules retain their source flags and are not invented as ordinary tabs.
- Five recovered caches: Leads 34,639; Contacts 3,854; Deals 5,003; Tasks 11,393; Calls 28,000. These are cache counts, not common-epoch source reconciliation.
- Captured metadata timestamp: 29 August 2026. File modification time used by the original cache builder is not independently verified source extraction time. Multiple dashboard transformations are involved; exact payload fidelity remains unproven.
- All other module data returns `SNAPSHOT_MODULE_DATA_UNAVAILABLE`, total null, total_exact false. This is not a claim of an empty Zoho module.
- Captured source saved views are available through `/api/meta/captured_views`. They are not advertised as executable filters until exact criteria/user semantics work offline.
- Monthly Flash Review SHA-256: `2cd40fba4ee5d3485a43bc559df9297a6eaccb5a2cce15b389d4f1ff33fd1677`. No module file/storage changes are authorized by the navigation restoration request.

## Recovery and verification

- Recoverable pre-edit source checkpoint: `.private/checkpoints/offline-module-navigation-before-20260907.tar.gz`.
- New tests: `node --test test/offline-module-availability.test.js` — verifies preservation, unavailable versus empty behavior, list/search/bundle/detail paths, unknown-module handling, denied writes, and authentication.
- `npm run check` passes. `npm run snapshot:build` and `npm run snapshot:build:deployment` regenerate from local inputs without Zoho calls.
- Prior stable deployment before this continuation: `dpl_BYbNxUx47dxQH9H89qDkvsN7FipA`. Expanded navigation deployment `dpl_4qKUvJdzXgBW7eQpendryUu2hKeS` passed stable-alias API and browser checks. Final label correction deployed and promoted as `dpl_5VP14FGAzpAKLDMs4x4KVbho2vya`.
- Full suite: 899 tests, 898 passed, 0 failed, 1 skipped. Final change only shortens the unavailable dropdown label; `node --check public/app.js` passed after that change.
- Stable alias checks confirmed five cache totals, 153 definitions, sync disabled, missing-module null totals, exact deployed Flash Review hash, and HTTP 401 for unauthenticated snapshot file requests. Browser showed 27 data tabs and intact Monthly Flash Review without horizontal overflow at desktop width. Separate QA browser storage does not prove the contents of another user's localStorage; no user saved review was modified.
- Local server restarted on port 3100, exec session 89435. Revalidate process/listener on continuation rather than assuming session lifetime.
- Final stable alias inspection resolves to `dpl_5VP14FGAzpAKLDMs4x4KVbho2vya`, Ready. Browser confirmed 27 data tabs and the corrected unavailable label on that alias. At 390 px, the unavailable-module page has no document horizontal overflow; desktop/mobile screenshots are in `.private/qa`. The separate QA browser session was closed.
- Superseding final deployment: `dpl_ANL8REPtUFH6HH66jQqJ6FFmEcHj`, Ready and aliased to `https://magppie-crm-clone.vercel.app`. Mobile visual review required shortening the dropdown text again to `Data unavailable`. Final screenshot `.private/qa/offline-mobile-label-reviewed.png` shows the complete label at 390 px. Stable-alias API/assets rechecked: 153 definitions, final label present, exact unchanged Flash Review SHA-256, Zoho false, sync false. This supersedes the preceding final-deployment ID; it changes only the display label.

## Next concrete work

1. Finish staged and stable-alias verification of the expanded navigation, missing-record state, five cached modules, and unchanged Monthly Flash Review. Confirm no private snapshot files are exposed unauthenticated.
2. Locate a complete prior replica database dump or backup among authorized local project/handover artifacts. Historical documentation reports roughly 219k rows, while this recovered offline bundle has only 82,889. Do not equate the two or fabricate the missing rows. Read existing exports before considering source reconnection.
3. Establish raw extraction provenance and payload manifests. Audit the current dashboard-derived mapping/merge logic: it uses source precedence rather than per-field timestamp comparison, and some inferred timestamps/financial mappings need authoritative verification. Preserve raw caches and report discrepancies.
4. Restore original saved-view criteria execution using existing reviewed compiler and permission contracts; test memberships against captured evidence. Retaining 386 view definitions alone is not filter parity.
5. Continue the full acceptance register: exact identity/permissions, durable independent storage, executable Blueprints and workflows, related records and file bodies, integrations with controlled test destinations, reports/templates, restore/concurrency tests, reconciliation, migration rehearsal, cutover and rollback. Historical code and test counts do not establish current runtime acceptance.

## Completion and blockers

Full replacement is not complete. Source access is intentionally paused, and a complete offline payload/file/process export has not been located in this continuation. Many independent engineering steps remain, so do not mark the goal blocked solely because source access is paused. Live Zoho writes and customer communications remain prohibited during development and migration. No 100% claim is permitted with unresolved required gaps.
