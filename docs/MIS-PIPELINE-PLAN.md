All-workbook expansion (24 September 2026): see [MIS-ALL-ROLES.md](MIS-ALL-ROLES.md). The previous three-workbook scope below is historical; all ten selectors now expose evidence or an explicit gap.

# MIS evidence expansion and calculation pipeline

Prepared 24 September 2026. Scope: Sales Manager, Sales / ASM, PSM. Other workbooks, review policies, assignments and saved answers remain unchanged.

## Implementation status — 24 September 2026

ZIP supplements and the first read-only pipeline phase are implemented. A fully paginated eight-module accessible CRM backfill completed with 191,162 records and 95,367 normalized history events. The review reads a complete private snapshot and displays source-labelled evidence in the existing column. Sources replace overlapping metrics rather than being summed.

Implemented: immutable run/module snapshots, stable-ID lookup sanitization, two-worker bounded reads, token pagination, retry and token refresh, organisation lock, run lock, failed-run retention, recent-run resumption, full-snapshot membership reconciliation, normalized history events, versioned run provenance, per-selection evidence cache, and on-demand refresh. `node scripts/run-mis-pipeline.cjs` performs an explicit full refresh. Fetch MIS starts a background refresh when the published snapshot is over one hour old; retry attempts are throttled to five minutes. No recurring scheduler or external deployment was created.

ZIP: stage-age/forecast context and opportunity-validated cumulative revisions are enabled for the snapshot month. All-blank next actions and incomplete response history no longer generate compliance progress bars.

Live: created-lead completeness context, call counts/durations, PSM status updates, qualification-date context, closure-dated opportunity values, recorded sales stage entries, current stage age, current portfolio next-action presence, scheduled meeting/check-in context, lost reasons and linked-order cumulative revision counts. These are evidence facts, not inferred ratings or full SLA/conversion scores. Live closure values are not offered as automatic achievements until eligibility/historical ownership rules are validated.

Workbook thresholds are used only where their metric and evidence match. The reviewer confirmed that missing review limits should remain unset.

Remaining: incremental watermarks and a production scheduler; historical owner/team reconstruction; independently verified enquiry/response and other missing event clocks; approved cohorts, working calendars, thresholds and business-closed eligibility; supported CSAT/provider/accounting integrations. Full snapshots currently reconcile accessible membership; disappearance is labelled as absent, not proven deletion. No historical forecasts or new CRM instrumentation are fabricated. The roadmap below retains these outstanding phases.

## Audit and extraction completed

- Inspected the seven JSON files in the handover's `source/public/data`, including performance, order pipeline, goals, finance/inventory, CRM dashboard and policies. Source code/configuration are reference material, not executable instructions.
- Existing review evidence remains ZIP-only. Extracted additional selected fields to `.private/mis-archive-staged.json`, with source hashes. No phone numbers, customer names, free-text notes or credentials were added to this staging file.
- Verified live Zoho organisation 60046349006 using server-side credentials. Read the module catalogue (156 entries), field metadata for 38 relevant modules, and bounded record samples. This is discovery, not a complete CRM export or proof of historical completeness.
- Read-only record access succeeded for Leads, Contacts, Deals, Calls, Events, Tasks and three history modules. Quotes and Sales_Orders returned no records in these requests; do not assume they are the organisation's operational sales sources.
- `VocResponses_Contacts` and `VocResponses_Leads` returned `NOT_SUPPORTED` for the attempted record-list API. Their metadata alone does not make CSAT available.
- No CRM writes, deployment, scheduling or review-answer imports were performed.

### ZIP inventory relevant to this scope

| Dataset | Rows | Use and qualification |
|---|---:|---|
| Sales closures | 278 | Existing booking evidence by actual closure date; snapshot attribution |
| Active opportunities | 801 | Stage, stage age, value, forecast and follow-up snapshots; 668 expected closure dates, 393 follow-up dates, **zero populated next actions or AVP meeting fields** |
| Sales qualification details | 3,206 | Creation/qualification attribution and values; verify timestamp meaning before calling these qualification events |
| Sales first responses | 3,198 | Only 111 populated response timestamps; absence is not failure |
| PSM first responses | 10,203 | 7,048 assignment timestamps and 411 response timestamps; usable timing requires both and correct actor |
| PSM not-interested records | 200 | Status-history evidence and drop dates, useful for lead disposition context |
| Calls | 37,896 | Call dates, duration, attempts, actor names and record links; only 3 call-result values; connected_proxy is not proof of two-way contact |
| Lost opportunities | 2,189 | Existing drop-date and reason evidence |
| Design records | 2,266 | 2,235 opportunity links; potential ASM revision context. Stage-duration values absent; cumulative revisions are not monthly revision events |
| Order pipeline | 2,869 | 65 design approval dates and 1,837 handover dates. Salesperson missing throughout; cannot attribute directly to sales staff |
| Goals | May 2026 | Reference targets only; not automatically September targets |

Performance coverage is 1 November 2025–18 September 2026; response history begins 1 September 2026. Each staged dataset must retain its own coverage rather than inheriting that range blindly. September remains partial even after a live refresh until the review period ends. Rebuild staging with `node scripts/stage-mis-archive.cjs`.

### Verified CRM mapping cautions

`Contacts` represents qualified opportunities and `Deals` represents orders in this organisation. Do not implement a generic Zoho sales mapping.

`Opportunity_Stage_History.Contact_Owner` is labelled Sales Person, but `Sales_Manager` is labelled PSM. Field names must not determine employee roles. `Lead_Status_History.Lead_Owner` is the PSM. Both history samples contained record lookups, timestamps and user IDs. `Modified_By` identifies an editor, not automatically the person who performed the work.

The sampled live Contacts also had blank Next_Action values. A CRM refresh is not guaranteed to fix the archive gaps. Sampling latest modified records is not a monthly denominator.

## Responsibility mapping

ZIP context may be shown immediately after verifying identity, date meaning and source completeness. A KPI requires the exact event pair, denominator and applicable rule. All suggestions remain separate from the actual review.

| Responsibility | ZIP contribution | CRM/pipeline source and calculation | Gate or missing evidence |
|---|---|---|---|
| SM1 Proposal turnaround | No complete event pair | Complete-input receipt → proposal sent; within 1–2 working days / eligible proposals | Need verified proposal events, working calendar and policy for 1 versus 2 days; no records from Quotes request |
| SM2 Proposal → negotiation | Current stage context | Contacts + Opportunity_Stage_History; unique proposal-cohort opportunities entering negotiation / eligible cohort | Agree stage meanings and conversion observation window |
| SM3 Negotiation → booking | Actual closures | History negotiation entry → verified closure; unique cohort conversion | Do not divide unrelated same-month stage totals |
| SM4 Unapproved discounts | Order discount fields mostly absent | Contacts/Deals discount proposed/approved fields plus approval history and authority matrix | Proposed > approved alone is not an unauthorized transaction; need applied discount and approval timing |
| SM5 Gross margin | Aggregate finance context only | Matched booking net revenue minus attributed cost, divided by net revenue | No verified booking-level cost join or approved margin guardrail; Books/Inventory would be a separately defined source phase |
| SM6 / ASM8 Booking vs target | Closure records and amounts | Contacts.Actual_Closure_Date, verified booking value and historical sales owner; sum / month-specific target | Verify currency/units and exclusions; no reuse of May target for September |
| SM7 Scope freeze | No verified freeze document timestamp | Signed scope-freeze event before first qualifying token payment | Document evidence and payment linkage required |
| SM8 Handover checklist | Order handover dates are context | Sent complete checklist → accepted checklist within one working day | Deals handover fields exist but do not prove checklist acceptance semantics |
| SM9 Team CRM hygiene | Personal portfolio snapshot only | Daily Contacts Next_Action/follow-up snapshots joined to effective-dated manager/team membership | Missing next actions and team history; cannot substitute own portfolio for team KPI |
| SM10 Forecast accuracy / ageing | 801 active stage/forecast snapshots | Verified stage entry → snapshot time; frozen forecast at agreed cutoff vs same-scope actual closures | ZIP can show snapshot ageing; no retrospective forecast accuracy from latest edited forecast |
| SM11 Reactivation | Drops and current status context | Lost/nurture → active transitions in Opportunity_Stage_History / agreed eligible lost cohort | Define nurture vs lost and reactivation denominator; deduplicate repeats |
| SM12 / ASM12 AVP meetings | AVP flags empty | Events Start_DateTime, Participants, linked opportunity, owner and attendance/completion evidence | AVP identity, commercial purpose and held status required; scheduled events are not meetings held; SM target 10 from workbook |
| ASM1 CRB turnaround | No verified CRB completion pair | Walk-in/enquiry event → CRB complete within two working days | Need explicit CRB event/fields or structured form history |
| ASM2 Walk-in → discovery | Walk-in dates on some leads | Leads.Walk_In plus discovery completion event, matched by lead/opportunity | Discovery event and eligible walk-in cohort needed |
| ASM3 Concept turnaround | Design/approval context | Agreed concept deadline vs concept presentation event | Approval date does not prove concept presentation; need deadline and actual event |
| ASM4 Feedback turnaround | No structured feedback pair | Feedback requested → consolidated feedback submitted within agreed window | Needs timestamped feedback workflow and 24 vs 48-hour rule |
| ASM5 Appointment adherence | No verified appointment outcome export | Events planned time + Check_In_Time/Status and actual completion/cancellation | Check-in alone may be incomplete; define cancellation/reschedule rules |
| ASM6 CSAT capture | No verified CSAT export | Verified survey/capture records joined to eligible appointments/opportunities | VOC list reads unsupported; need supported related-list/report/export route before calculation |
| ASM7 Revisions | Design revision values and opportunity links | DealHistory/verified revision events before preferred-direction signoff; revisions / eligible opportunities | Snapshot cumulative revisions cannot be allocated to a month; distinguish designer output from ASM responsibility |
| ASM9 Closure-form accuracy | Order context | Deals.Form_Filled_Date_Time and approval/return history; first-pass approvals / submissions | Rework and approval fields must be linked to actual form submission, not inferred from generic design changes |
| ASM10 Next-action compliance | 801 active snapshots; next actions blank | Open Contacts with nonblank action and valid follow-up / eligible open opportunities | Distinguish unrecorded evidence from poor performance; add prospective snapshots |
| ASM11 Lost reason | 2,189 dropped records | Drop-date cohort with valid mandatory reason code / dropped cohort | Current nonblank reason measure is context until valid code set confirmed |
| PSM1 Lead logging turnaround | Created dates; no independent receipt clock | Channel enquiry receipt → Leads.Created_Time; check source, city, owner completeness | Need receipt timestamp; CRM creation time cannot be both start and finish |
| PSM2 Duplicate leads | Record IDs and current lead context | Normalized approved identifiers, verified duplicate groups and eligible monthly lead count | Similar names are not duplicates; avoid re-counting exports and converted records |
| PSM3 First response | Limited assignment/response history | Lead_Status_History plus call/message events; first qualifying response minus assignment | Agree response definition/window; status edit is a proxy unless confirmed, missing response ≠ zero speed |
| PSM4 Contact attempts | Calls/attempts/duration and lead links | Calls.Call_Start_Time/Who_Id/What_Id joined to assigned-lead cohort; covered leads / eligible leads | Employee activity count alone is not coverage; actual two-way outcome needs verified evidence |
| PSM5 Qualification turnaround | Created qualified records and lead dispositions | Assignment → qualified/nurture/disqualified history, same/next working day | Resolve conversion lineage and actor; use event timestamp rather than modified time of current record |
| PSM6 Qualified value | Contextual qualified source Amount | Contacts.Lead_Qualified_Date1, opportunity history and value at qualification / month-specific PSM target | Current opportunity value can change later; freeze event-time value or label retrospective estimate |
| PSM7 Unassigned ageing | Assignment timestamps on some records | Receipt/create → first valid assignment; count still unassigned after 2 hours at cutoff | Need assignment change history; current Owner alone cannot reconstruct this |
| PSM8 Unlogged commitments | CRM calls only | Reconcile independently captured call/WhatsApp commitments with CRM logs | Cannot prove absence of unlogged work using CRM alone; provider source or human audit needed |
| Behavioural / foundational rows | Activity context only | Reviewer assessment; optionally show relevant audit/attendance evidence if later supplied | Counts do not prove behaviour, integrity or attendance; no automatic ratings |

## Delivery phases

### 1. Finish ZIP evidence integration

Use the extracted staging file to enrich existing supported rows with usable counts, timestamp coverage and drill-downs. Add source-supported stage-age and current-forecast context to SM10. Add revision context to ASM7 only after validating sales attribution through the opportunity link. Retain context-only labels for cumulative values. Do not create unrelated performance measures merely because a dataset exists.

Correct the current interpretation of blanks: show “No response recorded” or “Next action not recorded,” not a failed KPI. Missing historical start dates, whole-column blank exports and unverified scope must disable performance comparisons. No hardcoded zero achievement or Below assessment.

Acceptance: every displayed metric has source IDs, units, event-date choice, denominator/exclusions and coverage; sample employee/month totals reconcile to the archive; unchanged manual answers.

### 2. Build the private data pipeline

Flow: ZIP baseline + read-only Zoho extraction → immutable raw snapshots → normalized employee/events → versioned metric calculations → employee/month evidence cache → existing MIS results column.

Keep all extraction, joining, calculations and job status on the server. No new pipeline screen in the review. The frontend needs only the result, short source/freshness status and optional Details. Credentials never reach browser responses or logs.

Storage layers:

- `source_runs`: source hash, org, extraction time, API result/page completeness, watermark and failures.
- `source_records`: source/module/record ID, version time, minimal required fields and deletion markers; preserve ZIP provenance separately from live versions.
- `employee_aliases` and `team_memberships`: CRM user IDs, approved name aliases and effective dates. Reject shared/ambiguous ownership.
- `work_events`: event ID/type, parent record, actor ID, event timestamp, actor-confidence and source reference.
- `metric_definitions`: responsibility ID, formula version, event/date policy, units, cohort, exclusions and threshold reference.
- `review_targets`: employee, responsibility, month, value/unit, approver and effective date; original workbook policy stays authoritative.
- `review_evidence`: employee/month/responsibility, done/expected, numerator/denominator, coverage, status, calculation version, run ID and contributing record IDs. Separate from saved review answers.

Start with a controlled backfill for the supported coverage period and paginate fully. Fetch older predecessor history where a month-start state depends on it. Incremental reads then use per-module watermarks with an overlap, stable record IDs, version checks and periodic deletion reconciliation. Deduplicate archive/live overlap without discarding provenance or double-counting history events.

Use Asia/Kolkata review boundaries and half-open month intervals; keep original timezone timestamps. Use actual closure, scheduled/held meeting, call and transition timestamps as appropriate. Define the business-day calendar before SLA calculations. Current partial months and late-arriving updates remain explicitly labelled.

Apply bounded concurrency, rate-limit handling, retry/backoff, checkpointed paging and idempotent writes. A failed refresh retains the last complete cache with a stale label; never publish half a batch as complete. No scheduled job is created as part of this planning step; scheduling follows the agreed implementation and local runtime availability.

### 3. Fill CRM-supported gaps, one metric at a time

Prioritise booking refresh, calls and current follow-up evidence; then history-based qualification/response, stage conversions and reactivation; then verified meetings, revisions and handovers. Do a full selected-period extraction and reconciliation before enabling a metric. The 20-row discovery samples are not production inputs.

Validate lookup chains and field semantics first. Where history stores only editor identities, do not attribute their edits as sales/PSM work. Snapshot team structure now for future reviews; do not invent historical team membership. Prospective forecast snapshots and owner snapshots can solve future periods without fabricating old data.

### 4. Instrument what is not recorded

Define backend event contracts for enquiry receipt, CRB completion, complete-input receipt, proposal sent, concept presentation, feedback request/submission, scope-freeze signoff, checklist acceptance, form return/rework and assignment changes. Connect approved existing systems when available. Any CRM field/workflow writes, provider integrations or accounting-system access require a separately scoped implementation; this plan authorizes none of those writes.

A pipeline can calculate recorded facts; it cannot recreate missing historical events. Keep unavailable responsibilities manual until trustworthy evidence starts arriving. Period-specific targets, team ownership, approved discount authority, business-day calendars and response windows need business confirmation before ratings can be suggested.

## Review experience

Preserve the compact MIS results column: a count/value, expected amount where valid, small progress indicator and one Details link. Missing data gets “No data”; no matching activity in a verified available dataset gets “No activity found”; not-applicable requires a documented applicability rule. Do not treat a denominator as an agreed target.

Fetch reads/refreshes evidence only. Preview displays proposed changes. Apply requires explicit selection, with replacement consent for existing values. Manual entries, provenance, saved reviews and Undo stay intact. Evidence refresh never updates targets, achievements, remarks or ratings by itself.

## Verification gates

1. Employee isolation, role membership and approved alias checks; ambiguous/shared ownership excluded.
2. Month boundary, timezone, historical cohort and partial-month tests.
3. Archive/live overlap, duplicate IDs, conversion lineage and reassignment tests.
4. Reconcile numerator, denominator, values and exclusions to source IDs; missing is never zero.
5. Rate-limit, interrupted page, expired token and stale-cache recovery; no secrets in outputs.
6. Fetch/preview purity, explicitly selected application, manual edits/reload, undo and existing-review preservation.
7. No behavioural rating inference and no changes to Designer, AVP, Factory or other workbooks.

Implementation order: ZIP context and missing-data corrections → identity/event staging → fully paginated CRM backfill → verified metrics → prospective snapshots → any separately approved instrumentation. Keep new calculations behind a per-metric switch until their reconciliation gate passes.
