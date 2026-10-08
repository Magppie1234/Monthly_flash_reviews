# Monthly review MIS evidence

Applies only to Sales Manager, Sales / ASM and PSM. The supplied September 18, 2026 handover ZIP is extracted separately under `.private/mis-handover-2026-09-18`. No archive programs were executed. A read-only Zoho pipeline now supplements the ZIP; see `MIS-PIPELINE-PLAN.md` for implementation status and remaining gaps. Each responsibility retains its own source/date label. `config/mis-metrics.json` controls the enabled live evidence rows; automatic rating suggestions remain disabled.

The archive contains application/configuration material and actual exported CRM snapshot records. The selected performance dataset covers November 1, 2025 through September 18, 2026; first-response history starts September 1, 2026. Goals are labelled May 2026. September is incomplete. Historical owner assignments are not established.

| Responsibility | Dataset and fields | Calculation and matching | Limitations |
|---|---|---|---|
| Sales booking (SM/ASM) | sales_closure_details: record_id, sales_person, sort_date, value | Unique record IDs, exact owner name, actual closure month; lakh / 100 = Cr | Snapshot owner, filtered export; missing values prevent achievement suggestion |
| CRM hygiene (SM/ASM) | sales_active_opportunities: contact_id, sales_person, next_action, follow_up_date | Next action and valid follow-up date / exported active records | September snapshot only; personal portfolio, not manager team rollup |
| Lost opportunity reasons (ASM) | sales_attrition_summary: record_id, sales_person, drop_date, drop_reason | Nonblank reasons for distinct dropped records in month | Does not validate reason codes |
| First response (PSM) | psm_first_response_records: record_id, owner, responder, assigned_at, first_response_at, response_time_minutes | Assignment-month cohort; average recorded nonnegative timing only for same responder | September onward; no verified SLA threshold or historical reassignment |
| Calling (PSM) | bd_call_records: call_id, bd_name, call_date, attempts, talk_seconds | Distinct call IDs in call month; recorded attempts and talk minutes | Not proof of two-way interaction or WhatsApp compliance |
| Qualified value context (PSM) | bd_records: record_id, bd_name, created_date, bd_value | Creation-month source Amount in lakh / 100 | Creation date is not qualification event date; no achievement suggestion |
| Other responsibilities | No sufficient mapped evidence | Manual assessment | No invented ratings or results |

Names are uniquely matched against active local CRM employee IDs. Archive records lack stable employee IDs; aliases and ambiguous names are not guessed. Conflicting duplicate records are excluded. A zero count means no matching activity in the export, not proof of complete coverage. Missing source evidence remains missing. No responsibility is automatically classified as not applicable: that decision requires reviewer knowledge.

Prepare the private minimal dataset with `node scripts/build-mis-evidence.cjs`, then restart the offline server. The prepared file includes a source SHA-256. Customer contact details and credentials are not copied into evidence responses.

Fetch and preview only display evidence. Apply requires unchecked selections and additional replacement consent for existing values. Ratings and targets are never imported. Existing manual storage is retained; provenance and a last-application transaction are additive review properties. Undo restores unchanged imported fields while preserving fields manually changed afterward.

Additional historical assignment records, qualification events, complete activity coverage, month-specific targets and approved responsibility-specific rating thresholds would be needed for stronger assessments. Any live-source access must be separately explained and authorized.
