# Zoho CRM Source Inventory

Updated: 2026-08-30T16:38:39Z

Source mode: **read-only**

Authenticated target organization verified: **Yes**

Raw API responses are stored only in the ignored, permission-restricted `.private/zoho-discovery/` directory.

The authenticated Setup index was also mapped in read-only mode. See `ZOHO_SETUP_UI_INVENTORY.md` for the accessible Setup surface.

The module table covers 122 API-supported datasets within the 153-module catalog. Data Volume is the aggregate count endpoint when available; it must not be read as active-ID parity.

The same-run Notes audit completed at `2026-08-30T16:38:39.339Z`: active IDs reconcile at 67,798/67,798 with zero gaps, while the separately observed count endpoint is 67,948 and retains a 150-row aggregate-scope difference. The Tasks/child audit completed at `2026-08-30T16:00:09.934Z`: Tasks reconcile at 12,422/12,422, and the four generated child datasets reconcile 7,827/7,827 enumerable active IDs; 4,737 additional count-only rows expose no IDs or payloads. The current task/child run imported and exact-payload-verified zero rows; historical totals remain 2/2.

At the historical `2026-08-30T07:11:35Z` local check, the continuously refreshed store contained 219,242 physical rows: 219,241 source-derived rows and one retained local-only Contacts QA row. This all-dataset snapshot predates the newer Notes and Tasks audits and is not adjusted by inference. Aggregate source-count comparisons use source-derived rows only.

No newer complete physical-row snapshot was produced by the bounded reconciliation audits.

Attachment evidence is metadata-only: 78,758 source IDs, 78,327 exact addressable module/record/attachment triples, 431 quarantined rows, 2 locally linked IDs, 78,756 source IDs absent locally, and 0 bodies migrated. On-demand access is implemented and tested but unmounted. Reproduce count-only evidence without loading credentials or accessing the source with `node scripts/discover-zoho.js --audit-attachment-manifest-counts`. See [Attachment Replication](ATTACHMENT_REPLICATION.md), [On-demand Access](docs/on-demand-attachment-access.md), [Migration Manifest](ZOHO_MIGRATION_MANIFEST.md), and [Reconciliation Report](ZOHO_RECONCILIATION_REPORT.md).

| Category | Source Item | Configuration | Dependencies | Data Volume | Local Status | Verification |
| --- | --- | --- | --- | ---: | --- | --- |
| Module | Raw Leads (Leads) | 134 fields; 1 layouts; 26 views; 23 related lists | Metadata and lookup map | 20222 | Data Migrated | Inspected |
| Module | Qualified Leads (Contacts) | 195 fields; 2 layouts; 28 views; 37 related lists | Metadata and lookup map | 4640 | Reconciled source-derived rows; 1 local-only QA row retained | Inspected |
| Module | Tasks (Tasks) | 21 fields; 1 layouts; 19 views; 4 related lists | Metadata and lookup map | 12422 | Reconciled at 2026-08-30T16:00:09.934Z | Inspected |
| Module | Orders (Deals) | 207 fields; 1 layouts; 61 views; 26 related lists | Metadata and lookup map | 7307 | Reconciled | Inspected |
| Module | Accounts (Accounts) | 42 fields; 1 layouts; 10 views; 24 related lists | Metadata and lookup map | 5618 | Reconciled | Inspected |
| Module | Meetings (Events) | 36 fields; 1 layouts; 13 views; 4 related lists | Metadata and lookup map | 5 | Reconciled | Inspected |
| Module | Calls (Calls) | 32 fields; 1 layouts; 28 views; 2 related lists | Metadata and lookup map | 56600 | Reconciled | Inspected |
| Module | Products (Products) | 32 fields; 1 layouts; 7 views; 22 related lists | Metadata and lookup map | 2640 | Reconciled | Inspected |
| Module | Quotes (Quotes) | 39 fields; 1 layouts; 5 views; 14 related lists | Metadata and lookup map | 0 | Not Inspected | Inspected |
| Module | Sales Orders (Sales_Orders) | 44 fields; 1 layouts; 5 views; 14 related lists | Metadata and lookup map | 0 | Not Inspected | Inspected |
| Module | Purchase Orders (Purchase_Orders) | 42 fields; 1 layouts; 6 views; 13 related lists | Metadata and lookup map | 0 | Not Inspected | Inspected |
| Module | Invoices (Invoices) | 42 fields; 1 layouts; 5 views; 13 related lists | Metadata and lookup map | 0 | Not Inspected | Inspected |
| Module | Campaigns (Campaigns) | 23 fields; 1 layouts; 6 views; 16 related lists | Metadata and lookup map | 0 | Not Inspected | Inspected |
| Module | Vendors (Vendors) | 26 fields; 1 layouts; 6 views; 18 related lists | Metadata and lookup map | 693 | Reconciled | Inspected |
| Module | Price Books (Price_Books) | 15 fields; 1 layouts; 5 views; 5 related lists | Metadata and lookup map | 0 | Not Inspected | Inspected |
| Module | Cases (Cases) | 30 fields; 1 layouts; 10 views; 15 related lists | Metadata and lookup map | 0 | Not Inspected | Inspected |
| Module | Solutions (Solutions) | 20 fields; 1 layouts; 6 views; 4 related lists | Metadata and lookup map | 0 | Not Inspected | Inspected |
| Module | Quoted Items (Quoted_Items) | 15 fields; 1 layouts; 4 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Sunrooof Products (Sunrooof_Products) | 13 fields; 1 layouts; 4 views; 0 related lists | Metadata and lookup map | 3 | Reconciled | Inspected |
| Module | Actual Material Required (Actual_Material_Required) | 10 fields; 1 layouts; 4 views; 0 related lists | Metadata and lookup map | 5 | Reconciled | Inspected |
| Module | Complaint Items Detail (Complaint_Items_Detail) | 11 fields; 1 layouts; 4 views; 0 related lists | Metadata and lookup map | 17 | Reconciled | Inspected |
| Module | AMS Done Data by Team (AMS_Done_Data_by_Team) | 10 fields; 1 layouts; 4 views; 0 related lists | Metadata and lookup map | 4720 | Reconciled | Inspected |
| Module | Visits (Visits) | 35 fields; 1 layouts; 6 views; 3 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | EmailSentiment (Email_Sentiment) | 8 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Ordered Items (Ordered_Items) | 15 fields; 1 layouts; 4 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Email Analytics (Email_Analytics) | 24 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Email Template Analytics (Email_Template_Analytics) | 14 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Product Details (Product_Details) | 13 fields; 1 layouts; 4 views; 0 related lists | Metadata and lookup map | 822 | Blocked: active-ID parity; 36 count-only rows unavailable | Inspected |
| Module | Product Detail (Product_Details1) | 20 fields; 2 layouts; 4 views; 0 related lists | Metadata and lookup map | 11609 | Blocked: active-ID parity; 4,674 count-only rows unavailable | Inspected |
| Module | Project Details (Project_Details) | 14 fields; 1 layouts; 4 views; 0 related lists | Metadata and lookup map | 40 | Blocked: active-ID parity; 1 count-only row unavailable | Inspected |
| Module | Project Detail (Project_Detail) | 19 fields; 2 layouts; 4 views; 0 related lists | Metadata and lookup map | 93 | Blocked: active-ID parity; 26 count-only rows unavailable | Inspected |
| Module | Stage History (DealHistory) | 20 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Purchase Items (Purchase_Items) | 15 fields; 1 layouts; 4 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Invoiced Items (Invoiced_Items) | 15 fields; 1 layouts; 4 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | My Jobs (Approvals) | 0 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Notes (Notes) | 11 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | 67948 | Same-epoch active-ID parity at 67,798/67,798; 150-row aggregate scope unresolved | Inspected |
| Module | Services (Services__s) | 26 fields; 1 layouts; 1 views; 4 related lists | Metadata and lookup map | 0 | Not Inspected | Inspected |
| Module | Appointments (Appointments__s) | 32 fields; 1 layouts; 15 views; 3 related lists | Metadata and lookup map | 0 | Not Inspected | Inspected |
| Module | Attachments (Attachments) | 10 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | 78,758 metadata IDs | Metadata only: 78,758 IDs indexed; 78,327 addressable; 431 quarantined; 2 locally linked; 78,756 absent; 0 bodies migrated; on-demand access unmounted | Inspected |
| Module | Actions Performed (Actions_Performed) | 8 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Facebook (Facebook) | 5 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Twitter (Twitter) | 5 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Locking Information (Locking_Information__s) | 9 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Functions (Functions__s) | 27 fields; 0 layouts; 6 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Site Pictures (Image_Upload_1__s) | 14 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Lead Status History (Lead_Status_History) | 13 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | VoC Resources (VocResources) | 12 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | VoC Responses Leads (VocResponses_Leads) | 27 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | VoC Answers Leads (VocAnswers_Leads) | 9 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | VoC Events Leads (VocEvents_Leads) | 6 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | VoC Keywords Leads (VocInferences_Leads) | 11 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | VoC Responses Contacts (VocResponses_Contacts) | 28 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | VoC Answers Contacts (VocAnswers_Contacts) | 10 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | VoC Events Contacts (VocEvents_Contacts) | 6 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | VoC Keywords Contacts (VocInferences_Contacts) | 11 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Kitchen Layout (Image_Upload_2__s) | 14 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Kitchen Layout (Image_Upload_3__s) | 14 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Kitchen Layout (Image_Upload_4__s) | 14 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Services X Users (Services_X_Users__s) | 10 fields; 1 layouts; 0 views; 1 related lists | Metadata and lookup map | 0 | Not Inspected | Inspected |
| Module | Appointments Rescheduled History (Appointments_Rescheduled_History__s) | 13 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Opportunity Stage History (Opportunity_Stage_History) | 18 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Upload Site Images(Scanner) (Image_Upload_5__s) | 14 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Upload Site Images(Scanner) (Image_Upload_6__s) | 14 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | VoC Responses VocAnonymous (VocResponses_VocAnonymous) | 26 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | VoC Answers VocAnonymous (VocAnswers_VocAnonymous) | 8 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | VoC Events VocAnonymous (VocEvents_VocAnonymous) | 5 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | VoC Keywords VocAnonymous (VocInferences_VocAnonymous) | 10 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Service Managements (Service_Managements) | 0 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Blocked |
| Module | Service Status History (Service_Status_History) | 10 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Developers (Developers) | 23 fields; 1 layouts; 8 views; 13 related lists | Metadata and lookup map | 21 | Reconciled | Inspected |
| Module | Referral Partners (Referral_Partners) | 23 fields; 1 layouts; 8 views; 15 related lists | Metadata and lookup map | 2 | Reconciled | Inspected |
| Module | Payment Milestones (Payment_Milestones) | 29 fields; 1 layouts; 8 views; 14 related lists | Metadata and lookup map | 8 | Reconciled | Inspected |
| Module | Designers (Designers) | 16 fields; 1 layouts; 8 views; 14 related lists | Metadata and lookup map | 3 | Reconciled | Inspected |
| Module | Payment M X Orders (Payment_M_X_Orders) | 18 fields; 1 layouts; 5 views; 12 related lists | Metadata and lookup map | 0 | Not Inspected | Inspected |
| Module | Order Closure form (File_Upload_1__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Payment Received Document (File_Upload_2__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Payment Confirmation (File_Upload_3__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Estimate (File_Upload_4__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Order Closure (File_Upload_5__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Estimate (File_Upload_6__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Payment Confirmation (File_Upload_7__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Appliances List (File_Upload_8__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Drawing (File_Upload_9__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Mood Board (File_Upload_10__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Order Closure (File_Upload_11__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Accessory List (File_Upload_12__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Scanner (Image_Upload_7__s) | 14 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Visit Module (Visit_Module) | 59 fields; 1 layouts; 12 views; 15 related lists | Metadata and lookup map | 10901 | Reconciled | Inspected |
| Module | Voc Inferences Relation Leads (VocInferenceRelations_Leads) | 2 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Voc Inferences Relation Contacts (VocInferenceRelations_Contacts) | 2 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Voc Inferences Relation VocAnonymous (VocInferenceRelations_VocAnonymous) | 2 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Status History (Status_History) | 13 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Visit A X Orders (Service_A_X_Orders) | 19 fields; 1 layouts; 5 views; 12 related lists | Metadata and lookup map | 14156 | Reconciled | Inspected |
| Module | Signed Drawing (File_Upload_13__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Handover Certificate (File_Upload_14__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Complaint Video (File_Upload_15__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | AMS/Complaints (AMS_Complaints) | 47 fields; 1 layouts; 10 views; 15 related lists | Metadata and lookup map | 3388 | Reconciled | Inspected |
| Module | Stages History (Stages_History) | 11 fields; 1 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Complaint Video (File_Upload_16__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Kitchen Layout (Image_Upload_8__s) | 14 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Order Closure form (File_Upload_17__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Payment Received Document (File_Upload_18__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Estimate (File_Upload_19__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Payment Confirmation (File_Upload_20__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Appliances List (File_Upload_21__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Drawing (File_Upload_22__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Mood Board (File_Upload_23__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Order Closure (File_Upload_24__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Accessory List (File_Upload_25__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Handover Certificate (File_Upload_26__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Kitchen Layout (Image_Upload_9__s) | 14 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Order Closure form (File_Upload_27__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Payment Received Document (File_Upload_28__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Estimate (File_Upload_29__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Payment Confirmation (File_Upload_30__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Appliances List (File_Upload_31__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Drawing (File_Upload_32__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Mood Board (File_Upload_33__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Order Closure (File_Upload_34__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Signed Accessory List (File_Upload_35__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Handover Certificate (File_Upload_36__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |
| Module | Images (File_Upload_37__s) | 10 fields; 0 layouts; 0 views; 0 related lists | Metadata and lookup map | Pending | Not Inspected | Inspected |

## Organization-Level Discovery

| Area | Endpoint status | Coverage status |
| --- | ---: | --- |
| modules | 200 | Inspected |
| users | 200 | Inspected |
| roles | 200 | Inspected |
| profiles | 200 | Inspected |
| territories | 400 | Blocked |
| currencies | 401 | Not Accessible |
| global picklists | 200 | Inspected |
| variables | 204 | Inspected |
| workflow rules | 200 | Inspected |
| field updates | 200 | Inspected |
| email notifications | 200 | Inspected |
| automation tasks | 200 | Inspected |
| webhooks | 200 | Inspected |
| functions | 200 | Inspected |
