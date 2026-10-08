'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const review=require('../public/flash-review');
const config=review.constants.ROLE_CONFIGS.designer;
const state=()=>{const data=review.defaultState('designer');data.setup.startYear=2026;data.setup.annualPeriod='april-march';return data;};

test('Designer workbook modal ratings follow Annual Dashboard G84:P95 tie rules',()=>{
  const sample={ratings:{dc_w1:'above',dc_w2:'below',dc_w3:'above',dc_w4:'meets',dc_b_1:'meets',dc_b_2:'meets',dc_b_3:'below'}};
  const scores=review.monthlyScores(sample,'designer');
  assert.equal(scores.kraScores.kra1,1); // Below wins a tie, rather than averaging to 2.
  assert.equal(scores.kraScores.kra2,3); // Above wins an Above/Meets tie.
  assert.equal(scores.behavioural,2);
  assert.equal(scores.foundational,null);
});
test('Designer annual score follows available-aspect denominator in E50',()=>{
  const data=state();data.reviews.Apr={ratings:{dc_w1:'above',dc_w2:'above',dc_w3:'meets',dc_w4:'meets',dc_b_1:'below'}};
  const result=review.calculateAnnual(data);
  const expectedWork=(3*20+2*15)/35;
  assert.ok(Math.abs(result.aspects.work-expectedWork)<1e-10);
  assert.ok(Math.abs(result.annualScore-(expectedWork*55+1*15)/70)<1e-10);
  assert.equal(review.calculateAnnual(state()).annualScore,null);
});
test('Designer trend uses eligible calendar halves, not the first six completed reviews',()=>{
  const data=state();data.setup.joiningDate='2026-09-18';
  for(const key of ['Sep','Oct','Nov'])data.reviews[key]={overallAssessment:'meets'};
  for(const key of ['Dec','Jan','Feb','Mar'])data.reviews[key]={overallAssessment:'above'};
  const result=review.calculateAnnual(data);
  assert.equal(result.trend,'Improving');assert.equal(result.proRataFactor,7/12);
  assert.ok(Math.abs(result.proRataDaysFactor-195/365)<1e-10);
});
test('Designer missing months break consecutive Below sequences',()=>{
  const data=state();data.reviews.Apr={overallAssessment:'below'};data.reviews.Jun={overallAssessment:'below'};
  assert.equal(review.calculateAnnual(data).escalationCount,0);
  data.reviews.Jul={overallAssessment:'below'};data.reviews.Aug={overallAssessment:'below'};data.reviews.Sep={overallAssessment:'below'};
  const result=review.calculateAnnual(data);assert.equal(result.escalationCount,1);assert.equal(result.pipCount,2);
});
test('Designer points and weights persist independently of other roles',()=>{
  const data=state();data.setup.designerScoring={points:{above:4,meets:2,below:1},kraWeights:{...config.kraWeights,kra1:40,kra2:0}};
  data.reviews.Apr={ratings:{dc_w1:'above',dc_w3:'below'}};
  const restored=review.normalizeState(JSON.parse(JSON.stringify(data)),'designer');
  assert.equal(review.calculateAnnual(restored).aspects.work,4);
  assert.equal(review.monthlyScores(restored.reviews.Apr,'designer',restored.setup).kraScores.kra1,4);
  assert.equal(review.constants.ROLE_CONFIGS.sales_manager.kraWeights.kra1,13);
});
test('Designer target scoring and remarks coverage stay faithful to the template',()=>{
  const data=state();for(const month of ['Apr','May','Jun'])data.reviews[month]={target:100,achieved:80};
  assert.equal(review.calculateAnnual(data).aspects.target,1);
  assert.match(review.calculateAnnual(data).targetFlag,/RED FLAG/);
  const comp=review.reviewCompleteness({ratings:{dc_w1:'above',dc_w2:'below'}},'designer');
  assert.equal(comp.missingRemarks,2);assert.equal(comp.missingMis,0);
});
