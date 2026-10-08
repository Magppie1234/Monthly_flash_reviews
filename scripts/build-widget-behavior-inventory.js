'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PRIVATE_WIDGET_DIR = path.join(ROOT, '.private', 'zoho-discovery', 'widgets');
const CONFIG_PATH = path.join(ROOT, 'config', 'widget-behavior-inventory.json');
const DOCUMENT_PATH = path.join(ROOT, 'ZOHO_WIDGET_BEHAVIOR_INVENTORY.md');
const MAX_ARCHIVE_ENTRIES = 200;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 5 * 1024 * 1024;

const SOURCE_WIDGETS = [
  ['1032257000000478094', 'WebTab1 Extension', 'External', 'Web Tab'],
  ['1032257000000478100', 'LeadChain Extension', 'External', 'Settings'],
  ['1032257000007994308', 'Payment Milestone Widget Installed', 'Zoho', 'Blueprint'],
  ['1032257000008937849', 'Handover to Installation', 'External', 'Blueprint'],
  ['1032257000010677612', 'Revise Quote - local', 'External', 'Blueprint'],
  ['1032257000010677855', 'Designer Form Widget Installed', 'Zoho', 'Blueprint'],
  ['1032257000010720459', 'Revise Quote - Widget Installed', 'Zoho', 'Blueprint'],
  ['1032257000010720513', 'Designer Form - local', 'External', 'Blueprint'],
  ['1032257000011559129', 'Picky-WhatsApp Extension', 'External', 'Button'],
  ['1032257000011559135', 'Picky-WhatsApp Extension', 'External', 'Button'],
  ['1032257000011559141', 'Picky-WhatsApp Extension', 'External', 'Button'],
  ['1032257000011559147', 'Picky-WhatsApp Extension', 'External', 'Button'],
  ['1032257000011559153', 'Picky-WhatsApp Extension', 'External', 'Button'],
  ['1032257000011559159', 'Picky-WhatsApp Extension', 'External', 'Button'],
  ['1032257000011559165', 'Picky-WhatsApp Extension', 'External', 'Button'],
  ['1032257000011559171', 'Picky-WhatsApp Extension', 'External', 'Button'],
  ['1032257000011559177', 'Picky-WhatsApp Extension', 'External', 'Button'],
  ['1032257000011559183', 'Picky-WhatsApp Extension', 'External', 'Button'],
  ['1032257000011589066', 'Testing', 'Zoho', 'Blueprint'],
  ['1032257000011958232', 'test', 'Zoho', 'Button'],
  ['1032257000012018119', 'KitchenEstimator', 'Zoho', 'Button'],
  ['1032257000012167001', 'Estimate Widget Installed', 'Zoho', 'Button'],
  ['1032257000013052001', 'WorkDriveWidget', 'Zoho', 'Blueprint'],
  ['1032257000013052011', 'Demo', 'Zoho', 'Blueprint'],
  ['1032257000016434001', 'Order Stages Update', 'Zoho', 'Blueprint'],
  ['1032257000017358913', 'Revise-Approve Quote-Any Stage Installed', 'Zoho', 'Button'],
  ['1032257000018181042', 'Closure Order Stage Update', 'Zoho', 'Blueprint'],
  ['1032257000018181058', 'Payment Milestone - pink', 'External', 'Blueprint'],
  ['1032257000018181128', 'New Test Widget Order', 'Zoho', 'Blueprint'],
  ['1032257000020866834', 'Handover to Post Design Installed', 'Zoho', 'Blueprint'],
  ['1032257000022772566', 'Factory Ticket', 'External', 'Blueprint'],
  ['1032257000022961582', 'Deploy Team Installed', 'Zoho', 'Button'],
  ['1032257000023117488', 'Handover To Post Team Installed', 'Zoho', 'Blueprint'],
  ['1032257000023270884', 'Sunrooof Mark Closures Installed', 'Zoho', 'Button'],
  ['1032257000023277323', 'Service Team AMS Dashboard Installed', 'External', 'Home Page Dashboard'],
  ['1032257000023349089', 'widget first dispatched', 'External', 'Blueprint'],
  ['1032257000023774783', 'Assign Technician Widget Installed', 'Zoho', 'Blueprint'],
  ['1032257000024506045', 'Design Dashboard Installed', 'External', 'Home Page Dashboard'],
  ['1032257000025407208', 'Closure New - Pinki Installed', 'Zoho', 'Blueprint'],
  ['1032257000025584294', 'Complaint', 'Zoho', 'Home Page Dashboard'],
].map(([id, sourceDisplayName, hosting, type]) => ({ id, sourceDisplayName, hosting, type }));

const EXTERNAL_BUTTON_MODULES = {
  '1032257000011559129': 'Leads',
  '1032257000011559135': 'Leads',
  '1032257000011559141': 'Contacts',
  '1032257000011559147': 'Contacts',
  '1032257000011559153': 'Deals',
  '1032257000011559159': 'Deals',
  '1032257000011559165': 'Accounts',
  '1032257000011559171': 'Accounts',
  '1032257000011559177': 'Invoices',
  '1032257000011559183': 'Invoices',
};

const INTERNAL_BEHAVIORS = {
  'Payment Milestone Widget': {
    purpose: 'Maintain opportunity payment milestones and the financial and follow-up values used by the closure flow.',
    context_modules: ['Contacts'],
    modules_read: ['Contacts', 'Payment_Milestones'],
    modules_written: ['Contacts', 'Payment_Milestones'],
    record_actions: [
      'Load the opportunity and its related payment milestones.',
      'Validate milestone percentages, discounts, booking values, and follow-up data.',
      'Replace related milestone rows and update the opportunity as one business operation.',
      'Continue the invoking Blueprint only after a successful save.',
    ],
    mandatory_input_status: 'Mapped with conditional rules',
    mandatory_inputs: [
      'Estimated closure date',
      'Next follow-up date',
      'Number of accessories',
      'Milestone percentages between 0 and 100 with the Magppie allocation totaling 100%',
      'Management-discount justification values when a management discount is entered',
      'Sunrooof total, booking, and discount values when the Sunrooof milestone option is enabled',
    ],
    dependencies: ['Opportunity-to-payment-milestone relationship', 'Atomic child-row replacement', 'Blueprint continuation'],
    local_equivalent_feasibility: 'Partial',
    local_blockers: ['Atomic relationship writes are not yet implemented locally.', 'The invoking Blueprint transition contract is not fully available.'],
  },
  'Designer Form Widget': {
    purpose: 'Collect project design requirements for every order related to an opportunity.',
    context_modules: ['Contacts', 'Deals'],
    modules_read: ['Contacts', 'Deals'],
    modules_written: ['Deals', 'Notes', 'Attachments'],
    record_actions: [
      'Load all related orders for the opportunity.',
      'Update product-specific design requirements on each completed order.',
      'Add notes and files to the order.',
      'Continue the applicable order Blueprint transition after successful validation.',
    ],
    mandatory_input_status: 'Mapped with product-specific rules',
    mandatory_inputs: [
      'A completed form for every displayed project',
      'At least one kitchen type for kitchen projects',
      'At least one wardrobe type for wardrobe projects',
      'City and room or area name',
      'All product-specific fields marked mandatory by the form',
    ],
    dependencies: ['Opportunity-to-order relationship', 'Order attachments and notes', 'Order Blueprint transition'],
    local_equivalent_feasibility: 'Partial',
    local_blockers: ['Attachment and note writes require atomic local orchestration.'],
  },
  'Revise Quote - Widget': {
    purpose: 'Revise design requirements and quote status across selected orders for an opportunity.',
    context_modules: ['Contacts', 'Deals'],
    modules_read: ['Contacts', 'Deals', 'Stage_History'],
    modules_written: ['Deals', 'Notes', 'Attachments'],
    record_actions: [
      'Load related orders and their stage history.',
      'Update design, quote-status, and revision-reason fields for completed orders.',
      'Add notes and files to the order.',
      'Continue the matching order Blueprint transition.',
    ],
    mandatory_input_status: 'Mapped with status and product rules',
    mandatory_inputs: [
      'At least one completed order',
      'A status for each completed order',
      'At least one kitchen or wardrobe type when that product applies',
      'Notes when the selected status requires sales-manager input',
      'A revision reason when revising a quote',
    ],
    dependencies: ['Opportunity-to-order relationship', 'Order stage history', 'Order attachments and notes', 'Order Blueprint transition'],
    local_equivalent_feasibility: 'Partial',
    local_blockers: ['Conditional attachment, note, and status writes are not yet implemented as one transaction.'],
  },
  Testing: {
    purpose: 'Calculate a kitchen estimate from layout, dimensions, package, and wall-unit height, then save the opportunity-value estimate to a Lead.',
    context_modules: ['Leads'],
    modules_read: [],
    modules_written: ['Leads'],
    record_actions: ['Calculate an estimate in the browser.', 'Update the Lead opportunity-value field on save.'],
    mandatory_input_status: 'Mapped',
    mandatory_inputs: ['Kitchen layout', 'Kitchen package type', 'Wall lengths', 'Wall-unit height'],
    dependencies: ['Lead record context', 'Source pricing constants'],
    local_equivalent_feasibility: 'High',
    local_blockers: ['Pricing constants and rounding must be acceptance-tested before enabling writes.'],
  },
  test: {
    purpose: 'Calculate a broad kitchen cost estimate from cabinetry, counters, flooring, appliances, labour, and contingency choices.',
    context_modules: ['Leads'],
    modules_read: [],
    modules_written: ['Leads'],
    record_actions: ['Calculate an estimate in the browser.', 'Update the Lead opportunity-value field on save.'],
    mandatory_input_status: 'No hard-required controls detected',
    mandatory_inputs: ['Any supplied numeric area or rate must be valid and non-negative.'],
    dependencies: ['Lead record context', 'Source pricing constants'],
    local_equivalent_feasibility: 'High',
    local_blockers: ['Pricing constants and default-value behavior must be acceptance-tested before enabling writes.'],
  },
  KitchenEstimator: {
    purpose: 'Calculate a kitchen estimate from layout, dimensions, kitchen type, and wall-unit height, then save the result to a Lead.',
    context_modules: ['Leads'],
    modules_read: [],
    modules_written: ['Leads'],
    record_actions: ['Calculate an estimate in the browser.', 'Update the Lead opportunity-value field on save.'],
    mandatory_input_status: 'Mapped',
    mandatory_inputs: ['Kitchen layout', 'Kitchen type', 'Wall lengths', 'Wall-unit height'],
    dependencies: ['Lead record context', 'Source pricing constants'],
    local_equivalent_feasibility: 'High',
    local_blockers: ['Pricing constants and rounding must be acceptance-tested before enabling writes.'],
  },
  'Estimate Widget': {
    purpose: 'Calculate a kitchen estimate from layout, dimensions, package, and wall-unit height, then save the result to a Lead.',
    context_modules: ['Leads'],
    modules_read: [],
    modules_written: ['Leads'],
    record_actions: ['Calculate an estimate in the browser.', 'Update the Lead opportunity-value field on save.'],
    mandatory_input_status: 'Mapped',
    mandatory_inputs: ['Kitchen layout', 'Package type', 'Wall lengths', 'Wall-unit height'],
    dependencies: ['Lead record context', 'Source pricing constants'],
    local_equivalent_feasibility: 'High',
    local_blockers: ['Pricing constants and rounding must be acceptance-tested before enabling writes.'],
  },
  WorkDriveWidget: {
    purpose: 'Load the WorkDrive reference stored on an Order and display the linked workspace.',
    context_modules: ['Deals'],
    modules_read: ['Deals'],
    modules_written: [],
    record_actions: ['Load the current Order.', 'Resolve and display its configured WorkDrive reference.'],
    mandatory_input_status: 'Context requirement',
    mandatory_inputs: ['An Order record context', 'A populated WorkDrive reference on the Order'],
    dependencies: ['Authenticated WorkDrive access', 'Order WorkDrive reference'],
    local_equivalent_feasibility: 'Partial',
    local_blockers: ['External workspace access and authorization are not replicated locally.'],
  },
  Demo: {
    purpose: 'Display a preconfigured WorkDrive viewer target without loading a CRM record.',
    context_modules: [],
    modules_read: [],
    modules_written: [],
    record_actions: ['Open the preconfigured external workspace viewer.'],
    mandatory_input_status: 'None detected',
    mandatory_inputs: [],
    dependencies: ['Authenticated WorkDrive access', 'Preconfigured external target'],
    local_equivalent_feasibility: 'Low',
    local_blockers: ['The external target and its authorization are intentionally omitted from the public inventory.'],
  },
  'Order Stages Update': {
    purpose: 'Bulk-manage Blueprint stages for Orders related to an opportunity.',
    context_modules: ['Contacts', 'Deals'],
    modules_read: ['Contacts', 'Deals', 'Attachments'],
    modules_written: ['Deals', 'Contacts', 'Attachments'],
    record_actions: [
      'Load related Orders and the Blueprint transitions available to each Order.',
      'Render transition-specific fields, picklists, checklists, and file controls.',
      'Apply the selected Blueprint transition to each validated Order.',
      'Copy or attach supporting files when required by the transition.',
    ],
    mandatory_input_status: 'Dynamic from Blueprint metadata',
    mandatory_inputs: ['Selected Order or Orders', 'Target transition', 'Every mandatory transition field', 'All required checklist confirmations', 'All required supporting files'],
    dependencies: ['Deals Blueprint transition metadata', 'Contact and Order attachment APIs', 'Per-record transition eligibility'],
    local_equivalent_feasibility: 'Partial',
    local_blockers: ['Dynamic checklist and attachment persistence is not implemented locally.'],
  },
  'Revise-Approve Quote-Any Stage': {
    purpose: 'Revise or approve quote and design data from a Contact button, independent of the current order-stage entry point.',
    context_modules: ['Contacts', 'Deals'],
    modules_read: ['Contacts', 'Deals', 'Stage_History'],
    modules_written: ['Deals', 'Notes', 'Attachments'],
    record_actions: [
      'Load related Orders and their stage history.',
      'Update design requirements, status, and revision reason for selected Orders.',
      'Add supporting notes and files.',
      'Use a matching Blueprint transition when one is available.',
    ],
    mandatory_input_status: 'Mapped with status and product rules',
    mandatory_inputs: ['At least one completed Order with a selected status', 'Kitchen or wardrobe selection when applicable', 'Conditional sales-manager notes', 'Conditional revision reason'],
    dependencies: ['Opportunity-to-order relationship', 'Order stage history', 'Order attachments and notes', 'Conditional Blueprint transition'],
    local_equivalent_feasibility: 'Partial',
    local_blockers: ['Conditional record and file writes are not yet implemented atomically.'],
  },
  'Closure Order Stage Update': {
    purpose: 'Manage order-stage transitions with closure, handover, checklist, and supporting-document safeguards.',
    context_modules: ['Contacts', 'Deals'],
    modules_read: ['Contacts', 'Deals', 'Attachments'],
    modules_written: ['Deals', 'Contacts', 'Attachments'],
    record_actions: [
      'Load related Orders and eligible Blueprint transitions.',
      'Render transition fields, sign-off checklists, and document controls.',
      'Apply the selected transition per Order after validation.',
      'Enforce cross-order handover rules and attach supporting files.',
    ],
    mandatory_input_status: 'Dynamic from Blueprint metadata',
    mandatory_inputs: ['Selected Order or Orders', 'Target transition', 'Every mandatory transition field', 'All required sign-off confirmations', 'All required supporting files'],
    dependencies: ['Deals Blueprint transition metadata', 'Cross-order stage state', 'Contact and Order attachment APIs'],
    local_equivalent_feasibility: 'Partial',
    local_blockers: ['Cross-order safeguards and dynamic attachment writes are not implemented locally.'],
  },
  'New Test Widget Order': {
    purpose: 'A later order-stage-manager variant with additional attachment diagnostics and connection-backed file handling.',
    context_modules: ['Contacts', 'Deals'],
    modules_read: ['Contacts', 'Deals', 'Attachments'],
    modules_written: ['Deals', 'Contacts', 'Attachments'],
    record_actions: [
      'Load related Orders, eligible transitions, and available Contact attachments.',
      'Render transition-specific fields, checklists, and file controls.',
      'Apply the selected Blueprint transition per validated Order.',
      'Copy or upload supporting files using the configured CRM connection path.',
    ],
    mandatory_input_status: 'Dynamic from Blueprint metadata',
    mandatory_inputs: ['Selected Order or Orders', 'Target transition', 'Every mandatory transition field', 'All required checklist confirmations', 'All required supporting files'],
    dependencies: ['Deals Blueprint transition metadata', 'Contact and Order attachment APIs', 'Configured CRM connection'],
    local_equivalent_feasibility: 'Low',
    local_blockers: ['The connection-backed attachment path is not configured locally.', 'Diagnostic-only controls must not be promoted as production behavior without approval.'],
  },
  'Handover to Post Design': {
    purpose: 'Move selected Orders through their eligible post-design handover transitions.',
    context_modules: ['Contacts', 'Deals'],
    modules_read: ['Contacts', 'Deals', 'Attachments'],
    modules_written: ['Deals', 'Contacts', 'Attachments'],
    record_actions: [
      'Load related Orders and each Order\'s eligible Blueprint transitions.',
      'Collect transition-specific fields, checklists, and files.',
      'Apply the selected post-design transition to each validated Order.',
      'Copy supporting Contact files to Orders when required.',
    ],
    mandatory_input_status: 'Dynamic from Blueprint metadata',
    mandatory_inputs: ['Selected Order or Orders', 'Eligible post-design transition', 'Every mandatory transition field', 'All required checklist confirmations and files'],
    dependencies: ['Deals Blueprint transition metadata', 'Contact and Order attachments', 'Per-record transition eligibility'],
    local_equivalent_feasibility: 'Partial',
    local_blockers: ['Dynamic transition and attachment persistence is not implemented locally.'],
  },
  'Deploy Team': {
    purpose: 'Schedule an installation visit and deploy a team against selected Orders for an opportunity.',
    context_modules: ['Contacts', 'Deals', 'Visit_Module', 'Service_A_X_Orders'],
    modules_read: ['Contacts', 'Deals', 'Users', 'Visit_Module'],
    modules_written: ['Visit_Module', 'Service_A_X_Orders'],
    record_actions: [
      'Load related Orders eligible for installation handover.',
      'Load installation-manager and team choices.',
      'Create the installation Visit record.',
      'Create the Visit-to-Order linking rows for selected Orders.',
    ],
    mandatory_input_status: 'Mapped',
    mandatory_inputs: ['At least one eligible Order', 'Installation manager', 'Visit date', 'Task', 'At least one team member'],
    dependencies: ['Authenticated CRM user mapping', 'Installation picklists and users', 'Visit-to-Order linking module'],
    local_equivalent_feasibility: 'Partial',
    local_blockers: ['User identity and team lookup mappings are not complete.', 'Atomic Visit and linking-row creation is not implemented locally.'],
  },
  'Handover To Post Team': {
    purpose: 'Complete post-team handover for selected Orders and create the corresponding AMS service record.',
    context_modules: ['Contacts', 'Deals', 'AMS_Complaints'],
    modules_read: ['Contacts', 'Deals', 'AMS_Complaints', 'Attachments'],
    modules_written: ['Deals', 'Contacts', 'AMS_Complaints', 'Attachments'],
    record_actions: [
      'Load related Orders and eligible Blueprint transitions.',
      'Collect transition-specific fields, checklists, handover data, and files.',
      'Apply each validated Order transition and write final-handover values.',
      'Create an AMS service record and carry forward approved files and service dates.',
    ],
    mandatory_input_status: 'Dynamic from Blueprint metadata plus handover rules',
    mandatory_inputs: ['Selected Order or Orders', 'Eligible handover transition', 'Every mandatory transition field', 'All required checklists and files', 'Required service and handover dates returned by the transition'],
    dependencies: ['Deals Blueprint transition metadata', 'AMS record schema', 'Contact and Order attachments', 'Owner and service-date mappings'],
    local_equivalent_feasibility: 'Low',
    local_blockers: ['Atomic Order transition, attachment copy, and AMS creation is not implemented locally.', 'Owner identity mapping is incomplete.'],
  },
  'Sunrooof Mark Closures': {
    purpose: 'Create cross-organization Sunrooof CRM records from selected opportunity Orders, product rows, commercial terms, addresses, advance payment, and files.',
    context_modules: ['Accounts', 'Contacts', 'Deals', 'Products', 'Product_Items', 'Payment_Milestones', 'Attachments'],
    modules_read: ['Contacts', 'Deals', 'Products', 'Product_Items'],
    modules_written: ['Accounts', 'Contacts', 'Deals', 'Product_Items', 'Payment_Milestones', 'Attachments'],
    record_actions: [
      'Load related Orders and Sunrooof product choices without a complete relationship guard.',
      'Collect item rows, prices, taxes, discounts, addresses, and advance-payment data.',
      'Create a cross-organization Account, Contact, Order, four payment milestones, and related product records.',
      'Create and share a WorkDrive folder, upload files, attach files, write cross-organization identifiers back, and trigger workflows.',
    ],
    mandatory_input_status: 'Mapped with commercial conditional rules',
    mandatory_inputs: [
      'At least one eligible Sunrooof Order',
      'At least one Order Item with a selected Sunrooof design',
      'Required billing and shipping address values',
      'Required commercial and tax values',
      'Accessory count and amount when management discount is entered',
      'Required advance-payment reference and date values when advance payment is entered',
    ],
    dependencies: ['Product catalog and item subform', 'Opportunity-to-order relationship', 'Payment milestones', 'Server-side authorized access to both CRM organizations and WorkDrive', 'Target-organization schemas, privacy consent, and approved commercial mappings', 'Bounded attachment upload and safe file handling'],
    local_equivalent_feasibility: 'Low',
    local_blockers: ['Embedded OAuth credentials must be revoked or rotated before any rebuild.', 'Cross-organization authorization, target schemas, privacy consent, and commercial formulas and mappings are not accepted.', 'Complete relationship pagination, idempotency, rollback, bounded file handling, safe rendering, redacted logging, and accessibility are not implemented.'],
  },
  'Assign Technician Widget': {
    purpose: 'Schedule an AMS visit and assign one or more technicians from an AMS or Complaint Blueprint transition.',
    context_modules: ['AMS_Complaints', 'Visit_Module'],
    modules_read: ['AMS_Complaints', 'Visit_Module'],
    modules_written: ['Visit_Module'],
    record_actions: [
      'Load address, record type, date, owner, and picklist context from the AMS record.',
      'Collect visit purpose, date, and team selection.',
      'Create the Visit record linked to the AMS record.',
      'Continue the invoking Blueprint after a successful Visit creation.',
    ],
    mandatory_input_status: 'Mapped',
    mandatory_inputs: ['Full address', 'Purpose of visit', 'At least one AMS team member', 'Visit date'],
    dependencies: ['AMS owner identity', 'Visit purpose and team picklists', 'AMS-to-Visit relationship', 'Blueprint continuation'],
    local_equivalent_feasibility: 'Partial',
    local_blockers: ['Owner identity and team mappings are incomplete.', 'Atomic Visit creation plus Blueprint continuation is not implemented locally.'],
  },
  'Closure New - Pinki': {
    purpose: 'Move selected opportunity Orders into closure after validating payment milestones and an estimated handover date.',
    context_modules: ['Contacts', 'Deals', 'Payment_Milestones'],
    modules_read: ['Contacts', 'Deals', 'Payment_Milestones'],
    modules_written: ['Deals', 'Payment_Milestones'],
    record_actions: [
      'Load related Orders and payment milestones.',
      'Select Orders eligible for closure.',
      'Validate Magppie and conditional Sunrooof payment allocation.',
      'Update closure payment values and apply the matching Order Blueprint transition.',
    ],
    mandatory_input_status: 'Mapped with payment conditional rules',
    mandatory_inputs: ['At least one eligible Order', 'Estimated handover date', 'Magppie milestone percentages totaling 100%', 'Per-milestone received amount, received date, discount, and reference values when applicable'],
    dependencies: ['Opportunity-to-order relationship', 'Payment milestone relationship', 'Deals Blueprint transitions'],
    local_equivalent_feasibility: 'Low',
    local_blockers: ['Atomic milestone updates and Order transitions are not implemented locally.'],
  },
  Complaint: {
    purpose: 'Provide a read-only AMS and Complaints dashboard with filtering, refresh, record navigation, and spreadsheet or PDF export.',
    context_modules: ['AMS_Complaints'],
    modules_read: ['AMS_Complaints'],
    modules_written: [],
    record_actions: ['Search and aggregate AMS or Complaint records.', 'Open the source record or module.', 'Export the current dashboard view to spreadsheet or PDF.'],
    mandatory_input_status: 'None for read-only use',
    mandatory_inputs: [],
    dependencies: ['Complete AMS and Complaint data', 'CRM record navigation', 'Client-side export libraries'],
    local_equivalent_feasibility: 'High',
    local_blockers: ['Live-data parity and export rendering must be reconciled before this replaces the source dashboard.'],
  },
};

function normalizeDisplayName(name) {
  return String(name || '').replace(/ Installed$/, '');
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || '').trim().slice(0, 240);
    throw new Error(`${command} failed${message ? `: ${message}` : ''}`);
  }
  return result.stdout;
}

function validateArchiveEntryNames(names) {
  if (!Array.isArray(names) || names.length === 0) throw new Error('Archive is empty.');
  if (names.length > MAX_ARCHIVE_ENTRIES) throw new Error('Archive exceeds the entry-count limit.');
  const seen = new Set();
  names.forEach(name => {
    if (!name || name.includes('\0') || name.includes('\\') || path.posix.isAbsolute(name) || name.split('/').includes('..')) {
      throw new Error('Archive contains an unsafe entry name.');
    }
    if (seen.has(name)) throw new Error('Archive contains a duplicate entry name.');
    seen.add(name);
  });
  return true;
}

function validateArchive(archivePath) {
  runCommand('unzip', ['-tqq', archivePath]);
  const names = runCommand('zipinfo', ['-Z1', archivePath]).split(/\r?\n/).filter(Boolean);
  validateArchiveEntryNames(names);
  const lines = runCommand('zipinfo', ['-l', archivePath]).split(/\r?\n/);
  let regularFiles = 0;
  let uncompressedBytes = 0;
  let containsSymlink = false;
  lines.forEach(line => {
    const columns = line.trim().split(/\s+/);
    if (!/^[dl-]/.test(columns[0] || '')) return;
    if (columns[0].startsWith('l')) containsSymlink = true;
    if (columns[0].startsWith('-')) regularFiles += 1;
    const size = Number(columns[3]);
    if (Number.isFinite(size) && size >= 0) uncompressedBytes += size;
  });
  if (containsSymlink) throw new Error('Archive contains a symbolic link.');
  if (uncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) throw new Error('Archive exceeds the uncompressed-size limit.');
  return { entries: names.length, regular_files: regularFiles, uncompressed_bytes: uncompressedBytes };
}

function externalBehavior(widget) {
  const contextModule = EXTERNAL_BUTTON_MODULES[widget.id];
  const picky = widget.sourceDisplayName === 'Picky-WhatsApp Extension';
  return {
    purpose: picky
      ? 'Provide an external outbound-messaging button in the associated CRM module.'
      : 'External-hosted behavior is not present in the downloaded Zoho package set.',
    context_modules: contextModule ? [contextModule] : [],
    modules_read: [],
    modules_written: [],
    record_actions: picky ? ['Open the external messaging extension from the source record.'] : [],
    mandatory_input_status: 'Unavailable from source package evidence',
    mandatory_inputs: [],
    dependencies: ['External hosting and configuration'],
    mapping_confidence: contextModule ? 'Partial' : 'Unavailable',
    local_equivalent_feasibility: 'Blocked',
    local_blockers: ['No source package was available because this widget is externally hosted.', 'External authorization and behavior must be specified separately before replication.'],
  };
}

function buildInventory() {
  const zohoWidgets = SOURCE_WIDGETS.filter(widget => widget.hosting === 'Zoho');
  const expectedArchives = zohoWidgets.map(widget => `${normalizeDisplayName(widget.sourceDisplayName)}.zip`).sort();
  const actualArchives = fs.readdirSync(PRIVATE_WIDGET_DIR).filter(name => name.endsWith('.zip')).sort();
  if (JSON.stringify(expectedArchives) !== JSON.stringify(actualArchives)) {
    throw new Error('Private package set does not reconcile to the 20 Zoho-hosted source rows.');
  }

  let regularFiles = 0;
  let uncompressedBytes = 0;
  let maxEntries = 0;
  let maxUncompressedBytes = 0;
  const validationByName = new Map();
  expectedArchives.forEach(archiveName => {
    const result = validateArchive(path.join(PRIVATE_WIDGET_DIR, archiveName));
    regularFiles += result.regular_files;
    uncompressedBytes += result.uncompressed_bytes;
    maxEntries = Math.max(maxEntries, result.entries);
    maxUncompressedBytes = Math.max(maxUncompressedBytes, result.uncompressed_bytes);
    validationByName.set(archiveName, result);
  });

  const widgets = SOURCE_WIDGETS.map(sourceWidget => {
    const name = normalizeDisplayName(sourceWidget.sourceDisplayName);
    const captured = sourceWidget.hosting === 'Zoho';
    const archiveName = `${name}.zip`;
    const behavior = captured ? INTERNAL_BEHAVIORS[name] : externalBehavior(sourceWidget);
    if (!behavior) throw new Error(`Missing sanitized behavior definition for ${name}.`);
    return {
      id: sourceWidget.id,
      name,
      source_display_name: sourceWidget.sourceDisplayName,
      hosting: sourceWidget.hosting,
      type: sourceWidget.type,
      package: captured
        ? {
            captured: true,
            match_basis: 'Exact source name after removing only the trailing Installed status suffix',
            archive_validation: 'Passed',
            static_analysis: 'Completed without executing widget code',
            entries: validationByName.get(archiveName).entries,
            regular_files: validationByName.get(archiveName).regular_files,
            uncompressed_bytes: validationByName.get(archiveName).uncompressed_bytes,
          }
        : {
            captured: false,
            match_basis: 'External-hosted source row',
            archive_validation: 'Not applicable',
            static_analysis: 'Blocked: no Zoho-hosted package exists in the captured set',
          },
      behavior: {
        ...behavior,
        mapping_confidence: behavior.mapping_confidence || 'High',
      },
      local_execution: {
        status: 'Blocked',
        enabled: false,
        fail_closed: true,
        reason: captured
          ? 'Static behavior is mapped, but source-backed dependencies and atomic write safeguards are not yet complete.'
          : 'External package behavior and authorization are unavailable.',
      },
    };
  });

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_mode: 'read-only',
    analysis_mode: 'Offline static package inspection; widget code was not executed and no network calls were made.',
    reconciliation: {
      source_widget_rows: widgets.length,
      zoho_hosted_widgets: widgets.filter(widget => widget.hosting === 'Zoho').length,
      external_hosted_widgets: widgets.filter(widget => widget.hosting === 'External').length,
      expected_zoho_packages: expectedArchives.length,
      captured_zoho_packages: widgets.filter(widget => widget.package.captured).length,
      validated_zoho_packages: widgets.filter(widget => widget.package.archive_validation === 'Passed').length,
      unmatched_zoho_packages: 0,
      external_packages_unavailable: widgets.filter(widget => widget.hosting === 'External').length,
      status: 'Reconciled',
    },
    archive_safety: {
      crc_test: 'Passed',
      path_traversal: 'None detected',
      absolute_paths: 'None detected',
      backslash_paths: 'None detected',
      symbolic_links: 'None detected',
      duplicate_entries: 'None detected',
      size_limits: 'Passed',
      regular_files: regularFiles,
      total_uncompressed_bytes: uncompressedBytes,
      maximum_entries_in_one_package: maxEntries,
      maximum_uncompressed_bytes_in_one_package: maxUncompressedBytes,
    },
    type_summary: Object.fromEntries([...new Set(widgets.map(widget => widget.type))]
      .sort()
      .map(type => [type, widgets.filter(widget => widget.type === type).length])),
    execution_boundary: {
      local_widget_execution_enabled: false,
      source_widget_execution_enabled: false,
      source_writes_enabled: false,
      outbound_delivery_enabled: false,
      status: 'Blocked',
      reason: 'The inventory is evidence for replication planning only; every widget remains fail-closed.',
    },
    privacy: {
      widget_code_exposed: false,
      external_targets_exposed: false,
      archive_hashes_exposed: false,
      local_paths_exposed: false,
      credentials_exposed: false,
      personally_identifiable_information_exposed: false,
    },
    widgets,
  };
}

function markdownList(values, empty = 'None') {
  return values.length ? values.join('; ') : empty;
}

function buildMarkdown(inventory) {
  const captured = inventory.widgets.filter(widget => widget.package.captured);
  const external = inventory.widgets.filter(widget => !widget.package.captured);
  const lines = [
    '# Zoho Widget Behavior Inventory',
    '',
    '> Source organization access remained read-only. The downloaded packages were inspected offline as static files; no widget code was executed, no network requests were made, and no source or local CRM writes occurred.',
    '',
    '## Executive status',
    '',
    '| Measure | Result |',
    '|---|---:|',
    `| Source widget rows | ${inventory.reconciliation.source_widget_rows} |`,
    `| Zoho-hosted widgets | ${inventory.reconciliation.zoho_hosted_widgets} |`,
    `| Zoho packages captured and validated | ${inventory.reconciliation.validated_zoho_packages}/${inventory.reconciliation.expected_zoho_packages} |`,
    `| External-hosted widgets without a package | ${inventory.reconciliation.external_packages_unavailable} |`,
    `| Local widget execution | ${inventory.execution_boundary.status} |`,
    '',
    'The 20 Zoho-hosted rows reconcile one-to-one to 20 downloaded packages. The remaining 20 rows are externally hosted configurations and therefore have no downloadable Zoho package in this evidence set. All 40 local execution paths remain fail-closed.',
    '',
    'Blueprint phase-detail coverage is 202/202 across all 7 Blueprints. Tasks is specified at 5/5 with all five transitions policy blocked; 5/202 transitions are policy eligible, zero are atomically runtime-ready, and 197 are policy blocked. This evidence does not enable any widget execution path.',
    '',
    '## Archive safety validation',
    '',
    `All ${inventory.reconciliation.validated_zoho_packages} archives passed CRC validation. The set contains ${inventory.archive_safety.regular_files} regular files and ${inventory.archive_safety.total_uncompressed_bytes.toLocaleString('en-US')} uncompressed bytes. No traversal entries, absolute paths, backslash paths, symbolic links, duplicate entries, or configured size-limit violations were detected.`,
    '',
    '## Exact source-to-package reconciliation',
    '',
    '| Widget ID | Normalized name | Hosting | Type | Package | Local execution |',
    '|---|---|---|---|---|---|',
    ...inventory.widgets.map(widget => `| ${widget.id} | ${widget.name} | ${widget.hosting} | ${widget.type} | ${widget.package.captured ? 'Captured and validated' : 'External; unavailable'} | Blocked |`),
    '',
    'Name normalization removes only the trailing source-UI status suffix `Installed`; all other source wording is preserved.',
    '',
    '## Zoho-hosted package behavior',
    '',
  ];

  captured.forEach(widget => {
    const behavior = widget.behavior;
    lines.push(
      `### ${widget.name} — ${widget.type}`,
      '',
      behavior.purpose,
      '',
      `- Context modules: ${markdownList(behavior.context_modules)}`,
      `- Reads: ${markdownList(behavior.modules_read)}`,
      `- Writes: ${markdownList(behavior.modules_written)}`,
      `- Record actions: ${markdownList(behavior.record_actions)}`,
      `- Mandatory-input status: ${behavior.mandatory_input_status}`,
      `- Mandatory inputs: ${markdownList(behavior.mandatory_inputs)}`,
      `- Dependencies: ${markdownList(behavior.dependencies)}`,
      `- Local-equivalent feasibility: ${behavior.local_equivalent_feasibility}`,
      `- Fail-closed blockers: ${markdownList(behavior.local_blockers)}`,
      '',
    );
  });

  lines.push(
    '## External-hosted widget boundary',
    '',
    '| Widget ID | Name | Type | Known context | Blocker |',
    '|---|---|---|---|---|',
    ...external.map(widget => `| ${widget.id} | ${widget.name} | ${widget.type} | ${markdownList(widget.behavior.context_modules, 'Not established')} | No Zoho-hosted package; external behavior and authorization unavailable |`),
    '',
    'The external rows are inventoried, but their runtime behavior, mandatory inputs, delivery semantics, and authorization cannot be asserted from the downloaded set. They must remain blocked until separately captured from an authorized source.',
    '',
    '## Execution and privacy boundary',
    '',
    '- Local widget execution is disabled.',
    '- Source widget execution and source writes are disabled.',
    '- Outbound delivery is disabled.',
    '- Widget source, external targets, archive hashes, local paths, credentials, and personally identifiable information are not included in this inventory.',
    '- A package marked “captured” means only that its archive was safely validated and its static behavior was mapped; it does not mean that the behavior is implemented or verified locally.',
    '',
  );
  return lines.join('\n');
}

function assertPublicArtifactSafe(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const forbidden = [
    /https?:\/\//i,
    /\bwww\./i,
    /\/(?:Users|home|var|tmp|opt|etc)\//i,
    /\.private\//i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(?:authorization|bearer|password|secret|token|credential)\s*[:=]\s*\S+/i,
    /\b[A-F0-9]{32,128}\b/i,
  ];
  if (forbidden.some(pattern => pattern.test(serialized))) {
    throw new Error('Generated widget inventory failed the public-artifact safety scan.');
  }
}

function main() {
  const inventory = buildInventory();
  const markdown = buildMarkdown(inventory);
  assertPublicArtifactSafe(inventory);
  assertPublicArtifactSafe(markdown);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o644 });
  fs.writeFileSync(DOCUMENT_PATH, `${markdown}\n`, { mode: 0o644 });
  process.stdout.write(`Widget inventory built: ${inventory.reconciliation.validated_zoho_packages}/${inventory.reconciliation.expected_zoho_packages} packages validated; ${inventory.reconciliation.source_widget_rows} source rows reconciled; local execution blocked.\n`);
}

if (require.main === module) main();

module.exports = {
  SOURCE_WIDGETS,
  buildInventory,
  buildMarkdown,
  normalizeDisplayName,
  validateArchiveEntryNames,
};
