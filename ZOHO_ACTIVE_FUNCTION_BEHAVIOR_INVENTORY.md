# Active Deluge Function Behavior Inventory

## Status

Read-only analysis is complete for every captured Deluge body referenced by an active workflow function action or by a `custom_function` entry in `config/custom-buttons.json`.

- Local automation endpoint: reachable and validated
- Detailed workflow rules: 44
- Active workflow rules: 39
- Active workflow function associations: 22
- Unique active workflow function action IDs: 21
- Custom-button entries: 19
- Custom-button function references: 2
- Unique captured function bodies analyzed: 23 of 60 available
- Unresolved in-scope function references: 0
- Functions executed: 0
- Source CRM reads or writes performed by this analysis: 0

The machine-readable inventory, including complete field arrays and blockers, is in `config/active-function-behavior-inventory.json`.

## Current local planning boundary

Two function definitions have received bounded deterministic review: `update_expected_closing_date_change_counter` and `markdonevisit`. Only `update_expected_closing_date_change_counter` has one eligible plan-only adapter. Its null initialization is tested as zero before the increment; the adapter emits a deterministic mutation plan but performs no write. Atomic persistence, concurrent increments, retries, and all source or local writes remain blocked.

The `markdonevisit` body and hash are reviewed, and its zero-equals-zero and unequal-counter semantics are tested. The captured workflow action still does not provide authoritative function-argument-to-CRM-field bindings, so it remains blocked with `FUNCTION_PARAMETER_BINDING_UNVERIFIED` and exposes no mutation plan. No captured Deluge body is executed.

## Mapping method

The workflow associations below use the exact action IDs returned by the detailed active rules from the local `/api/meta/automation` endpoint. A workflow action ID is not the same identifier as its function-definition ID. The bodies were matched using the exact action display name and captured function catalog metadata. The two same-named note functions were disambiguated by their separate action and definition ID lineages.

The two custom-button function references use a different identifier namespace from the captured function definitions. Each has a unique display-name and Button-category match; these two mappings are therefore marked Medium confidence. All workflow mappings are High confidence.

## Sanitized behavior inventory

| Function ID / API name | Association | Behavior | Modules read | Modules written | Complexity | Primary blocker |
|---|---|---|---|---|---|---|
| `1032257000003489144` / `create_lead` | Active workflow `1032257000003489158`; action `1032257000003489154` | Resolves a Call caller against Leads, creates a Lead when unmatched, and links the Call. | Calls, Leads | Leads, Calls | High | Exact number matching, idempotent creation, and CRM OAuth are required. |
| `1032257000023782453` / `markdonevisit` | Active workflow `1032257000023782470`; action `1032257000023782468` | Conditionally marks a visit complete from supplied counters. | — | Visit_Module | Low | The function body is hash-verified and its counter semantics are tested, but the captured workflow action does not expose authoritative argument-to-field bindings. The reviewed definition remains quarantined and plan execution is blocked. |
| `1032257000005147130` / `createticketservicemanagement` | Active workflow `1032257000005147032`; action `1032257000005147164` | Creates a service ticket from a Call. | Calls | Service_Managements | Moderate | Hard-coded communication targets must become approved configuration. |
| `1032257000010762191` / `updatedesignername` | Active workflow `1032257000010762211`; action `1032257000010762207` | Writes the supplied designer name to a Deal. | — | Deals | Low | Input and missing-record validation are absent locally. |
| `1032257000004871115` / `set_psm_user` | Active workflow `1032257000004871161`; action `1032257000004871157` | Copies the Contact creator into Sales_Manager. | Contacts | Contacts | Low | Inactive-user and lookup compatibility need validation. |
| `1032257000011594003` / `sync_order_value_with_opp` | Active workflow `1032257000011594112`; action `1032257000011594108` | Synchronizes a Deal value into the matching Contact product row. | Deals, Contacts | Contacts | Moderate | Subform row identity and concurrent edits need exact tests. |
| `1032257000005804238` / `createnoteinopportunity` | Active workflow `1032257000005804262`; action `1032257000005804258` | Converts Contact Description into a related Note and updates Last_Note. | Contacts | Notes, Contacts | Moderate | Note creation and source clearing must be safely retryable. |
| `1032257000006125020` / `setcalldurationinminutes` | Active workflow `1032257000015737666`; action `1032257000006125030` | Converts Call_Duration into Call_Durations_In_Minutes. | Calls | Calls | Low | Format variants and rounding require parity tests. |
| `1032257000005832107` / `updatenoteinopportunity` | Active workflow `1032257000005832133`; action `1032257000005832129` | Copies selected related Note content into Contact Last_Note. | Notes, Contacts | Contacts | Low | Related-note ordering must match Zoho. |
| `1032257000007791080` / `updatenoteinopportunity1` | Active workflow `1032257000007791110`; action `1032257000007791094` | Copies selected related Note content into Contact Last_Note. | Notes, Contacts | Contacts | Low | This separate near-duplicate version must not be collapsed accidentally. |
| `1032257000005804096` / `createnotefromdesc` | Active workflow `1032257000005804209`; action `1032257000005804205` | Converts Lead Description into a related Note and updates Last_Note. | Leads | Notes, Leads | Moderate | Note creation and source clearing must be safely retryable. |
| `1032257000010080001` / `createaccounts` | Active workflows `1032257000010080047` and `1032257000010080063`; shared action `1032257000010080027` | Creates or updates an Account and links the Contact. | — | Accounts, Contacts | Moderate | Identity, duplicate prevention, and partial failure require tests. |
| `1032257000005832019` / `udpatenoteinlead` | Active workflow `1032257000005832094`; action `1032257000005832090` | Copies selected related Note content into Lead Last_Note. | Notes, Leads | Leads | Low | Related-note ordering must match Zoho. |
| `1032257000007467439` / `create_project` | Active workflow `1032257000015737607`; action `1032257000008937694` | Creates or updates a related Deal, copies a broad field and subform mapping, transfers attachments, and writes the relationship back. | Contacts, Attachments | Deals, Contacts, Attachments | Very high | Mapping fidelity, idempotency, required fields, and file transfer need sandbox coverage. |
| `1032257000016568140` / `update_expected_closing_date_change_counter` | Active workflow `1032257000016568154`; action `1032257000016568150` | Increments the expected-closing-date change counter. | Contacts | Contacts | Low | A separate plan-only adapter now treats null as zero and has bounded arithmetic tests; atomic concurrent writes remain disabled and unimplemented. |
| `1032257000015032233` / `addleadtransferinfo` | Active workflow `1032257000015032363`; action `1032257000015032359` | Records current and previous owner details and assignment timing. | Leads | Leads | Moderate | First assignment, lookup shape, and workflow recursion need tests. |
| `1032257000011574083` / `sync_attachments_with_orders` | Active workflow `1032257000018629177`; action `1032257000011574155` | Copies Contact attachments to related Deals. | Contacts, Deals, Attachments | Deals, Attachments | Very high | File deduplication, limits, MIME handling, and partial retries are unimplemented. |
| `1032257000006796017` / `addcountrycodewithremoveduplicate` | Active workflow `1032257000015737626`; action `1032257000006796053` | Normalizes Lead mobile data, searches Leads and Contacts, creates selected follow-up Tasks, and can delete a matched CRM record. | Leads, Contacts | Leads, Tasks | Very high | Destructive deletion must remain disabled until explicit merge/delete approval. |
| `1032257000021616713` / `checkissunrooof` | Active workflow `1032257000021616723`; action `1032257000021616721` | Classifies a Contact from Product_Details1 and sets Is_Sunrooof. | Contacts | Contacts | Low | Product matching and empty-subform behavior need tests. |
| `1032257000017855001` / `findduplicateleadsandopp` | Active workflow `1032257000015737646`; action `1032257000017855019` | Searches newly created Lead data for duplicates, creates selected follow-up Tasks, and can delete a matched CRM record. | Leads, Contacts | Leads, Tasks | Very high | Destructive deletion must remain disabled until explicit merge/delete approval. |
| `1032257000023616244` / `addsunroooffilesinworkdrive` | Active workflow `1032257000023616255`; action `1032257000023616253` | Uploads qualifying related Deal attachments to WorkDrive and updates completion flags. | Contacts, Deals, Attachments | Contacts, Deals | Very high | WorkDrive permissions, deduplication, and all-or-nothing flag semantics need sandbox tests. |
| `1032257000022801585` / `initiatecallsontimepay` | Custom button `1032257000022801590`; reference `342586000000262006` | Reads selected Leads and initiates outbound calls through TimePay. | Leads | — | Very high | External communications must remain disabled until consent, recipient, credential, rate-limit, and test-destination controls exist. |
| `1032257000011594193` / `test_button` | Custom button `1032257000011594251`; reference `342586000000151003` | Links Deals referenced by selected Contacts back through Opportunity_Name. | Contacts | Deals | Moderate | Bulk parsing, missing records, duplicates, and partial failures need tests. |

## Field coverage

The JSON inventory lists the exact CRM API field names read and written by every scoped body. Field extraction was constrained to field names present in the captured CRM metadata; external payload keys and all literal values were excluded.

The largest mapping is `create_project`, which reads and writes a broad Contact-to-Deal field set, the `Product_Details1` subform, lookups, and attachments. Its field names are preserved exactly, including similarly spelled source and destination API names. They should not be normalized during implementation.

## External dependencies

- Zoho CRM REST and a named CRM OAuth connection are used by Lead creation, service ticket creation, Note creation, project creation, and attachment transfer.
- Zoho WorkDrive is used by the active file-upload workflow.
- TimePay is used by the Lead list-view call button.
- Two duplicate-detection functions use a Zoho CRM connector capable of record deletion.

Connection aliases and all literal endpoint, credential, communication-target, and customer values are intentionally omitted.

## Secret scan

| Severity | Confirmed findings |
|---|---:|
| High | 1 |
| Medium | 0 |
| Low | 0 |

Runtime connection vault contents were outside this static source scan.

## Implementation boundary

This inventory documents captured behavior; no captured function body has been enabled or executed, and no function write path is available. One separate deterministic plan-only adapter exists for `update_expected_closing_date_change_counter`; it is not a port of captured execution and cannot persist its proposed increment. `markdonevisit` remains reviewed but blocked on authoritative parameter binding. Every other function remains blocked until an adapter has explicit authorization, safe configuration, idempotency, failure-path tests, and sandbox evidence. The high-severity credential finding must be removed from source and rotated before any scoped function is enabled. The two deletion-capable duplicate routines and the TimePay communication button require separate approval before any execution path is enabled.
