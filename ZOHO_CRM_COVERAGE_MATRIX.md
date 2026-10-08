# Zoho CRM Coverage Matrix

Updated: 2026-08-30T16:38:39Z

Allowed statuses: Not Inspected, Inspected, Specified, In Development, Implemented, Data Migrated, Tested, Reconciled, Blocked, Not Accessible, Not Applicable.

Cross-cutting verification for this snapshot:

- Module metadata is reconciled at 153/153. Local metadata now matches the captured definitions for fields (2,377/2,377), layouts (70/70), field picklists (381/381), custom views (386/386), and related lists (375/375). Six captured global picklist definitions remain absent locally; `Service_Managements` configuration is unavailable because its source metadata scope failed, so unknown definitions cannot be treated as zero.
- The historical source-discovery artifact contains 386 custom-view list rows across 41 modules but no executable criteria bodies. The separately audited hydrated local runtime also contains 386 views: 102 executable-criteria views and 53 explicitly safe unfiltered views compile (155 total), while 134 unresolved criteria bodies and 97 unsupported definitions remain blocked (231 total). Of 41 defaults, 14 compile, 26 have unresolved bodies, and 1 is unsupported. Eleven hydrated visible modules with unresolved defaults render an unresolved state rather than query unfiltered. The single unsupported Tasks default may implicitly fall back to the explicitly safe `All Tasks` view; explicit unsupported selections remain denied.
- Related-list metadata contains 375 local definitions across 29 parent modules. The generic Related-tab contract excludes 69 and evaluates 281: 99 are queryable and 182 are unresolved (100 unresolved link paths, 33 unavailable target-field sets, and 49 unresolved target modules). Unresolved definitions are labelled unavailable; only queryable definitions may be reported as verified empty. Of 27 visible parent modules, 26 have definitions; `Service_Managements` configuration remains unavailable.
- The source permission catalog is captured, but no verified local identity mapping exists; local role/profile/field enforcement defaults to Deny.
- Source validation, assignment, approval, and pipeline execution remains blocked. Local layout-aware schema validation and fail-closed custom-view compilation are implemented but do not establish source-rule parity.
- The same-run Notes audit completed at `2026-08-30T16:38:39.339Z`: active IDs reconcile at 67,798/67,798 with zero gaps, while the separately observed 67,948 count endpoint retains a 150-row aggregate-scope difference. The Tasks/child audit completed at `2026-08-30T16:00:09.934Z`: Tasks reconcile at 12,422/12,422, and four generated child datasets reconcile every enumerable active ID at 7,827/7,827. Another 4,737 child rows remain count-only and blocked because Zoho exposes no IDs or payloads for them. The current task/child audit imported and exact-payload-verified zero rows; historical imported/verified totals remain 2/2.

| Module | Metadata | Layouts | Fields | Views | Related Lists | Blueprints | Buttons | Validation | Permissions | Data | Tests | Reconciliation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Raw Leads | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Data Migrated | Not Inspected | Not Inspected |
| Qualified Leads | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Data Migrated | Not Inspected | Not Inspected |
| Tasks | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Reconciled | Tested | Reconciled |
| Orders | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Accounts | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Meetings | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Calls | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Products | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Quotes | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Sales Orders | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Purchase Orders | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Invoices | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Campaigns | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Vendors | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Price Books | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Cases | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Solutions | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Quoted Items | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Sunrooof Products | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Actual Material Required | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Complaint Items Detail | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| AMS Done Data by Team | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Visits | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| EmailSentiment | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Ordered Items | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Email Analytics | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Email Template Analytics | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Product Details | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Blocked | Data Migrated | Tested | Blocked |
| Product Detail | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Blocked | Data Migrated | Tested | Blocked |
| Project Details | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Blocked | Data Migrated | Tested | Blocked |
| Project Detail | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Blocked | Data Migrated | Tested | Blocked |
| Stage History | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Purchase Items | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Invoiced Items | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| My Jobs | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Notes | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Blocked | Reconciled | Tested | Blocked |
| Services | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Appointments | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Attachments | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Blocked | Blocked | Tested | Blocked |
| Actions Performed | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Facebook | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Twitter | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Locking Information | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Functions | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Site Pictures | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Lead Status History | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| VoC Resources | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| VoC Responses Leads | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| VoC Answers Leads | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| VoC Events Leads | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| VoC Keywords Leads | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| VoC Responses Contacts | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| VoC Answers Contacts | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| VoC Events Contacts | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| VoC Keywords Contacts | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Kitchen Layout | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Kitchen Layout | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Kitchen Layout | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Services X Users | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Appointments Rescheduled History | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Opportunity Stage History | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Upload Site Images(Scanner) | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Upload Site Images(Scanner) | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| VoC Responses VocAnonymous | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| VoC Answers VocAnonymous | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| VoC Events VocAnonymous | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| VoC Keywords VocAnonymous | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Service Managements | Blocked | Blocked | Blocked | Blocked | Blocked | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Service Status History | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Developers | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Referral Partners | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Payment Milestones | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Designers | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Payment M X Orders | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Order Closure form | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Payment Received Document | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Payment Confirmation | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Estimate | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Order Closure | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Estimate | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Payment Confirmation | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Appliances List | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Drawing | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Mood Board | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Order Closure | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Accessory List | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Scanner | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Visit Module | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Voc Inferences Relation Leads | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Voc Inferences Relation Contacts | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Voc Inferences Relation VocAnonymous | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Status History | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Visit A X Orders | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Signed Drawing | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Handover Certificate | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Complaint Video | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| AMS/Complaints | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Not Inspected | Reconciled | Not Inspected | Reconciled |
| Stages History | Inspected | Inspected | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Complaint Video | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Kitchen Layout | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Order Closure form | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Payment Received Document | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Estimate | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Payment Confirmation | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Appliances List | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Drawing | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Mood Board | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Order Closure | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Accessory List | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Handover Certificate | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Kitchen Layout | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Order Closure form | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Payment Received Document | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Estimate | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Payment Confirmation | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Appliances List | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Drawing | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Mood Board | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Order Closure | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Signed Accessory List | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Handover Certificate | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
| Images | Inspected | Blocked | Inspected | Inspected | Inspected | Inspected | Blocked | Blocked | Not Inspected | Not Inspected | Not Inspected | Not Inspected |
