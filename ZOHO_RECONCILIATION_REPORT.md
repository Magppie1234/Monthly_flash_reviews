# Zoho CRM Reconciliation Report

Updated: 2026-08-30T16:38:39Z

At the last full discovery audit, the official read-only count endpoint returned usable counts for 37 of 122 API-supported datasets; 20 matched the source-derived local row counts at that audit epoch. Those aggregate figures were not re-created from unrelated current counts.

The official count endpoint is not always the same scope as the active-record enumeration API. A same-run Notes audit completed at `2026-08-30T16:38:39.339Z` and proves exact active-ID parity at 67,798/67,798 with zero source-only or local-only gaps. Its separately observed count endpoint returned 67,948, leaving a 150-row aggregate-scope difference rather than an active-ID gap. The Tasks/child audit completed at `2026-08-30T16:00:09.934Z`: Tasks reconcile at 12,422/12,422, and the four generated child datasets match all 7,827 enumerable active IDs. Their aggregate counts still include 4,737 additional rows with no retrievable IDs or payloads.

At the 2026-08-30T07:11:35Z local check, the continuously refreshed database contained 219,242 physical rows across 26 datasets: 219,241 source-derived rows plus one retained local-only Contacts QA row. Zoho is live, so counts can change after this timestamp. A non-match is never silently deleted or fabricated.

Attachment reconciliation covers metadata, not bodies: 78,758 source IDs, 78,327 exact addressable triples, 431 quarantined rows, 2 locally linked IDs, 78,756 source IDs absent locally, and 0 bodies migrated. The tested on-demand service remains unmounted. Reproduce count-only evidence without loading credentials or accessing the source with `node scripts/discover-zoho.js --audit-attachment-manifest-counts`. See [Attachment Replication](ATTACHMENT_REPLICATION.md), [On-demand Access](docs/on-demand-attachment-access.md), [Source Inventory](ZOHO_SOURCE_INVENTORY.md), and [Migration Manifest](ZOHO_MIGRATION_MANIFEST.md).

The scheduled active-record delta boundary is 16 record modules out of 122 API-supported modules. The other 106 modules, attachments, metadata/configuration, native reports, dashboards, and generated child datasets are not covered by that scheduler. A partial/error module makes the complete run partial. Health may report only `reconciled_current`, `ahead_of_audit_recheck_required`, `behind_source`, `partial_refresh`, or `unsupported_scope`. `reconciled_current` requires exact source and local observations from the same audit/recheck epoch; a later local digest match against a frozen source audit remains `ahead_of_audit_recheck_required` until the source is rechecked. A frozen audit that is older than a larger local count likewise requires a source recheck rather than a false drift or parity claim.

Source-deletion reconciliation is a separate staged boundary, not part of the active runtime. The engine and SQL archive/lease contract are focused-test covered for 15 of the 16 scheduled modules; Zoho's deleted-record endpoint does not document `Notes`. No live DDL was installed, no source-deletion run occurred, and no deletion reconciliation result is recorded in this report. Activation requires a verified exact source-organization lock, installed and verified SQL, a working singleton lease, exact per-module starting baselines, explicit feature flags, and fresh complete operational evidence for every included module. Until those gates pass, deletions remain unreconciled and Notes deletion parity remains unsupported.

| Dataset | Zoho Count Endpoint | Exported | Local Source-Derived / Active IDs | Valid | Failed | Active gap / count scope | Local-only / duplicate | Reconciliation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Leads | 20222 | Pending | 20463 | Pending | Pending | 0 | 241 | Not Inspected |
| Contacts | 4640 | Pending | 4640 | Pending | Pending | 0 | 1 local-only QA row | Reconciled source-derived rows |
| Tasks | 12422 | Pending | 12422 | Pending | Pending | 0 | 0 | Reconciled at 2026-08-30T16:00:09.934Z |
| Deals | 7307 | Pending | 7307 | Pending | Pending | 0 | 0 | Reconciled |
| Accounts | 5618 | Pending | 5618 | Pending | Pending | 0 | 0 | Reconciled |
| Events | 5 | Pending | 5 | Pending | Pending | 0 | 0 | Reconciled |
| Calls | 56600 | Pending | 56600 | Pending | Pending | 0 | 0 | Reconciled |
| Products | 2640 | Pending | 2640 | Pending | Pending | 0 | 0 | Reconciled |
| Quotes | 0 | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Sales_Orders | 0 | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Purchase_Orders | 0 | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Invoices | 0 | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Campaigns | 0 | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Vendors | 693 | Pending | 693 | Pending | Pending | 0 | 0 | Reconciled |
| Price_Books | 0 | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Cases | 0 | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Solutions | 0 | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Quoted_Items | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Sunrooof_Products | 3 | Pending | 3 | Pending | Pending | 0 | 0 | Reconciled |
| Actual_Material_Required | 5 | Pending | 5 | Pending | Pending | 0 | 0 | Reconciled |
| Complaint_Items_Detail | 17 | Pending | 17 | Pending | Pending | 0 | 0 | Reconciled |
| AMS_Done_Data_by_Team | 4720 | Pending | 4720 | Pending | Pending | 0 | 0 | Reconciled |
| Visits | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Email_Sentiment | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Ordered_Items | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Email_Analytics | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Email_Template_Analytics | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Product_Details | 822 | Pending | 786 | Pending | Pending | 0 active / 36 count-only | 0 | Active-ID parity; count-only blocked |
| Product_Details1 | 11609 | Pending | 6935 | Pending | Pending | 0 active / 4,674 count-only | 0 | Active-ID parity; one historical exact-payload import; count-only blocked |
| Project_Details | 40 | Pending | 39 | Pending | Pending | 0 active / 1 count-only | 0 | Active-ID parity; count-only blocked |
| Project_Detail | 93 | Pending | 67 | Pending | Pending | 0 active / 26 count-only | 0 | Active-ID parity; count-only blocked |
| DealHistory | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Purchase_Items | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Invoiced_Items | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Approvals | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Notes | 67948 | Pending | 67798 | Pending | Pending | 0 active / 150 aggregate-scope delta | 0 | Same-epoch active-ID parity at 2026-08-30T16:38:39.339Z; aggregate scope unresolved |
| Services__s | 0 | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Appointments__s | 0 | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Attachments | 78,758 metadata IDs | 78,758 metadata rows | 2 locally linked IDs | 0 migrated bodies | 78,756 source IDs absent locally | 78,327 addressable / 431 quarantined | 0 verified migrated bodies | Metadata reconciled only; body parity blocked; on-demand access unmounted |
| Actions_Performed | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Facebook | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Twitter | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Locking_Information__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Functions__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Image_Upload_1__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Lead_Status_History | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocResources | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocResponses_Leads | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocAnswers_Leads | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocEvents_Leads | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocInferences_Leads | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocResponses_Contacts | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocAnswers_Contacts | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocEvents_Contacts | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocInferences_Contacts | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Image_Upload_2__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Image_Upload_3__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Image_Upload_4__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Services_X_Users__s | 0 | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Appointments_Rescheduled_History__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Opportunity_Stage_History | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Image_Upload_5__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Image_Upload_6__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocResponses_VocAnonymous | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocAnswers_VocAnonymous | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocEvents_VocAnonymous | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocInferences_VocAnonymous | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Service_Managements | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Service_Status_History | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Developers | 21 | Pending | 21 | Pending | Pending | 0 | 0 | Reconciled |
| Referral_Partners | 2 | Pending | 2 | Pending | Pending | 0 | 0 | Reconciled |
| Payment_Milestones | 8 | Pending | 8 | Pending | Pending | 0 | 0 | Reconciled |
| Designers | 3 | Pending | 3 | Pending | Pending | 0 | 0 | Reconciled |
| Payment_M_X_Orders | 0 | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_1__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_2__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_3__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_4__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_5__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_6__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_7__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_8__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_9__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_10__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_11__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_12__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Image_Upload_7__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Visit_Module | 10901 | Pending | 10901 | Pending | Pending | 0 | 0 | Reconciled |
| VocInferenceRelations_Leads | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocInferenceRelations_Contacts | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| VocInferenceRelations_VocAnonymous | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Status_History | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Service_A_X_Orders | 14156 | Pending | 14156 | Pending | Pending | 0 | 0 | Reconciled |
| File_Upload_13__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_14__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_15__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| AMS_Complaints | 3388 | Pending | 3388 | Pending | Pending | 0 | 0 | Reconciled |
| Stages_History | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_16__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Image_Upload_8__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_17__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_18__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_19__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_20__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_21__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_22__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_23__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_24__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_25__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_26__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| Image_Upload_9__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_27__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_28__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_29__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_30__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_31__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_32__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_33__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_34__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_35__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_36__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
| File_Upload_37__s | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not Inspected |
