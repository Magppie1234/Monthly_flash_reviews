(function attachFlashReview(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MagppieFlashReview = api;
})(typeof window !== 'undefined' ? window : null, function createFlashReviewModule() {
  'use strict';

  const STORAGE_KEY = 'magppie_monthly_flash_review_v1';
  const MONTHS = Object.freeze([['Jan','January'],['Feb','February'],['Mar','March'],['Apr','April'],['May','May'],['Jun','June'],['Jul','July'],['Aug','August'],['Sep','September'],['Oct','October'],['Nov','November'],['Dec','December']]);
  const SCORE = Object.freeze({ above: 3, meets: 2, below: 1 });
  const RATING_LABEL = Object.freeze({ above: 'Above Expectations', meets: 'Meets Expectations', below: 'Below Expectations', na: 'Not applicable' });
  const ASPECT_WEIGHTS = Object.freeze({ work: 55, behavioural: 15, foundational: 10, target: 20 });
  const work = (prefix, rows) => Object.freeze(rows.map(([kra,label], i) => Object.freeze({ id:`${prefix}_w${i+1}`, kra, label })));
  const items = (prefix, rows) => Object.freeze(rows.map((label, i) => Object.freeze({ id:`${prefix}_${i+1}`, label })));

  const sharedSalesFoundational = [
    'Attendance and punctuality: present and on time for work, reviews and client meetings; plans leave in advance and hands over before going',
    'Adherence to company policy and process: follows approvals, documentation and reporting laid down, without needing reminders',
    'Systems and data discipline: keeps CRM and official records complete, accurate and current, so reports can be trusted without rechecking',
    'Learning and self-development: takes ownership of building product, market and commercial knowledge, and visibly applies it',
    'Company values and conduct: represents the company with integrity and respect in front of colleagues, clients and vendors',
  ];
  const sharedFactoryFoundational = [
    'Attendance and punctuality: present and on time for shift, reviews and site visits; plans leave in advance and hands over before going',
    'Adherence to company policy and process: follows approvals, documentation and reporting laid down, without needing reminders',
    'Systems and data discipline: keeps trackers, logs and official records complete, accurate and current, so reports can be trusted without rechecking',
    'Safety, statutory and housekeeping discipline: follows and enforces safety, 5S and statutory requirements in own area every day',
    'Company values and conduct: represents the company with integrity and respect in front of colleagues, workers, vendors and customers',
  ];
  const ROLE_CONFIGS = Object.freeze({
    sales_manager: Object.freeze({
      id:'sales_manager', selectorLabel:'Sales Manager', designation:'Sales Manager', requiresMis:true,
      purpose:'Leads commercial performance through proposal discipline, conversion, margin protection, clean handovers and reliable pipeline governance.',
      workItems:work('sm',[
        ['kra1','Proposal TAT: % of proposals sent within 1–2 working days of complete inputs (target ≥ 90%, tracked weekly)'],
        ['kra1','Proposal-to-negotiation conversion rate (per target, reviewed monthly)'],
        ['kra2','Negotiation-to-booking conversion: bookings won against opportunities entering negotiation (per target, monthly)'],
        ['kra2','Unapproved discount incidents: discounts given outside approved authority (target: zero, monthly audit)'],
        ['kra2','Average gross margin % per booking vs the approved guardrail (at or above guardrail, monthly)'],
        ['kra3','Booking value vs target: ₹ Cr booked vs individual monthly target (100% of target, monthly)'],
        ['kra4','Scope-freeze compliance: % of bookings with a scope-freeze sheet completed before token (target 100%, monthly audit)'],
        ['kra4','Handover checklist compliance: accepted within 1 working day, no verbal-only handovers (target 100%, weekly)'],
        ['kra5','Team CRM hygiene rollup: % of team opportunities with a logged next action (target ≥ 95%, checked daily)'],
        ['kra5','Forecast accuracy: actual vs forecast bookings, and pipeline ageing by stage (within ±10% variance, weekly/monthly)'],
        ['kra5','Reactivation rate: nurture leads reactivated against total lost deals (per target, monthly)'],
        ['kra6','Arranges client commercial meetings with the AVP (minimum 10 per month)'],
      ]),
      behaviouralItems:items('sm_b',[
        'Ownership and accountability: owns the outcome end to end, flags risk early, needs no chasing on commitments',
        "Team leadership and coaching: reviews the team's live deals, gives specific direction, builds team capability",
        'Client handling and professionalism: prepared, responsive and composed with the client, including under commercial pressure',
        'Integrity and process discipline: stays inside approved authority, never bypasses an approval to close faster',
        'Collaboration and reporting: gives Design, Projects and Finance complete information on time, no surprises to the reporting manager',
      ]),
      foundationalItems:items('sm_f',[
        'Attendance and punctuality: present and on time for work, reviews and client meetings; plans leave and handovers in advance',
        'Adherence to company policy and process: follows approvals, documentation and reporting without reminders',
        'Systems and data discipline: keeps CRM and official records complete, accurate and current',
        'Learning and self-development: builds product, market and commercial knowledge and visibly applies it',
        'Company values and conduct: represents the company with integrity and respect',
      ]),
      kraWeights:Object.freeze({kra1:13,kra2:20,kra3:27,kra4:11,kra5:20,kra6:9}),
      kraLabels:Object.freeze({kra1:'Proposal turnaround and accuracy',kra2:'Negotiation and margin discipline',kra3:'Booking conversion against target',kra4:'Scope-freeze and clean-handover compliance',kra5:'Pipeline governance and forecasting',kra6:'Commercial meetings with AVP'}),
    }),
    designer: Object.freeze({
      id:'designer', selectorLabel:'Designer / Design Consultant', designation:'Design Consultant', requiresMis:false,
      sourceWorkbook:'Designer - Monthly Flash Review (1).xlsx', scoringMethod:'workbook-majority',
      purpose:'Translates the customer requirement brief into concept, then production-ready detailed design, validating site conditions and technical integration along the way. Owns pre- and post-order design work end-to-end, and coordinates closely with installation, factory, and sales teams to close all client deliverables on time.',
      workItems:work('dc',[
        ['kra1','Concept-stage design output. Special condition: if only pre-design work is assigned.'],
        ['kra1','Detailed-design stage output. Special condition: if only post-design work is assigned.'],
        ['kra2','% of concepts presented within agreed design TAT within 48 hours (during working days)'],
        ['kra2','% of post designs ready within specified target ( refer to Post Design TAT annexure attached for details)'],
        ['kra3','% of detailed designs with site validated before drawing release'],
        ['kra4','Average individual revisions per product post-design compared to team average'],
        ['kra4','Revision-stage output and estimate volume when revisions are required calculated at 25% of total square ft'],
        ['kra5','% of projects with a post-booking cost overrun traced to design/estimation error'],
        ['kra5','% of BOQs / specifications issued error-free (no site or factory rework)'],
        ['kra6','% of estimates delivered within 24 hours of complete inputs'],
        ['kra7','Design errors caught before production release vs. after'],
        ['kra8','% of projects with a post-production cost overrun traced to design error'],
        ['kra9','Response time to client queries; same-day status updates'],
        ['kra9','Morning plan and EOD update; weekly status update across all live projects'],
        ['kra9','% of all deliverables: designs and estimates: communicated on time and correctly'],
        ['kra10','Average client satisfaction rating'],
        ['kra10','Escalations/Complaints raised by the client'],
      ]),
      behaviouralItems:items('dc_b',[
        'Ownership and accountability: owns the design deliverable end to end, flags risk early, no follow-up needed',
        'Cross-functional coordination: works hand in hand with sales, factory and installation so nothing falls between teams',
        'Client handling and professionalism: prepared, responsive and composed with the client at every design touchpoint',
        'Integrity and process discipline: stays inside the approved brief and authority, never bypasses design or costing controls',
        'Collaboration and reporting: gives sales, projects and factory complete, accurate information the first time',
      ]),
      foundationalItems:items('dc_f',[
        'Attendance and punctuality: present and on time for work, reviews and client meetings',
        'Adherence to company policy and process: follows approvals, documentation and escalation paths',
        'Systems and data discipline: keeps drawings, BOQs and official records complete, accurate and current',
        'Learning and self-development: takes ownership of building product, material and design-tool knowledge',
        'Company values and conduct: represents the company with integrity and respect in every interaction',
      ]),
      kraWeights:Object.freeze({kra1:20,kra2:15,kra3:10,kra4:10,kra5:10,kra6:5,kra7:5,kra8:5,kra9:10,kra10:10}),
      kraLabels:Object.freeze({kra1:'Concept and detailed-design quality',kra2:'Design turnaround time',kra3:'Site validation accuracy',kra4:'Controlled, documented revisions',kra5:'BOQ and costing accuracy',kra6:'Estimate turnaround time',kra7:'Margin protection',kra8:'Production release accuracy',kra9:'Milestone communication',kra10:'Client satisfaction'}),
    }),
    asm: Object.freeze({
      id:'asm', selectorLabel:'Sales / ASM', designation:'Sales', requiresMis:true,
      purpose:'Runs structured discovery, visits clients, sites and architects to generate and close leads, coordinates with Design on concept delivery, manages walk-ins, and controls the revision cycle so scope stays contained.',
      workItems:work('asm',[
        ['kra1','CRB completion TAT: % of Customer Requirement Briefs completed within 2 working days'],['kra1','Walk-in to discovery-complete rate'],
        ['kra2','Concept TAT adherence: % of concepts presented within agreed design TAT'],['kra2','Feedback turnaround: % of consolidated feedback provided within 24–48 hrs'],
        ['kra3','Appointment adherence rate: appointments kept as scheduled / total scheduled'],['kra3','Feedback/CSAT capture-assist rate'],
        ['kra4','Revision count per opportunity: average revisions before preferred direction'],['kra5','Booking value vs target: ₹ Cr booked vs individual monthly target'],
        ['kra6','Order closure form accuracy: % with no rework required post-submission'],['kra6','CRM next-action compliance: % of open opportunities with logged next action & date'],
        ['kra6','Lost-reason logging compliance: % of lost deals with mandatory reason code'],['kra7','To arrange for client commercial meetings with the AVP per month'],
      ]),
      behaviouralItems:items('asm_b',[
        'Ownership and accountability: owns the outcome end to end, flags risk early, needs no chasing on commitments',
        'Client and architect engagement: prepared and responsive on visits, discovery meetings and walk-ins',
        'Client handling and professionalism: composed and credible with the client, including under commercial pressure',
        'Integrity and process discipline: stays inside approved authority, never bypasses an approval to close faster',
        'Collaboration and reporting: gives Design, Projects and Finance complete information on time, no surprises to the reporting manager',
      ]),
      foundationalItems:items('asm_f',sharedSalesFoundational),
      kraWeights:Object.freeze({kra1:15,kra2:10,kra3:20,kra4:10,kra5:25,kra6:15,kra7:5}),
      kraLabels:Object.freeze({kra1:'Discovery completeness (CRB quality)',kra2:'Design coordination turnaround',kra3:'Customer engagement and feedback capture',kra4:'Revision and scope-creep control',kra5:'Booking conversion against target',kra6:'Post-booking account discipline',kra7:'Commercial meetings with AVP'}),
    }),
    psm: Object.freeze({
      id:'psm', selectorLabel:'Pre-Sales Manager (PSM)', designation:'Pre-Sales Manager (PSM)', requiresMis:true,
      purpose:'Owns the top of funnel: converts raw enquiries into logged, contacted and qualified opportunities with clean CRM data before any design effort begins.',
      workItems:work('psm',[
        ['kra1','Lead logging TAT: % of enquiries logged with source, city and owner within 15 mins, maximum of 2 hours'],['kra1','Duplicate lead rate: duplicate records identified / total leads logged'],
        ['kra2','First response TAT: % of leads contacted within agreed window'],['kra2','Contact-attempt compliance: % with two-way interaction or documented attempts'],
        ['kra3','Qualification TAT: % qualified/nurture/disqualified same or next working day'],['kra3','Qualified value delivered: ₹ Cr moved to Qualified vs individual target'],
        ['kra4','Lead assignment TAT: unassigned-lead count beyond 2 hrs'],['kra4','Zero unlogged commitment: unlogged calls/WhatsApp commitments on audit'],
      ]),
      behaviouralItems:items('psm_b',[
        'Ownership and accountability: owns the enquiry from capture to handoff, flags risk early, needs no chasing on commitments',
        'Responsiveness and urgency: treats a new enquiry as time-critical and works the queue without being prompted',
        'Enquiry handling and professionalism: courteous, clear and consistent with every caller, including difficult ones',
        'Integrity and process discipline: logs what actually happened, never closes or reclassifies a lead to make the numbers look better',
        'Collaboration and reporting: gives Sales and Design complete, accurate lead context on time, no surprises to the reporting manager',
      ]),
      foundationalItems:items('psm_f',[
        'Attendance and punctuality: present and on time for work and reviews; plans leave in advance and hands over the lead queue before going',
        ...sharedSalesFoundational.slice(1,3),
        'Learning and self-development: takes ownership of building product, market and CRM knowledge, and visibly applies it',
        sharedSalesFoundational[4],
      ]),
      kraWeights:Object.freeze({kra1:30,kra2:25,kra3:30,kra4:15}),
      kraLabels:Object.freeze({kra1:'Lead capture and CRM logging discipline',kra2:'Response speed and contactability',kra3:'Qualification accuracy and turnaround',kra4:'Pipeline hygiene and handoff readiness'}),
    }),
    factory_head: Object.freeze({"id": "factory_head", "selectorLabel": "Factory Office", "designation": "Factory Office", "requiresMis": true, "combinedReview": true, "referenceSavings": 2086420, "purpose": "Monthly review of operational results, behaviour, foundational responsibilities and evidenced savings. Targets from FY 2025–26 are historical references; unresolved targets and incentive policies remain pending.", "defaultMisSources": ["Rework Time / Complaint Log", "Raw Material Usage vs BOM Report", "MTC & Audit Discrepancies Report", "Mandays Sheet Monitoring"], "workItems": [{"id": "factory_head_v2_w1", "kra": "kra1", "label": "Rework and rejection: COPQ", "referenceTarget": "20–25% reduction; measure hours and cost separately", "evidence": "Rework Time / Complaint Log"}, {"id": "factory_head_v2_w2", "kra": "kra2", "label": "Material wastage", "referenceTarget": "Pending confirmation: 12% → 8% wastage versus 3% cost reduction", "evidence": "Raw Material Usage vs BOM Report"}, {"id": "factory_head_v2_w3", "kra": "kra3", "label": "Repair and maintenance cost", "referenceTarget": "10–15% reduction", "evidence": "MTC & Audit Discrepancies Report"}, {"id": "factory_head_v2_w4", "kra": "kra4", "label": "Labour cost optimization", "referenceTarget": "5–7% reduction on comparable output", "evidence": "Mandays Sheet Monitoring"}], "behaviouralItems": [{"id": "factory_head_v2_b1", "label": "Ownership and accountability: owns outcomes and flags risks early"}, {"id": "factory_head_v2_b2", "label": "Cross-functional coordination: complete handovers without surprises"}, {"id": "factory_head_v2_b3", "label": "Team, vendor and contractor management: clear direction and capability development"}, {"id": "factory_head_v2_b4", "label": "Integrity: acts within approved authority"}, {"id": "factory_head_v2_b5", "label": "Reporting: provides complete, timely information"}], "foundationalItems": [{"id": "factory_head_v2_f1", "label": "Attendance, punctuality and planned handovers"}, {"id": "factory_head_v2_f2", "label": "Process compliance: follows approvals and documented processes"}, {"id": "factory_head_v2_f3", "label": "Data discipline: accurate, current records"}, {"id": "factory_head_v2_f4", "label": "Learning: applies learning and develops skills"}, {"id": "factory_head_v2_f5", "label": "Conduct: respect and company values"}], "kraWeights": {}, "kraLabels": {}}),
    purchase_head: Object.freeze({"id": "purchase_head", "selectorLabel": "Purchase Head", "designation": "Purchase Head", "requiresMis": true, "combinedReview": true, "referenceSavings": 4956000, "purpose": "Monthly review of operational results, behaviour, foundational responsibilities and evidenced savings. Targets from FY 2025–26 are historical references; unresolved targets and incentive policies remain pending.", "defaultMisSources": ["Monthly Savings Tracker vs Last Year Spend", "Vendor Development / Procurement Records"], "workItems": [{"id": "purchase_head_v2_w1", "kra": "kra1", "label": "MSPL procurement cost", "referenceTarget": "4–6% reduction; financial target pending (source formula uses 3%)", "evidence": "Monthly Savings Tracker vs Last Year Spend"}, {"id": "purchase_head_v2_w2", "kra": "kra2", "label": "MLPL procurement cost", "referenceTarget": "4–6% reduction", "evidence": "Vendor Development / Procurement Records"}], "behaviouralItems": [{"id": "purchase_head_v2_b1", "label": "Ownership and accountability: owns outcomes and flags risks early"}, {"id": "purchase_head_v2_b2", "label": "Cross-functional coordination: complete handovers without surprises"}, {"id": "purchase_head_v2_b3", "label": "Team, vendor and contractor management: clear direction and capability development"}, {"id": "purchase_head_v2_b4", "label": "Integrity: acts within approved authority"}, {"id": "purchase_head_v2_b5", "label": "Reporting: provides complete, timely information"}], "foundationalItems": [{"id": "purchase_head_v2_f1", "label": "Attendance, punctuality and planned handovers"}, {"id": "purchase_head_v2_f2", "label": "Process compliance: follows approvals and documented processes"}, {"id": "purchase_head_v2_f3", "label": "Data discipline: accurate, current records"}, {"id": "purchase_head_v2_f4", "label": "Learning: applies learning and develops skills"}, {"id": "purchase_head_v2_f5", "label": "Conduct: respect and company values"}], "kraWeights": {}, "kraLabels": {}}),
    logistics_head: Object.freeze({"id": "logistics_head", "selectorLabel": "Logistics Head", "designation": "Logistics Head", "requiresMis": true, "combinedReview": true, "referenceSavings": 672000, "purpose": "Monthly review of operational results, behaviour, foundational responsibilities and evidenced savings. Targets from FY 2025–26 are historical references; unresolved targets and incentive policies remain pending.", "defaultMisSources": ["Cost per km / per Delivery Report"], "workItems": [{"id": "logistics_head_v2_w1", "kra": "kra1", "label": "Freight cost per kitchen/unit: consolidate 2–3 MRPs in one truck per location and plan delivery routes", "referenceTarget": "8–10% reduction; source timeline Q4 (Jan–Mar), FY 2025–26", "evidence": "Cost per km / per Delivery Report"}], "behaviouralItems": [{"id": "logistics_head_v2_b1", "label": "Ownership and accountability: owns outcomes and flags risks early"}, {"id": "logistics_head_v2_b2", "label": "Cross-functional coordination: complete handovers without surprises"}, {"id": "logistics_head_v2_b3", "label": "Team, vendor and contractor management: clear direction and capability development"}, {"id": "logistics_head_v2_b4", "label": "Integrity: acts within approved authority"}, {"id": "logistics_head_v2_b5", "label": "Reporting: provides complete, timely information"}], "foundationalItems": [{"id": "logistics_head_v2_f1", "label": "Attendance, punctuality and planned handovers"}, {"id": "logistics_head_v2_f2", "label": "Process compliance: follows approvals and documented processes"}, {"id": "logistics_head_v2_f3", "label": "Data discipline: accurate, current records"}, {"id": "logistics_head_v2_f4", "label": "Learning: applies learning and develops skills"}, {"id": "logistics_head_v2_f5", "label": "Conduct: respect and company values"}], "kraWeights": {}, "kraLabels": {}}),
    installation_manager: Object.freeze({"id": "installation_manager", "selectorLabel": "Installation Manager", "designation": "Installation Manager", "requiresMis": true, "combinedReview": true, "referenceSavings": 1393000, "purpose": "Monthly review of operational results, behaviour, foundational responsibilities and evidenced savings. Targets from FY 2025–26 are historical references; unresolved targets and incentive policies remain pending.", "defaultMisSources": ["Start-to-Completion Time Log", "Loading/Unloading Sheet", "Number of Repeat Visits per Project", "Complaint Types & Frequency / Closure Time"], "workItems": [{"id": "installation_manager_v2_w1", "kra": "kra1", "label": "Installation time per kitchen", "referenceTarget": "8 → 6 days; 25% reduction", "evidence": "Start-to-Completion Time Log"}, {"id": "installation_manager_v2_w2", "kra": "kra2", "label": "Loading/unloading cost", "referenceTarget": "Pending confirmation: ₹1.5–2 lakh/month savings versus ₹50,000 calculation", "evidence": "Loading/Unloading Sheet"}, {"id": "installation_manager_v2_w3", "kra": "kra3", "label": "First Time Right", "referenceTarget": "Pending confirmation: ≥95% written target versus 60% initial target", "evidence": "Number of Repeat Visits per Project"}, {"id": "installation_manager_v2_w4", "kra": "kra4", "label": "Installation complaint reduction", "referenceTarget": "40% reduction against a comparable baseline", "evidence": "Complaint Types & Frequency / Closure Time"}], "behaviouralItems": [{"id": "installation_manager_v2_b1", "label": "Ownership and accountability: owns outcomes and flags risks early"}, {"id": "installation_manager_v2_b2", "label": "Cross-functional coordination: complete handovers without surprises"}, {"id": "installation_manager_v2_b3", "label": "Team, vendor and contractor management: clear direction and capability development"}, {"id": "installation_manager_v2_b4", "label": "Integrity: acts within approved authority"}, {"id": "installation_manager_v2_b5", "label": "Reporting: provides complete, timely information"}], "foundationalItems": [{"id": "installation_manager_v2_f1", "label": "Attendance, punctuality and planned handovers"}, {"id": "installation_manager_v2_f2", "label": "Process compliance: follows approvals and documented processes"}, {"id": "installation_manager_v2_f3", "label": "Data discipline: accurate, current records"}, {"id": "installation_manager_v2_f4", "label": "Learning: applies learning and develops skills"}, {"id": "installation_manager_v2_f5", "label": "Conduct: respect and company values"}], "kraWeights": {}, "kraLabels": {}}),
    customer_care_head: Object.freeze({"id": "customer_care_head", "selectorLabel": "Customer Care Head / AMS", "designation": "Customer Care Head / AMS", "requiresMis": true, "combinedReview": true, "referenceSavings": 1624000, "purpose": "Monthly review of operational results, behaviour, foundational responsibilities and evidenced savings. Targets from FY 2025–26 are historical references; unresolved targets and incentive policies remain pending.", "defaultMisSources": ["TAT Monitoring Sheet", "Route & Spares Optimisation Log", "Root Cause Tracking Log", "Customer Satisfaction Score Report"], "workItems": [{"id": "customer_care_head_v2_w1", "kra": "kra1", "label": "Average service turnaround time", "referenceTarget": "10 → 6 days; 40% reduction", "evidence": "TAT Monitoring Sheet"}, {"id": "customer_care_head_v2_w2", "kra": "kra2", "label": "Cost per service call", "referenceTarget": "20% reduction; total service cost divided by completed calls", "evidence": "Route & Spares Optimisation Log"}, {"id": "customer_care_head_v2_w3", "kra": "kra3", "label": "Warranty claim cost", "referenceTarget": "30% reduction", "evidence": "Root Cause Tracking Log"}, {"id": "customer_care_head_v2_w4", "kra": "kra4", "label": "Customer satisfaction: CSAT", "referenceTarget": "78% → 90%; record survey response count", "evidence": "Customer Satisfaction Score Report"}], "behaviouralItems": [{"id": "customer_care_head_v2_b1", "label": "Ownership and accountability: owns outcomes and flags risks early"}, {"id": "customer_care_head_v2_b2", "label": "Cross-functional coordination: complete handovers without surprises"}, {"id": "customer_care_head_v2_b3", "label": "Team, vendor and contractor management: clear direction and capability development"}, {"id": "customer_care_head_v2_b4", "label": "Integrity: acts within approved authority"}, {"id": "customer_care_head_v2_b5", "label": "Reporting: provides complete, timely information"}], "foundationalItems": [{"id": "customer_care_head_v2_f1", "label": "Attendance, punctuality and planned handovers"}, {"id": "customer_care_head_v2_f2", "label": "Process compliance: follows approvals and documented processes"}, {"id": "customer_care_head_v2_f3", "label": "Data discipline: accurate, current records"}, {"id": "customer_care_head_v2_f4", "label": "Learning: applies learning and develops skills"}, {"id": "customer_care_head_v2_f5", "label": "Conduct: respect and company values"}], "kraWeights": {}, "kraLabels": {}}),
    avp: Object.freeze({
      id:'avp',selectorLabel:'AVP',designation:'AVP',policyPending:true,requiresMis:false,
      purpose:'AVP employee assignments. Review criteria have not been configured.',
      workItems:Object.freeze([]),behaviouralItems:Object.freeze([]),foundationalItems:Object.freeze([]),
      kraWeights:Object.freeze({}),kraLabels:Object.freeze({}),
    }),
  });
  const ROLE_ORDER = Object.freeze(['avp','sales_manager','designer','asm','psm','factory_head','purchase_head','logistics_head','installation_manager','customer_care_head']);
  const roleConfig = id => ROLE_CONFIGS[id] || ROLE_CONFIGS.sales_manager;
  const allItems = c => [...c.workItems,...c.behaviouralItems,...c.foundationalItems];
  const KRA_WEIGHTS = ROLE_CONFIGS.sales_manager.kraWeights;
  const WORK_ITEMS = ROLE_CONFIGS.sales_manager.workItems;
  const BEHAVIOURAL_ITEMS = ROLE_CONFIGS.sales_manager.behaviouralItems;
  const FOUNDATIONAL_ITEMS = ROLE_CONFIGS.sales_manager.foundationalItems;

  function defaultState(roleId='sales_manager') {
    const c=roleConfig(roleId), year=new Date().getFullYear();
    return {version:2,roleId:c.id,setup:{employeeName:'',designation:c.designation,reportingManager:'',joiningDate:'',annualPeriod:'april-march',startYear:year,overrideFirstMonth:'',misSources:[...(c.defaultMisSources||[])]},reviews:{},updatedAt:null};
  }
  const defaultStore = () => ({version:3,activeRole:'sales_manager',activeEmployees:{},employeeReviews:{},roles:Object.fromEntries(ROLE_ORDER.map(id=>[id,defaultState(id)]))});
  const monthReview = () => ({discussionDate:'',hrPresent:false,ratings:{},mis:{},remarks:{},strengths:'',focus:'',actions:'',lastActions:'',overallAssessment:'',overallRemark:'',employeeSignoff:'',managerSignoff:'',target:'',achieved:'',targetUnit:'',correctiveAction:''});
  function normalizeState(value, roleId=value?.roleId||'sales_manager') {
    const c=roleConfig(roleId), base=defaultState(c.id), setup=value?.setup&&typeof value.setup==='object'?value.setup:{};
    if(!value||typeof value!=='object') return base;
    return {...base,...value,version:2,roleId:c.id,setup:{...base.setup,...setup,designation:c.designation,startYear:Number(setup.startYear)||base.setup.startYear,misSources:Array.isArray(setup.misSources)?setup.misSources.map(String).map(v=>v.trim()).filter(Boolean).slice(0,50):base.setup.misSources},reviews:value.reviews&&typeof value.reviews==='object'?value.reviews:{}};
  }
  function normalizeStore(value) {
    const base=defaultStore();
    if(!value||typeof value!=='object') return base;
    if(!value.roles||typeof value.roles!=='object'){base.roles.sales_manager=normalizeState(value,'sales_manager');return base;}
    ROLE_ORDER.forEach(id=>{base.roles[id]=normalizeState(value.roles[id],id);});
    // Keep old role-only reviews intact; never assign one to an employee by name.
    ROLE_ORDER.forEach(roleId=>{
      const entries=value.employeeReviews?.[roleId];
      base.employeeReviews[roleId]={};
      if(entries&&typeof entries==='object')Object.entries(entries).forEach(([id,data])=>{
        if(/^(?:\d+|local:[a-z0-9-]+)$/.test(id))base.employeeReviews[roleId][id]=normalizeState(data,roleId);
      });
      const id=value.activeEmployees?.[roleId];
      if(typeof id==='string'&&/^(?:\d+|local:[a-z0-9-]+)$/.test(id))base.activeEmployees[roleId]=id;
    });
    base.activeRole=ROLE_CONFIGS[value.activeRole]?value.activeRole:'sales_manager';
    return base;
  }
  const safeNumber = value => value===''||value==null?null:(Number.isFinite(Number(value))?Number(value):null);
  function monthSequence(setup) {
    const startMonth=setup.annualPeriod==='january-december'?0:3,startYear=Number(setup.startYear)||new Date().getFullYear();
    const cycleStart=new Date(Date.UTC(startYear,startMonth,1)),cycleEnd=new Date(Date.UTC(startYear,startMonth+12,0));
    let eligibleStart=cycleStart;
    const joining=/^\d{4}-\d{2}-\d{2}$/.test(setup.joiningDate||'')?new Date(`${setup.joiningDate}T00:00:00Z`):null;
    if(joining&&joining>eligibleStart) eligibleStart=new Date(Date.UTC(joining.getUTCFullYear(),joining.getUTCMonth(),1));
    if(/^\d{4}-\d{2}$/.test(setup.overrideFirstMonth||'')){const [y,m]=setup.overrideFirstMonth.split('-').map(Number);eligibleStart=new Date(Date.UTC(y,m-1,1));}
    if(eligibleStart<cycleStart) eligibleStart=cycleStart;
    return Array.from({length:12},(_,index)=>{const d=new Date(Date.UTC(startYear,startMonth+index,1)),m=MONTHS[d.getUTCMonth()];return{key:m[0],name:m[1],year:d.getUTCFullYear(),label:`${m[1]} ${d.getUTCFullYear()}`,inPeriod:d>=eligibleStart&&d<=cycleEnd,index};});
  }
  const average = values => {const n=values.filter(Number.isFinite);return n.length?n.reduce((s,v)=>s+v,0)/n.length:null;};
  const itemAverage = (review,list) => average(list.map(item=>SCORE[review?.ratings?.[item.id]]));
  // Annual Dashboard!B84:P95: modal marking; ties prefer Below, then Above.
  function majorityScore(review,list,points=SCORE) {
    const counts={above:0,meets:0,below:0};
    list.forEach(item=>{const value=review?.ratings?.[item.id];if(Object.hasOwn(counts,value))counts[value]++;});
    if(!Object.values(counts).some(Boolean))return null;
    return points[counts.below>=counts.above&&counts.below>=counts.meets?'below':counts.above>=counts.meets?'above':'meets'];
  }
  function designerScoring(setup={}) {
    const stored=setup.designerScoring||{};
    const clean=(defaults,value)=>Object.fromEntries(Object.entries(defaults).map(([key,fallback])=>[key,Number.isFinite(value?.[key])&&value[key]>=0?value[key]:fallback]));
    return {points:clean(SCORE,stored.points),kraWeights:clean(ROLE_CONFIGS.designer.kraWeights,stored.kraWeights),aspectWeights:clean(ASPECT_WEIGHTS,stored.aspectWeights)};
  }
  function monthlyScores(review, roleId='sales_manager',setup={}) {
    const c=roleConfig(roleId),kraScores={};
    if(c.combinedReview)return {work:null,behavioural:null,foundational:null,overall:SCORE[review?.overallAssessment]||null,kraScores};
    if(c.scoringMethod==='workbook-majority'){
      const {points}=designerScoring(setup);
      Object.keys(c.kraWeights).forEach(k=>{kraScores[k]=majorityScore(review,c.workItems.filter(i=>i.kra===k),points);});
      return {work:majorityScore(review,c.workItems,points),behavioural:majorityScore(review,c.behaviouralItems,points),foundational:majorityScore(review,c.foundationalItems,points),overall:points[review?.overallAssessment]??null,kraScores};
    }
    Object.keys(c.kraWeights).forEach(k=>{kraScores[k]=itemAverage(review,c.workItems.filter(i=>i.kra===k));});
    const weighted=Object.entries(c.kraWeights).filter(([k])=>Number.isFinite(kraScores[k]));
    const workScore=weighted.length?weighted.reduce((s,[k,w])=>s+kraScores[k]*w,0)/weighted.reduce((s,[,w])=>s+w,0):null;
    return{work:workScore,behavioural:itemAverage(review,c.behaviouralItems),foundational:itemAverage(review,c.foundationalItems),overall:SCORE[review?.overallAssessment]||null,kraScores};
  }
  function reviewCompleteness(review, roleId='sales_manager') {
    const c=roleConfig(roleId),list=allItems(c),ratings=list.filter(i=>SCORE[review?.ratings?.[i.id]]||review?.ratings?.[i.id]==='na').length;
    const missingRemarks=list.filter(i=>['above','below'].includes(review?.ratings?.[i.id])&&!String(review?.remarks?.[i.id]||'').trim()).length;
    const missingMis=0;
    return{ratings,total:list.length,missingRemarks,missingMis,complete:ratings===list.length&&!missingRemarks&&!missingMis&&Boolean(review?.overallAssessment)};
  }
  function annualRating(score){if(!Number.isFinite(score))return'Not enough data yet';if(score<1.6)return'Below Expectations: formal review with HR';if(score<2)return'Partially Meets: improvement plan required';if(score<2.4)return'Meets Expectations';if(score<2.75)return'Exceeds Expectations';return'Outstanding';}
  function calculateAnnual(data, roleId=data?.roleId||'sales_manager') {
    if(roleId==='designer')return calculateDesignerAnnual(data);
    const c=roleConfig(roleId),sequence=monthSequence(data.setup),eligible=sequence.filter(m=>m.inPeriod);
    const rows=eligible.map(m=>{const review=data.reviews[m.key]||monthReview(),scores=monthlyScores(review,c.id),target=safeNumber(review.target),achieved=safeNumber(review.achieved);return{...m,review,scores,completeness:reviewCompleteness(review,c.id),target,achieved,achievement:target!==null&&achieved!==null&&target!==0?achieved/target:null,targetStatus:target!==null&&achieved!==null?(achieved>=target?'Achieved':'Not Achieved'):'Not recorded'};});
    const completed=rows.filter(r=>r.scores.overall!==null),kraScores={};Object.keys(c.kraWeights).forEach(k=>{kraScores[k]=average(rows.map(r=>r.scores.kraScores[k]));});
    const weighted=Object.entries(c.kraWeights).filter(([k])=>Number.isFinite(kraScores[k])),workScore=weighted.length?weighted.reduce((s,[k,w])=>s+kraScores[k]*w,0)/weighted.reduce((s,[,w])=>s+w,0):null;
    const targeted=rows.filter(r=>r.targetStatus!=='Not recorded'),missedTargets=targeted.filter(r=>r.targetStatus==='Not Achieved').length,targetScore=targeted.length?(missedTargets<=1?3:missedTargets===2?2:1):null;
    const aspects={work:workScore,behavioural:average(rows.map(r=>r.scores.behavioural)),foundational:average(rows.map(r=>r.scores.foundational)),target:targetScore};
    const available=Object.entries(ASPECT_WEIGHTS).filter(([k])=>Number.isFinite(aspects[k])),annualScore=available.length===4?available.reduce((s,[k,w])=>s+aspects[k]*w,0)/100:null;
    const first=average(completed.slice(0,6).map(r=>r.scores.overall)),second=average(completed.slice(6).map(r=>r.scores.overall));
    const trend=first===null||second===null?'Not enough data yet':second>first+.05?'Improving':second<first-.05?'Declining':'Stable';
    let below=0,escalationCount=0,pipCount=0;rows.forEach(r=>{if(r.review.overallAssessment==='below'){below++;if(below===2)escalationCount++;if(below===3)pipCount++;}else if(r.review.overallAssessment)below=0;});
    return{sequence,eligible,rows,completed,kraScores,aspects,annualScore,annualRating:c.combinedReview?'Reviewer assessed · numerical weights pending':annualRating(annualScore),proRataFactor:eligible.length/12,proRataScore:Number.isFinite(annualScore)?annualScore*(eligible.length/12):null,trend,escalationCount:c.combinedReview?0:escalationCount,pipCount:c.combinedReview?0:pipCount,targeted:targeted.length,missedTargets,targetFlag:!targeted.length?'No targets recorded yet':missedTargets>2?'RED FLAG: recommend PIP and HR discussion':missedTargets===2?'Amber: two missed target months':'On track'};
  }

  function calculateDesignerAnnual(data) {
    const c=ROLE_CONFIGS.designer,scoring=designerScoring(data.setup),sequence=monthSequence(data.setup),eligible=sequence.filter(m=>m.inPeriod);
    const rows=eligible.map(m=>{
      const review=data.reviews[m.key]||monthReview(),target=safeNumber(review.target),achieved=safeNumber(review.achieved);
      const achievement=target!==null&&achieved!==null&&target!==0?achieved/target:null;
      return {...m,review,scores:monthlyScores(review,'designer',data.setup),completeness:reviewCompleteness(review,'designer'),target,achieved,achievement,
        targetStatus:target===null||achieved===null?'Not recorded':achievement!==null&&achievement>=1?'Achieved':'Not Achieved'};
    });
    const weighted=(values,weights)=>{const entries=Object.entries(weights).filter(([key,w])=>w>0&&Number.isFinite(values[key])&&values[key]>0);return entries.length?entries.reduce((s,[k,w])=>s+values[k]*w,0)/entries.reduce((s,[,w])=>s+w,0):null;};
    const kraScores=Object.fromEntries(Object.keys(c.kraWeights).map(k=>[k,average(rows.map(r=>r.scores.kraScores[k]))]));
    const targeted=rows.filter(r=>r.targetStatus!=='Not recorded'),missedTargets=targeted.filter(r=>r.targetStatus==='Not Achieved').length;
    const aspects={work:weighted(kraScores,scoring.kraWeights),behavioural:average(rows.map(r=>r.scores.behavioural)),foundational:average(rows.map(r=>r.scores.foundational)),target:targeted.length?(missedTargets>2?1:missedTargets===2?2:3):null};
    const annualScore=weighted(aspects,scoring.aspectWeights),half=Math.floor(rows.length/2),first=average(rows.slice(0,half).map(r=>r.scores.overall)),second=average(rows.slice(half).map(r=>r.scores.overall));
    const trend=rows.length<4||first===null||second===null?'Not enough data yet':second-first>=.15?'Improving':first-second>=.15?'Declining':'Stable';
    let below=0,escalationCount=0,pipCount=0;
    rows.forEach(row=>{below=row.review.overallAssessment==='below'?below+1:0;row.escalation=below>=3?'PIP: formal review required':below===2?'HR required at next review':'';if(below>=3)pipCount++;else if(below===2)escalationCount++;});
    const startMonth=data.setup.annualPeriod==='january-december'?0:3,year=Number(data.setup.startYear)||new Date().getFullYear(),start=Date.UTC(year,startMonth,1),end=Date.UTC(year,startMonth+12,1),joined=Date.parse(data.setup.joiningDate||'');
    const daysFactor=Number.isFinite(joined)?Math.max(0,Math.min(1,(end-Math.max(start,joined))/(end-start))):1;
    return {sequence,eligible,rows,completed:rows.filter(r=>r.scores.overall!==null),kraScores,aspects,annualScore,annualRating:annualRating(annualScore),trend,escalationCount,pipCount,targeted:targeted.length,missedTargets,
      targetFlag:!targeted.length?'No targets recorded yet':missedTargets>2?'RED FLAG: recommend PIP and HR discussion':missedTargets===2?'Amber: two missed target months':'On track',
      proRataFactor:eligible.length/12,proRataDaysFactor:daysFactor,proRataScore:annualScore===null?null:annualScore*eligible.length/12};
  }

  function node(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined&&text!==null)n.textContent=String(text);return n;}
  const fmtScore=v=>Number.isFinite(v)?v.toFixed(2):'-';
  const fmtPercent=v=>Number.isFinite(v)?`${Math.round(v*100)}%`:'-';
  let currentStore,currentRole='sales_manager',currentData,currentView='overview',selectedMonth='Jan',currentContainer,currentContext;
  function loadStore(){storageLoadError=false;try{return normalizeStore(JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'));}catch{storageLoadError=true;return defaultStore();}}
  let directory=null,directoryError='',directoryLoading=false,currentEmployee=null,storageLoadError=false;
  function persist(){
    if(storageLoadError)throw new Error('Stored review data could not be read');
    const previous=localStorage.getItem(STORAGE_KEY);
    if(previous&&!localStorage.getItem(STORAGE_KEY+'_before_employee_reviews')){
      localStorage.setItem(STORAGE_KEY+'_before_employee_reviews',previous);
    }
    localStorage.setItem(STORAGE_KEY,JSON.stringify(currentStore));
  }
  function reviewPolicyRole(){return currentEmployee?.policyRoleId||currentRole;}

  // Reviews also live in the server's database when one is configured. This browser's copy stays
  // the working copy: every save is sent on, and a newer copy saved elsewhere replaces it on load.
  const remote={enabled:false,revisions:{},timers:{},queue:{}};
  const remoteKey=(policy,id)=>`${policy}:${id}`;
  const setSaveState=text=>{const state=currentContainer?.querySelector('.flash-save-state');if(state)state.textContent=text;};
  function adoptRemote(doc){
    const entries=currentStore.employeeReviews[doc.policyRole]||(currentStore.employeeReviews[doc.policyRole]={});
    entries[doc.employeeId]=normalizeState(doc.state,doc.policyRole);remote.revisions[remoteKey(doc.policyRole,doc.employeeId)]=doc.revision;
  }
  async function pullReviews(){
    try{
      const response=await fetch('/api/flash-review/reviews',{cache:'no-store',signal:AbortSignal.timeout(15000)});
      const value=await response.json();remote.enabled=response.ok&&value.enabled===true;if(!remote.enabled)return;
      const stored=new Set();
      for(const doc of value.reviews){
        if(!ROLE_CONFIGS[doc.policyRole]||!doc.state)continue;
        const key=remoteKey(doc.policyRole,doc.employeeId);stored.add(key);remote.revisions[key]=doc.revision;
        const local=currentStore.employeeReviews[doc.policyRole]?.[doc.employeeId];
        if(!local?.updatedAt||String(doc.state.updatedAt||'')>=String(local.updatedAt))adoptRemote(doc);
        else pushReview(doc.policyRole,doc.employeeId);
      }
      // Reviews written in this browser before the database existed are sent up once.
      for(const [policy,entries] of Object.entries(currentStore.employeeReviews))for(const [id,state] of Object.entries(entries))if(state.updatedAt&&!stored.has(remoteKey(policy,id)))pushReview(policy,id);
      persist();
    }catch{remote.enabled=false;}
  }
  // Typing saves on every change; wait for a pause, and never send two saves of one review at once.
  function pushReview(policy,id,delay=0){
    if(!remote.enabled)return;const key=remoteKey(policy,id);clearTimeout(remote.timers[key]);
    remote.timers[key]=setTimeout(()=>{remote.queue[key]=(remote.queue[key]||Promise.resolve()).then(()=>sendReview(policy,id));},delay);
  }
  async function sendReview(policy,id){
    const key=remoteKey(policy,id),state=currentStore.employeeReviews[policy]?.[id];if(!state)return;
    const showing=currentEmployee?.id===id&&reviewPolicyRole()===policy;
    try{
      const response=await fetch(`/api/flash-review/reviews/${policy}/${encodeURIComponent(id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,revision:remote.revisions[key]||0}),signal:AbortSignal.timeout(15000)});
      const value=await response.json();
      if(response.ok){remote.revisions[key]=value.revision;if(showing)setSaveState('Saved to database');return;}
      if(response.status===409&&value.current){
        adoptRemote(value.current);try{persist();}catch{}
        if(showing){selectEmployeeData(id);renderCurrent();if(currentContext?.toast)currentContext.toast('Someone else saved this review first. Their version is now shown.');}
        return;
      }
      if(showing)setSaveState('Saved in this browser only');
    }catch{if(showing)setSaveState('Saved in this browser only');}
  }
  function peopleForRole(roleId){return directory?.roles?.[roleId]?.employees||[];}
  function selectEmployeeData(id){
    currentEmployee=peopleForRole(currentRole).find(person=>person.id===id)||null;
    if(!currentEmployee){currentData=defaultState(currentRole);return;}
    const policy=reviewPolicyRole();
    const entries=currentStore.employeeReviews[policy]||(currentStore.employeeReviews[policy]={});
    currentData=entries[currentEmployee.id]||(entries[currentEmployee.id]=defaultState(policy));
    currentData.setup.employeeName=currentEmployee.name;
    currentData.setup.employeeId=currentEmployee.id;
    currentData.setup.assignedRole=currentEmployee.assignedRole||roleConfig(currentRole).designation;
    currentData.setup.department=currentEmployee.department||'';
    const manager=currentEmployee.reportingManager;
    if(manager){
      const label=manager.type==='department'?`${manager.name} (department)`:manager.name;
      if(currentData.setup.reportingManager && currentData.setup.reportingManager!==label)currentData.setup.previousReportingManagers=Array.from(new Set([...(currentData.setup.previousReportingManagers||[]),currentData.setup.reportingManager]));
      currentData.setup.reportingManager=label;
    }
    currentStore.activeEmployees[currentRole]=currentEmployee.id;openedAs=JSON.stringify(currentData);
  }
  let openedAs='';
  const edited=()=>JSON.stringify(currentData)!==openedAs;
  function switchEmployee(id){
    if(currentEmployee&&edited()&&!save('Saved locally',true))return;
    selectEmployeeData(id);currentView='overview';
    try{persist();}catch{renderCurrent();showIssues(['Could not save the selection. Enable browser storage and keep this page open.']);return;}
    selectedMonth=(monthSequence(currentData.setup).find(m=>m.inPeriod)||{key:'Jan'}).key;
    renderCurrent();
  }
  async function loadDirectory(){
    directoryLoading=true;directoryError='';renderCurrent();
    try{
      const response=await fetch('/api/flash-review/people',{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Directory unavailable');
      const value=await response.json();
      if(value.orgId!=='60046349006'||!value.roles)throw new Error('Unverified directory');
      directory=value;await pullReviews();selectEmployeeData(currentStore.activeEmployees[currentRole]);
    }catch{directory=null;currentEmployee=null;directoryError='Could not load the employee list. Retry to select a verified employee.';}
    directoryLoading=false;renderCurrent();
  }
  function downloadReviewBackup(){
    const raw=storageLoadError?localStorage.getItem(STORAGE_KEY):JSON.stringify(currentStore,null,2);
    const url=URL.createObjectURL(new Blob([raw||'{}'],{type:'application/json'}));
    const a=node('a');a.href=url;a.download='magppie-flash-review-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function save(message='Saved locally',keepSubmission=false){
    if(!currentEmployee)return false;
    const previousUpdatedAt=currentData.updatedAt;
    const review=currentData.reviews[selectedMonth];
    if(!keepSubmission){
      if(currentView==='monthly'&&review)delete review.submittedAt;
      if(currentView==='setup')Object.values(currentData.reviews).forEach(r=>{delete r.submittedAt;});
    }
    currentData.updatedAt=new Date().toISOString();currentStore.activeRole=currentRole;currentStore.employeeReviews[reviewPolicyRole()][currentEmployee.id]=currentData;
    try{persist();}catch{currentData.updatedAt=previousUpdatedAt;showIssues(['Could not save in this browser. Free browser storage or enable site storage, then try again. Keep this page open to retain your entries.']);return false;}
    openedAs=JSON.stringify(currentData);setSaveState(remote.enabled?'Saving…':'Saved locally');pushReview(reviewPolicyRole(),currentEmployee.id,1200);
    if(currentContext?.toast)currentContext.toast(message);return true;
  }
  function setupIssues(setup){
    const issues=[];
    if(String(setup.startYear??'').trim()&&(!Number.isInteger(Number(setup.startYear))||Number(setup.startYear)<2020||Number(setup.startYear)>2100))issues.push('Enter a review start year between 2020 and 2100.');
    if(!monthSequence(setup).some(m=>m.inPeriod))issues.push('Choose a review period with at least one eligible month in Setup.');
    return issues;
  }
  function submissionIssues(data,monthKey){
    const issues=setupIssues(data.setup);
    if(roleConfig(data.roleId).policyPending)issues.push('AVP review policy is not configured.');
    if(!monthSequence(data.setup).some(m=>m.key===monthKey&&m.inPeriod))issues.push('Select an eligible review month.');
    return issues;
  }
  function showIssues(issues){
    currentContainer.querySelector('.flash-feedback')?.remove();
    const notice=node('div','flash-feedback');notice.setAttribute('role','alert');notice.tabIndex=-1;
    notice.appendChild(node('strong',null,'Please complete the following:'));const list=node('ul');issues.forEach(text=>list.appendChild(node('li',null,text)));notice.appendChild(list);
    currentContainer.querySelector('.flash-module-body').prepend(notice);notice.focus();notice.scrollIntoView?.({block:'start',behavior:'smooth'});
  }
  function goTo(view){currentView=view;renderCurrent();currentContainer.querySelector('.flash-module-body')?.scrollIntoView?.({block:'start'});}
  function actionButton(label,action,primary=false){
    const button=node('button',primary?'flash-action-primary':'flash-action-secondary',label);button.type='button';
    // Commit the focused field before navigating, including fields that rerender on change.
    button.onmousedown=e=>e.preventDefault();button.onclick=()=>{document.activeElement?.blur();action();};return button;
  }
  function actions(body,copy,buttons){const bar=node('section','flash-actions'),text=node('p',null,copy),controls=node('div','flash-action-buttons');buttons.forEach(b=>controls.appendChild(b));bar.append(text,controls);body.appendChild(bar);}
  function submitReview(){
    const issues=submissionIssues(currentData,selectedMonth,reviewPolicyRole());if(issues.length){showIssues(issues);return;}
    const review=currentData.reviews[selectedMonth] ||= monthReview(),previous=review.submittedAt;review.submittedAt=new Date().toISOString();
    if(save('Review submitted locally',true))goTo('report');else if(previous)review.submittedAt=previous;else delete review.submittedAt;
  }

  function field(label,value,onChange,options={}){
    const wrap=node('label','flash-field'),caption=node('span',null,label),input=options.type==='textarea'?node('textarea'):node(options.select?'select':'input');wrap.append(caption,input);
    if(options.select)options.select.forEach(([v,l])=>{const o=node('option',null,l);o.value=v;o.selected=v===value;input.appendChild(o);});else if(options.type!=='textarea')input.type=options.type||'text';
    if(!options.select)input.value=value??'';if(options.readOnly)input.readOnly=true;if(options.placeholder)input.placeholder=options.placeholder;if(options.min)input.min=options.min;if(options.max)input.max=options.max;
    input.addEventListener('change',()=>onChange(input.value));return wrap;
  }
  function rating(value,onChange,label){
    const g=node('div','flash-rating-control');g.setAttribute('role','group');g.setAttribute('aria-label',label);
    [['above','Above'],['meets','Meets'],['below','Below'],...(roleConfig(reviewPolicyRole()).combinedReview&&label!=='Overall monthly assessment'?[['na','N/A']]:[])].forEach(([k,l])=>{
      const b=node('button',`flash-rate ${value===k?`is-${k}`:''}`,l);b.type='button';b.dataset.rating=k;b.setAttribute('aria-pressed',value===k?'true':'false');
      b.onclick=()=>{value=value===k?'':k;g.querySelectorAll('button').forEach(button=>{const selected=button.dataset.rating===value;button.className=`flash-rate ${selected?`is-${value}`:''}`;button.setAttribute('aria-pressed',String(selected));});onChange(value);};if(k==='na'){const extra=node('details','flash-rating-extra');extra.append(node('summary',null,'Not applicable'),b);g.appendChild(extra);}else g.appendChild(b);
    });return g;
  }
  function refreshMonthly(){
    const review=currentData.reviews[selectedMonth]||monthReview(),comp=reviewCompleteness(review,reviewPolicyRole()),progress=currentContainer.querySelector('.flash-progress strong');
    if(progress)progress.textContent=`${comp.ratings}/${comp.total} responsibilities marked`;
    drawSideProgress();
    if(reviewPolicyRole()==='designer'){
      const guidance=currentContainer.querySelector('.flash-progress span');if(guidance)guidance.textContent=comp.missingRemarks?`${comp.missingRemarks} Above / Below ratings need remarks.`:'Use Above, Meets or Below; add remarks for Above and Below.';
      currentContainer.querySelectorAll('textarea[data-review-item]').forEach(ta=>{const missing=['above','below'].includes(review.ratings[ta.dataset.reviewItem])&&!ta.value.trim();ta.setAttribute('aria-invalid',String(missing));ta.style.borderColor=missing?'#b42318':'';const hint=ta.parentElement.querySelector('.flash-remark-hint');if(hint)hint.textContent=missing?'Remark required for Above or Below':'';});
    }
    const result=currentContainer.querySelector('.flash-target-result');
    if(result){const target=safeNumber(review.target),actual=safeNumber(review.achieved),pct=target!==null&&actual!==null&&target!==0?actual/target:null;
      result.className=`flash-target-result ${Number.isFinite(pct)?(pct>=1?'is-good':'is-danger'):''}`;
      result.querySelector('strong').textContent=fmtPercent(pct);result.querySelector('small').textContent=Number.isFinite(pct)?(pct>=1?'Target achieved':'Target not achieved'):'Enter target and actual';
    }
  }
  function refreshSetupPeriod(){
    const eligible=monthSequence(currentData.setup).filter(m=>m.inPeriod),period=currentContainer.querySelector('.flash-period-summary');
    if(period){period.querySelector('strong').textContent=eligible.length?`${eligible[0].label} to ${eligible.at(-1).label}`:'No eligible months';period.querySelector('span').textContent=`${eligible.length} of 12 months · pro-rata factor ${(eligible.length/12).toFixed(2)}`;}
  }
  function header(title,copy){const h=node('div','flash-section-head'),t=node('div');t.append(node('h2',null,title),node('p',null,copy));h.appendChild(t);return h;}

  function renderOverview(body){
    const c=roleConfig(reviewPolicyRole()),annual=calculateAnnual(currentData,reviewPolicyRole()),hero=node('section','flash-hero'),copy=node('div');
    copy.append(node('span','flash-eyebrow',`${c.selectorLabel} performance`),node('h1',null,currentData.setup.employeeName||'Monthly Flash Review'),node('p',null,c.purpose));
    if(c.sourceWorkbook)copy.appendChild(node('p','flash-note',`Template: ${c.sourceWorkbook} · 17 work KPIs, 5 behavioural and 5 foundational criteria. Review by the 5th of the following month.`));
    const open=node('button','flash-primary','Open current month');open.type='button';open.onclick=()=>{currentView='monthly';selectedMonth=MONTHS[new Date().getMonth()][0];renderCurrent();};hero.append(copy,open);body.appendChild(hero);
    const metrics=node('section','flash-metrics');[
      ['Eligible months',`${annual.eligible.length}/12`,'Joining month through period end'],['Months assessed',`${annual.completed.length}/${annual.eligible.length}`,'Overall assessment recorded; includes drafts'],
      ['Annual score',fmtScore(annual.annualScore),c.combinedReview?'Numerical weights pending approval':'Weighted score from recorded ratings'],['Annual rating',annual.annualRating,c.id==='designer'?'Calculated from available aspects; blank aspects excluded':'Calculated when all four aspects have data'],
    ].forEach(([l,v,n])=>{const card=node('article','flash-metric');card.append(node('span',null,l),node('strong',null,v),node('small',null,n));metrics.appendChild(card);});body.appendChild(metrics);
    const alerts=node('section','flash-alert-grid'),esc=node('article',`flash-callout ${annual.pipCount?'is-danger':annual.escalationCount?'is-warning':'is-good'}`),target=node('article',`flash-callout ${annual.missedTargets>2?'is-danger':annual.missedTargets===2?'is-warning':'is-good'}`);
    esc.append(node('span',null,'Escalation / PIP'),node('strong',null,annual.pipCount?`${annual.pipCount} PIP trigger${annual.pipCount===1?'':'s'}`:annual.escalationCount?`${annual.escalationCount} HR escalation${annual.escalationCount===1?'':'s'}`:'No consecutive-Below trigger'),node('p',null,'Two consecutive Below months trigger HR attendance; three trigger a formal PIP.'));
    target.append(node('span',null,'Target flag'),node('strong',null,annual.targetFlag),node('p',null,`${annual.targeted} month${annual.targeted===1?'':'s'} with targets · ${annual.missedTargets} missed.`));if(!c.combinedReview){alerts.append(esc,target);body.appendChild(alerts);}else body.appendChild(header('Policy status','Overall assessments are reviewer-selected. Incentive and HR escalation rules remain proposals; no automatic payout or HR action.'));
    const panel=node('section','flash-panel'),grid=node('div','flash-month-grid');panel.appendChild(header('Review period','Open any applicable month to complete or continue its review.'));
    annual.sequence.forEach(m=>{const comp=reviewCompleteness(currentData.reviews[m.key]||monthReview(),reviewPolicyRole()),b=node('button',`flash-month-card ${m.inPeriod?'':'is-disabled'} ${comp.complete?'is-complete':''}`);b.type='button';b.disabled=!m.inPeriod;b.append(node('span',null,m.label),node('strong',null,m.inPeriod?(currentData.reviews[m.key]?.submittedAt?'Submitted':comp.complete?'Ready to submit':`${comp.ratings}/${comp.total} marked`):'Not applicable'));b.onclick=()=>{selectedMonth=m.key;currentView='monthly';renderCurrent();};grid.appendChild(b);});panel.appendChild(grid);body.appendChild(panel);
  }

  function renderSetup(body){
    const c=roleConfig(reviewPolicyRole()),s=currentData.setup,panel=node('section','flash-panel'),grid=node('div','flash-form-grid');panel.appendChild(header(`${c.selectorLabel} review setup`,'Enter employee and review-cycle details once. Monthly reviews and the annual summary follow automatically.'));
    const update=(k,v,refreshPeriod=false)=>{s[k]=v;save();if(refreshPeriod)refreshSetupPeriod();};
    grid.append(field('Employee name',s.employeeName,()=>{},{readOnly:true}),field('Designation',c.designation,()=>{},{readOnly:true}),field('Reporting manager',s.reportingManager,v=>update('reportingManager',v),{readOnly:!!currentEmployee?.reportingManager}),field('Date of joining',s.joiningDate,v=>update('joiningDate',v,true),{type:'date'}),field('Annual review period',s.annualPeriod,v=>update('annualPeriod',v,true),{select:[['april-march','April to March'],['january-december','January to December']]}),field('Review period starts in year',s.startYear,v=>update('startYear',Number(v),true),{type:'number',min:'2020',max:'2100'}),field('Override first review month (optional)',s.overrideFirstMonth,v=>update('overrideFirstMonth',v,true),{type:'month'}));panel.appendChild(grid);
    const sequence=monthSequence(s),eligible=sequence.filter(m=>m.inPeriod),period=node('div','flash-period-summary');period.append(node('strong',null,eligible.length?`${eligible[0].label} to ${eligible.at(-1).label}`:'No eligible months'),node('span',null,`${eligible.length} of 12 months · pro-rata factor ${(eligible.length/12).toFixed(2)}`));panel.appendChild(period);
    panel.appendChild(node('p','flash-note flash-note-standalone',c.id==='designer'?'Above and Below ratings need a remark stating the fact, a specific example, impact and evidence source. Drafts can be saved with gaps.':'Remarks are optional; add examples and evidence whenever useful. You can submit with blank fields.'));
    body.appendChild(panel);
    actions(body,`Changes save automatically ${remote.enabled?'to the review database':'in this browser'}. Continue to enter the monthly assessment.`,[
      actionButton('View Annual Summary',()=>goTo('annual')),
      actionButton('Save Setup & Continue',()=>{const issues=setupIssues(currentData.setup);if(issues.length){showIssues(issues);return;}if(save('Setup saved',true)){const months=monthSequence(currentData.setup),now=new Date();selectedMonth=(months.find(m=>m.inPeriod&&m.key===MONTHS[now.getMonth()][0]&&m.year===now.getFullYear())||months.find(m=>m.inPeriod)).key;goTo('monthly');}},true)
    ]);
  }

  function assessment(title,copy,list,review){
    const c=roleConfig(reviewPolicyRole()),section=node('section','flash-panel flash-assessment'),wrap=node('div','flash-table-scroll'),table=node('table','flash-review-table without-mis'),thead=node('thead'),hr=node('tr'),tbody=node('tbody');section.appendChild(header(title,copy));
    ['Responsibility','Assessment','Remarks'].forEach(x=>hr.appendChild(node('th',null,x)));thead.appendChild(hr);
    list.forEach(item=>{const tr=node('tr'),heading=node('th'),cut=/^[^.:]+: /.exec(item.label),name=cut?cut[0].slice(0,-2):item.label,measure=cut?[item.label.slice(cut[0].length)]:[];if(c.kraLabels?.[item.kra])heading.appendChild(node('span','flash-kra',`${c.kraLabels[item.kra]} · ${c.kraWeights[item.kra]}%`));heading.appendChild(node('strong',null,name));if(measure.length)heading.appendChild(node('p','flash-measure',measure[0]));if(item.referenceTarget)heading.appendChild(node('p',null,`Reference: ${item.referenceTarget}`));tr.appendChild(heading);const rc=node('td');rc.appendChild(rating(review.ratings[item.id]||'',v=>{review.ratings[item.id]=v;save();refreshMonthly();},`${item.label} assessment`));tr.appendChild(rc);
      if(c.combinedReview&&list===c.workItems){
        review.measurements ||= {};const values=review.measurements[item.id] ||= {},cell=node('details','flash-measurement-details');cell.appendChild(node('summary',null,'Measurements'));
        [['Baseline','baseline'],['Agreed target','target'],['Actual result','actual'],['Unit','unit']].forEach(([label,key])=>{const control=field(label,values[key],v=>{values[key]=v;save();});control.querySelector('input').setAttribute('aria-label',`${item.label}: ${label}`);cell.appendChild(control);});
        heading.appendChild(cell);
      }
      const td=node('td'),ta=node('textarea');ta.value=review.remarks[item.id]||'';ta.placeholder=c.id==='designer'?'Fact, example, impact and evidence source':'Specific example and impact';ta.setAttribute('aria-label',`${item.label} remarks`);ta.dataset.reviewItem=item.id;ta.onchange=()=>{review.remarks[item.id]=ta.value;save();refreshMonthly();};
      if(c.id==='designer'){const missing=['above','below'].includes(review.ratings[item.id])&&!ta.value.trim();ta.setAttribute('aria-invalid',String(missing));ta.style.borderColor=missing?'#b42318':'';const hint=node('small','flash-remark-hint',missing?'Remark required for Above or Below':'');td.append(ta,hint);}else td.appendChild(ta);tr.appendChild(td);tbody.appendChild(tr);});
    if(window.MagppieFlashMis?.supported(c.id)){
      table.classList.add('with-mis-results');hr.appendChild(node('th',null,'MIS results'));
      Array.from(tbody.rows).forEach((row,index)=>{const result=node('td','flash-mis-result');result.dataset.misItem=list[index].id;row.appendChild(result);});
    }
    table.append(thead,tbody);wrap.appendChild(table);section.appendChild(wrap);return section;
  }


  function savingsResult(review){
    const data=review.savings||{},target=safeNumber(data.target),actual=safeNumber(data.actual);
    return data.verified&&target!==null&&target>0&&actual!==null&&actual>=0?actual/target:null;
  }
  function renderSavings(body,review,readOnly){
    const c=roleConfig(reviewPolicyRole()),panel=node('section','flash-panel'),grid=node('div','flash-form-grid');review.savings ||= {};const values=review.savings;
    panel.appendChild(header('Section E: Savings and incentives',`FY 2025–26 reference target: ₹${c.referenceSavings.toLocaleString('en-IN')}. Historical seven-month calculation; current period and targets require confirmation.`));
    [['Savings period / as-of date','period','text'],['Approved period savings target (₹)','target','number'],['Verified cumulative savings (₹)','actual','number'],['Savings evidence / verification reference','evidence','textarea']].forEach(([label,key,type])=>grid.appendChild(field(label,values[key],v=>{values[key]=v;save();update();},{type,readOnly})));
    const label=node('label','flash-check'),check=node('input');check.type='checkbox';check.checked=!!values.verified;check.disabled=readOnly;check.onchange=()=>{values.verified=check.checked;save();update();};label.append(check,node('span',null,'Savings verified against comparable costs and approved period'));grid.appendChild(label);panel.appendChild(grid);
    const result=node('p');const update=()=>{const pct=savingsResult(review);result.textContent=`Savings achievement: ${pct===null?'Pending assessment':fmtPercent(pct)} · Incentive multiplier / payout: Pending policy approval`;};update();panel.appendChild(result);
    const proposal=node('details');proposal.appendChild(node('summary',null,'Proposed policy: not active'));proposal.appendChild(node('p',null,'Below 60%: 0×; 60% to below 85%: 0.5×; 85% to below 100%: 1×; 100%+: 1.5×. Below Expectations override: 0×. Rating, payout base and eligibility require approval. Two consecutive Below months: proposed HR review; three: proposed PIP. No automatic action.'));panel.appendChild(proposal);
    if(c.id==='factory_head')panel.appendChild(node('p',null,'Factory department historical reference: ₹77,14,420 = Factory Office ₹20,86,420 + Purchase ₹49,56,000 + Logistics ₹6,72,000. This subtotal is not extra personal savings.'));
    body.appendChild(panel);
  }
  function renderLegacy(body,review,c){
    const current=new Set(allItems(c).map(i=>i.id));const old=Array.from(new Set([...Object.keys(review.ratings||{}),...Object.keys(review.mis||{}),...Object.keys(review.remarks||{})])).filter(id=>!current.has(id));
    if(!old.length)return;const details=node('details','flash-panel');details.appendChild(node('summary',null,'Preserved previous-framework entries'));
    old.forEach(id=>details.appendChild(node('p',null,`${id}: ${RATING_LABEL[review.ratings[id]]||'Not assessed'} · ${review.mis?.[id]||''} · ${review.remarks?.[id]||''}`)));body.appendChild(details);
  }

  function renderAvpEvidence(body){
    const section=node('section','flash-panel'),label=node('label','flash-field'),input=node('input');input.type='month';input.value=new Date().toLocaleDateString('en-CA').slice(0,7);label.append(node('span',null,'Evidence month'),input);section.appendChild(label);body.appendChild(section);
    const surface=node('div');body.appendChild(surface);
    const draw=()=>{surface.replaceChildren();const host=node('div'),table=node('table','flash-review-table with-mis-results'),tr=node('tr'),cell=node('td','flash-mis-result');cell.dataset.misItem='avp_context_meetings';tr.append(node('th',null,'Scheduled meetings · activity context'),cell);table.appendChild(tr);surface.append(host,table);window.MagppieFlashMis?.mount({host,body:surface,readOnly:true,context:{role:'avp',policy:'avp',employeeId:currentEmployee.id,month:input.value},getReview:()=>({}),commit:()=>false});};input.onchange=draw;draw();
  }

  function renderMonthly(body){
    const c=roleConfig(reviewPolicyRole()),sequence=monthSequence(currentData.setup);if(!sequence.some(m=>m.inPeriod)){const empty=node('section','flash-panel');empty.appendChild(header('No eligible review months','Update the review period or first review month in Setup.'));body.appendChild(empty);actions(body,'Choose an eligible review period to begin.',[actionButton('Open Setup',()=>goTo('setup'),true)]);return;}if(!sequence.some(m=>m.key===selectedMonth&&m.inPeriod))selectedMonth=(sequence.find(m=>m.inPeriod)||sequence[0]).key;const month=sequence.find(m=>m.key===selectedMonth),review=currentData.reviews[selectedMonth]={...monthReview(),...(currentData.reviews[selectedMonth]||{})};review.ratings={...(review.ratings||{})};review.mis={...(review.mis||{})};review.remarks={...(review.remarks||{})};const comp=reviewCompleteness(review,reviewPolicyRole());
    const toolbar=node('section','flash-month-toolbar'),monthSelect=node('select');sequence.forEach(m=>{const o=node('option',null,`${m.label}${m.inPeriod?'':' · not applicable'}`);o.value=m.key;o.selected=m.key===selectedMonth;o.disabled=!m.inPeriod;monthSelect.appendChild(o);});monthSelect.onchange=()=>{selectedMonth=monthSelect.value;renderCurrent();};const progress=node('div','flash-progress');progress.append(node('strong',null,`${comp.ratings}/${comp.total} responsibilities marked`),node('span',null,'All review fields are optional. Submit whenever you are ready.'));toolbar.append(monthSelect,progress,actionButton('Submit & View Report',submitReview,true));body.appendChild(toolbar);
    const top=node('section','flash-panel'),topGrid=node('div','flash-form-grid');top.appendChild(header(`${month.label} · ${c.selectorLabel}`,'Review by the 5th of the following month. Ratings, remarks and sign-offs are optional.'));topGrid.append(field('Employee name',currentData.setup.employeeName||'Not entered (optional)',()=>{},{readOnly:true}),field('Reporting manager',currentData.setup.reportingManager||'Not entered (optional)',()=>{},{readOnly:true}),field('Date of discussion',review.discussionDate,v=>{review.discussionDate=v;save();},{type:'date'}));const hr=node('label','flash-check'),cb=node('input');cb.type='checkbox';cb.checked=Boolean(review.hrPresent);cb.onchange=()=>{review.hrPresent=cb.checked;save();};hr.append(cb,node('span',null,'HR present for this review'));topGrid.appendChild(hr);top.appendChild(topGrid);body.appendChild(top);
    if(c.id==='designer'){
      progress.querySelector('span').textContent=comp.missingRemarks?`${comp.missingRemarks} Above / Below ratings need remarks.`:'Use Above, Meets or Below; add remarks for Above and Below.';
      top.querySelector('.flash-section-head p').textContent='Designer workbook: review by the 5th of the following month. Above and Below ratings need a fact, example, impact and evidence source in Remarks.';
    }
    body.append(assessment('Section A: Work',`${c.workItems.length} responsibilities from the approved ${c.designation} KRA and KPI framework.`,c.workItems,review),assessment('Section B: Behavioural',`How the ${c.selectorLabel} role is carried out.`,c.behaviouralItems,review),assessment('Section C: Foundational','Baseline expectations for every employee.',c.foundationalItems,review));
    const closing=node('section','flash-panel flash-closing'),form=node('div','flash-form-grid');closing.appendChild(header('Section D: Closing','Capture the conversation, next steps and agreed monthly result.'));[['Key strengths this month','strengths'],['Focus areas for next month','focus'],['Agreed actions: what, who, by when','actions'],["Status of last month's actions",'lastActions'],['Overall remark','overallRemark'],['Employee sign-off','employeeSignoff'],['Reporting manager sign-off','managerSignoff']].forEach(([l,k])=>form.appendChild(field(l,review[k],v=>{review[k]=v;save();},{type:k.includes('Signoff')?'text':'textarea'})));const overall=node('div','flash-field flash-field-wide');overall.append(node('span',null,'Overall assessment for the month'),rating(review.overallAssessment,v=>{review.overallAssessment=v;save();refreshMonthly();},'Overall monthly assessment'));form.appendChild(overall);closing.appendChild(form);body.appendChild(closing);
    if(c.combinedReview){renderSavings(body,review,false);renderLegacy(body,review,c);}else {const target=node('section','flash-panel'),tg=node('div','flash-target-grid');target.appendChild(header('Target vs Achievement','Agree the target at the start of the month and record the actual at review.'));tg.append(field('Monthly target',review.target,v=>{review.target=v;save();refreshMonthly();},{type:'number'}),field('Unit',review.targetUnit,v=>{review.targetUnit=v;save();},{placeholder:'₹ Cr, count, %…'}),field('Actual achieved',review.achieved,v=>{review.achieved=v;save();refreshMonthly();},{type:'number'}),field('Reason / corrective action',review.correctiveAction,v=>{review.correctiveAction=v;save();},{type:'textarea'}));const t=safeNumber(review.target),a=safeNumber(review.achieved),pct=t!==null&&a!==null&&t!==0?a/t:null,res=node('div',`flash-target-result ${Number.isFinite(pct)?(pct>=1?'is-good':'is-danger'):''}`);res.append(node('span',null,'Achievement'),node('strong',null,fmtPercent(pct)),node('small',null,Number.isFinite(pct)?(pct>=1?'Target achieved':'Target not achieved'):'Enter target and actual'));tg.appendChild(res);target.appendChild(tg);body.appendChild(target);}
    if(currentEmployee&&window.MagppieFlashMis?.supported(c.id)){
      const host=node('div');body.insertBefore(host,body.querySelector('.flash-assessment'));
      window.MagppieFlashMis.mount({host,body,context:{role:currentRole,policy:c.id,employeeId:currentEmployee.id,month:`${month.year}-${String(MONTHS.findIndex(m=>m[0]===month.key)+1).padStart(2,'0')}`}});
    }
    actions(body,`${remote.enabled?'Saved to the review database':'Saved only in this browser'}. Submit to generate the report. Editing returns a submitted review to draft; nothing is sent to CRM or HR.`,[
      actionButton('Save Draft',()=>{save('Draft saved');}),
      actionButton('View Report',()=>goTo('report')),
      actionButton('Submit & View Report',submitReview,true)
    ]);
  }

  function renderReport(body){
    const c=roleConfig(reviewPolicyRole()),month=monthSequence(currentData.setup).find(m=>m.key===selectedMonth),review=currentData.reviews[selectedMonth]||monthReview(),scores=monthlyScores(review,reviewPolicyRole(),currentData.setup),issues=submissionIssues(currentData,selectedMonth,reviewPolicyRole());
    const submitted=Boolean(review.submittedAt)&&!issues.length;
    const panel=node('section','flash-panel');panel.appendChild(header(`${month.label} · Monthly Review Report`,`${currentData.setup.employeeName||'Employee not entered'} · ${c.designation} · ${submitted?'Submitted locally':'Draft: not submitted'}`));
    const details=node('div','flash-result-grid');[['Reporting manager',currentData.setup.reportingManager||'Not entered'],['Discussion date',review.discussionDate||'Not entered'],['Overall assessment',RATING_LABEL[review.overallAssessment]||'Not assessed'],['Submission',submitted?new Date(review.submittedAt).toLocaleString('en-IN'):'Not submitted']].forEach(([label,value])=>{const item=node('div');item.append(node('span',null,label),node('strong',null,value));details.appendChild(item);});panel.appendChild(details);body.appendChild(panel);
    if(!submitted){const notice=node('section','flash-callout is-warning');notice.append(node('strong',null,'Draft report'),node('p',null,issues.length?issues.join(' '):'You can submit this report with any fields left blank.'));body.appendChild(notice);}
    const metrics=node('div','flash-metrics');[['Work',scores.work],['Behavioural',scores.behavioural],['Foundational',scores.foundational],['Overall',scores.overall]].forEach(([label,value])=>{const card=node('article','flash-metric');card.append(node('span',null,label),node('strong',null,fmtScore(value)),node('small',null,'Score from entered ratings · out of 3.00'));metrics.appendChild(card);});if(!c.combinedReview)body.appendChild(metrics);
    [['Section A: Work',c.workItems],['Section B: Behavioural',c.behaviouralItems],['Section C: Foundational',c.foundationalItems]].forEach(([title,items])=>{
      const section=node('section','flash-panel'),wrap=node('div','flash-table-scroll'),table=node('table','flash-report-table'),thead=node('thead'),head=node('tr'),tbody=node('tbody');section.appendChild(header(title,'Recorded assessment and remarks.'));
      ['Responsibility','Assessment','Remarks'].forEach(label=>head.appendChild(node('th',null,label)));thead.appendChild(head);
      items.forEach(item=>{const row=node('tr');row.append(node('th',null,item.label),node('td',null,RATING_LABEL[review.ratings?.[item.id]]||'Not assessed'));row.appendChild(node('td',null,[review.remarks?.[item.id]||'-',...(c.combinedReview&&item.referenceTarget?[`Reference: ${item.referenceTarget}`,['baseline','target','actual','unit'].map(key=>`${key}: ${review.measurements?.[item.id]?.[key]||'Not recorded'}`).join(' · ')]:[])].join(' · ')));tbody.appendChild(row);});table.append(thead,tbody);wrap.appendChild(table);section.appendChild(wrap);body.appendChild(section);
    });
    const closing=node('section','flash-panel'),grid=node('div','flash-form-grid');closing.appendChild(header('Discussion and target result','Notes, sign-offs and target figures entered for this month.'));
    [['Key strengths','strengths'],['Focus areas','focus'],['Agreed actions','actions'],["Last month’s actions",'lastActions'],['Overall remark','overallRemark'],['Employee sign-off','employeeSignoff'],['Manager sign-off','managerSignoff'],['Monthly target','target'],['Actual achieved','achieved'],['Unit','targetUnit'],['Reason / corrective action','correctiveAction']].forEach(([label,key])=>{const item=node('div','flash-report-detail');item.append(node('strong',null,label),node('p',null,String(review[key]??'').trim()||'Not recorded'));grid.appendChild(item);});
    const target=safeNumber(review.target),actual=safeNumber(review.achieved);
    const achievement=node('div','flash-report-detail');achievement.append(node('strong',null,'Target achievement'),node('p',null,target!==null&&actual!==null?`${target!==0?fmtPercent(actual/target)+' · ':''}${actual>=target?'Target achieved':'Target not achieved'}`:'Not recorded'));grid.appendChild(achievement);
    const hr=node('div','flash-report-detail');hr.append(node('strong',null,'HR attendance'),node('p',null,review.hrPresent?'Marked present':'Not marked present'));grid.appendChild(hr);closing.appendChild(grid);body.appendChild(closing);
    if(c.combinedReview){renderSavings(body,review,true);renderLegacy(body,review,c);}
    actions(body,'This report is stored in this browser. The annual summary includes saved draft assessments.',[
      actionButton('Edit Review',()=>goTo('monthly')),actionButton('View Annual Summary',()=>goTo('annual')),
      ...(!submitted?[actionButton('Submit & View Report',submitReview,true)]:[])
    ]);
  }

  function annualTable(body,annual){const c=roleConfig(reviewPolicyRole()),panel=node('section','flash-panel'),wrap=node('div','flash-table-scroll'),table=node('table','flash-summary-table'),thead=node('thead'),trh=node('tr'),tbody=node('tbody');panel.appendChild(header('Month by month',`Work, Behavioural, Foundational, overall assessment, review completion and target result.`));['Month','Work','Behavioural','Foundational','Overall','Evidence','Target','Status'].forEach(x=>trh.appendChild(node('th',null,x)));thead.appendChild(trh);annual.rows.forEach(r=>{const tr=node('tr');tr.append(node('th',null,r.label),node('td',null,fmtScore(r.scores.work)),node('td',null,fmtScore(r.scores.behavioural)),node('td',null,fmtScore(r.scores.foundational)),node('td',null,RATING_LABEL[r.review.overallAssessment]||'-'),node('td',null,r.completeness.complete?'Complete':`${r.completeness.ratings}/${r.completeness.total}`),node('td',null,r.target!==null&&r.achieved!==null?`${r.achieved}/${r.target} ${r.review.targetUnit||''}`.trim():'-'),node('td',r.targetStatus==='Not Achieved'?'is-danger-text':'',r.targetStatus));tbody.appendChild(tr);});table.append(thead,tbody);wrap.appendChild(table);panel.appendChild(wrap);body.appendChild(panel);}
  function renderAnnual(body){
    if(roleConfig(reviewPolicyRole()).combinedReview){
      const annual=calculateAnnual(currentData,reviewPolicyRole());body.appendChild(header('Annual review history','Overall assessments are selected by the reviewer. Numerical weights, incentive payouts and escalation rules remain pending.'));
      annual.rows.forEach(row=>{const panel=node('section','flash-panel');panel.appendChild(header(row.label,RATING_LABEL[row.review.overallAssessment]||'Not assessed'));panel.appendChild(node('p',null,row.review.overallRemark||'No overall remarks recorded.'));body.appendChild(panel);});
      body.appendChild(node('p',null,'Cumulative savings snapshots are not summed across months. The latest verified snapshot must be assessed against its approved period target.'));return;
    }
    const c=roleConfig(reviewPolicyRole()),annual=calculateAnnual(currentData,reviewPolicyRole()),hero=node('section','flash-annual-hero');hero.append(node('span','flash-eyebrow',`${c.selectorLabel} annual result`),node('h1',null,annual.annualRating),node('p',null,`${annual.completed.length} of ${annual.eligible.length} eligible months assessed (including drafts) · trend: ${annual.trend}`));const ring=node('div','flash-score-ring');ring.append(node('strong',null,fmtScore(annual.annualScore)),node('span',null,'Annual score'));hero.appendChild(ring);body.appendChild(hero);annualTable(body,annual);
    if(c.id==='designer'){renderDesignerAnnual(body,annual);return;}
    const panel=node('section','flash-panel'),aspects=node('div','flash-aspect-grid');panel.appendChild(header('Aspect weightages','The workbook’s provisional 55 / 15 / 10 / 20 split is preserved.'));[['Work','work'],['Behavioural','behavioural'],['Foundational','foundational'],['Target vs Achievement','target']].forEach(([l,k])=>{const card=node('article');card.append(node('span',null,l),node('strong',null,fmtScore(annual.aspects[k])),node('small',null,`${ASPECT_WEIGHTS[k]}% weight`));aspects.appendChild(card);});panel.appendChild(aspects);const kras=node('div','flash-kra-list');Object.entries(c.kraLabels).forEach(([k,l],i)=>{const row=node('div');row.append(node('span',null,`KRA ${i+1} · ${l}`),node('strong',null,fmtScore(annual.kraScores[k])),node('small',null,`${c.kraWeights[k]}% of Work`));kras.appendChild(row);});panel.appendChild(kras);body.appendChild(panel);
    const result=node('section','flash-panel'),grid=node('div','flash-result-grid');result.appendChild(header('Annual result and flags','Scores use available entries. Unrecorded values remain blank.'));[['Review period',annual.eligible.length?`${annual.eligible[0].label} to ${annual.eligible.at(-1).label}`:'No eligible months'],['Pro-rata factor',annual.proRataFactor.toFixed(2)],['Pro-rated score',fmtScore(annual.proRataScore)],['Trend',annual.trend],['Escalations',annual.escalationCount],['PIP triggers',annual.pipCount],['Target flag',annual.targetFlag]].forEach(([l,v])=>{const x=node('div');x.append(node('span',null,l),node('strong',null,v));grid.appendChild(x);});result.appendChild(grid);body.appendChild(result);
  }

  function renderDesignerAnnual(body,annual){
    const c=ROLE_CONFIGS.designer,scoring=designerScoring(currentData.setup),panel=node('section','flash-panel');
    panel.appendChild(header('Designer workbook scoring','Monthly KRA and section ratings use the most frequent marking. Ties prefer Below, then Above. Annual results average the eligible months and weight the available aspects.'));
    const controls=node('details');controls.appendChild(node('summary',null,'Edit points and provisional weights'));
    const grid=node('div','flash-form-grid');
    const add=(group,key,label)=>grid.appendChild(field(label,scoring[group][key],value=>{
      const number=safeNumber(value);if(number===null||number<0){showIssues(['Enter a non-negative number.']);return;}
      currentData.setup.designerScoring={...scoring,[group]:{...scoring[group],[key]:number}};
      if(save('Designer scoring saved',true))renderCurrent();
    },{type:'number',min:'0'}));
    Object.keys(SCORE).forEach(key=>add('points',key,`${RATING_LABEL[key]} points`));
    Object.entries(c.kraLabels).forEach(([key,label])=>add('kraWeights',key,`${label} weight (%)`));
    Object.entries({work:'Work',behavioural:'Behavioural',foundational:'Foundational',target:'Target vs Achievement'}).forEach(([key,label])=>add('aspectWeights',key,`${label} aspect weight (%)`));
    controls.appendChild(grid);panel.appendChild(controls);
    const kraTotal=Object.values(scoring.kraWeights).reduce((s,v)=>s+v,0),aspectTotal=Object.values(scoring.aspectWeights).reduce((s,v)=>s+v,0);
    panel.appendChild(node('p',kraTotal!==100||aspectTotal!==100?'is-danger-text':'flash-note',`KRA weights: ${kraTotal}% · Aspect weights: ${aspectTotal}% · Both should total 100%. Weights remain provisional pending management approval.`));
    const results=node('div','flash-kra-list');Object.entries(c.kraLabels).forEach(([key,label])=>{const row=node('div');row.append(node('span',null,label),node('strong',null,fmtScore(annual.kraScores[key])),node('small',null,`${scoring.kraWeights[key]}% of Work`));results.appendChild(row);});panel.appendChild(results);body.appendChild(panel);
    const summary=node('section','flash-panel'),values=node('div','flash-result-grid');summary.appendChild(header('Annual result and pro-ration','Only eligible months and recorded ratings contribute. The annual rating is not pro-rated.'));
    [['Work',fmtScore(annual.aspects.work)],['Behavioural',fmtScore(annual.aspects.behavioural)],['Foundational',fmtScore(annual.aspects.foundational)],['Target vs Achievement',fmtScore(annual.aspects.target)],['Months factor',annual.proRataFactor.toFixed(2)],['Days factor',annual.proRataDaysFactor.toFixed(2)],['Pro-rated score',fmtScore(annual.proRataScore)],['Trend',annual.trend],['HR escalation flags',annual.escalationCount],['PIP flags',annual.pipCount],['Target flag',annual.targetFlag]].forEach(([label,value])=>{const item=node('div');item.append(node('span',null,label),node('strong',null,value));values.appendChild(item);});summary.appendChild(values);body.appendChild(summary);
    const digest=node('section','flash-panel');digest.appendChild(header('Remarks digest','Key strengths, focus areas and overall remarks from each eligible month.'));
    annual.rows.forEach(row=>{if(!row.review.strengths&&!row.review.focus&&!row.review.overallRemark&&!row.escalation)return;const item=node('article');item.append(node('h3',null,row.label));[['Strengths',row.review.strengths],['Focus areas',row.review.focus],['Overall remark',row.review.overallRemark],['Escalation / PIP',row.escalation]].forEach(([label,value])=>{if(value)item.appendChild(node('p',null,`${label}: ${value}`));});digest.appendChild(item);});body.appendChild(digest);
  }

  function switchRole(id){
    if(!ROLE_CONFIGS[id])return;
    if(currentEmployee&&edited()&&!save('Saved locally',true))return;
    currentRole=id;currentStore.activeRole=id;selectEmployeeData(currentStore.activeEmployees[id]);
    selectedMonth=(monthSequence(currentData.setup).find(m=>m.inPeriod)||{key:'Jan'}).key;
    currentView='overview';renderCurrent();
  }
  function renderUnassignedTemplate(body,c){
    const intro=node('section','flash-panel');
    intro.appendChild(header(`${c.selectorLabel} review template`,'Preview of the monthly review. No employee is assigned; no review entries are saved.'));
    body.appendChild(intro);
    // Reuse the actual review form so assigned and unassigned workbooks share Sales styling.
    renderMonthly(body);
    body.querySelectorAll('.flash-actions,.flash-month-toolbar .flash-action-primary').forEach(element=>element.remove());
    body.querySelectorAll('input,textarea,select,button').forEach(control=>{
      if(control.tagName==='INPUT'||control.tagName==='TEXTAREA')control.readOnly=true;
      if(control.tagName==='SELECT'||control.tagName==='BUTTON'||control.type==='checkbox')control.disabled=true;
    });
    const progress=body.querySelector('.flash-progress span');
    if(progress)progress.textContent='Template preview · employee assignment pending';
  }

  const VIEW_TITLES={overview:'Overview',setup:'Setup',monthly:'Monthly review',report:'Report',annual:'Annual summary'};
  const reviewOpen=()=>Boolean(currentEmployee)&&!storageLoadError&&!roleConfig(reviewPolicyRole()).policyPending;
  // The dark panel on the left: who is being reviewed, the five pages, and progress for the month.
  function sidePanel(c,tabs){
    const side=node('aside','flash-side'),logo=node('button','flash-side-logo'),who=node('div','flash-side-who');logo.type='button';logo.title='Back to the start page';logo.onclick=goHome;
    logo.append(node('i',null,'M'),node('span',null,'Magppie Flash Review'));
    if(currentEmployee){
      const text=node('div');text.append(node('b',null,currentEmployee.name),node('span',null,[currentEmployee.assignedRole||c.selectorLabel,currentData.setup.reportingManager?`reports to ${currentData.setup.reportingManager}`:''].filter(Boolean).join(' · ')));
      who.append(node('div','flash-side-avatar',currentEmployee.name.trim().charAt(0).toUpperCase()),text);
    }else who.appendChild(node('span',null,'Choose a workbook and an employee to begin.'));
    tabs.setAttribute('aria-label','Review pages');
    if(currentView==='monthly'&&reviewOpen()){
      const sections=node('div','flash-side-sections');
      ['Work','Behavioural','Foundational','Closing'].forEach((label,index)=>{
        const jump=node('button',null,label);jump.type='button';jump.dataset.section=String(index);jump.appendChild(node('em'));
        jump.onclick=()=>currentContainer.querySelectorAll('.flash-assessment, .flash-closing')[index]?.scrollIntoView({behavior:'smooth',block:'start'});sections.appendChild(jump);
      });
      tabs.insertBefore(sections,tabs.children[3]||null);
    }
    side.append(logo,who,tabs);
    if(reviewOpen()){const card=node('div','flash-side-progress');card.append(node('span'),node('strong'),node('div','flash-side-track'));card.lastChild.appendChild(node('i'));side.appendChild(card);}
    return side;
  }
  function drawSideProgress(){
    const card=currentContainer?.querySelector('.flash-side-progress');if(!card||!reviewOpen())return;
    const c=roleConfig(reviewPolicyRole()),review=currentData.reviews[selectedMonth]||monthReview(),comp=reviewCompleteness(review,reviewPolicyRole());
    const month=monthSequence(currentData.setup).find(m=>m.key===selectedMonth);
    card.querySelector('span').textContent=`${month?.label||selectedMonth} review`;card.querySelector('strong').textContent=`${comp.ratings} of ${comp.total} marked`;
    card.querySelector('i').style.width=`${comp.total?Math.round(100*comp.ratings/comp.total):0}%`;
    const rated=list=>list.filter(item=>SCORE[review.ratings?.[item.id]]||review.ratings?.[item.id]==='na').length;
    [c.workItems,c.behaviouralItems,c.foundationalItems].forEach((list,index)=>{const count=currentContainer.querySelector(`.flash-side-sections [data-section="${index}"] em`);if(count)count.textContent=`${rated(list)} / ${list.length}`;});
  }
  // The landing page: where a reviewer arrives after signing in, and where the logo returns to.
  // The page re-renders once or twice just after loading (employee list, saved reviews). The
  // entrance is timed from arrival, so a re-render carries on from where it was, not from the start.
  const HOME_ENTRANCE_MS=1700;let homeArrivedAt=0;
  function goHome(){currentView='home';homePick=null;homeArrivedAt=Date.now();renderCurrent();}
  // Start a review: choose the designation, then the person. null = the landing page itself.
  let homePick=null,arriving=false;
  function pickStep(next){homePick=next;renderCurrent();currentContainer.querySelector('.flash-home')?.scrollTo?.({top:0,behavior:'smooth'});}
  // Reviews are held by the 5th of the following month, so the month to open is the one just ended.
  function monthToReview(){
    const now=new Date(),previous=MONTHS[(now.getMonth()+11)%12][0],months=monthSequence(currentData.setup).filter(m=>m.inPeriod);
    return (months.find(m=>m.key===previous)||months[0]||{key:'Jan'}).key;
  }
  function beginReview(roleId,personId){
    currentRole=roleId;currentStore.activeRole=roleId;selectEmployeeData(personId);selectedMonth=monthToReview();
    currentView='overview';homePick=null;arriving=true;
    try{persist();}catch{}renderCurrent();
  }
  function renderPicker(){
    const panel=node('div','flash-pick'),head=node('div','flash-pick-head'),list=node('div','flash-pick-list'),role=homePick.role;
    const back=node('button','flash-pick-back',role?'Change designation':'Back');back.type='button';back.onclick=()=>pickStep(role?{}:null);
    const trail=node('div','flash-pick-trail');trail.append(node('span',role?'is-done':'is-on','Designation'),node('i'),node('span',role?'is-on':'','Employee'));
    head.append(back,trail);
    const title=node('h1',null,role?'Who are you reviewing?':'Which designation?');
    const copy=node('p',null,role?`${ROLE_CONFIGS[role].selectorLabel} · choose the person to open their review.`:'Choose the role first; each has its own responsibilities and scoring.');
    const option=(label,detail,action,index)=>{const b=node('button','flash-pick-option');b.type='button';b.style.setProperty('--i',String(index));b.append(node('b',null,label),node('span',null,detail));b.onclick=action;return b;};
    if(!role)ROLE_ORDER.forEach((id,index)=>{const count=peopleForRole(id).length;list.appendChild(option(ROLE_CONFIGS[id].selectorLabel,`${count} ${count===1?'person':'people'}`,()=>pickStep({role:id}),index));});
    else{
      const people=peopleForRole(role);
      people.forEach((person,index)=>list.appendChild(option(person.name,[person.department,person.reportingManager?`reports to ${person.reportingManager.name}`:''].filter(Boolean).join(' · ')||ROLE_CONFIGS[role].selectorLabel,()=>beginReview(role,person.id),index)));
      if(!people.length)list.appendChild(node('p','flash-pick-empty','No one is assigned to this designation yet.'));
    }
    panel.append(head,title,copy,list);return panel;
  }
  function openReview(roleId,personId,monthKey,view){
    currentRole=roleId;currentStore.activeRole=roleId;selectEmployeeData(personId);
    selectedMonth=monthKey||(monthSequence(currentData.setup).find(m=>m.inPeriod)||{key:'Jan'}).key;currentView=view;
    try{persist();}catch{}renderCurrent();
  }
  // The review saved most recently, and the month in it still being worked on.
  function lastReview(){
    // A rating that was set and then cleared leaves an empty entry behind; only real ones count.
    const marked=review=>Object.values(review?.ratings||{}).filter(Boolean).length;
    let best=null;
    for(const [roleId,group] of Object.entries(directory?.roles||{}))for(const person of group.employees){
      const policy=person.policyRoleId||roleId,state=currentStore.employeeReviews[policy]?.[person.id];
      if(!state?.updatedAt||ROLE_CONFIGS[policy].policyPending)continue;
      if(!Object.values(state.reviews||{}).some(marked))continue;
      if(!best||state.updatedAt>best.state.updatedAt)best={roleId,policy,person,state};
    }
    if(!best)return null;
    const months=monthSequence(best.state.setup).filter(m=>m.inPeriod),started=months.filter(m=>marked(best.state.reviews[m.key]));
    const month=started.filter(m=>!best.state.reviews[m.key].submittedAt).at(-1)||started.at(-1)||months[0];
    if(!month)return null;
    return {...best,month,comp:reviewCompleteness(best.state.reviews[month.key]||monthReview(),best.policy)};
  }
  function renderHome(){
    const elapsed=Date.now()-homeArrivedAt,entering=elapsed<HOME_ENTRANCE_MS;
    const shell=node('div',`flash-review-module flash-home${entering?' is-entering':''}`),top=node('header','flash-home-top'),wrap=node('div','flash-home-wrap');
    if(entering)shell.style.setProperty('--t',`${elapsed}ms`);
    let order=0;const rise=element=>{element.classList.add('flash-rise');element.style.setProperty('--i',String(order++));return element;};
    const bar=node('div','flash-home-bar'),logo=node('div','flash-side-logo');logo.append(node('i',null,'M'),node('span',null,'Magppie Flash Review'));
    bar.append(logo,node('span','flash-home-saved',remote.enabled?'Reviews saved to the database':'Reviews saved in this browser'));
    const hero=node('div','flash-home-hero'),lead=node('div'),cta=node('div','flash-home-cta'),recent=lastReview();
    const start=actionButton('Start a review',()=>pickStep({}),true);start.disabled=!directory;cta.appendChild(start);
    if(recent)cta.appendChild(actionButton('Open annual summary',()=>openReview(recent.roleId,recent.person.id,recent.month.key,'annual')));
    lead.append(rise(node('h1',null,'Every review, grounded in the record.')),rise(node('p',null,'Assess each responsibility against live Zoho CRM figures, open the records behind any number, and keep the whole year in one place.')),rise(cta));
    const card=rise(node('div','flash-home-resume'));
    if(recent){
      const track=node('div','flash-side-track'),fill=node('i');fill.style.setProperty('--w',`${recent.comp.total?Math.round(100*recent.comp.ratings/recent.comp.total):0}%`);track.appendChild(fill);
      const again=node('button','flash-home-link','Continue this review');again.type='button';again.onclick=()=>openReview(recent.roleId,recent.person.id,recent.month.key,'monthly');
      card.append(node('small',null,'Pick up where you left off'),node('b',null,`${recent.person.name}, ${recent.month.label}`),node('span',null,`${ROLE_CONFIGS[recent.policy].selectorLabel} · ${recent.comp.ratings} of ${recent.comp.total} marked`),track,again);
    }else card.append(node('small',null,'Nothing in progress'),node('b',null,directoryLoading?'Loading your reviews':'No review started yet'),node('span',null,'Select Start a review to begin the first one.'));
    if(homePick&&directory){hero.classList.add('is-picking');hero.appendChild(renderPicker());}else hero.append(lead,card);
    wrap.append(bar,hero);top.appendChild(wrap);
    const main=node('main','flash-home-wrap flash-home-main');
    if(directoryError){main.append(node('p','flash-home-lead',directoryError),actionButton('Retry employee list',()=>loadDirectory()));}
    const steps=node('div','flash-home-steps');
    [['Choose who and when','Open the person\u2019s workbook and select the month under review.'],['Bring in the evidence','One click reads the month\u2019s figures from Zoho CRM. Any number opens the records it was counted from.'],['Assess and sign off','Mark each responsibility, record your remarks, and submit to produce the report.']].forEach(([title,copy],index)=>{
      const step=rise(node('div','flash-home-step'));step.append(node('em',null,String(index+1)),node('b',null,title),node('p',null,copy));steps.appendChild(step);
    });
    main.appendChild(steps);
    const foot=node('footer','flash-home-wrap flash-home-foot');foot.append(node('span',null,remote.enabled?'Reviews are saved to the review database as you work.':'Reviews are saved in this browser as you work.'),node('span',null,'Figures are read from Zoho CRM at the moment you fetch them.'));
    shell.append(top,main,foot);currentContainer.appendChild(shell);
  }
  function renderCurrent(){
    if(!currentContainer||!currentData)return;
    const c=roleConfig(currentRole);currentContainer.innerHTML='';
    if(currentView==='home'){renderHome();return;}
    const shell=node('div','flash-review-module flash-studio'),nav=node('div','flash-module-nav'),copy=node('h1','flash-page-title',VIEW_TITLES[currentView]||'Monthly Flash Review');
    const role=node('label','flash-role-switch');role.appendChild(node('span',null,'Workbook'));
    const select=node('select');ROLE_ORDER.forEach(id=>{const o=node('option',null,ROLE_CONFIGS[id].selectorLabel);o.value=id;o.selected=id===currentRole;select.appendChild(o);});
    select.setAttribute('aria-label','Monthly Flash Review workbook');select.onchange=()=>switchRole(select.value);role.appendChild(select);
    const people=peopleForRole(currentRole),person=node('label','flash-role-switch flash-person-switch');person.appendChild(node('span',null,`Employee${directory?` (${people.length})`:''}`));
    const personSelect=node('select');personSelect.setAttribute('aria-label','Employee to review');
    const placeholder=node('option',null,directoryLoading?'Loading employees…':people.length?'Select employee':directoryError?'List unavailable':'No assigned employees');placeholder.value='';personSelect.appendChild(placeholder);
    const groups=new Map();
    people.forEach(p=>{
      let parent=personSelect;
      if(p.department){if(!groups.has(p.department)){const group=node('optgroup');group.label=p.department;groups.set(p.department,group);personSelect.appendChild(group);}parent=groups.get(p.department);}
      const option=node('option',null,p.name+(p.policyRoleId&&p.policyRoleId!==currentRole?' (SM, ASM policy)':''));option.value=p.id;parent.appendChild(option);
    });
    personSelect.value=currentEmployee?.id||'';personSelect.disabled=directoryLoading||!people.length||storageLoadError;
    personSelect.onchange=()=>switchEmployee(personSelect.value);person.appendChild(personSelect);
    const tabs=node('div','flash-module-tabs');
    Object.entries(VIEW_TITLES).forEach(([k,l])=>{const b=actionButton(l,()=>goTo(k));b.className=currentView===k?'active':'';b.disabled=!currentEmployee||storageLoadError||!!roleConfig(reviewPolicyRole()).policyPending;tabs.appendChild(b);});
    const saved=node('span','flash-save-state',currentEmployee?(currentData.updatedAt?`Saved ${new Date(currentData.updatedAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}`:'New employee review'):'');
    const home=node('button','flash-back-home','Back to home');home.type='button';home.onclick=goHome;
    nav.append(home,copy,role,person,saved);
    const side=sidePanel(c,tabs);
    const body=node('div','flash-module-body');
    const status=node('div','flash-directory-status');status.setAttribute('role','status');
    status.appendChild(node('span',null,directory?`Department lists maintained in this project · Zoho identities checked ${new Date(directory.fetchedAt).toLocaleString('en-IN')} · reviews saved ${remote.enabled?'to the review database':'in this browser'}`:directoryLoading?'Loading verified role assignments…':directoryError));
    if(directoryError)status.appendChild(actionButton('Retry employee list',()=>loadDirectory()));
    body.appendChild(status);
    if(currentEmployee?.policyRoleId&&currentEmployee.policyRoleId!==currentRole){
      const notice=node('div','flash-legacy-note',`${currentEmployee.name}: ${currentEmployee.assignedRole} in ${currentEmployee.department} · ASM review policy applies.`);body.appendChild(notice);
    }

    if(storageLoadError){body.appendChild(header('Saved reviews could not be read','Your existing storage has not been overwritten. Download a backup before recovering it.'));body.appendChild(actionButton('Download review backup',downloadReviewBackup));}
    else{
      const hasLegacy=Object.values(currentStore.roles).some(data=>data.updatedAt||data.setup.employeeName||Object.keys(data.reviews).length);
      if(hasLegacy){const legacy=node('div','flash-legacy-note');legacy.append(node('span',null,'Previous role-only reviews are preserved separately and have not been assigned to an employee.'),actionButton('Download review backup',downloadReviewBackup));body.appendChild(legacy);}
      if(!currentEmployee&&['purchase_head','logistics_head'].includes(currentRole)){
        renderUnassignedTemplate(body,c);
      }else if(!currentEmployee){
        const empty=node('section','flash-panel flash-person-empty');
        empty.appendChild(header(directoryError?'Employee list unavailable':directoryLoading?'Loading employees':people.length?`Choose a ${c.selectorLabel} employee`:'No matching employees',directoryError?'Retry the employee list to continue.':directoryLoading?'Checking the saved Zoho directory.':people.length?'Select a name above to open that person’s review. Each employee has a separate workbook.':'No employee is assigned to this list. Employees from other departments and roles are excluded.'));
        body.appendChild(empty);
      }else if(roleConfig(reviewPolicyRole()).policyPending){
        const pending=node('section','flash-panel');pending.appendChild(header(`${currentEmployee.name} · ${currentEmployee.department} AVP`,'AVP review policy is not configured. This person is assigned in the project; no other role’s scorecard is applied.'));pending.appendChild(node('p',null,`Reporting manager: ${currentData.setup.reportingManager||'Not specified'}`));body.appendChild(pending);renderAvpEvidence(body);
      }else if(currentView==='setup')renderSetup(body);else if(currentView==='monthly')renderMonthly(body);else if(currentView==='report')renderReport(body);else if(currentView==='annual')renderAnnual(body);else renderOverview(body);
    }
    const main=node('div','flash-main');main.append(nav,body);shell.append(side,main);if(arriving){shell.classList.add('is-arriving');arriving=false;}currentContainer.appendChild(shell);drawSideProgress();
  }
  function render(container,context={}){
    if(!container||typeof document==='undefined')return;
    currentContainer=container;currentContext=context;currentStore=loadStore();currentRole=currentStore.activeRole;
    currentEmployee=null;currentData=defaultState(currentRole);currentView='home';if(!homeArrivedAt)homeArrivedAt=Date.now();
    if(directory){selectEmployeeData(currentStore.activeEmployees[currentRole]);renderCurrent();pullReviews().then(()=>{if(remote.enabled&&currentContainer===container){selectEmployeeData(currentStore.activeEmployees[currentRole]);renderCurrent();}});}else loadDirectory();
  }
  return Object.freeze({render,savingsResult,calculateAnnual,monthlyScores,monthSequence,reviewCompleteness,setupIssues,submissionIssues,defaultState,defaultStore,normalizeState,normalizeStore,constants:Object.freeze({STORAGE_KEY,MONTHS,SCORE,KRA_WEIGHTS,ASPECT_WEIGHTS,WORK_ITEMS,BEHAVIOURAL_ITEMS,FOUNDATIONAL_ITEMS,ROLE_CONFIGS,ROLE_ORDER})});
});
