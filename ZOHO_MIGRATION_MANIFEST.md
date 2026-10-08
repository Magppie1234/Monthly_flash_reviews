# Zoho CRM Migration Manifest

Updated: 2026-08-30T16:38:39Z

Raw exports and attachments must remain outside version control. Source Count is the aggregate count endpoint when available; active-ID audits are stated separately and take precedence for their audited scope.

Attachments are metadata-only and must never be inferred as migrated from module-row presence: 78,758 source IDs, 78,327 exact addressable triples, 431 quarantined rows, 2 locally linked IDs, 78,756 source IDs absent locally, and 0 bodies migrated. The tested on-demand service remains unmounted. Reproduce count-only evidence without loading credentials or accessing the source with `node scripts/discover-zoho.js --audit-attachment-manifest-counts`. See [Attachment Replication](ATTACHMENT_REPLICATION.md), [On-demand Access](docs/on-demand-attachment-access.md), [Source Inventory](ZOHO_SOURCE_INVENTORY.md), and [Reconciliation Report](ZOHO_RECONCILIATION_REPORT.md).

The same-run Notes audit completed at `2026-08-30T16:38:39.339Z`: active IDs reconcile at 67,798/67,798 with zero gaps, while its separately observed count endpoint is 67,948 and retains a 150-row aggregate-scope difference. The Tasks/child audit completed at `2026-08-30T16:00:09.934Z`: Tasks reconcile at 12,422/12,422; four generated child datasets have 7,827/7,827 active-ID parity and 4,737 additional count-only rows without retrievable IDs or payloads. The current task/child audit imported zero rows and performed zero new exact-payload checks; historical imported and exact-payload-verified totals remain 2/2.

The separate physical-row snapshot at `2026-08-30T07:11:35Z` recorded 219,242 rows: 219,241 source-derived rows and one retained local-only Contacts QA row. It predates the newer Notes and Tasks audits and is preserved as historical evidence; no newer all-dataset total is inferred by adding changes from unrelated audit epochs.

| Module | Source Count Endpoint | Export Method | Export Timestamp | Field Count | Related Datasets / Active-ID Evidence | Attachment Count | Export Status | Import Status | Reconciliation |
| --- | ---: | --- | --- | ---: | --- | ---: | --- | --- | --- |
| Leads | 20222 | Official Zoho API | 2026-08-29T18:08:21.123Z | 134 | See relationship map | Pending | Inspected | Data Migrated | Not Inspected |
| Contacts | 4640 | Official Zoho API | 2026-08-29T18:08:21.123Z | 195 | See relationship map | Pending | Inspected | Data Migrated | Not Inspected |
| Tasks | 12422 | Official Zoho API | 2026-08-30T16:00:09.934Z | 21 | Active IDs 12,422/12,422; current imports/payload checks 0/0; historical imports/exact checks 1/1 | Pending | Inspected | Reconciled | Reconciled |
| Deals | 7307 | Official Zoho API | 2026-08-29T18:08:21.123Z | 207 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Accounts | 5618 | Official Zoho API | 2026-08-29T18:08:21.123Z | 42 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Events | 5 | Official Zoho API | 2026-08-29T18:08:21.123Z | 36 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Calls | 56600 | Official Zoho API | 2026-08-29T18:08:21.123Z | 32 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Products | 2640 | Official Zoho API | 2026-08-29T18:08:21.123Z | 32 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Quotes | 0 | Official Zoho API | 2026-08-29T18:08:21.123Z | 39 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Sales_Orders | 0 | Official Zoho API | 2026-08-29T18:08:21.123Z | 44 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Purchase_Orders | 0 | Official Zoho API | 2026-08-29T18:08:21.123Z | 42 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Invoices | 0 | Official Zoho API | 2026-08-29T18:08:21.123Z | 42 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Campaigns | 0 | Official Zoho API | 2026-08-29T18:08:21.123Z | 23 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Vendors | 693 | Official Zoho API | 2026-08-29T18:08:21.123Z | 26 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Price_Books | 0 | Official Zoho API | 2026-08-29T18:08:21.123Z | 15 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Cases | 0 | Official Zoho API | 2026-08-29T18:08:21.123Z | 30 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Solutions | 0 | Official Zoho API | 2026-08-29T18:08:21.123Z | 20 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Quoted_Items | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 15 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Sunrooof_Products | 3 | Official Zoho API | 2026-08-29T18:08:21.123Z | 13 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Actual_Material_Required | 5 | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Complaint_Items_Detail | 17 | Official Zoho API | 2026-08-29T18:08:21.123Z | 11 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| AMS_Done_Data_by_Team | 4720 | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Visits | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 35 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Email_Sentiment | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 8 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Ordered_Items | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 15 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Email_Analytics | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 24 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Email_Template_Analytics | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 14 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Product_Details | 822 | Official Zoho API | 2026-08-30T16:00:09.934Z | 13 | Active IDs 786/786; current imports/payload checks 0/0; 36 count-only rows unavailable | Pending | Inspected | Data Migrated | Active-ID parity; count-only blocked |
| Product_Details1 | 11609 | Official Zoho API | 2026-08-30T16:00:09.934Z | 20 | Active IDs 6,935/6,935; current imports/payload checks 0/0; historical imports/exact checks 1/1; 4,674 count-only rows unavailable | Pending | Inspected | Data Migrated | Active-ID parity; count-only blocked |
| Project_Details | 40 | Official Zoho API | 2026-08-30T16:00:09.934Z | 14 | Active IDs 39/39; current imports/payload checks 0/0; 1 count-only row unavailable | Pending | Inspected | Data Migrated | Active-ID parity; count-only blocked |
| Project_Detail | 93 | Official Zoho API | 2026-08-30T16:00:09.934Z | 19 | Active IDs 67/67; current imports/payload checks 0/0; 26 count-only rows unavailable | Pending | Inspected | Data Migrated | Active-ID parity; count-only blocked |
| DealHistory | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 20 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Purchase_Items | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 15 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Invoiced_Items | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 15 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Approvals | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 0 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Notes | 67948 | Official Zoho API | 2026-08-30T16:38:39.339Z | 11 | Active IDs 67,798/67,798; zero active gaps; 150 aggregate-scope delta unresolved | Pending | Inspected | Reconciled active IDs | Same-epoch active-ID parity; aggregate scope unresolved |
| Services__s | 0 | Official Zoho API | 2026-08-29T18:08:21.123Z | 26 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Appointments__s | 0 | Official Zoho API | 2026-08-29T18:08:21.123Z | 32 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Attachments | 78,758 metadata IDs | Read-only metadata manifest | 2026-08-30 | 10 | 78,327 exact addressable triples; 431 quarantined | 78,758 metadata rows | Inspected | 0 bodies migrated; on-demand access unmounted | Metadata reconciled only; body parity blocked |
| Actions_Performed | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 8 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Facebook | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 5 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Twitter | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 5 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Locking_Information__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 9 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Functions__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 27 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Image_Upload_1__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 14 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Lead_Status_History | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 13 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocResources | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 12 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocResponses_Leads | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 27 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocAnswers_Leads | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 9 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocEvents_Leads | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 6 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocInferences_Leads | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 11 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocResponses_Contacts | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 28 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocAnswers_Contacts | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocEvents_Contacts | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 6 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocInferences_Contacts | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 11 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Image_Upload_2__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 14 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Image_Upload_3__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 14 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Image_Upload_4__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 14 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Services_X_Users__s | 0 | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Appointments_Rescheduled_History__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 13 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Opportunity_Stage_History | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 18 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Image_Upload_5__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 14 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Image_Upload_6__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 14 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocResponses_VocAnonymous | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 26 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocAnswers_VocAnonymous | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 8 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocEvents_VocAnonymous | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 5 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocInferences_VocAnonymous | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Service_Managements | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 0 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Service_Status_History | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Developers | 21 | Official Zoho API | 2026-08-29T18:08:21.123Z | 23 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Referral_Partners | 2 | Official Zoho API | 2026-08-29T18:08:21.123Z | 23 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Payment_Milestones | 8 | Official Zoho API | 2026-08-29T18:08:21.123Z | 29 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Designers | 3 | Official Zoho API | 2026-08-29T18:08:21.123Z | 16 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Payment_M_X_Orders | 0 | Official Zoho API | 2026-08-29T18:08:21.123Z | 18 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_1__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_2__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_3__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_4__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_5__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_6__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_7__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_8__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_9__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_10__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_11__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_12__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Image_Upload_7__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 14 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Visit_Module | 10901 | Official Zoho API | 2026-08-29T18:08:21.123Z | 59 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| VocInferenceRelations_Leads | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 2 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocInferenceRelations_Contacts | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 2 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| VocInferenceRelations_VocAnonymous | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 2 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Status_History | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 13 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Service_A_X_Orders | 14156 | Official Zoho API | 2026-08-29T18:08:21.123Z | 19 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| File_Upload_13__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_14__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_15__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| AMS_Complaints | 3388 | Official Zoho API | 2026-08-29T18:08:21.123Z | 47 | See relationship map | Pending | Inspected | Data Migrated | Reconciled |
| Stages_History | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 11 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_16__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Image_Upload_8__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 14 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_17__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_18__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_19__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_20__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_21__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_22__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_23__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_24__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_25__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_26__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| Image_Upload_9__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 14 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_27__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_28__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_29__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_30__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_31__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_32__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_33__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_34__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_35__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_36__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
| File_Upload_37__s | Pending | Official Zoho API | 2026-08-29T18:08:21.123Z | 10 | See relationship map | Pending | Inspected | Not Inspected | Not Inspected |
