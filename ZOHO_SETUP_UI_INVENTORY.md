# Zoho CRM Setup UI Inventory

Inspected read-only on 29 August 2026 from the authenticated Zoho CRM Setup index.

This inventory records accessible Setup surfaces without copying credentials, customer records, employee data, or hidden platform assets.

| Category | Accessible Setup Surfaces | Source Coverage | Local Coverage |
| --- | --- | --- | --- |
| General | Personal Settings; Users; Company Settings; Calendar Booking; Motivator | Inspected | Not Inspected |
| Security Control | Profiles; Roles and Sharing; Zoho Mail Add-on Users; Compliance Settings; Territory Management; Trusted Domain; Support Access; Audit Log | Inspected | In Development |
| Channels | Email; Telephony; Business Messaging; Notification SMS; Webforms; Social; Chat; Portals | Inspected | Not Inspected |
| Customization | Modules and Fields; Pipelines; Wizards; Kiosk Studio; Canvas; Customize Home page; Translations; Templates; Teamspace | Inspected | In Development |
| Automation | Workflow Rules; Actions; Schedules; Assignment; Scoring Rules; Cadences | Inspected | In Development |
| Process Management | Blueprint; Approval Processes; Review Processes; Connected Workflow; Signals; CommandCenter; Segmentation | Inspected | In Development |
| Data Administration | Import; Export; Data Backup; Storage; Recycle Bin; Admin Tools; Sandbox; Copy Customization | Inspected | In Development |
| Marketplace | All; Zoho; Google; Microsoft; Facebook; QuickBooks | Inspected | Not Inspected |
| Developer Hub | MCP for AI Agents; APIs and SDKs; Connections; Variables; Circuits; Functions; Widgets; Data Model; SlyteUI; Queries; Client Script; Catalyst Solutions; Agents | Inspected | In Development |
| Zia | Data Enrichment; Prediction; Recommendation; Communication; Vision; Notifications; Voice of the Customer; Models; Presentation; Custom AI Studio; Competitors; Usage Data | Inspected | Not Inspected |
| CPQ | Product Configurator; Price Rules; Guided Selling | Inspected | Not Inspected |

## Read-Only Safety Boundary

- Source pages are inspected without Save, Update, Delete, Convert, transition execution, exports that mutate configuration, or live communication actions.
- The localhost server blocks all non-GET/HEAD Zoho source calls.
- Local implementation status remains separate from source inspection status; an inspected Setup page is not treated as implemented parity.
