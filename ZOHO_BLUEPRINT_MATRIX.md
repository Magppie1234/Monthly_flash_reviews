# Zoho CRM Blueprint Matrix

Updated: 2026-08-30

Source Blueprint inspection is read-only. The authoritative structural endpoint is requested for every listed Blueprint. Raw successful responses remain private; this document and `config/blueprints.json` contain only sanitized graph fields.

Phase-detail and policy counts use unique Blueprint transitions, not graph connections. A captured automatic transition is included in phase-detail coverage but is never treated as a manually executable transition. “Source Coverage” reports `Phase specified` when complete Before/During/After evidence exists; otherwise it reports structural graph coverage only. Authenticated read-only UI inspection captured exact Before/During/After evidence for all 83 Contacts transitions and all 5 Tasks transitions. Authenticated read-only UI GET requests captured equivalent exact evidence for all 80 Deals transitions. In total, 202/202 transitions across all 7 Blueprints have phase details. Five transitions are policy eligible: two Leads transitions plus the exact Contacts `Approve/Disapprove Quote` → `Raw Quote`, `Raw Quote` → `Ringing No Response`, and `Revised Design Discussion` → `Revised Design Discussion1` transitions. The remaining 197 are policy blocked, including all 5/5 Tasks transitions and all 80/80 Deals transitions. Every policy-eligible transition is bound to a reviewed contract policy and fails closed if its source path, phases, inputs, actions, or identity scope drift. Zero transitions are atomically runtime-ready and all forms remain inspection-only: the staged RPC is not installed, and runtime readiness separately requires a fresh bounded exact catalog/body/owner/ACL/canary verification plus a verified request principal, Blueprint authorization, and audit-actor binding. Exact SQL alone cannot satisfy that identity boundary, and disposable-database transaction acceptance has not run. Raw Quotation additionally requires an explicit real calendar date and accepts only a blank or whole-number amount.

| Module | Blueprint | Layout | State Field | Status | Structural Graph | Phase Details / Policy / Atomic Runtime |
| --- | --- | --- | --- | --- | --- | --- |
| Leads | Lead nurturing process | Standard | Lead_Status | Active | HTTP 500; authenticated UI fallback | 8/8 phase details; 2/8 policy eligible; 6/8 policy blocked; 0/8 atomic ready |
| Contacts | Opportunity Stage | Standard | Stage | Active | HTTP 500; authenticated UI fallback | 83/83 phase details; 3/83 policy eligible; 80/83 policy blocked; 0/83 atomic ready |
| Tasks | Task Process Management | Standard | Status | Inactive | 5 states; 5 transitions; 6 connections | 5/5 phase details; 0/5 policy eligible; 5/5 policy blocked; 0/5 atomic ready |
| Deals | Order Stages | Standard | Stage | Active | HTTP 500; authenticated UI fallback | 80/80 phase details; 0/80 policy eligible; 80/80 policy blocked; 0/80 atomic ready |
| Accounts | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Events | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Calls | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Products | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Quotes | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Sales_Orders | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Purchase_Orders | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Invoices | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Campaigns | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Vendors | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Price_Books | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Cases | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Solutions | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Quoted_Items | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Sunrooof_Products | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Actual_Material_Required | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Complaint_Items_Detail | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| AMS_Done_Data_by_Team | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Visits | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Email_Sentiment | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Ordered_Items | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Email_Analytics | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Email_Template_Analytics | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Product_Details | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Product_Details1 | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Project_Details | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Project_Detail | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| DealHistory | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Purchase_Items | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Invoiced_Items | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Approvals | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Notes | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Services__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Appointments__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Attachments | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Actions_Performed | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Facebook | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Twitter | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Locking_Information__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Functions__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Image_Upload_1__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Lead_Status_History | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocResources | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocResponses_Leads | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocAnswers_Leads | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocEvents_Leads | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocInferences_Leads | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocResponses_Contacts | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocAnswers_Contacts | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocEvents_Contacts | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocInferences_Contacts | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Image_Upload_2__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Image_Upload_3__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Image_Upload_4__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Services_X_Users__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Appointments_Rescheduled_History__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Opportunity_Stage_History | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Image_Upload_5__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Image_Upload_6__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocResponses_VocAnonymous | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocAnswers_VocAnonymous | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocEvents_VocAnonymous | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocInferences_VocAnonymous | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Service_Managements | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Service_Status_History | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Developers | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Referral_Partners | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Payment_Milestones | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Designers | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Payment_M_X_Orders | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_1__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_2__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_3__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_4__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_5__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_6__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_7__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_8__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_9__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_10__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_11__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_12__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Image_Upload_7__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Visit_Module | Installation Visit Flow | Standard | AMS_Status | Active | 2 states; 1 transitions; 1 connections | 1/1 phase details; 0/1 policy eligible; 1/1 policy blocked; 0/1 atomic ready |
| VocInferenceRelations_Leads | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocInferenceRelations_Contacts | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| VocInferenceRelations_VocAnonymous | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Status_History | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Service_A_X_Orders | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_13__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_14__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_15__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| AMS_Complaints | Complaint Flow - Installation | Standard | Stage | Active | 11 states; 10 transitions; 26 connections | 10/10 phase details; 0/10 policy eligible; 10/10 policy blocked; 0/10 atomic ready; 1 automatic |
| AMS_Complaints | AMS/Complaint Flow | Standard | Stage | Active | 14 states; 15 transitions; 41 connections | 15/15 phase details; 0/15 policy eligible; 15/15 policy blocked; 0/15 atomic ready |
| Stages_History | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_16__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Image_Upload_8__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_17__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_18__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_19__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_20__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_21__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_22__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_23__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_24__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_25__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_26__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| Image_Upload_9__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_27__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_28__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_29__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_30__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_31__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_32__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_33__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_34__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_35__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_36__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |
| File_Upload_37__s | None returned | — | — | Inspected | Not Applicable | Not Applicable |

## Transition Matrices

### Lead nurturing process — Leads

State field: `Lead_Status`. Source status: Active. Graph source: authenticated-ui-fallback (HTTP 500). Phase details: 8/8 specified. Policy: 2/8 eligible; 6/8 blocked. Atomic runtime: 0/8 ready.

| Current State | Transition | API Name | Trigger | Global | Included States | Next State | Source Coverage | Local Status |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| Not Contacted Yet | No Response/Call Back Later | — | Unknown | Yes | 0 | No Response/ Call Back Later | Phase specified | Blocked |
| No Response/ Call Back Later | Under Follow Up | — | Unknown | Yes | 0 | Under Follow Up | Phase specified | Blocked |
| Under Follow Up | Will buy in Future | — | Unknown | Yes | 0 | Will buy in Future | Phase specified | Blocked |
| Under Follow Up | Not Interested | — | Unknown | Yes | 0 | Not Interested | Phase specified | Blocked |
| Under Follow Up | Junk Lead | — | Unknown | Yes | 0 | Junk Lead | Phase specified | Blocked |
| -None- | Not Called Yet | — | Unknown | No | 0 | Not Contacted Yet | Phase specified | Blocked |
| -None- | Qualified | — | Unknown | Yes | 0 | Qualified/ Drawings Awiated | Phase specified | Implemented |
| -None- | Human Intervention Required | — | Unknown | Yes | 0 | Human Intervention Required(AI) | Phase specified | Implemented |

### Opportunity Stage — Contacts

State field: `Stage`. Source status: Active. Graph source: authenticated-ui-fallback (HTTP 500). Phase details: 83/83 specified. Policy: 3/83 eligible; 80/83 blocked. Atomic runtime: 0/83 ready.

Captured phase evidence:

- **Raw Quotation** — trigger: manual; before owners: All Users; during: field Follow Up Date (required), field BD Value (optional whole number); after actions: none; local: Implemented with an exact drift-sensitive policy, explicit real-calendar-date validation, and strict integer semantics.
- **Ringing No Response** — trigger: manual; before owners: All Users; during: none; after actions: none; local: Implemented.
- **Revised Design Discussion1** — trigger: manual; before owners: All Users; during: none; after actions: none; local: Implemented.
- **Under Follow Up** — trigger: manual; before owners: All Users; during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Design Discussion** — trigger: manual; before owners: All Users; during: field Follow Up Date (required); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Not Interested** — trigger: manual; before owners: All Users; during: field Lead Drop Reason (required); after actions: client Status, Lead drop Date; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Revised Design Discussion** — trigger: manual; before owners: All Users; during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Price Dicussion** — trigger: manual; before owners: All Users; during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Principally Closed** — trigger: manual; before owners: All Users; during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Create Payment Terms** — trigger: manual; before owners: Specific Users (1); during: widget Payment Milestone Widget (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Closure** — trigger: manual; before owners: All Users; during: widget Handover to Post Design (optional); after actions: Actual Closure, WOn, Create Won Recoad in Books; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Closure New - Pinki** — trigger: manual; before owners: Specific Users (1); during: widget Closure New - Pinki (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Closure.** — trigger: manual; before owners: Record Owner; during: none; after actions: Actual Closure, WOn, Create Deal in Sunrooof; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Revised Design Discussion1** — trigger: manual; before owners: All Users; during: none; after actions: none; local: Implemented.
- **Will Buy in Future** — trigger: manual; before owners: Record Owner; during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Design Form** — trigger: manual; before owners: All Users; during: widget Designer Form Widget (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Approve/Revise Quote** — trigger: manual; before owners: All Users; during: widget Revise Quote - Widget (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Design Form for Backend** — trigger: manual; before owners: Specific Users (1); during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Order Update** — trigger: manual; before owners: Specific Users (1); during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **On Hold** — trigger: manual; before owners: All Users; during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **test** — trigger: manual; before owners: Specific Users (1); during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Handover to Post Design** — trigger: manual; before owners: All Users; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Update Order Stages** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: Create Won Recoad in Books; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Update Order Stages.** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: Create Won Recoad in Books; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Validated By SM** — trigger: manual; before owners: All Users; during: field Sales Person's Value (required), associated_item Notes (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **update** — trigger: manual; before owners: Specific Users (1); during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Assign Post Designer** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Request for fist measurement** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Aling first measurement** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **First measurement done** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Revisit Req-First Measurment** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **First measurement Appoved** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Design revision after site measurement** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Design approved** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Sent to client** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Preparation of electrical and plumbing** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Request for electrical and plumbing marking** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Scheduling Meeting For Finishes** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Assign Electric/Plumbing Marking** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Electric/plumbing Marking Done** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Modd Board Selection Request** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Sample Request To Factory** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Modd Board Selection Approved** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Modd Board Approved** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Revision Required Modd board** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Preparation of 3D Drawing** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Revision Required For 3D Drawing** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **3D Drawing Approved** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Pre. of Sign-Off And Production Drawing - Design** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Send for Design/Payment Approval** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Handover TO Factory** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Site Follow up - Satvir** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Create MPP - Factory** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Site Follow Up Done** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Material Procurement - Factory** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Request For Electric/Plumbing** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Electric/Plumbing Checking Done** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Align PDI** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **PDI Done** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Prepare PDI - Designer** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Send PDI Drawing to Factory - Designer** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Create Production Set -Planning** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Start Production** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Sent For Dispatch Payment** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Dispatch payment Done** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Site Approved For Dispatch - Installation** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **First Dispatch Done- Factory** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Start First Installation Process** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Wal Cladding** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Initial Installation Completed** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Sent For Second Disapatch Approval** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Second Dispatch Done** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Start Second Installation Process** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Ready For Handover** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Final Handover** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Raise Final Complaint** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Complaint Material Dipatched** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Complaint Material Installed** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **handover to post - 2** — trigger: manual; before owners: Specific Users (1); during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **II** — trigger: manual; before owners: Record Owner; during: widget Handover To Post Team (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **post widget** — trigger: manual; before owners: Specific Users (1); during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Preparation of 3D Drawing After Revision** — trigger: manual; before owners: Record Owner; during: widget Handover to Post Design (optional); after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **Reverse** — trigger: manual; before owners: Specific Users (1); during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.
- **reverse.** — trigger: manual; before owners: Record Owner; during: none; after actions: none; local: Blocked; reason: Captured from read-only source UI. Local execution remains blocked until source-equivalent identity and permission rules, During inputs, and every After action are implemented and tested.

| Current State | Transition | API Name | Trigger | Global | Included States | Next State | Source Coverage | Local Status |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| Approve/Disapprove Quote | Raw Quotation | — | manual | No | 0 | Raw Quote | Phase specified | Implemented |
| Raw Quote | Ringing No Response | — | manual | No | 0 | Ringing No Response | Phase specified | Implemented |
| Raw Quote | Under Follow Up | — | manual | Yes | 0 | Under Follow Up | Phase specified | Blocked |
| Raw Quote | Design Discussion | — | manual | Yes | 0 | Design Discussion | Phase specified | Blocked |
| Design Discussion | Not Interested | — | manual | Yes | 0 | Dead | Phase specified | Blocked |
| Design Discussion | Revised Design Discussion | — | manual | Yes | 0 | Revised Design Discussion | Phase specified | Blocked |
| Revised Design Discussion | Revised Design Discussion1 | — | manual | No | 0 | Revised Design Discussion1 | Phase specified | Implemented |
| Design Discussion | Price Dicussion | — | manual | Yes | 0 | Price Discussion | Phase specified | Blocked |
| Price Discussion | Principally Closed | — | manual | Yes | 0 | Principally Closed | Phase specified | Blocked |
| Price Discussion | Create Payment Terms | — | manual | No | 0 | Principally Closed | Phase specified | Blocked |
| Principally Closed | Closure | — | manual | No | 0 | Closure | Phase specified | Blocked |
| Principally Closed | Closure New - Pinki | — | manual | No | 0 | Closure | Phase specified | Blocked |
| Principally Closed | Closure. | — | manual | No | 0 | Closure | Phase specified | Blocked |
| Revised Design Discussion | Revised Design Discussion1 | — | manual | No | 0 | Revised Design Discussion1 | Phase specified | Implemented |
| Design Discussion | Will Buy in Future | — | manual | No | 0 | Will Buy in Future | Phase specified | Blocked |
| Validated By SM | Design Form | — | manual | Yes | 0 | Design Form Filled | Phase specified | Blocked |
| Design Form Filled | Approve/Revise Quote | — | manual | No | 0 | Approve/Disapprove Quote | Phase specified | Blocked |
| Opportunity Receieved | Design Form for Backend | — | manual | No | 0 | Design Form Filled | Phase specified | Blocked |
| Opportunity Receieved | Order Update | — | manual | No | 0 | Design Form Filled | Phase specified | Blocked |
| Design Discussion | On Hold | — | manual | Yes | 0 | On Hold | Phase specified | Blocked |
| Design Form Filled | test | — | manual | No | 0 | Site Approved For Dispatched | Phase specified | Blocked |
| Closure | Handover to Post Design | — | manual | Yes | 0 | Handover To Post Design | Phase specified | Blocked |
| Handover To Post Design | Update Order Stages | — | manual | Yes | 0 | Update Order Stages | Phase specified | Blocked |
| Update Order Stages | Update Order Stages. | — | manual | No | 0 | Order Stage Update | Phase specified | Blocked |
| Opportunity Receieved | Validated By SM | — | manual | No | 0 | Validated By SM | Phase specified | Blocked |
| On Hold | update | — | manual | No | 0 | Handover To Post Design | Phase specified | Blocked |
| Handover To Post Design | Assign Post Designer | — | manual | No | 0 | Assign Post Designer | Phase specified | Blocked |
| Assign Post Designer | Request for fist measurement | — | manual | No | 0 | Request for site vist | Phase specified | Blocked |
| Request for site vist | Aling first measurement | — | manual | No | 0 | Align First Measurement | Phase specified | Blocked |
| Align First Measurement | First measurement done | — | manual | No | 0 | First Measurement Done | Phase specified | Blocked |
| First Measurement Done | Revisit Req-First Measurment | — | manual | No | 0 | Revisit Req-First Measurement | Phase specified | Blocked |
| First Measurement Done | First measurement Appoved | — | manual | No | 0 | First Measurement Approved | Phase specified | Blocked |
| First Measurement Approved | Design revision after site measurement | — | manual | No | 0 | Design Revision After Site Measurement | Phase specified | Blocked |
| First Measurement Approved | Design approved | — | manual | No | 0 | Design Approval | Phase specified | Blocked |
| Design Approval | Sent to client | — | manual | No | 0 | Design Approved | Phase specified | Blocked |
| Design Approval | Preparation of electrical and plumbing | — | manual | No | 0 | Preparation of Electrical and Plumbing Drawings | Phase specified | Blocked |
| Preparation of Electrical and Plumbing Drawings | Request for electrical and plumbing marking | — | manual | No | 0 | Request for Electric and Plumbing Marking | Phase specified | Blocked |
| Preparation of Electrical and Plumbing Drawings | Scheduling Meeting For Finishes | — | manual | No | 0 | Scheduling Meeting For Finishes | Phase specified | Blocked |
| Request for Electric and Plumbing Marking | Assign Electric/Plumbing Marking | — | manual | No | 0 | Electric/Plumbing Marking Aligned | Phase specified | Blocked |
| Electric/Plumbing Marking Aligned | Electric/plumbing Marking Done | — | manual | No | 0 | Electric/Plumbing Marking Done | Phase specified | Blocked |
| Electric/Plumbing Marking Done | Modd Board Selection Request | — | manual | No | 0 | Modd Board Selection (Client) Request | Phase specified | Blocked |
| Modd Board Selection (Client) Request | Sample Request To Factory | — | manual | No | 0 | Sample Request | Phase specified | Blocked |
| Modd Board Selection (Client) Request | Modd Board Selection Approved | — | manual | No | 0 | Modd Board Selection Approved | Phase specified | Blocked |
| Sample Request | Modd Board Approved | — | manual | No | 0 | Modd Board Selection Approved | Phase specified | Blocked |
| Modd Board Selection (Client) Request | Revision Required Modd board | — | manual | No | 0 | Revision Modd Board | Phase specified | Blocked |
| Modd Board Selection Approved | Preparation of 3D Drawing | — | manual | No | 0 | Preparation  of 3D Drawing | Phase specified | Blocked |
| Preparation  of 3D Drawing | Revision Required For 3D Drawing | — | manual | No | 0 | Revision For 3D Drawing | Phase specified | Blocked |
| Preparation  of 3D Drawing | 3D Drawing Approved | — | manual | No | 0 | 3D Drawing Approved | Phase specified | Blocked |
| 3D Drawing Approved | Pre. of Sign-Off And Production Drawing - Design | — | manual | No | 0 | Pre. Of Sign-off & Production Drawing | Phase specified | Blocked |
| Pre. Of Sign-off & Production Drawing | Send for Design/Payment Approval | — | manual | No | 0 | Sent For Design Approval | Phase specified | Blocked |
| Sent For Design Approval | Handover TO Factory | — | manual | No | 0 | Handover To Factory | Phase specified | Blocked |
| Handover To Factory | Site Follow up - Satvir | — | manual | No | 0 | Site Follow up | Phase specified | Blocked |
| Handover To Factory | Create MPP - Factory | — | manual | No | 0 | Create MPP | Phase specified | Blocked |
| Site Follow up | Site Follow Up Done | — | manual | No | 0 | Site Follow  Up Down | Phase specified | Blocked |
| Create MPP | Material Procurement - Factory | — | manual | No | 0 | Material Procurement | Phase specified | Blocked |
| Material Procurement | Request For Electric/Plumbing | — | manual | No | 0 | Request For Electric Plumbing Checking | Phase specified | Blocked |
| Request For Electric Plumbing Checking | Electric/Plumbing Checking Done | — | manual | No | 0 | Electric/Plumbing Checking Done | Phase specified | Blocked |
| Electric/Plumbing Checking Done | Align PDI | — | manual | No | 0 | Align PDI | Phase specified | Blocked |
| Align PDI | PDI Done | — | manual | No | 0 | PDI Done | Phase specified | Blocked |
| PDI Done | Prepare PDI - Designer | — | manual | No | 0 | Prepare PDI | Phase specified | Blocked |
| Prepare PDI | Send PDI Drawing to Factory - Designer | — | manual | No | 0 | Send PDI Drawing to Factory | Phase specified | Blocked |
| Send PDI Drawing to Factory | Create Production Set -Planning | — | manual | No | 0 | Create Production Set | Phase specified | Blocked |
| Create Production Set | Start Production | — | manual | No | 0 | Start Production | Phase specified | Blocked |
| Start Production | Sent For Dispatch Payment | — | manual | No | 0 | Sent For PDI Payment Approval | Phase specified | Blocked |
| Sent For PDI Payment Approval | Dispatch payment Done | — | manual | No | 0 | PDI Payment Done | Phase specified | Blocked |
| PDI Payment Done | Site Approved For Dispatch - Installation | — | manual | No | 0 | Site Approved For Dispatched | Phase specified | Blocked |
| Site Approved For Dispatched | First Dispatch Done- Factory | — | manual | No | 0 | First Dispatch Done | Phase specified | Blocked |
| First Dispatch Done | Start First Installation Process | — | manual | No | 0 | Start First Installation Process | Phase specified | Blocked |
| Start First Installation Process | Wal Cladding | — | manual | No | 0 | Wal Cladding | Phase specified | Blocked |
| Start First Installation Process | Initial Installation Completed | — | manual | No | 0 | First Installation  Done | Phase specified | Blocked |
| First Installation  Done | Sent For Second Disapatch Approval | — | manual | No | 0 | Sent For Second Dispatch Approval | Phase specified | Blocked |
| Sent For Second Dispatch Approval | Second Dispatch Done | — | manual | No | 0 | Second Dispatch Done | Phase specified | Blocked |
| Second Dispatch Done | Start Second Installation Process | — | manual | No | 0 | Start Second Installation Process | Phase specified | Blocked |
| Start Second Installation Process | Ready For Handover | — | manual | No | 0 | Second Installation Done | Phase specified | Blocked |
| Second Installation Done | Final Handover | — | manual | No | 0 | Final Handover | Phase specified | Blocked |
| Second Installation Done | Raise Final Complaint | — | manual | No | 0 | Raise Final Complaint | Phase specified | Blocked |
| Raise Final Complaint | Complaint Material Dipatched | — | manual | No | 0 | Complaint Material Dispatched | Phase specified | Blocked |
| Complaint Material Dispatched | Complaint Material Installed | — | manual | No | 0 | Second Installation Done | Phase specified | Blocked |
| Handover To Post Design | handover to post - 2 | — | manual | No | 0 | Second Installation Done | Phase specified | Blocked |
| Wal Cladding | II | — | manual | Yes | 0 | First Installation  Done | Phase specified | Blocked |
| Principally Closed | post widget | — | manual | No | 0 | Price Discussion | Phase specified | Blocked |
| Revision For 3D Drawing | Preparation of 3D Drawing After Revision | — | manual | No | 0 | Preparation  of 3D Drawing | Phase specified | Blocked |
| Handover To Post Design | Reverse | — | manual | No | 0 | Closure | Phase specified | Blocked |
| Design Form Filled | reverse. | — | manual | No | 0 | Opportunity Receieved | Phase specified | Blocked |

### Task Process Management — Tasks

State field: `Status`. Source status: Inactive. Graph source: settings-blueprint-detail (HTTP 200). Phase details: 5/5 specified from authenticated read-only UI inspection. Policy: 0/5 eligible; 5/5 blocked. Atomic runtime: 0/5 ready. The source Blueprint is inactive, and no local activation or transition execution is enabled.

Captured phase evidence:

- **Awaiting input** — trigger: manual; before owners: Record Owner; during: message Message (optional), field Due Date (required); after actions: Reminder task for - ${Tasks.Subject}; local: Blocked; reason: source-equivalent identity, date validation, task scheduling, action, and rollback behavior are not implemented and acceptance-tested.
- **Do later** — trigger: manual; before owners: Record Owner; during: message Message (optional), field Due Date (required); after actions: Reminder for deferred task - ${Tasks.Subject}; local: Blocked; reason: source-equivalent identity, date validation, task scheduling, action, and rollback behavior are not implemented and acceptance-tested.
- **Started** — trigger: manual; before owners: Record Owner; during: message Message (optional), field Priority (required); after actions: none; local: Blocked; reason: the source Blueprint is inactive and source-equivalent identity, validation, action, and rollback behavior are not implemented and acceptance-tested.
- **Resume** — trigger: manual; before owners: Record Owner; during: none; after actions: none; local: Blocked; reason: the source Blueprint is inactive and source-equivalent identity, action, and rollback behavior are not implemented and acceptance-tested.
- **Mark as complete** — trigger: manual; before owners: Record Owner; during: message Message (optional); after actions: none; local: Blocked; reason: the source Blueprint is inactive and source-equivalent identity, action, and rollback behavior are not implemented and acceptance-tested.

| Current State | Transition | API Name | Trigger | Global | Included States | Next State | Source Coverage | Local Status |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| Not Started | Started | — | manual | No | 0 | In Progress | Phase specified | Blocked |
| In Progress | Mark as complete | — | manual | No | 0 | Completed | Phase specified | Blocked |
| In Progress | Awaiting input | — | manual | No | 0 | Waiting for input | Phase specified | Blocked |
| In Progress | Do later | — | manual | No | 0 | Deferred | Phase specified | Blocked |
| Waiting for input | Resume | — | manual | Yes | 2 | In Progress | Phase specified | Blocked |
| Deferred | Resume | — | manual | Yes | 2 | In Progress | Phase specified | Blocked |

### Order Stages — Deals

State field: `Stage`. Source status: Active. Graph source: authenticated-ui-fallback (HTTP 500). Phase details: 80/80 specified from authenticated read-only UI GET requests. Policy: 0/80 eligible; 80/80 blocked. Atomic runtime: 0/80 ready. Captured composition: 77 During inputs, including 49 field inputs, and 25 After actions. Eight transitions contain source criteria available only as display-form evidence; their unsupported criteria logic is explicitly marked and evaluates false locally.

| Current State | Transition | API Name | Trigger | Global | Included States | Next State | Source Coverage | Local Status |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| Sent for Approval | Not Interested | — | manual | No | 0 | Not Interested | Phase specified | Blocked |
| Price Discussion | Principally Close | — | manual | No | 0 | Payment Awaited | Phase specified | Blocked |
| Payment Awaited | Closure | — | manual | Yes | 0 | Closure | Phase specified | Blocked |
| Payment Awaited | Closure Sunrooof | — | manual | No | 0 | Closure | Phase specified | Blocked |
| Sent for Approval | Design Approved | — | manual | No | 0 | Price Discussion | Phase specified | Blocked |
| Handover to Post Design | Assign Post Designer | — | manual | No | 0 | Assign Post - Designer | Phase specified | Blocked |
| Request for Site Visit | Align First Measurement | — | manual | Yes | 0 | Align First Measurement | Phase specified | Blocked |
| Align First Measurement | First Measurement Done | — | manual | No | 0 | First Measurement Done | Phase specified | Blocked |
| Design Approval | Preparation of Electrical and Plumbing | — | manual | Yes | 0 | Preparation of Electrical and Plumbing Drawings | Phase specified | Blocked |
| Preparation of Electrical and Plumbing Drawings | Schedule Meeting for Finishes | — | manual | No | 0 | Schedule Meeting for Finishes | Phase specified | Blocked |
| 3D Drawings Approved | Prep. of Sign-off and Production Drawings - Design | — | manual | No | 0 | Prep. of Sign-off & Production Drawing | Phase specified | Blocked |
| Prep. of Sign-off & Production Drawing | Send for Design/Payment Approval | — | manual | No | 0 | Sent for Design Approval | Phase specified | Blocked |
| Sent for Design Approval | Handover to Factory | — | manual | No | 0 | Handover to Factory | Phase specified | Blocked |
| Handover to Factory | Create MPP - Factory | — | manual | No | 0 | Create MPP | Phase specified | Blocked |
| Create MPP | Material Procurement - Factory | — | manual | No | 0 | Material Procurement | Phase specified | Blocked |
| PDI Done | Prepare PDI - Designer | — | manual | No | 0 | Prepare PDI | Phase specified | Blocked |
| Prepare PDI | Send PDI Drawings to Factory - Designer | — | manual | No | 0 | Send PDI Drawings to Factory | Phase specified | Blocked |
| Send PDI Drawings to Factory | Create Production Set - Planning | — | manual | No | 0 | Create Production Set | Phase specified | Blocked |
| Create Production Set | Start Production | — | manual | No | 0 | Start Production | Phase specified | Blocked |
| Start Production | Sent for Dispatch Payment | — | manual | No | 0 | Sent for PDI payment Approval | Phase specified | Blocked |
| PDI Payment Done | Site Approved for Dispatch- Installation | — | manual | No | 0 | Site Approved for Dispatch | Phase specified | Blocked |
| Sent for PDI payment Approval | Dispatch Payment Done | — | manual | No | 0 | PDI Payment Done | Phase specified | Blocked |
| Site Approved for Dispatch | First Dispatch Done - Factory | — | manual | No | 0 | First Dipatch Done | Phase specified | Blocked |
| Wall cladding | Initial installation completed | — | manual | No | 0 | First Installation Done | Phase specified | Blocked |
| First Installation Done | Sent for Second Dispatch Approval | — | manual | No | 0 | Sent for Second Dispatch Approval | Phase specified | Blocked |
| Second Dispatch Approved | Second Dispatch Done | — | manual | No | 0 | Second Dispatch Done | Phase specified | Blocked |
| Second Dispatch Done | Start Second Installation Process | — | manual | No | 0 | Start Second Installation Process | Phase specified | Blocked |
| Start Second Installation Process | Second Installation Done | — | manual | No | 0 | Second Installation Done | Phase specified | Blocked |
| Second Installation Done | Final Handover | — | manual | No | 0 | Final Handover | Phase specified | Blocked |
| Start Second Installation Process | Raise Final Complaint | — | manual | No | 0 | Raise Final Complaint | Phase specified | Blocked |
| Raise Final Complaint | Complaint Material Dispatched | — | manual | No | 0 | Complaint Material Dispatched | Phase specified | Blocked |
| Complaint Material Dispatched | Complaint Material Installed | — | manual | No | 0 | Second Dispatch Done | Phase specified | Blocked |
| Request for Electric and Plumbing Marking | Asign Electric/Plumbing Marking | — | manual | No | 0 | Electric/Plumbing Marking Aligned | Phase specified | Blocked |
| Electric/Plumbing Marking Aligned | Electric/Plumbing Marking Done | — | manual | No | 0 | Electric/Plumbing Marking Done | Phase specified | Blocked |
| Electric/Plumbing Checking Done | Align PDI | — | manual | No | 0 | Align PDI | Phase specified | Blocked |
| Align PDI | PDI Done | — | manual | No | 0 | PDI Done | Phase specified | Blocked |
| Handover to Factory | Site Follow up -Satvir | — | manual | No | 0 | Site Follow up | Phase specified | Blocked |
| Site Follow up | Site Follow up Done | — | manual | No | 0 | Site Follow up Done | Phase specified | Blocked |
| Designer Assigned | Send For Approval | — | manual | No | 0 | Sent for Approval | Phase specified | Blocked |
| Designer Assigned | Send For Approval Revision | — | manual | No | 0 | Sent for Approval | Phase specified | Blocked |
| Designer Assigned | Send for Approval-SN | — | manual | No | 0 | Sent for Approval | Phase specified | Blocked |
| Designer Assigned | Send For Approval Revision-SN | — | manual | No | 0 | Sent for Approval | Phase specified | Blocked |
| Sent for Approval | Pending From SM | — | manual | Yes | 0 | Query to SM | Phase specified | Blocked |
| Query to SM | Reqs. Completed | — | manual | No | 0 | Designer Assigned | Phase specified | Blocked |
| Sent for Approval | Revision Required | — | manual | Yes | 0 | Revision Required | Phase specified | Blocked |
| Form Filled | Assign Designer | — | manual | Yes | 0 | Designer Assigned | Phase specified | Blocked |
| Assign Post - Designer | Request for First Measurement | — | manual | No | 0 | Request for Site Visit | Phase specified | Blocked |
| First Measurement Approved | Design Revision after first Measurement | — | manual | No | 0 | Design Revision After Site Measurement | Phase specified | Blocked |
| Preparation of Electrical and Plumbing Drawings | Request for Electric and Plumbing Marking | — | manual | No | 0 | Request for Electric and Plumbing Marking | Phase specified | Blocked |
| None | Form Filled | — | manual | No | 0 | Form Filled | Phase specified | Blocked |
| Electric/Plumbing Marking Done | Modd Board Selection Request | — | manual | Yes | 0 | Modd Board Selection(Client) Request | Phase specified | Blocked |
| Modd Board Selection(Client) Request | Modd Board Selection Approved | — | manual | No | 0 | Modd Board Selection Approved | Phase specified | Blocked |
| Modd Board Selection Approved | Preparation of 3D Drawings | — | manual | No | 0 | Preparation of 3D Drawings | Phase specified | Blocked |
| Preparation of 3D Drawings | 3D Drawings Approved | — | manual | No | 0 | 3D Drawings Approved | Phase specified | Blocked |
| Request for Electric Plumbing Checking | Electric/Plumbing Checking Done | — | manual | No | 0 | Electric/Plumbing Checking Done | Phase specified | Blocked |
| Modd Board Selection(Client) Request | Revision Required Modd Board | — | manual | No | 0 | Revision Modd Board | Phase specified | Blocked |
| Preparation of 3D Drawings | Revision Required for 3D Drawing | — | manual | No | 0 | Revision For 3D Drawing | Phase specified | Blocked |
| Query to SM | Req. Completed | — | manual | No | 0 | Form Filled | Phase specified | Blocked |
| Material Procurement | Request for Electrical / Plumbering | — | manual | No | 0 | Request for Electric Plumbing Checking | Phase specified | Blocked |
| First Measurement Done | First Measurement Approved | — | manual | Yes | 0 | First Measurement Approved | Phase specified | Blocked |
| First Measurement Done | Revisit Req-First Measurement | — | manual | No | 0 | Revisit Req-First Measurement | Phase specified | Blocked |
| Closure | Handover to Post design | — | manual | No | 0 | Handover to Post Design | Phase specified | Blocked |
| First Measurement Approved | Design Approved. | — | manual | Yes | 0 | Design Approval | Phase specified | Blocked |
| Design Approval | Send to Client | — | manual | No | 0 | Design Approved After First Meaurement | Phase specified | Blocked |
| Modd Board Selection(Client) Request | Sample Request to Factory | — | manual | No | 0 | Sample Request | Phase specified | Blocked |
| Sample Request | Modd Board Approved | — | manual | No | 0 | Modd Board Selection Approved | Phase specified | Blocked |
| Designer Assigned | Update Stage | — | manual | No | 0 | Assign Post - Designer | Phase specified | Blocked |
| First Dipatch Done | Start First Installation Process | — | manual | No | 0 | Start First Installation Process | Phase specified | Blocked |
| Start First Installation Process | Wal Cladding | — | manual | No | 0 | Wall cladding | Phase specified | Blocked |
| Complaint Raised | Complaint Close | — | manual | No | 0 | Complaint Closed | Phase specified | Blocked |
| Complaint Closed | Start Installation | — | manual | No | 0 | Start First Installation Process | Phase specified | Blocked |
| Start First Installation Process | Complaint Raise | — | manual | No | 0 | Complaint Raised | Phase specified | Blocked |
| Wall cladding | Complaint raise | — | manual | No | 0 | Complaint Raised | Phase specified | Blocked |
| Sent for Second Dispatch Approval | Second Dispatch Approve | — | manual | No | 0 | Second Dispatch Approved | Phase specified | Blocked |
| Raise Final Complaint | Closed Final Complaint | — | manual | No | 0 | Second Dispatch Done | Phase specified | Blocked |
| None | Hold | — | manual | Yes | 0 | Hold | Phase specified | Blocked |
| Form Filled | ab | — | manual | No | 0 | Site Approved for Dispatch | Phase specified | Blocked |
| Revision For 3D Drawing | Preparation of 3D Drawings After Revison | — | manual | No | 0 | Preparation of 3D Drawings | Phase specified | Blocked |
| Closure | Reverse | — | manual | No | 0 | Payment Awaited | Phase specified | Blocked |
| Final Handover | p | — | manual | No | 0 | Second Installation Done | Phase specified | Blocked |

### Installation Visit Flow — Visit_Module

State field: `AMS_Status`. Source status: Active. Graph source: settings-blueprint-detail (HTTP 200). Phase details: 1/1 specified. Policy: 0/1 eligible; 1/1 blocked. Atomic runtime: 0/1 ready.

| Current State | Transition | API Name | Trigger | Global | Included States | Next State | Source Coverage | Local Status |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| Open | Visit Done | Visit_Done | manual | No | 0 | Done | Specified | Blocked |

### Complaint Flow - Installation — AMS_Complaints

State field: `Stage`. Source status: Active. Graph source: settings-blueprint-detail (HTTP 200). Phase details: 10/10 specified. Policy: 0/10 eligible; 10/10 blocked. Atomic runtime: 0/10 ready. Automatic transitions: 1.

| Current State | Transition | API Name | Trigger | Global | Included States | Next State | Source Coverage | Local Status |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| Approved by IM | Sent to QC | Sent_to_QC | manual | No | 0 | Sent to QC | Specified | Blocked |
| Sent to QC | Sent to Planning | Sent_to_Planning | manual | No | 0 | Sent to Planning | Specified | Blocked |
| Sent to QC | Send to Purchase | Send_to_Purchase | manual | No | 0 | Sent for Purchase | Specified | Blocked |
| Sent for Purchase | Hold | Hold | manual | Yes | 9 | Hold | Specified | Blocked |
| Sent to Planning | Hold | Hold | manual | Yes | 9 | Hold | Specified | Blocked |
| Approved by IM | Hold | Hold | manual | Yes | 9 | Hold | Specified | Blocked |
| Create PO | Hold | Hold | manual | Yes | 9 | Hold | Specified | Blocked |
| Send to Production | Hold | Hold | manual | Yes | 9 | Hold | Specified | Blocked |
| Sent for Dispatch | Hold | Hold | manual | Yes | 9 | Hold | Specified | Blocked |
| Dispatch | Hold | Hold | manual | Yes | 9 | Hold | Specified | Blocked |
| Final QA Pending | Hold | Hold | manual | Yes | 9 | Hold | Specified | Blocked |
| Final QA Done | Hold | Hold | manual | Yes | 9 | Hold | Specified | Blocked |
| Sent for Purchase | Create PO | Create_PO | manual | No | 0 | Create PO | Specified | Blocked |
| Create PO | Send to Production | Send_to_Production | manual | Yes | 7 | Send to Production | Specified | Blocked |
| Send to Production | Sent for Dispatch | Sent_for_Dispatch | manual | Yes | 3 | Sent for Dispatch | Specified | Blocked |
| Sent for Dispatch | Dispatched | Dispatched | manual | No | 0 | Dispatch | Specified | Blocked |
| Final QA Pending | Final QA Done | Final_QA_Done | manual | No | 0 | Final QA Done | Specified | Blocked |
| Final QA Done | Send to Production | Send_to_Production | manual | Yes | 7 | Send to Production | Specified | Blocked |
| Final QA Pending | Send to Production | Send_to_Production | manual | Yes | 7 | Send to Production | Specified | Blocked |
| Dispatch | Send to Production | Send_to_Production | manual | Yes | 7 | Send to Production | Specified | Blocked |
| Sent for Dispatch | Send to Production | Send_to_Production | manual | Yes | 7 | Send to Production | Specified | Blocked |
| Hold | Send to Production | Send_to_Production | manual | Yes | 7 | Send to Production | Specified | Blocked |
| Sent to Planning | Send to Production | Send_to_Production | manual | Yes | 7 | Send to Production | Specified | Blocked |
| Hold | Sent for Dispatch | Sent_for_Dispatch | manual | Yes | 3 | Sent for Dispatch | Specified | Blocked |
| Sent to Planning | Sent for Dispatch | Sent_for_Dispatch | manual | Yes | 3 | Sent for Dispatch | Specified | Blocked |
| Dispatch | Final QA Pending | Final_QA_Pending | automatic | No | 0 | Final QA Pending | Specified | Blocked |

### AMS/Complaint Flow — AMS_Complaints

State field: `Stage`. Source status: Active. Graph source: settings-blueprint-detail (HTTP 200). Phase details: 15/15 specified. Policy: 0/15 eligible; 15/15 blocked. Atomic runtime: 0/15 ready. The exact Assign Technician widget tuple has a separate original read-only local preview on records resolved through the module's single active captured layout; Visit creation, workflow triggering, identity use, and Blueprint continuation remain blocked.

| Current State | Transition | API Name | Trigger | Global | Included States | Next State | Source Coverage | Local Status |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| Planned | Assign Technician | Assign_Technician | manual | Yes | 6 | Assigned Technician | Specified | Blocked |
| Dispatch | Assign Technician | Assign_Technician | manual | Yes | 6 | Assigned Technician | Specified | Blocked |
| Done | Assign Technician | Assign_Technician | manual | Yes | 6 | Assigned Technician | Specified | Blocked |
| Assigned Technician | Sent to QC | Sent_to_QC | manual | Yes | 2 | Sent to QC | Specified | Blocked |
| Sent to QC | Sent to Planning | Sent_to_Planning | manual | No | 0 | Sent to Planning | Specified | Blocked |
| Sent to QC | Send to Purchase | Send_to_Purchase | manual | No | 0 | Sent for Purchase | Specified | Blocked |
| Sent for Purchase | Hold | Hold | manual | Yes | 13 | Hold | Specified | Blocked |
| Sent to Planning | Hold | Hold | manual | Yes | 13 | Hold | Specified | Blocked |
| Sent to QC | Hold | Hold | manual | Yes | 13 | Hold | Specified | Blocked |
| Planned | Hold | Hold | manual | Yes | 13 | Hold | Specified | Blocked |
| Assigned Technician | Hold | Hold | manual | Yes | 13 | Hold | Specified | Blocked |
| Create PO | Hold | Hold | manual | Yes | 13 | Hold | Specified | Blocked |
| Send to Production | Hold | Hold | manual | Yes | 13 | Hold | Specified | Blocked |
| Sent for Dispatch | Hold | Hold | manual | Yes | 13 | Hold | Specified | Blocked |
| Dispatch | Hold | Hold | manual | Yes | 13 | Hold | Specified | Blocked |
| Done | Hold | Hold | manual | Yes | 13 | Hold | Specified | Blocked |
| Sent for Purchase | Create PO | Create_PO | manual | No | 0 | Create PO | Specified | Blocked |
| Create PO | Send to Production | Send_to_Production | manual | Yes | 6 | Send to Production | Specified | Blocked |
| Send to Production | Sent for Dispatch | Sent_for_Dispatch | manual | Yes | 4 | Sent for Dispatch | Specified | Blocked |
| Sent for Dispatch | Dispatched | Dispatched | manual | No | 0 | Dispatch | Specified | Blocked |
| Assigned Technician | AMS Done | AMS_Done | manual | No | 0 | Done | Specified | Blocked |
| Client Denied | Assign Technician | Assign_Technician | manual | Yes | 6 | Assigned Technician | Specified | Blocked |
| Client Denied | Hold | Hold | manual | Yes | 13 | Hold | Specified | Blocked |
| Planned | Client Deny | Client_Deny | manual | No | 0 | Client Denied | Specified | Blocked |
| Payment Required | Assign Technician | Assign_Technician | manual | Yes | 6 | Assigned Technician | Specified | Blocked |
| Payment Required | Hold | Hold | manual | Yes | 13 | Hold | Specified | Blocked |
| Sent to QC | Payment Required | Payment_Required | manual | No | 0 | Payment Required | Specified | Blocked |
| Payment Required | Payment Done | Payment_Done | manual | No | 0 | Sent to QC | Specified | Blocked |
| Sent to Planning | Send to Production | Send_to_Production | manual | Yes | 6 | Send to Production | Specified | Blocked |
| Hold | Send to Production | Send_to_Production | manual | Yes | 6 | Send to Production | Specified | Blocked |
| Sent for Dispatch | Send to Production | Send_to_Production | manual | Yes | 6 | Send to Production | Specified | Blocked |
| Dispatch | Send to Production | Send_to_Production | manual | Yes | 6 | Send to Production | Specified | Blocked |
| Sent to Planning | Sent for Dispatch | Sent_for_Dispatch | manual | Yes | 4 | Sent for Dispatch | Specified | Blocked |
| Hold | Sent for Dispatch | Sent_for_Dispatch | manual | Yes | 4 | Sent for Dispatch | Specified | Blocked |
| Open | Assign Technician | Assign_Technician | manual | Yes | 6 | Assigned Technician | Specified | Blocked |
| Open | Hold | Hold | manual | Yes | 13 | Hold | Specified | Blocked |
| Open | Send to Production | Send_to_Production | manual | Yes | 6 | Send to Production | Specified | Blocked |
| Open | Sent for Dispatch | Sent_for_Dispatch | manual | Yes | 4 | Sent for Dispatch | Specified | Blocked |
| Open | Sent to QC | Sent_to_QC | manual | Yes | 2 | Sent to QC | Specified | Blocked |
| Assigned Technician | Ticket Closed | Ticket_Closed | manual | No | 0 | Done | Specified | Blocked |
| Hold | e3r4 | e3r4 | manual | No | 0 | Assigned Technician | Specified | Blocked |
