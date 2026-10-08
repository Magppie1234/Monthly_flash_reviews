# Local Permission Coverage

> This is an offline, identity-free comparison of the captured Zoho permission catalog with the localhost authorization implementation. No Zoho request or mutation was made.

## Outcome

The source catalog is structurally reconciled, but localhost does not have an individual user principal. Consequently, none of the source role hierarchy, profile-module permissions, field-level exceptions, ownership rules, or sharing rules are currently enforced per user. Every permission decision exposed by the adapter defaults to deny until an identity provider and explicit user mapping are implemented.

| Coverage item | Source evidence | Enforced locally | Status |
|---|---:|---:|---|
| Roles | 14 | 0 | Blocked |
| Profiles | 11 | 0 | Blocked |
| Aggregated source users | 63 | 0 | Blocked |
| Profile-module assignments | 506 | 0 | Blocked |
| Field exception assignments | 2836 | 0 | Blocked |
| Record-level sharing | Not captured | No | Blocked |
| Territory rules | Source discovery blocked | No | Blocked |

## Exact source catalog

- 14 roles and 11 profiles were captured; all 11 profile-detail responses are available.
- The profile matrix contains 506 assignments across 46 modules.
- The field catalog contains 2836 exception assignments grouped into 273 module-field pairs across 50 modules.
- Field exceptions comprise 928 hidden and 1908 read-only assignments.
- 16 profile labels occur in field metadata; 5 are additional source labels not present in the 11-profile CRM catalog and therefore remain unresolved.

## Role hierarchy

| Role | Reports to | Share with peers | Local hierarchy enforcement |
|---|---|---|---|
| AMS Head | Manager | No | Blocked |
| AVP | CEO | No | Blocked |
| CEO | Root | Yes | Blocked |
| Designer Head | Manager | No | Blocked |
| Designer1 Magppie | Designer Head | No | Blocked |
| IM | IM Head | No | Blocked |
| IM Head | Manager | No | Blocked |
| Manager | CEO | No | Blocked |
| PSM | PSM Lead | No | Blocked |
| PSM Lead | Manager | No | Blocked |
| SM | SM Lead | No | Blocked |
| SM Lead | Manager | No | Blocked |
| TL Punjab | Manager | No | Blocked |
| TL Surat and Hydrabad | CEO | No | Blocked |

## Profile-module permission summary

Counts below are source grants out of 46 captured modules per profile. The full sanitized matrix is retained in the JSON artifact.

| Profile | View | Create | Edit | Delete | Modules | Local enforcement |
|---|---:|---:|---:|---:|---:|---|
| Administrator | 41 | 30 | 29 | 32 | 46 | Blocked |
| AMS Head | 35 | 27 | 26 | 21 | 46 | Blocked |
| AVP | 41 | 30 | 29 | 32 | 46 | Blocked |
| Designer | 32 | 24 | 23 | 8 | 46 | Blocked |
| Designer Head | 32 | 24 | 23 | 8 | 46 | Blocked |
| IM | 29 | 22 | 21 | 6 | 46 | Blocked |
| IM Head | 32 | 24 | 23 | 8 | 46 | Blocked |
| PM Lead | 29 | 22 | 21 | 4 | 46 | Blocked |
| PSM and SM | 29 | 22 | 21 | 6 | 46 | Blocked |
| SM Lead | 29 | 22 | 21 | 6 | 46 | Blocked |
| Standard | 32 | 24 | 23 | 21 | 46 | Blocked |

## Field-level exception summary

| Source profile label | Hidden | Read-only | Local enforcement |
|---|---:|---:|---|
| AMS Head | 97 | 173 | Blocked |
| AVP | 27 | 168 | Blocked |
| Administrator | 27 | 168 | Blocked |
| Admins | 0 | 3 | Blocked |
| Designer | 97 | 173 | Blocked |
| Designer Head | 97 | 173 | Blocked |
| IM | 98 | 173 | Blocked |
| IM Head | 97 | 173 | Blocked |
| Managers | 0 | 3 | Blocked |
| Members | 0 | 3 | Blocked |
| PM Lead | 97 | 173 | Blocked |
| PSM and SM | 97 | 173 | Blocked |
| Participants | 0 | 3 | Blocked |
| Requesters | 0 | 3 | Blocked |
| SM Lead | 97 | 173 | Blocked |
| Standard | 97 | 173 | Blocked |

Additional field-metadata labels not present in the captured CRM profile list: Admins, Managers, Members, Participants, Requesters.

## What localhost currently enforces

- **Loopback server bind by default:** Implemented. Reduces network exposure but does not identify or authorize a user.
- **Optional shared access-code gate:** Present but not configured. All holders are indistinguishable and receive the same application access.
- **Database service-secret and row-level-security boundary:** Implemented. Protects direct database access but represents the server service, not a CRM end user.
- **Global schema and layout validation:** Implemented. Rejects unknown, formula, virtual, and globally read-only fields, but does not apply profile-specific field exceptions.
- **Local record delete route:** Not implemented. Delete is globally unavailable rather than allowed or denied according to the source profile.
- **Zoho source writes:** Blocked. The source transport is read-only; this is a data-safety boundary, not local user authorization.

These are global safety controls. None establishes a verified CRM user, profile, or role.

## Missing authorization decision

Choose an identity provider and a stable local subject, then explicitly map each authorized local principal to one source user, profile, and role before enabling profile-sensitive reads or writes.

The decision must also define disabled and deleted user handling, owner reassignment, role-hierarchy inheritance, peer sharing, record-sharing rules, metadata filtering, audit identity, and how profile changes invalidate active sessions. Caller-supplied role or profile headers must not be trusted.

## Privacy and execution boundary

- No user record, user name, email, phone number, credential, source ID, role ID, profile ID, endpoint, or private path is included.
- User information appears only as aggregate counts by captured role, profile, and account status.
- The permission adapter is informational and fail-closed; it does not enable local authorization.
- Until verified identity mapping exists, every user-specific permission evaluation returns `Deny`.

