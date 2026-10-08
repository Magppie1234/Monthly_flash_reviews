# All-workbook MIS coverage

Scope expanded by the user to all ten workbooks and all assigned employees on 24 September 2026. Existing responsibilities, assignments, scoring, targets, savings calculations and saved review storage are unchanged. AVP has no approved scorecard: its evidence is read-only activity context with a month selector.

| Responsibility | Dataset and fields | Calculation and matching | Evidence and limits |
| --- | --- | --- | --- |
| Designer detailed design (`dc_w2`) | ZIP design_records.designer/approval_date; CRM Deals.Designer_Name/Design_Approved_Date | Distinct order IDs, unique exact designer name, approval month in IST | Count of dated approvals, not a verified concept/detailed output or area achievement. Current assignment only. CRM replaces overlapping ZIP records. |
| Designer revisions (`dc_w6`) | ZIP revisions; CRM Number_of_Design_Revisions | Sum populated cumulative counts for named designer orders in snapshot month only | Cumulative context, not monthly work or team-comparison score. Missing numbers excluded. |
| Installation time (`installation_manager_v2_w1`) | Deals.Installation_Managers, Actual_installation_start_date, Actual_End_Date | Unique exact manager name; first-install completion month; mean nonnegative calendar end-minus-start days | Shows dated supporting orders and timing coverage. No working-day, product eligibility, baseline reduction or rating inferred. |
| Service turnaround (`customer_care_head_v2_w1`) | Visit_Module.Owner.id, Completion_Date, Deploy_Date | Exact selected employee ID; count owned completed visits by completion month | Context only: owner is not necessarily worker; no request-received timestamp or department attribution. Not full service TAT. |
| AVP activity context | Events.Owner.id, Start_DateTime | Exact selected employee ID; count distinct owned scheduled meetings in month | No attendance, commercial purpose, outcome, score or automatic fill. |
| Factory COPQ, wastage, maintenance, labour | No verified employee-linked cost/production dataset | Manual | Need BOM vs consumption, rework and costs, maintenance costs, mandays/output and comparable baseline. Company aggregate totals are not personal evidence. |
| Purchase MSPL/MLPL savings | No verified employee/entity/baseline mapping | Manual | Need entity, procurement ownership, quantities, approved baseline prices and actual prices. |
| Logistics freight/unit reduction | No verified employee-linked shipment costs | Manual | Need shipment ownership, actual costs, comparable units and baseline. Dispatch milestones alone are insufficient. |
| Other designer/operational work and behavioural/foundational rows | No qualifying events for these responsibilities | Manual | Missing working-day inputs, audits, error attribution, survey responses, costs or baseline are explicitly explained. |
| Sales Manager, Sales/ASM, PSM | Existing ZIP and CRM mappings in MIS-PIPELINE-PLAN.md | Existing matching and calculations retained | No response-window threshold invented; use existing review rules only. |

Name matching includes the user-confirmed local designer directory and active CRM directory, deduplicated by stable employee ID. Aliases, shared names and multi-person assignments are not inferred. Factory/purchase/logistics local IDs are not matched to arbitrary CRM owners. Empty date/metric fields remain missing data. Snapshot revision totals never appear as historical monthly achievements.

Pipeline now fetches selected designer/installation fields and all accessible Visit_Module records, using read-only CRM requests, complete pagination, minimized fields and atomic publication. Failed runs keep the prior complete snapshot; resume checks requested field coverage before reusing a module. Transient Windows file locks receive bounded retries. Credentials remain server-only. No live Books/Inventory access, CRM mutation or deployment is introduced.

Fetch and preview do not save answers. Applying remains explicit, with replacement consent and provenance; undo preserves later manual edits. Operational measurement fields and savings remain manual. Additional sources can be mapped when employee attribution, event dates and metric definitions are established.
