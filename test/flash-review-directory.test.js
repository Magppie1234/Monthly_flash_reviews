'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReviewDirectory } = require('../lib/flash-review-directory');
const flash = require('../public/flash-review');

test('local business lists include only approved people and leave other departments intact', () => {
  const roster=require('../data/flash-review-roster.json');
  const mapping=require('../config/flash-review-roles.json');
  const directory=buildReviewDirectory(roster,mapping);
  assert.deepEqual(directory.roles.sales_manager.employees.map(p=>p.name),['Lang Takhel','Himanshu Thakur','Sakshi','Ashish','Abhinav Tomar','Arjun','Rahul Mahajan','Siddharth','Rananjay']);
  assert.deepEqual(directory.roles.asm.employees.map(p=>p.name),['Vaishnavi','Anushka','Shrestha']);
  assert.deepEqual(directory.roles.psm.employees.map(p=>p.name),['Sowmya','Ishita','Sparshan','Deepak']);
  assert.deepEqual(directory.roles.avp.employees.map(p=>[p.name,p.department]),[['Tavneet','Retail'],['Harshita Magppie','Retail'],['Pratyush Pratyush','Projects']]);
  for(const name of ['Rahul Mahajan','Siddharth']){
    const person=directory.roles.sales_manager.employees.find(p=>p.name===name);
    assert.equal(person.assignedRole,'SM');assert.equal(person.policyRoleId,'asm');
    assert.equal(directory.roles.asm.employees.some(p=>p.id===person.id),false);
  }
  const original=buildReviewDirectory(roster,{...mapping,localAssignments:{}});
  for(const key of ['customer_care_head'])assert.deepEqual(directory.roles[key],original.roles[key]);
  // Even a new profile/CRM-role value cannot widen an explicit local department list.
  const extra={id:'999999',name:'Extra SM',roleId:mapping.roles.sales_manager[0],status:'active'};
  assert.equal(buildReviewDirectory({...roster,employees:[...roster.employees,extra]},mapping).roles.sales_manager.employees.some(p=>p.id===extra.id),false);
});

test('user-confirmed Designer team has individual reviews and reports to Sachin',()=>{
  const roster=require('../data/flash-review-roster.json'),mapping=require('../config/flash-review-roles.json');
  const people=buildReviewDirectory(roster,mapping).roles.designer.employees;
  assert.deepEqual(people.map(p=>p.name),['Atif Hussain','Rishabh Butar','Rashi','Vishal Dubey','Kavita','Nidhi','Shruti','Jyoti','Gunjan','Pravallika','Ankita','Palak','Rupa','Mansi','Sudha','Mehul','Deepanksha','Soma','Abdul']);
  assert.equal(new Set(people.map(p=>p.id)).size,19);
  for(const person of people){assert.equal(person.reportingManager.name,'Sachin');assert.equal(person.policyRoleId,'designer');assert.match(person.id,/^local:designer-/);}
  const store=flash.defaultStore();
  store.employeeReviews.designer={};
  for(const person of people)store.employeeReviews.designer[person.id]=flash.defaultState('designer');
  store.employeeReviews.designer[people[0].id].reviews.Apr={remarks:{dc_w1:'Saved review'}};
  const restored=flash.normalizeStore(JSON.parse(JSON.stringify(store)));
  assert.equal(Object.keys(restored.employeeReviews.designer).length,19);
  assert.equal(restored.employeeReviews.designer[people[0].id].reviews.Apr.remarks.dc_w1,'Saved review');
  assert.deepEqual(restored.employeeReviews.designer[people[1].id].reviews,{});
});

test('AVP identity is available without inventing a scorecard or allowing submission',()=>{
  const config=flash.constants.ROLE_CONFIGS.avp;
  assert.equal(config.policyPending,true);assert.deepEqual(config.workItems,[]);
  assert.ok(flash.submissionIssues(flash.defaultState('avp'),'Apr').includes('AVP review policy is not configured.'));
});

test('uses exact roles, excluding profiles, inactive users, duplicates and unrelated heads', () => {
  const mapping = {orgId:'60046349006',roles:{sales_manager:['sm'],psm:['psm'],asm:[]}};
  const person={id:'123',name:'SM Person',roleId:'sm',status:'active'};
  const roster={orgId:mapping.orgId,fetchedAt:new Date().toISOString(),employees:[person,person,{...person,id:'124',roleId:'psm',profile:'SM'},{...person,id:'125',status:'inactive'},{...person,id:'126',roleId:'head'}]};
  const directory=buildReviewDirectory(roster,mapping);
  assert.deepEqual(directory.roles.sales_manager.employees.map(p=>p.id),['123']);
  assert.deepEqual(directory.roles.psm.employees.map(p=>p.id),['124']);
  assert.deepEqual(directory.roles.asm.employees,[]);
  assert.equal('profile' in directory.roles.psm.employees[0],false);
  assert.throws(()=>buildReviewDirectory({...roster,orgId:'wrong'},mapping));
});

test('legacy role reviews survive migration without being assigned to any employee', () => {
  const old={version:2,activeRole:'psm',roles:{psm:{setup:{employeeName:'Old Name'},reviews:{Apr:{remarks:{psm_w1:'Preserve this'}}}}}};
  const restored=flash.normalizeStore(old);
  assert.equal(restored.version,3);
  assert.equal(restored.roles.psm.reviews.Apr.remarks.psm_w1,'Preserve this');
  assert.deepEqual(restored.employeeReviews.psm,{});
  assert.deepEqual(restored.activeEmployees,{});
});

test('employee workbooks and selected identity survive storage round trips independently', () => {
  const store=flash.defaultStore();
  store.employeeReviews.sales_manager={'123':flash.defaultState(),'456':flash.defaultState()};
  store.employeeReviews.sales_manager['123'].reviews.Apr={remarks:{sm_w1:'Only employee 123'}};
  store.activeEmployees.sales_manager='123';
  const restored=flash.normalizeStore(JSON.parse(JSON.stringify(store)));
  assert.equal(restored.activeEmployees.sales_manager,'123');
  assert.equal(restored.employeeReviews.sales_manager['123'].reviews.Apr.remarks.sm_w1,'Only employee 123');
  assert.deepEqual(restored.employeeReviews.sales_manager['456'].reviews,{});
  assert.deepEqual(restored.roles.sales_manager.reviews,{});
});

test('confirmed reporting hierarchy respects department parents and explicit identity only', () => {
  const roster=require('../data/flash-review-roster.json');
  const mapping=require('../config/flash-review-roles.json');
  const roles=buildReviewDirectory(roster,mapping).roles;
  const people=Object.values(roles).flatMap(role=>role.employees);
  const manager=name=>people.find(person=>person.name===name)?.reportingManager;
  for(const name of ['Tavneet','Harshita Magppie','Pratyush Pratyush']) assert.equal(manager(name).name,'Dr. Suruchi Mittal');
  for(const name of ['Lang Takhel','Arjun','Siddharth','Anushka','Vaishnavi']) assert.equal(manager(name).name,'Tavneet');
  assert.equal(manager('Ashish').name,'Harshita');
  for(const person of roles.psm.employees) assert.equal(person.reportingManager.name,'Sadhvi');
  assert.deepEqual(manager('Sudhakar Sudhakar'),{name:'Factory',type:'department',source:'project'});
  for(const name of ['Rananjay','Rajkumar']) assert.equal(manager(name),undefined);
  assert.equal(mapping.reportingHierarchy.parents.Factory,'Dr. Suruchi Mittal');
  assert.equal(mapping.reportingHierarchy.parents.Sadhvi,'Dr. Suruchi Mittal');
});


test('Factory Head is local Rajni and Installation Manager contains only verified Rishabh',()=>{
 const roster=require('../data/flash-review-roster.json');
 const mapping=require('../config/flash-review-roles.json');
 const roles=buildReviewDirectory(roster,mapping).roles;
 assert.deepEqual(roles.factory_head.employees.map(p=>[p.id,p.name]),[['local:rajni','Rajnikant']]);
 assert.deepEqual(roles.installation_manager.employees.map(p=>[p.id,p.name]),[['1032257000023448089','Rishabh']]);
 for(const key of ['factory_head','installation_manager']){
  assert.equal(roles[key].employees[0].reportingManager.name,'Factory');
  assert.equal(roles[key].employees[0].policyRoleId,key);
 }
 const store=flash.defaultStore();
 store.employeeReviews.installation_manager={};
 store.employeeReviews.installation_manager['1032257000023480001']={setup:{},reviews:{Apr:{remarks:{note:'Preserved'}}}};
 assert.equal(flash.normalizeStore(store).employeeReviews.installation_manager['1032257000023480001'].reviews.Apr.remarks.note,'Preserved');
});


test('local Rajni review survives reload without claiming a CRM identity',()=>{
 const store=flash.defaultStore();
 store.employeeReviews.factory_head={'local:rajni':flash.defaultState('factory_head')};
 store.employeeReviews.factory_head['local:rajni'].reviews.Apr={remarks:{note:'Rajni review'}};
 store.activeEmployees.factory_head='local:rajni';
 const restored=flash.normalizeStore(JSON.parse(JSON.stringify(store)));
 assert.equal(restored.activeEmployees.factory_head,'local:rajni');
 assert.equal(restored.employeeReviews.factory_head['local:rajni'].reviews.Apr.remarks.note,'Rajni review');
});

test('revised managers and Factory Office labels preserve stable review identities',()=>{
 const roles=buildReviewDirectory(require('../data/flash-review-roster.json'),require('../config/flash-review-roles.json')).roles;
 const people=Object.values(roles).flatMap(r=>r.employees);
 for(const [name,manager] of [['Sakshi','Dr. Suruchi Mittal'],['Abhinav Tomar','Dr. Suruchi Mittal'],['Himanshu Thakur','Harshita'],['Rahul Mahajan','Tavneet'],['Shrestha','Ashish']]) assert.equal(people.find(p=>p.name===name).reportingManager.name,manager);
 assert.equal(people.some(p=>p.id==='1032257000027013001'),false);
 assert.equal(roles.factory_head.employees[0].id,'local:rajni');
 assert.equal(roles.factory_head.employees[0].assignedRole,'Factory Office');
 assert.equal(flash.constants.ROLE_CONFIGS.factory_head.selectorLabel,'Factory Office');
});

test('Lokender has separate Purchase and Logistics workbooks without an inferred reporting manager',()=>{
 const roles=buildReviewDirectory(require('../data/flash-review-roster.json'),require('../config/flash-review-roles.json')).roles;
 const store=flash.defaultStore();
 for(const key of ['purchase_head','logistics_head']){
  assert.deepEqual(roles[key].employees.map(p=>[p.id,p.name,p.policyRoleId]),[['local:lokender','Lokender',key]]);
  assert.equal(roles[key].employees[0].reportingManager,undefined);
  store.employeeReviews[key]={'local:lokender':flash.defaultState(key)};
 }
 store.employeeReviews.purchase_head['local:lokender'].reviews.Apr={overallRemark:'Purchase only'};
 const restored=flash.normalizeStore(JSON.parse(JSON.stringify(store)));
 assert.equal(restored.employeeReviews.purchase_head['local:lokender'].reviews.Apr.overallRemark,'Purchase only');
 assert.deepEqual(restored.employeeReviews.logistics_head['local:lokender'].reviews,{});
});
