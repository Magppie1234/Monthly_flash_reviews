# Employee-specific Flash Review

## Current project-only department assignments

The user supplied the following local department lists on 16 September 2026. These supersede CRM-role filtering for AVP, SM, ASM and PSM only. No Zoho database records, user roles or profiles were changed. All other departments retain their previous mappings below.

| Department | Role / policy | People (CRM identity names) |
|---|---|---|
| Retail | AVP | Tavneet, Harshita Magppie |
| Retail | SM | Lang Takhel, Himanshu Thakur, Sakshi, Ashish, Abhinav Tomar, Arjun |
| Retail | SM with ASM review policy | Rahul Mahajan, Siddharth |
| Retail | ASM | Vaishnavi, Anushka, Shrestha, Rajkumar |
| Projects | AVP | Pratyush Pratyush |
| Projects | SM | Rananjay |
| Pre-Sales | PSM | Sowmya, Ishita, Sparshan, Deepak |

Names such as Lang, Rahul M and Shreshtha were resolved to their existing CRM user IDs (Lang Takhel, Rahul Mahajan and Shrestha). `config/flash-review-roles.json.localAssignments` is the sole local membership authority for these four lists; subsequent read-only identity refreshes preserve it. Other CRM users cannot enter these lists through a broad role or profile match.

Retail/Projects appear as employee dropdown groups. Rahul and Siddharth appear in the SM list, with an explicit ASM-policy notice. Their form, scores, reports and storage use the ASM policy, while their assigned role remains SM. Existing workbooks under other policies are preserved, not translated or deleted. AVP names can be selected but AVP ratings/submission remain unavailable because no AVP scorecard was supplied.

Validation: 19 Node tests pass. Browser checks cover exact lists, department grouping, SM/ASM policy separation, isolated saved ratings, reload, AVP pending policy and mobile layout.

This working copy serves http://127.0.0.1:3100/#/flash-review. The original September 7 handover source is untouched. Other CRM modules still use the synthetic demo snapshot; only the staff directory was fetched from live Zoho for this change.

## Use

Choose Workbook, then Employee. The dropdown uses the local department assignments above for sales/pre-sales and exact CRM role IDs for the remaining departments. Employee name is locked to the selected CRM identity. Setup, monthly ratings, drafts, submissions and annual reports belong to that employee and review policy. Review fields remain optional and ordinary edits continue updating in place.

## Original CRM mappings (still applicable to unmodified departments)

| Workbook | Exact CRM role | Exclusions |
|---|---|---|
| Sales Manager | SM | SM Lead role, PSM, generic Manager, CEO |
| Design Consultant | Designer1 Magppie | Designer Head |
| Pre-Sales Manager | PSM | PSM Lead role |
| Installation Manager | IM | IM Head |
| Customer Care Head | AMS Head | Other service roles |
| Sales / ASM, Factory Head, Purchase Head, Logistics Head | No verified mapping | All users |

Profiles are access permissions, not the assigned role. For example, a PSM with an SM Lead profile stays in PSM. The Designer1 Magppie account is shown with its actual CRM account name, not an invented personal identity. Customer Care Head → AMS Head is the explicit terminology mapping used here. Change the mapping file if the business uses a different assignment; do not add users based on names or broad substring matches.

## Files

- `config/flash-review-roles.json`: exact workbook-to-Zoho-role-ID mapping.
- `data/flash-review-roster.json`: minimal eligible employee snapshot, organization and checked timestamp; no email addresses or credentials.
- `lib/flash-review-directory.js`: validates organization, filters exact active roles and deduplicates employees.
- `server-offline.js`: authenticated-gate-compatible GET `/api/flash-review/people`; 503 if the saved roster cannot be validated.
- `public/flash-review.js`: employee selector and storage migration.
- `public/styles.css`: responsive controls using existing styling.
- `scripts/refresh-review-people.py`: manual read-only roster refresh from the supplied credential ZIP.
- `test/flash-review-directory.test.js`: filtering, identity separation and migration tests.

## Storage and migration

Same localStorage key: `magppie_monthly_flash_review_v1`, store version 3. `employeeReviews[workbookId][zohoUserId]` stores each workbook; `activeEmployees[workbookId]` remembers selection. Existing version-2 `roles` are retained unchanged as legacy documents. They are never assigned to an employee by matching a typed name. An exact pre-change storage backup is created at `magppie_monthly_flash_review_v1_before_employee_reviews` before the first write. A visible download control is available for existing role-only reviews. Corrupt/unreadable storage fails closed instead of being replaced.

Reviews are still browser-local, not uploaded to Zoho or shared across devices. The employee selector identifies the review subject; it does not authenticate the reviewer or enforce per-user HR permissions. Annual-cycle storage behavior is unchanged from the original workbook.

## Refresh and run

From this project directory:

```powershell
python scripts/refresh-review-people.py --credentials-zip 'C:\path\to\zoho-refresh-token-org60046349006.zip'
node --test test/flash-review.test.js test/flash-review-directory.test.js
```

Refresh exchanges the refresh token in memory, verifies org 60046349006, reads roles and paginated ActiveUsers, then atomically replaces the minimal roster. Requires Zoho read access for organization, users and roles. No credentials are copied to source or returned by the local endpoint. API failure preserves the previous roster and its checked timestamp. Reload the page after a successful refresh. There is no background sync job.

The Windows local launcher currently uses `CLONE_PORT=3100`, `CLONE_HOST=127.0.0.1`, and `CRM_OFFLINE_SNAPSHOT_DIR` pointing to the original handover's `examples/demo-snapshot`. `VERCEL=1` enables the original bundled-file permission mode because its POSIX mode check is incompatible with Windows. It does not deploy anything. The local node_modules junction reuses the handover dependencies; use `npm ci` on a fresh independent checkout.

## Verification

17 Node tests pass. Browser checks cover all nine filtered lists, switching employees without rating leakage, submission/reload, preserved legacy reviews and backup, empty-role state, directory failure and a 390px viewport. Tests use isolated browser storage; existing user reviews are not touched.

## Reporting hierarchy (17 September 2026)

`config/flash-review-roles.json` stores the confirmed reporting hierarchy. The directory maps CRM IDs to hierarchy nodes; all PSM workbook employees report to Sadhvi. This is local configuration only, with no Zoho writes. Factory is a department reporting to Dr. Suruchi Mittal, not an individual manager.

Confirmed managers prefill on selection and are read-only in Setup and reviews. AVPs show their manager in the pending-policy panel. Previous differing manual manager names are retained in `setup.previousReportingManagers`; saved review answers remain untouched. Unspecified reporting lines remain optional. Shreya is not matched to Shrestha, and Rananjay is not assumed to report to Pratyush. Hierarchy nodes without verified roster identities do not add employees or change review policies.

Validation: 20 Node tests pass, including explicit mappings, department semantics and unresolved identities.

### Factory and Installation assignments
Factory Head now contains only Rajni (`local:rajni`, explicitly supplied project identity with no claimed CRM account). Installation Manager now contains only Rishabh (`1032257000023448089`, verified saved CRM identity). Both report to Factory (department). Existing employee review records remain stored even when their employees are removed from the selectable list. `projectPeople` supports explicit local identities independently of CRM snapshot refresh; explicit CRM assignments are retained by the refresh script. Other workbooks are unchanged.

### Latest corrections
Sakshi and Abhinav Tomar report to Dr. Suruchi Mittal (Founder's Office); Himanshu Thakur to Harshita; Rahul Mahajan to Tavneet; Shrestha to Ashish. Rajkumar is removed from selectable ASM membership, with saved reviews preserved. Factory Head is displayed as Factory Office, and Rajni is renamed Rajnikant. Internal keys `factory_head` and `local:rajni` deliberately remain stable to retain review history. Verified with 23 Node tests and browser checks for every changed manager and label.

## Combined review framework
The five operations workbooks now implement the approved combined draft: Factory Office 4 KPIs, Purchase 2, Logistics 1, Installation 4, AMS 4. Each has five behavioural and five foundational items, a reviewer-selected overall assessment, KPI baseline/target/actual/unit, evidence, closing actions and Section E savings. IDs use a new v2 namespace; previous item ratings, evidence and remarks remain stored and visible under preserved entries, not reassigned to new KPIs. Stable employee IDs and existing role policies for other departments are unchanged.

Numerical weights and automatic escalation are disabled for these five roles. Incentive bands are informational proposals with no payout calculation. FY25–26 savings targets are historical seven-month references, not default current targets. Savings achievement requires a positive entered approved target, nonnegative actual and verification checkbox; missing information remains pending, actual zero remains zero. Cumulative snapshots must not be summed across months. Factory department subtotal is informational and never added to individual savings. Purchase and Logistics remain without assigned people.

Validated with 24 unit tests and browser checks for active role forms, report/submission, reload persistence, hierarchy and names. No CRM writes.
