# Local Rules, Layouts, Pipelines, and Custom-View Coverage

## Outcome

This report keeps two evidence scopes separate. The historical offline discovery audit covers **122 API-supported modules**. A separate current hydrated-runtime audit reads the local **153-module catalog** using bounded, SELECT-only crm_meta batches. Local layout-aware schema validation and a fail-closed custom-view compiler are implemented. Source validation rules, assignment execution, approvals, and pipelines are **not locally executable** from the available evidence and remain denied by default.

| Area | Captured source evidence | Actual local enforcement | Source-equivalent status |
| --- | --- | --- | --- |
| Layouts | 70 definitions across 67 modules; 47 module responses blocked | Exact/stored layout resolution, field overlay, and schema validation are enforced | Partial |
| Custom views | 386 list rows; 0 criteria details captured; 386 missing | Compiler is wired and rejects missing, dynamic, disrupted, unknown, or unsupported criteria | Blocked for all 386 offline rows |
| Validation rules | 0 definitions; 122/122 responses inaccessible | Generic schema/layout validation only; no source-rule interpreter | Blocked |
| Assignment rules | 1 list definition; 0 executable definitions | No rule interpreter or automatic assignee mutation | Blocked |
| Approval rules | 0 definitions; 122/122 responses inaccessible | No approval interpreter or approval-state mutation | Blocked |
| Pipelines | 70 layout-scoped responses; 0 definitions | No pipeline interpreter or automatic stage progression | Blocked |

## Current hydrated local metadata

The generator queried only approved crm_meta keys: 318 rows in 27 value batches of at most 12, with maximum concurrency 4. It did not query CRM records, mutate local metadata, or contact the source.

| Local metadata family | Stored scopes | Modules with definitions | Definitions | Empty scopes |
| --- | ---: | ---: | ---: | ---: |
| Fields | 121 | 120 | 2377 | 1 |
| Layouts | 75 | 67 | 70 | 8 |
| Custom views | 121 | 41 | 386 | 80 |

The 70 layouts contain 168 sections and 1796 layout-field references. All counts are derived from the current local metadata bodies, not a pre-hydration constant.

## Current custom-view compiler results

| Runtime population | Reviewed | Executable criteria | Safe unfiltered | Unresolved body | Unsupported criteria | Compiles | Blocked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All mirrored views | 386 | 102 | 53 | 134 | 97 | 155 | 231 |
| System-defined views | 306 | 33 | 48 | 134 | 91 | 81 | 225 |
| Module defaults | 41 | 4 | 10 | 26 | 1 | 14 | 27 |

All 386 local views were passed through the production custom-view filter. 102 criteria bodies compile to filters; 53 explicit null criteria are safely unfiltered; 134 definitions have no criteria body and remain unavailable; and 97 supplied criteria are rejected by the fail-closed compiler. An implicit unsupported default may fall back visibly to an explicitly safe unfiltered mirrored view; an explicitly selected unsupported view is denied.

## Exact source reconciliation

- Layouts: 75 successful and 47 blocked module responses; 70 definitions; 8 successful empty responses. All 70 captured definitions contain the sections property, and 69 contain at least one section.
- Custom views: 121 successful and 1 blocked module responses; 386 list rows across 41 modules; no captured row contains criteria detail.
- Validation rules: 122 inaccessible responses and no captured definitions. This does **not** establish that the source has no validation rules.
- Assignment rules: 12 successful and 110 blocked responses; one list definition exists, but it has no captured criteria or actions.
- Approval rules: 122 inaccessible responses and no captured definitions. This does **not** establish that the source has no approval processes.
- Pipelines: 70 responses across 67 modules; one successful empty response, 69 blocked responses, and no definitions.

## Implemented local equivalents

### Layout-aware validation

The local runtime resolves an explicitly selected or stored active layout. It does not guess when a create request has multiple candidate layouts. The resolved layout overlays field metadata before required, type, picklist, read-only, virtual-field, formula, lookup, and subform validation runs.

This is only partial parity: source profile visibility and layout-level action permissions are captured on the layout objects but are not locally enforced.

### Custom-view filtering

The local compiler supports nested AND/OR groups and these comparators: equal, not_equal, contains, not_contains, starts_with, ends_with, in, not_in, greater_than, greater_equal, less_than, less_equal, between. An explicit null criterion is treated as intentionally unfiltered. Missing criteria, disrupted criteria, dynamic values, unavailable fields, malformed values, and unsupported operators are denied before records are queried.

The historical offline snapshot still contains list rows only, so **0 of 386 historical rows can be independently compiled from that artifact alone**. The hydrated local metadata separately contains 199 criteria-bearing views comprising 321 leaf conditions; 102 compile and the rest remain explicitly categorized.

## Fail-closed execution boundary

Validation-rule, assignment-rule, approval-rule, and pipeline execution remains disabled. Caller assertions that a rule matched, an assignee was selected, an approval occurred, or a pipeline transition is valid are not trusted. The default decision is **Deny** until complete definitions, ordering, actor context, side effects, and failure behavior are captured, implemented, and tested.

Generic field/layout validation must not be described as source validation-rule parity. Likewise, Blueprint support or direct stage-field handling must not be described as pipeline parity.

## Evidence and privacy boundary

This report was generated from existing offline source artifacts, batched SELECT-only crm_meta reads, and a static local-code audit. It did not contact or mutate the source, mutate the local database, query CRM records, execute source configuration, or include configuration names, raw identifiers, individual identities, record values, communication targets, sensitive values, or private filesystem locations.
