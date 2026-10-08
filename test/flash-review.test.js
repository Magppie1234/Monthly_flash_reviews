'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const flashReview = require('../public/flash-review');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

function completedReview(rating = 'meets', target = 100, achieved = 100) {
  const ratings = {};
  const mis = {};
  const remarks = {};
  const items = [
    ...flashReview.constants.WORK_ITEMS,
    ...flashReview.constants.BEHAVIOURAL_ITEMS,
    ...flashReview.constants.FOUNDATIONAL_ITEMS,
  ];
  items.forEach(item => {
    ratings[item.id] = rating;
    mis[item.id] = 'CRM MIS';
    if (rating !== 'meets') remarks[item.id] = 'Specific evidence and impact recorded.';
  });
  return { ratings, mis, remarks, overallAssessment: rating, target, achieved, targetUnit: '₹ Cr' };
}

test('sidebar shows only Monthly Flash Review and defaults to that page', () => {
  const sidebar=appSource.slice(appSource.indexOf('function renderTabs()'),appSource.indexOf('function setActiveTab(mod)'));
  assert.match(sidebar,/Monthly Flash Review/);
  assert.equal((sidebar.match(/t\.appendChild\(/g)||[]).length,1);
  assert.match(appSource,/const h = location.hash \|\| '#\/flash-review'/);
  assert.match(appSource, /parts\[0\] === 'flash-review'/);
  assert.match(appSource, /setActiveTab\('__flash_review'\)/);
  assert.ok(indexSource.indexOf('/flash-review.js') < indexSource.indexOf('/app.js'));
  assert.match(styles, /\.flash-review-module\s*\{/);
});

test('keeps Monthly Flash Review available when CRM boot metadata is unavailable', () => {
  const bootSource = appSource.slice(
    appSource.indexOf('async function boot()'),
    appSource.indexOf('function renderTabs()'),
  );
  assert.ok(bootSource.indexOf('renderTabs();') < bootSource.indexOf("await api('/api/boot')"));
  assert.match(bootSource, /if \(isLocalFirstRoute\(\)\) route\(\);/);
  assert.match(bootSource, /else renderBootFailure\(\);/);
  assert.doesNotMatch(appSource, /Failed to connect to Zoho:/);
  assert.match(styles, /\.boot-error\s*\{/);
});

test('preserves the workbook structure and provisional weights', () => {
  assert.equal(flashReview.constants.WORK_ITEMS.length, 12);
  assert.equal(flashReview.constants.BEHAVIOURAL_ITEMS.length, 5);
  assert.equal(flashReview.constants.FOUNDATIONAL_ITEMS.length, 5);
  assert.deepEqual(flashReview.constants.KRA_WEIGHTS, { kra1: 13, kra2: 20, kra3: 27, kra4: 11, kra5: 20, kra6: 9 });
  assert.deepEqual(flashReview.constants.ASPECT_WEIGHTS, { work: 55, behavioural: 15, foundational: 10, target: 20 });
});

test('joining month drives eligibility and excludes earlier months', () => {
  const state = flashReview.defaultState();
  state.setup.annualPeriod = 'april-march';
  state.setup.startYear = 2026;
  state.setup.joiningDate = '2026-09-18';
  const sequence = flashReview.monthSequence(state.setup);
  assert.deepEqual(sequence.filter(month => month.inPeriod).map(month => month.key), ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']);
});

test('complete Meets reviews calculate an evidence-backed annual score', () => {
  const state = flashReview.defaultState();
  state.setup.annualPeriod = 'april-march';
  state.setup.startYear = 2026;
  flashReview.monthSequence(state.setup).forEach(month => { state.reviews[month.key] = completedReview(); });
  const annual = flashReview.calculateAnnual(state);
  assert.equal(annual.completed.length, 12);
  assert.equal(annual.aspects.work, 2);
  assert.equal(annual.aspects.behavioural, 2);
  assert.equal(annual.aspects.foundational, 2);
  assert.equal(annual.aspects.target, 3);
  assert.equal(annual.annualScore, 2.2);
  assert.equal(annual.annualRating, 'Meets Expectations');
  assert.equal(annual.targetFlag, 'On track');
});

test('three missed target months and consecutive Below reviews raise separate flags', () => {
  const state = flashReview.defaultState();
  state.setup.annualPeriod = 'january-december';
  state.setup.startYear = 2026;
  flashReview.monthSequence(state.setup).forEach((month, index) => {
    state.reviews[month.key] = completedReview(index < 3 ? 'below' : 'meets', 100, index < 3 ? 80 : 100);
  });
  const annual = flashReview.calculateAnnual(state);
  assert.equal(annual.missedTargets, 3);
  assert.equal(annual.targetFlag, 'RED FLAG: recommend PIP and HR discussion');
  assert.equal(annual.escalationCount, 1);
  assert.equal(annual.pipCount, 1);
});

test('a missing remark keeps a review incomplete; a missing MIS source no longer does', () => {
  const review = completedReview('above');
  const first = flashReview.constants.WORK_ITEMS[0];
  delete review.mis[first.id];
  delete review.remarks[first.id];
  const completeness = flashReview.reviewCompleteness(review);
  assert.equal(completeness.missingMis, 0);
  assert.equal(completeness.missingRemarks, 1);
  assert.equal(completeness.complete, false);
});

test('adds the Designer, ASM, and PSM workbooks with their exact KPI and KRA structures', () => {
  const { ROLE_CONFIGS, ROLE_ORDER } = flashReview.constants;
  assert.deepEqual(ROLE_ORDER, [
    'avp', 'sales_manager', 'designer', 'asm', 'psm',
    'factory_head', 'purchase_head', 'logistics_head', 'installation_manager', 'customer_care_head',
  ]);
  assert.equal(ROLE_CONFIGS.designer.workItems.length, 17);
  assert.equal(ROLE_CONFIGS.asm.workItems.length, 12);
  assert.equal(ROLE_CONFIGS.psm.workItems.length, 8);
  assert.equal(Object.keys(ROLE_CONFIGS.designer.kraWeights).length, 10);
  assert.equal(Object.keys(ROLE_CONFIGS.asm.kraWeights).length, 7);
  assert.equal(Object.keys(ROLE_CONFIGS.psm.kraWeights).length, 4);
  assert.equal(Object.values(ROLE_CONFIGS.designer.kraWeights).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(Object.values(ROLE_CONFIGS.asm.kraWeights).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(Object.values(ROLE_CONFIGS.psm.kraWeights).reduce((sum, value) => sum + value, 0), 100);
});

test('adds the five factory workbooks from the FY25-26 KRA tracking sheet', () => {
  const { ROLE_CONFIGS } = flashReview.constants;
  const factoryRoles = ['factory_head', 'purchase_head', 'logistics_head', 'installation_manager', 'customer_care_head'];
  const expectedWorkItems = { factory_head: 4, purchase_head: 2, logistics_head: 1, installation_manager: 4, customer_care_head: 4 };
  const seen = new Set();
  for (const roleId of factoryRoles) {
    const config = ROLE_CONFIGS[roleId];
    assert.equal(config.id, roleId);
    assert.equal(config.requiresMis, true, `${roleId} tracks MIS evidence`);
    assert.equal(config.workItems.length, expectedWorkItems[roleId], `${roleId} work item count`);
    assert.equal(config.behaviouralItems.length, 5);
    assert.equal(config.foundationalItems.length, 5);
    assert.deepEqual(config.kraWeights, {}, 'Weights remain pending');
    // The tracking methods from the sheet seed the MIS dropdown.
    assert.ok(config.defaultMisSources.length > 0, `${roleId} has default MIS sources`);
    [...config.workItems, ...config.behaviouralItems, ...config.foundationalItems].forEach(item => {
      assert.equal(seen.has(item.id), false, `duplicate item id ${item.id}`);
      seen.add(item.id);
    });
  }
});

test('seeds a new factory workbook with its sheet tracking methods as MIS sources', () => {
  const { ROLE_CONFIGS } = flashReview.constants;
  const store = flashReview.defaultStore();
  assert.deepEqual(store.roles.purchase_head.setup.misSources, [...ROLE_CONFIGS.purchase_head.defaultMisSources]);
  assert.equal(store.roles.purchase_head.setup.designation, 'Purchase Head');
  // Sales workbooks keep an empty list; the seed must not leak across roles.
  assert.deepEqual(store.roles.sales_manager.setup.misSources, []);
  // A round trip through storage preserves what the user actually has.
  const restored = flashReview.normalizeStore(JSON.parse(JSON.stringify(store)));
  assert.deepEqual(restored.roles.customer_care_head.setup.misSources, [...ROLE_CONFIGS.customer_care_head.defaultMisSources]);
});

test('a fully rated review is complete for every workbook without recording an MIS source', () => {
  const { ROLE_CONFIGS } = flashReview.constants;
  const reviewFor = roleId => {
    const config = ROLE_CONFIGS[roleId];
    const review = { ratings: {}, mis: {}, remarks: {}, overallAssessment: 'meets' };
    [...config.workItems, ...config.behaviouralItems, ...config.foundationalItems].forEach(item => { review.ratings[item.id] = 'meets'; });
    return review;
  };
  const designer = flashReview.reviewCompleteness(reviewFor('designer'), 'designer');
  const asm = flashReview.reviewCompleteness(reviewFor('asm'), 'asm');
  const psm = flashReview.reviewCompleteness(reviewFor('psm'), 'psm');
  assert.equal(designer.missingMis, 0);
  assert.equal(designer.complete, true);
  assert.equal(asm.missingMis, 0);
  assert.equal(psm.missingMis, 0);
  assert.equal(asm.complete, true);
  assert.equal(psm.complete, true);
});

test('migrates the original Sales Manager review into the multi-workbook store without data loss', () => {
  const legacy = flashReview.defaultState();
  legacy.version = 1;
  legacy.setup.employeeName = 'Existing employee';
  legacy.reviews.Jan = completedReview();
  const store = flashReview.normalizeStore(legacy);
  assert.equal(store.version, 3);
  assert.equal(store.activeRole, 'sales_manager');
  assert.equal(store.roles.sales_manager.setup.employeeName, 'Existing employee');
  assert.equal(store.roles.sales_manager.reviews.Jan.overallAssessment, 'meets');
  assert.equal(store.roles.designer.setup.designation, 'Design Consultant');
  assert.equal(store.roles.psm.setup.designation, 'Pre-Sales Manager (PSM)');
});

test('blank and partial reviews can be submitted without employee details or evidence', () => {
  for (const roleId of flashReview.constants.ROLE_ORDER.filter(id => !flashReview.constants.ROLE_CONFIGS[id].policyPending)) {
    const state = flashReview.defaultState(roleId);
    assert.deepEqual(flashReview.setupIssues(state.setup), [], roleId);
    assert.deepEqual(flashReview.submissionIssues(state, 'Apr'), [], roleId);
    const item = flashReview.constants.ROLE_CONFIGS[roleId].workItems[0].id;
    state.reviews.Apr = { ratings: { [item]: 'above' }, mis: { [item]: 'Other' }, remarks: {} };
    assert.deepEqual(flashReview.submissionIssues(state, 'Apr'), [], roleId);
    const scores = flashReview.monthlyScores(state.reviews.Apr, roleId);
    assert.equal(scores.work, flashReview.constants.ROLE_CONFIGS[roleId].combinedReview ? null : 3);
    assert.equal(scores.behavioural, null);
    assert.equal(scores.foundational, null);
    assert.equal(scores.overall, null);
  }
});

test('optional fields do not remove review period validation', () => {
  const state = flashReview.defaultState();
  Object.assign(state.setup, { startYear: 2026, joiningDate: '2026-09-01' });
  assert.deepEqual(flashReview.submissionIssues(state, 'Sep'), []);
  assert.ok(flashReview.submissionIssues(state, 'Apr').includes('Select an eligible review month.'));
  state.setup.startYear = 0;
  assert.ok(flashReview.setupIssues(state.setup).some(issue => issue.includes('start year')));
});


test('combined framework preserves old answers and never activates pending financial or HR policies',()=>{
 const state=flashReview.defaultState('factory_head');
 state.reviews.Apr={ratings:{fh_w1:'above'},remarks:{fh_w1:'Old evidence'},overallAssessment:'below',measurements:{factory_head_v2_w1:{actual:'12'}},savings:{target:'100',actual:'0',verified:true}};
 state.reviews.May={overallAssessment:'below'};state.reviews.Jun={overallAssessment:'below'};
 const restored=flashReview.normalizeState(JSON.parse(JSON.stringify(state)));
 assert.equal(restored.reviews.Apr.remarks.fh_w1,'Old evidence');
 assert.equal(restored.reviews.Apr.measurements.factory_head_v2_w1.actual,'12');
 assert.equal(flashReview.monthlyScores(restored.reviews.Apr,'factory_head').work,null);
 const annual=flashReview.calculateAnnual(restored);
 assert.equal(annual.annualScore,null);assert.equal(annual.escalationCount,0);assert.equal(annual.pipCount,0);
 assert.equal(flashReview.savingsResult({}),null);
 assert.equal(flashReview.savingsResult({savings:{target:'100',actual:'50'}}),null);
 assert.equal(flashReview.savingsResult({savings:{target:'0',actual:'50',verified:true}}),null);
 assert.equal(flashReview.savingsResult(state.reviews.Apr),0);
 assert.equal(flashReview.savingsResult({savings:{target:'100',actual:'85',verified:true}}),0.85);
});
