# Zoho Widget Behavior Inventory

> Source organization access remained read-only. The downloaded packages were inspected offline as static files; no widget code was executed, no network requests were made, and no source or local CRM writes occurred.

## Executive status

| Measure | Result |
|---|---:|
| Source widget rows | 40 |
| Zoho-hosted widgets | 20 |
| Zoho packages captured and validated | 20/20 |
| External-hosted widgets without a package | 20 |
| Supplied ZIPs with separate original read-only local previews | 9 |
| Supplied ZIPs remaining preview candidates | 0 |
| Supplied ZIPs with completed bounded reviews | 5/5 |
| Supplied ZIPs pending bounded review | 0 |
| Supplied ZIPs classified `quarantined-reviewed-contract-blocked` | 3 |
| Supplied ZIPs full-local-runtime ready | 0 |
| Captured package execution | Disabled |

The 20 Zoho-hosted rows reconcile one-to-one to 20 downloaded packages. The remaining 20 rows are externally hosted configurations and therefore have no downloadable Zoho package in this evidence set. The 12 supplied ZIPs are a separately tracked subset. Estimate, Assign Technician, Designer Form, Payment Milestone, Revise Quote, Closure New, Revise-Approve Quote-Any Stage, Deploy Team, and Handover To Post Team have nine separate original read-only local previews. Zero packages remain candidates, zero bounded reviews remain pending, and all five bounded sensitive/static reviews are complete. Closure Order Stage Update, Handover to Post Design, and Sunrooof Mark Closures are the exact three packages classified `quarantined-reviewed-contract-blocked`. Zero supplied packages are full-local-runtime ready. All 12 captured package execution paths and all 40 source widget execution paths remain fail-closed.

Package capture, archive validation, and static behavior mapping are evidence statuses only. A separate local preview is original plan or calculation code with an explicit no-write boundary; it does not execute the captured package and does not make that package locally executable.

Blueprint phase-detail coverage is 202/202 across all 7 Blueprints. Tasks is specified at 5/5 with all five transitions policy blocked; 5/202 transitions are policy eligible, zero are atomically runtime-ready, and 197 are policy blocked. This evidence does not enable any captured widget execution path.

## Archive safety validation

All 20 archives passed CRC validation. The set contains 38 regular files and 1,109,175 uncompressed bytes. No traversal entries, absolute paths, backslash paths, symbolic links, duplicate entries, or configured size-limit violations were detected.

## Exact source-to-package reconciliation

| Widget ID | Normalized name | Hosting | Type | Package | Captured package execution |
|---|---|---|---|---|---|
| 1032257000000478094 | WebTab1 Extension | External | Web Tab | External; unavailable | Blocked |
| 1032257000000478100 | LeadChain Extension | External | Settings | External; unavailable | Blocked |
| 1032257000007994308 | Payment Milestone Widget | Zoho | Blueprint | Captured and validated | Blocked |
| 1032257000008937849 | Handover to Installation | External | Blueprint | External; unavailable | Blocked |
| 1032257000010677612 | Revise Quote - local | External | Blueprint | External; unavailable | Blocked |
| 1032257000010677855 | Designer Form Widget | Zoho | Blueprint | Captured and validated | Blocked |
| 1032257000010720459 | Revise Quote - Widget | Zoho | Blueprint | Captured and validated | Blocked |
| 1032257000010720513 | Designer Form - local | External | Blueprint | External; unavailable | Blocked |
| 1032257000011559129 | Picky-WhatsApp Extension | External | Button | External; unavailable | Blocked |
| 1032257000011559135 | Picky-WhatsApp Extension | External | Button | External; unavailable | Blocked |
| 1032257000011559141 | Picky-WhatsApp Extension | External | Button | External; unavailable | Blocked |
| 1032257000011559147 | Picky-WhatsApp Extension | External | Button | External; unavailable | Blocked |
| 1032257000011559153 | Picky-WhatsApp Extension | External | Button | External; unavailable | Blocked |
| 1032257000011559159 | Picky-WhatsApp Extension | External | Button | External; unavailable | Blocked |
| 1032257000011559165 | Picky-WhatsApp Extension | External | Button | External; unavailable | Blocked |
| 1032257000011559171 | Picky-WhatsApp Extension | External | Button | External; unavailable | Blocked |
| 1032257000011559177 | Picky-WhatsApp Extension | External | Button | External; unavailable | Blocked |
| 1032257000011559183 | Picky-WhatsApp Extension | External | Button | External; unavailable | Blocked |
| 1032257000011589066 | Testing | Zoho | Blueprint | Captured and validated | Blocked |
| 1032257000011958232 | test | Zoho | Button | Captured and validated | Blocked |
| 1032257000012018119 | KitchenEstimator | Zoho | Button | Captured and validated | Blocked |
| 1032257000012167001 | Estimate Widget | Zoho | Button | Captured and validated | Blocked |
| 1032257000013052001 | WorkDriveWidget | Zoho | Blueprint | Captured and validated | Blocked |
| 1032257000013052011 | Demo | Zoho | Blueprint | Captured and validated | Blocked |
| 1032257000016434001 | Order Stages Update | Zoho | Blueprint | Captured and validated | Blocked |
| 1032257000017358913 | Revise-Approve Quote-Any Stage | Zoho | Button | Captured and validated | Blocked |
| 1032257000018181042 | Closure Order Stage Update | Zoho | Blueprint | Captured and validated | Blocked |
| 1032257000018181058 | Payment Milestone - pink | External | Blueprint | External; unavailable | Blocked |
| 1032257000018181128 | New Test Widget Order | Zoho | Blueprint | Captured and validated | Blocked |
| 1032257000020866834 | Handover to Post Design | Zoho | Blueprint | Captured and validated | Blocked |
| 1032257000022772566 | Factory Ticket | External | Blueprint | External; unavailable | Blocked |
| 1032257000022961582 | Deploy Team | Zoho | Button | Captured and validated | Blocked |
| 1032257000023117488 | Handover To Post Team | Zoho | Blueprint | Captured and validated | Blocked |
| 1032257000023270884 | Sunrooof Mark Closures | Zoho | Button | Captured and validated | Blocked |
| 1032257000023277323 | Service Team AMS Dashboard | External | Home Page Dashboard | External; unavailable | Blocked |
| 1032257000023349089 | widget first dispatched | External | Blueprint | External; unavailable | Blocked |
| 1032257000023774783 | Assign Technician Widget | Zoho | Blueprint | Captured and validated | Blocked |
| 1032257000024506045 | Design Dashboard | External | Home Page Dashboard | External; unavailable | Blocked |
| 1032257000025407208 | Closure New - Pinki | Zoho | Blueprint | Captured and validated | Blocked |
| 1032257000025584294 | Complaint | Zoho | Home Page Dashboard | Captured and validated | Blocked |

Name normalization removes only the trailing source-UI status suffix `Installed`; all other source wording is preserved.

## Zoho-hosted package behavior

### Payment Milestone Widget — Blueprint

Maintain opportunity payment milestones and the financial and follow-up values used by the closure flow.

- Context modules: Contacts
- Reads: Contacts; Payment_Milestones
- Writes: Contacts; Payment_Milestones
- Record actions: Load the opportunity and its related payment milestones.; Validate milestone percentages, discounts, booking values, and follow-up data.; Replace related milestone rows and update the opportunity as one business operation.; Continue the invoking Blueprint only after a successful save.
- Mandatory-input status: Mapped with conditional rules
- Mandatory inputs: Estimated closure date; Next follow-up date; Number of accessories; Milestone percentages between 0 and 100 with the Magppie allocation totaling 100%; Management-discount justification values when a management discount is entered; Sunrooof total, booking, and discount values when the Sunrooof milestone option is enabled
- Dependencies: Opportunity-to-payment-milestone relationship; Atomic child-row replacement; Blueprint continuation
- Local-equivalent feasibility: Partial
- Exact blocked source tuple: Contacts Standard layout `1032257000000000171`; Blueprint `1032257000001044611`; local/current stage and captured `from.display_value` `Price Discussion`; captured `from.actual_value` `Price Dicussion`; transition `1032257000025407036` (`Create Payment Terms`); display destination `Principally Closed`; actual destination `Payment Awaited`; owner scope `Specific Users (1)`; widget `1032257000007994308`.
- Separate local preview: Implemented as an original GET-only Contacts and `Payment_Milestones` preview. It supports the reviewed 50/30/20 and 50/50 templates, requires the Magppie allocation to total 100%, caps retention at 15%, applies the last-milestone deduction, supports the conditional Sunrooof schedule, shifts serial order deterministically, and converts lakh inputs to INR before returning an immutable display-only schedule.
- Preview boundaries: No source or local write, child-row replacement, Blueprint continuation, workflow trigger, SDK/provider call, storage, file, logging, outbound request, protected-value use, or captured-source execution is available. `Amount_To_Be_Paid` is absent from local metadata under the reviewed source contract and is treated as the expected display-only boundary; if that field unexpectedly appears or any other exact tuple/metadata contract drifts, the preview fails closed.
- Verification status: Automated exactness vectors passed for normal 50/30/20, 50/50, retention, Sunrooof, serial shift, lakh-to-INR, proxy rejection, and hidden-property regressions. Live browser checks passed at 1,440 × 900 and 390 × 844 on a real `Price Discussion` Contact: the exact action opened a same-element accessible dialog with close-only actions, an inert shell, contained focus, Escape-to-launcher focus restoration, no horizontal overflow, and no browser log errors. All 11 mirrored `Price Discussion` records lack required Region/Quotation evidence and most lack product rows, so the verified live state was explicitly no-draft/no-action; no live generated schedule is claimed. The GET-only/static contract proves there is no mutation path, and browser diagnostics showed none.
- Fail-closed blockers: Atomic Contacts and payment-milestone relationship writes, exact `Specific Users (1)` identity authorization, workflow effects, and Blueprint continuation are not implemented locally.

### Designer Form Widget — Blueprint

Collect project design requirements for every order related to an opportunity.

- Context modules: Contacts; Deals
- Reads: Contacts; Deals
- Writes: Deals; Notes; Attachments
- Record actions: Load all related orders for the opportunity.; Update product-specific design requirements on each completed order.; Add notes and files to the order.; Continue the applicable order Blueprint transition after successful validation.
- Mandatory-input status: Mapped with product-specific rules
- Mandatory inputs: A completed form for every displayed project; At least one kitchen type for kitchen projects; At least one wardrobe type for wardrobe projects; City and room or area name; All product-specific fields marked mandatory by the form
- Dependencies: Opportunity-to-order relationship; Order attachments and notes; Order Blueprint transition
- Local-equivalent feasibility: Partial
- Separate local preview: Implemented as an original GET-only preview for the exact blocked Contacts Blueprint widget tuple. It requires the exact complete `All_Orders` relation, validates current Deals field metadata, reduces eligible orders to anonymous project ordinals plus product types, and creates immutable non-persisted product-specific drafts.
- Preview boundaries: No source identifier, customer name, owner, payment value, file, or note value is displayed; no CRM write, Order/Note/file mutation, Blueprint continuation, workflow trigger, SDK/provider call, storage, outbound request, protected-value use, or captured-source execution is available.
- Fail-closed blockers: Full execution remains blocked because attachment and note writes, Order updates, identity/permissions, and Blueprint continuation require atomic local orchestration and acceptance testing.

### Revise Quote - Widget — Blueprint

Revise design requirements and quote status across selected orders for an opportunity.

- Context modules: Contacts; Deals
- Reads: Contacts; Deals; Stage_History
- Writes: Deals; Notes; Attachments
- Record actions: Load related orders and their stage history.; Update design, quote-status, and revision-reason fields for completed orders.; Add notes and files to the order.; Continue the matching order Blueprint transition.
- Mandatory-input status: Mapped with status and product rules
- Mandatory inputs: At least one completed order; A status for each completed order; At least one kitchen or wardrobe type when that product applies; Notes when the selected status requires sales-manager input; A revision reason when revising a quote
- Dependencies: Opportunity-to-order relationship; Order stage history; Order attachments and notes; Order Blueprint transition
- Local-equivalent feasibility: Partial
- Exact preview contract: The separate preview is bound to Contacts Standard layout `1032257000000000171`, Opportunity Stage Blueprint `1032257000001044611`, display/current stage `Design Form Filled` with captured actual value `Assigned Designer`, parent transition `1032257000010720046` (`Approve/Revise Quote`) to `Approve/Disapprove Quote`, and widget `1032257000010720459`. The reviewed child contract is the Deals Standard-layout Order Stages Blueprint, and only anonymous `All_Orders` rows at exact display/actual stage `Sent for Approval` are accepted. The only reviewed child paths are manual `Approved Quote` through non-common `Design Approved` to `Price Discussion`, and manual `Revise Quotes` through common `Revision Required` to `Revision Required`.
- Separate local preview: The original GET-only planner validates current Contacts and Deals metadata, the complete exact `All_Orders` relationship, and the captured Order Stages child-transition contract. It rechecks the Contact and parent Blueprint eligibility immediately before generating an immutable non-persisted plan. Product-specific Kitchen and Wardrobe fields and exact source option intersections remain validated; `None`, `Query to SM`, and every non-`Sent for Approval` Order are excluded from planning. Captured `Stage_History` behavior is not read or reproduced by this preview.
- Preview boundaries: No captured source, CRM write, note, attachment, workflow, child or parent Blueprint continuation, identity resolution, provider/SDK call, storage, logging, or outbound delivery path is available. The generated plan is anonymous and display-only; it does not assert permission to execute either reviewed child transition.
- Fail-closed blockers: Conditional attachment, note, and status writes are not yet implemented as one transaction.

### Testing — Blueprint

Calculate a kitchen estimate from layout, dimensions, package, and wall-unit height, then save the opportunity-value estimate to a Lead.

- Context modules: Leads
- Reads: None
- Writes: Leads
- Record actions: Calculate an estimate in the browser.; Update the Lead opportunity-value field on save.
- Mandatory-input status: Mapped
- Mandatory inputs: Kitchen layout; Kitchen package type; Wall lengths; Wall-unit height
- Dependencies: Lead record context; Source pricing constants
- Local-equivalent feasibility: High
- Fail-closed blockers: Pricing constants and rounding must be acceptance-tested before enabling writes.

### test — Button

Calculate a broad kitchen cost estimate from cabinetry, counters, flooring, appliances, labour, and contingency choices.

- Context modules: Leads
- Reads: None
- Writes: Leads
- Record actions: Calculate an estimate in the browser.; Update the Lead opportunity-value field on save.
- Mandatory-input status: No hard-required controls detected
- Mandatory inputs: Any supplied numeric area or rate must be valid and non-negative.
- Dependencies: Lead record context; Source pricing constants
- Local-equivalent feasibility: High
- Fail-closed blockers: Pricing constants and default-value behavior must be acceptance-tested before enabling writes.

### KitchenEstimator — Button

Calculate a kitchen estimate from layout, dimensions, kitchen type, and wall-unit height, then save the result to a Lead.

- Context modules: Leads
- Reads: None
- Writes: Leads
- Record actions: Calculate an estimate in the browser.; Update the Lead opportunity-value field on save.
- Mandatory-input status: Mapped
- Mandatory inputs: Kitchen layout; Kitchen type; Wall lengths; Wall-unit height
- Dependencies: Lead record context; Source pricing constants
- Local-equivalent feasibility: High
- Fail-closed blockers: Pricing constants and rounding must be acceptance-tested before enabling writes.

### Estimate Widget — Button

Calculate a kitchen estimate from layout, dimensions, package, and wall-unit height, then save the result to a Lead.

- Context modules: Leads
- Reads: None
- Writes: Leads
- Record actions: Calculate an estimate in the browser.; Update the Lead opportunity-value field on save.
- Mandatory-input status: Mapped
- Mandatory inputs: Kitchen layout; Package type; Wall lengths; Wall-unit height
- Dependencies: Lead record context; Source pricing constants
- Local-equivalent feasibility: High
- Fail-closed blockers: Pricing constants and rounding must be acceptance-tested before enabling writes.

### WorkDriveWidget — Blueprint

Load the WorkDrive reference stored on an Order and display the linked workspace.

- Context modules: Deals
- Reads: Deals
- Writes: None
- Record actions: Load the current Order.; Resolve and display its configured WorkDrive reference.
- Mandatory-input status: Context requirement
- Mandatory inputs: An Order record context; A populated WorkDrive reference on the Order
- Dependencies: Authenticated WorkDrive access; Order WorkDrive reference
- Local-equivalent feasibility: Partial
- Fail-closed blockers: External workspace access and authorization are not replicated locally.

### Demo — Blueprint

Display a preconfigured WorkDrive viewer target without loading a CRM record.

- Context modules: None
- Reads: None
- Writes: None
- Record actions: Open the preconfigured external workspace viewer.
- Mandatory-input status: None detected
- Mandatory inputs: None
- Dependencies: Authenticated WorkDrive access; Preconfigured external target
- Local-equivalent feasibility: Low
- Fail-closed blockers: The external target and its authorization are intentionally omitted from the public inventory.

### Order Stages Update — Blueprint

Bulk-manage Blueprint stages for Orders related to an opportunity.

- Context modules: Contacts; Deals
- Reads: Contacts; Deals; Attachments
- Writes: Deals; Contacts; Attachments
- Record actions: Load related Orders and the Blueprint transitions available to each Order.; Render transition-specific fields, picklists, checklists, and file controls.; Apply the selected Blueprint transition to each validated Order.; Copy or attach supporting files when required by the transition.
- Mandatory-input status: Dynamic from Blueprint metadata
- Mandatory inputs: Selected Order or Orders; Target transition; Every mandatory transition field; All required checklist confirmations; All required supporting files
- Dependencies: Deals Blueprint transition metadata; Contact and Order attachment APIs; Per-record transition eligibility
- Local-equivalent feasibility: Partial
- Fail-closed blockers: Dynamic checklist and attachment persistence is not implemented locally.

### Revise-Approve Quote-Any Stage — Button

Revise or approve quote and design data from a Contact button, independent of the current order-stage entry point.

- Context modules: Contacts; Deals
- Reads: Contacts; Deals; Stage_History
- Writes: Deals; Notes; Attachments
- Record actions: Load related Orders and their stage history.; Update design requirements, status, and revision reason for selected Orders.; Add supporting notes and files.; Use a matching Blueprint transition when one is available.
- Mandatory-input status: Mapped with status and product rules
- Mandatory inputs: At least one completed Order with a selected status; Kitchen or wardrobe selection when applicable; Conditional sales-manager notes; Conditional revision reason
- Dependencies: Opportunity-to-order relationship; Order stage history; Order attachments and notes; Conditional Blueprint transition
- Local-equivalent feasibility: Partial
- Exact preview contract: This is a Contacts record-view button, not a parent Blueprint transition. The separate preview requires custom button `1032257000017358923` (`Revise-Approve Quote`), API name `Revise_Approve_Quote`, sequence 2, exact widget reference `1032257000017358913`, and either registered Contact layout `1032257000000000171` or `1032257000005515301`. No parent Blueprint contract exists or is requested. Only `All_Orders` rows whose local displayed Stage is exactly `Sent for Approval` can be planned. Independently, the reviewed Deals Standard-layout Order Stages Blueprint catalog must contain the two exact manual child paths: `Approved Quote` through non-common `Design Approved` to `Price Discussion`, and `Revise Quotes` through common `Revision Required` to `Revision Required`; every other displayed Order stage is explicitly blocked.
- Separate local preview: The original direct-GET-only planner validates the exact button registration, current Contact layout and fields, complete exact `All_Orders` evidence, and the reviewed child-transition catalog. It does not perform or claim a per-Order Blueprint attestation. It keeps relationship record IDs only in a private in-memory ordinal fingerprint, rejects evidence drift before generation, and emits deeply frozen ID-free plans. Local user-profile and source profile eligibility are not asserted.
- Preview boundaries: No captured source, CRM write, note, attachment, workflow, child Blueprint transition, parent Blueprint request or continuation, provider/SDK call, storage, logging, file access, identity resolution, or outbound delivery path is available.
- Fail-closed blockers: Conditional record and file writes are not yet implemented atomically.

### Closure Order Stage Update — Blueprint

Manage order-stage transitions with closure, handover, checklist, and supporting-document safeguards.

- Context modules: Contacts; Deals
- Reads: Contacts; Deals; Attachments
- Writes: Deals; Contacts; Attachments
- Record actions: Load related Orders and eligible Blueprint transitions.; Render transition fields, sign-off checklists, and document controls.; Apply the selected transition per Order after validation.; Enforce cross-order handover rules and attach supporting files.
- Mandatory-input status: Dynamic from Blueprint metadata
- Mandatory inputs: Selected Order or Orders; Target transition; Every mandatory transition field; All required sign-off confirmations; All required supporting files
- Dependencies: Deals Blueprint transition metadata; Cross-order stage state; Contact and Order attachment APIs
- Local-equivalent feasibility: Low
- Bounded offline review status: Completed; classification `quarantined-reviewed-contract-blocked`. The package is registered as Blueprint widget `1032257000018181042`, but the current local Blueprint evidence contains 63 widget During-input mappings and zero exact mappings to this widget. Two name-adjacent Contacts transitions reference a different widget and are not treated as its parent. The exact parent Contacts layout, Blueprint, transition, During-input sequence, and owner/profile scope therefore remain unresolved.
- Read-only source UI recheck: The active Zoho/Blueprint widget registration and API name were confirmed in Developer Hub, and both name-adjacent transition nodes were confirmed in the Contacts Opportunity Stage Blueprint. No exact widget-to-During binding was established. The editor was exited without Save, Republish, or any source change.
- Child contract evidence: The package targets Deals Standard layout `1032257000000000173`, Order Stages Blueprint `1032257000000535747`, and Stage field `1032257000000000807`. All 80 child transition phase definitions are captured and locally blocked. Static compatibility data materially drifts from the current catalog: 22 of 59 stage labels exactly match current destination labels; 8 of 33 supplemental transition/stage tuples exactly match; the active pre-handover classifier matches 6 of 8 current ancestor stages exactly; and both special handover checklist sets differ from current evidence.
- Observed safety risks: Captured behavior includes dynamic Blueprint fields, Notes, files, checklists, two upload paths, two attachment writes, child transition updates, sequential non-atomic bulk execution, stale cross-order decisions, swallowed Contact-attachment failures, unbounded file validation, parsed-but-unused identity, extensive dynamic logging, trusted-markup rendering, and SDK dynamic-code primitives. The bounded review found sensitive-literal categories but no actual credential, email, phone-value, URL, or protected-endpoint literal. Captured code was not executed.
- Narrow future preview contract: Only after an exact parent binding is captured, a GET-only single-transition requirements plan may be considered for exact child transition `1032257000000535729` (`Closure`), displayed path `Payment Awaited` → `Closure`, and one valid `Est_Handover_Date`. It must block bulk mode, the SUNROOOF path, every handover transition, Notes, files, checklists, attachment reads, After actions, writes, and parent continuation; it must re-read exact parent, relationship, direct Deal, layout, and child Blueprint evidence on Generate and render no IDs.
- Fail-closed blockers: Exact parent registration is absent; current static stage/checklist contracts drift; attachment parity is incomplete; identity/authorization is not enforced; and cross-order, file, transaction, failure, and accessibility behavior is unsafe for local exposure. If an authoritative read-only source configuration capture still yields no exact binding, classify the package as retired and keep it permanently quarantined.

### New Test Widget Order — Blueprint

A later order-stage-manager variant with additional attachment diagnostics and connection-backed file handling.

- Context modules: Contacts; Deals
- Reads: Contacts; Deals; Attachments
- Writes: Deals; Contacts; Attachments
- Record actions: Load related Orders, eligible transitions, and available Contact attachments.; Render transition-specific fields, checklists, and file controls.; Apply the selected Blueprint transition per validated Order.; Copy or upload supporting files using the configured CRM connection path.
- Mandatory-input status: Dynamic from Blueprint metadata
- Mandatory inputs: Selected Order or Orders; Target transition; Every mandatory transition field; All required checklist confirmations; All required supporting files
- Dependencies: Deals Blueprint transition metadata; Contact and Order attachment APIs; Configured CRM connection
- Local-equivalent feasibility: Low
- Fail-closed blockers: The connection-backed attachment path is not configured locally.; Diagnostic-only controls must not be promoted as production behavior without approval.

### Handover to Post Design — Blueprint

Move selected Orders through their eligible post-design handover transitions.

- Context modules: Contacts; Deals
- Reads: Contacts; Deals; Attachments
- Writes: Deals; Contacts; Attachments
- Record actions: Load related Orders and each Order's eligible Blueprint transitions.; Collect transition-specific fields, checklists, and files.; Apply the selected post-design transition to each validated Order.; Copy supporting Contact files to Orders when required.
- Mandatory-input status: Dynamic from Blueprint metadata
- Mandatory inputs: Selected Order or Orders; Eligible post-design transition; Every mandatory transition field; All required checklist confirmations and files
- Dependencies: Deals Blueprint transition metadata; Contact and Order attachments; Per-record transition eligibility
- Local-equivalent feasibility: Partial
- Bounded offline review status: Completed; classification `quarantined-reviewed-contract-blocked`. The captured package was not executed.
- Parent-binding evidence: The current Contacts Opportunity Stage evidence contains 35 During placements whose visible widget label is `Handover to Post Design`, but all 35 are label-only candidates with no internal widget ID. The registration and manifest evidence contain zero authoritative ID-bearing parent bindings to widget `1032257000020866834`. A label match is not treated as proof of a layout, Blueprint, transition, source/destination stage, During sequence, or owner/profile contract.
- Preview decision: No local preview is exposed because an exact parent tuple cannot be selected without guessing. One authorized read-only source capture must establish the internal widget ID on the exact parent During placement, together with its layout, Blueprint, transition, source/destination stages, sequence, and owner scope.
- Fail-closed blockers: The authoritative parent binding is absent; dynamic transition, checklist, file, Contact-attachment-copy, identity, transaction, failure, and accessibility contracts are not accepted; and transition and attachment persistence is not implemented locally.

### Deploy Team — Button

Schedule an installation visit and deploy a team against selected Orders for an opportunity.

- Context modules: Contacts; Deals; Visit_Module; Service_A_X_Orders
- Reads: Contacts; Deals; Users; Visit_Module
- Writes: Visit_Module; Service_A_X_Orders
- Record actions: Load related Orders eligible for installation handover.; Load installation-manager and team choices.; Create the installation Visit record.; Create the Visit-to-Order linking rows for selected Orders.
- Mandatory-input status: Mapped
- Mandatory inputs: At least one eligible Order; Installation manager; Visit date; Task; At least one team member
- Dependencies: Authenticated CRM user mapping; Installation picklists and users; Visit-to-Order linking module
- Local-equivalent feasibility: Partial
- Bounded offline review status: Completed; the captured package was not executed, and only the separate original GET-only preview is exposed.
- Exact registration contract: Contacts Standard layout `1032257000000000171`; view button `1032257000022961587` (`Deploy Team for Installation`); API name `Assign_Visit_for_Installation`; sequence 3; widget `1032257000022961582`. This is a record-view button and does not claim a parent Blueprint binding.
- Separate local preview: Implemented as an original GET-only readiness preview. It validates the exact button/widget tuple, authoritative Contact layout, current Contacts/Deals/Visit/linking metadata, the complete exact `All_Orders` relationship linked only by `Opportunity_Name` with `has_more: false`, one direct Deal attestation for each eligible row with concurrency capped at four, the Visit-to-Order lookup contract, and the active Installation Visit Blueprint entry effect. Record identities remain private transient comparison evidence; preview output is anonymous, immutable, and display-only.
- Current evidence result: The current `Visit_Module.Client_Address` field is read-only. The preview surfaces that exact metadata conflict, fails closed, and generates no deployment plan rather than treating the write contract as ready. Automated contract checks and desktop/mobile browser checks confirmed the blocker, close-only dialog behavior, focus restoration, no horizontal overflow, and no browser warning or error logs.
- Preview boundaries: No captured source, CRM write, Visit creation, linking-row creation, workflow, Blueprint transition, provider/SDK call, storage, file, logging, identity resolution, or outbound request is available.
- Fail-closed blockers: `Client_Address` is currently read-only; user/owner/team identity and permission mappings are incomplete; and Visit plus linking-row creation is not implemented as one accepted atomic operation.

### Handover To Post Team — Blueprint

Complete post-team handover for selected Orders and create the corresponding AMS service record.

- Context modules: Contacts; Deals; AMS_Complaints
- Reads: Contacts; Deals; AMS_Complaints; Attachments
- Writes: Deals; Contacts; AMS_Complaints; Attachments
- Record actions: Load related Orders and eligible Blueprint transitions.; Collect transition-specific fields, checklists, handover data, and files.; Apply each validated Order transition and write final-handover values.; Create an AMS service record and carry forward approved files and service dates.
- Mandatory-input status: Dynamic from Blueprint metadata plus handover rules
- Mandatory inputs: Selected Order or Orders; Eligible handover transition; Every mandatory transition field; All required checklists and files; Required service and handover dates returned by the transition
- Dependencies: Deals Blueprint transition metadata; AMS record schema; Contact and Order attachments; Owner and service-date mappings
- Local-equivalent feasibility: Low
- Bounded offline review status: Completed; the captured package was not executed, and only the separate original GET-only preview is exposed.
- Exact parent and child contract: The parent is Contacts Standard layout `1032257000000000171`, Opportunity Stage Blueprint `1032257000001044611`, exact `Final Handover` transition `1032257000023182424`, and stage path `Second Installation Done` → `Final Handover`, with the single During widget `Handover To Post Team` and no parent After action. Each eligible child is Deals Standard layout `1032257000000000173`, Order Stages Blueprint `1032257000000535747`, exact `Final Handover` transition `1032257000008339350`, and the same stage path. The required child During contract is checklist `Handover File` with required item `Handover Certificate`, required date `MDR_Done`, and required integer `Internal_QC`; its exact After effect sets `First_Service_Date` to execution day plus zero days.
- Relationship and fresh-read evidence: The separate preview requires a complete exact `All_Orders` envelope linked only by `Opportunity_Name`, `has_more: false`, and one direct Deal plus child-Blueprint re-attestation for every potentially eligible Order. Per-Order reads preserve stable order with concurrency capped at four. On Generate, every base and per-Order GET is repeated uncached and both anonymous and private identity fingerprints must match before an immutable ID-free plan is emitted.
- AMS evidence and explicit blocker: Current exact `AMS_Complaints` metadata, active-visible Standard layout, and both active AMS Blueprint catalogs are attested. Across those catalogs there is no active transition whose destination is `Planned`. The preview therefore shows AMS creation and Planned enrollment as disabled and does not infer a missing transition.
- Preview boundaries: The original preview is GET-only and display-only. No captured source, CRM/attachment write, child or parent Blueprint continuation, AMS creation/enrollment, workflow, provider/SDK call, identity resolution, storage, file, logging, timer, or outbound request is available.
- Fail-closed blockers: The AMS `Planned` transition contract is absent; atomic child Order transition, attachment copy, AMS creation/enrollment, parent continuation, and rollback are not implemented; and owner identity/permission mapping is incomplete.

### Sunrooof Mark Closures — Button

Create cross-organization Sunrooof CRM records from selected opportunity Orders, product rows, commercial terms, addresses, advance payment, and files.

- Context modules: Accounts; Contacts; Deals; Products; Product_Items; Payment_Milestones; Attachments
- Reads: Contacts; Deals; Products; Product_Items
- Writes: Accounts; Contacts; Deals; Product_Items; Payment_Milestones; Attachments
- Record actions: Load related Orders and Sunrooof product choices without a complete relationship guard.; Collect item rows, prices, taxes, discounts, addresses, and advance-payment data.; Create a cross-organization Account, Contact, Order, four payment milestones, and related product records.; Create and share a WorkDrive folder, upload and attach files, write cross-organization identifiers back, and trigger workflows.
- Mandatory-input status: Mapped with commercial conditional rules
- Mandatory inputs: At least one eligible Sunrooof Order; At least one Order Item with a selected Sunrooof design; Required billing and shipping address values; Required commercial and tax values; Accessory count and amount when management discount is entered; Required advance-payment reference and date values when advance payment is entered
- Dependencies: Product catalog and item subform; Opportunity-to-order relationship; Payment milestones; Server-side authorized access to both CRM organizations and WorkDrive; Accepted target-organization schemas, privacy consent, and commercial mappings; Bounded attachment upload and safe file handling
- Local-equivalent feasibility: Low
- Bounded offline review status: Completed; classification `quarantined-reviewed-contract-blocked`. Static review found embedded OAuth credential material. No protected value was used, displayed, copied into local code, or sent over the network, and the captured package was not executed. Every affected credential must be revoked or rotated before any rebuild or provider test.
- Authorization and data-contract blockers: Cross-organization CRM and WorkDrive scopes, target organization and module ownership, folder/share policy, exact target schemas, record-level authorization, privacy/consent, retention, and the commercial formulas and field mappings require explicit acceptance. The captured mapping set is materially incomplete and must not be guessed.
- Transaction and presentation blockers: The behavior lacks complete `All_Orders` pagination, persisted idempotency, atomic orchestration, rollback for partial cross-system success, bounded and type-safe file handling, safe text rendering, redacted logging, and source-equivalent keyboard/accessibility behavior.
- Fail-closed blockers: Credential rotation, cross-organization CRM/WorkDrive authorization, target schema/privacy/commercial acceptance, complete relationship evidence, idempotency, rollback, file safety, safe rendering, redacted logging, and accessibility are all incomplete. No local preview or execution path is exposed.

### Assign Technician Widget — Blueprint

Schedule an AMS visit and assign one or more technicians from an AMS or Complaint Blueprint transition.

- Context modules: AMS_Complaints; Visit_Module
- Reads: AMS_Complaints; Visit_Module
- Writes: Visit_Module
- Record actions: Load address, record type, date, owner, and picklist context from the AMS record.; Collect visit purpose, date, and team selection.; Create the Visit record linked to the AMS record.; Continue the invoking Blueprint after a successful Visit creation.
- Mandatory-input status: Mapped
- Mandatory inputs: Full address; Purpose of visit; At least one AMS team member; Visit date
- Dependencies: AMS owner identity; Visit purpose and team picklists; AMS-to-Visit relationship; Blueprint continuation
- Local-equivalent feasibility: Partial
- Local preview: Implemented as an original, exact-widget-bound, read-only form. It resolves the single active local AMS layout, uses local record and Visit metadata, displays anonymized AMS-team choices, and produces an immutable sanitized non-persisted Visit draft. Desktop and 390 × 844 browser checks passed.
- Fail-closed blockers: Real owner and technician identity mappings remain unavailable.; Visit creation, workflow triggering, and Blueprint continuation are not implemented atomically.; The captured package is never executed, and the preview has no CRM-write or outbound capability.

### Closure New - Pinki — Blueprint

Move selected opportunity Orders into closure after validating payment milestones and an estimated handover date.

- Context modules: Contacts; Deals; Payment_Milestones
- Reads: Contacts; Deals; Payment_Milestones
- Writes: Deals; Payment_Milestones
- Record actions: Load related Orders and payment milestones.; Select Orders eligible for closure.; Validate Magppie and conditional Sunrooof payment allocation.; Update closure payment values and apply the matching Order Blueprint transition.
- Mandatory-input status: Mapped with payment conditional rules
- Mandatory inputs: At least one eligible Order; Estimated handover date; Magppie milestone percentages totaling 100%; Per-milestone received amount, received date, discount, and reference values when applicable
- Dependencies: Opportunity-to-order relationship; Payment milestone relationship; Deals Blueprint transitions
- Local-equivalent feasibility: Low
- Exact preview contract: The separate preview is bound to Contacts Standard layout `1032257000000000171`, Opportunity Stage Blueprint `1032257000001044611`, display/current stage `Principally Closed` with captured actual value `Payment Awaited`, parent transition `1032257000025407204` (`Closure New - Pinki`) to display `Closure` and actual `Principally Closure`, relationship `1032257000025407206`, and widget `1032257000025407208`. Each potentially supported Deals Standard-layout Order must be at exact display/actual stage `Payment Awaited` and independently attest the exact common manual `Closure` path to `Closure`, owner scope `Specific Users (1)`, required During field `Est_Handover_Date`, zero criteria, zero After actions, and `executable: false`. Reviewed common-path products are Kitchen, Wardrobe, Pantry, Countertop / Backplash, and Vanity. The SUNROOOF path remains blocked because its criterion and `Sync Magppie To Sunrooof` After action are unavailable to the local preview.
- Separate local preview: The original GET-only planner requires current parent evidence, current Contacts and Deals field metadata, deterministic single-active visible Deals Standard-layout resolution, and both complete exact `All_Orders` and `Payment_Milestones` relationships. For every potentially supported Order it performs bounded-concurrency uncached reads of the direct Deal record and child Blueprint, requires exactly one matching record with identical displayed Stage and product, validates the exact `only_active_layout` resolution tuple against the separately attested Standard layout, and then verifies the exact disabled child transition contract. On Generate it re-reads all evidence and compares both an anonymous fingerprint and a private record-ID-to-ordinal fingerprint before producing immutable display-only plans. Milestone names and reference free text are excluded from engine context, plan output, and rendering; currency inputs require exact two-decimal precision.
- Preview boundaries: Record IDs remain private UI-local comparison evidence and are never included in the engine plan or rendering. No captured source, CRM or milestone write, workflow, child or parent Blueprint transition, SUNROOOF action, provider/SDK call, identity resolution, storage, logging, file access, or outbound delivery path is available.
- Fail-closed blockers: Atomic milestone updates and Order transitions are not implemented locally.

### Complaint — Home Page Dashboard

Provide a read-only AMS and Complaints dashboard with filtering, refresh, record navigation, and spreadsheet or PDF export.

- Context modules: AMS_Complaints
- Reads: AMS_Complaints
- Writes: None
- Record actions: Search and aggregate AMS or Complaint records.; Open the source record or module.; Export the current dashboard view to spreadsheet or PDF.
- Mandatory-input status: None for read-only use
- Mandatory inputs: None
- Dependencies: Complete AMS and Complaint data; CRM record navigation; Client-side export libraries
- Local-equivalent feasibility: High
- Fail-closed blockers: Live-data parity and export rendering must be reconciled before this replaces the source dashboard.

## External-hosted widget boundary

| Widget ID | Name | Type | Known context | Blocker |
|---|---|---|---|---|
| 1032257000000478094 | WebTab1 Extension | Web Tab | Not established | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000000478100 | LeadChain Extension | Settings | Not established | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000008937849 | Handover to Installation | Blueprint | Not established | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000010677612 | Revise Quote - local | Blueprint | Not established | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000010720513 | Designer Form - local | Blueprint | Not established | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000011559129 | Picky-WhatsApp Extension | Button | Leads | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000011559135 | Picky-WhatsApp Extension | Button | Leads | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000011559141 | Picky-WhatsApp Extension | Button | Contacts | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000011559147 | Picky-WhatsApp Extension | Button | Contacts | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000011559153 | Picky-WhatsApp Extension | Button | Deals | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000011559159 | Picky-WhatsApp Extension | Button | Deals | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000011559165 | Picky-WhatsApp Extension | Button | Accounts | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000011559171 | Picky-WhatsApp Extension | Button | Accounts | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000011559177 | Picky-WhatsApp Extension | Button | Invoices | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000011559183 | Picky-WhatsApp Extension | Button | Invoices | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000018181058 | Payment Milestone - pink | Blueprint | Not established | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000022772566 | Factory Ticket | Blueprint | Not established | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000023277323 | Service Team AMS Dashboard | Home Page Dashboard | Not established | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000023349089 | widget first dispatched | Blueprint | Not established | No Zoho-hosted package; external behavior and authorization unavailable |
| 1032257000024506045 | Design Dashboard | Home Page Dashboard | Not established | No Zoho-hosted package; external behavior and authorization unavailable |

The external rows are inventoried, but their runtime behavior, mandatory inputs, delivery semantics, and authorization cannot be asserted from the downloaded set. They must remain blocked until separately captured from an authorized source.

## Execution and privacy boundary

- Captured-package execution is disabled. The nine separate original previews are read-only planners, calculators, or readiness views; none executes a captured package.
- Source widget execution and source writes are disabled.
- Outbound delivery is disabled.
- Widget source, external targets, archive hashes, local paths, credentials, and personally identifiable information are not included in this inventory.
- A package marked “captured” means only that its archive was safely validated and its static behavior was mapped; it does not mean that captured behavior is implemented or verified locally. The nine separate previews are original read-only implementations and never execute a captured package.
