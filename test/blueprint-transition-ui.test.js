'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'app.js'), 'utf8');
const controlStart = appSource.indexOf('function transitionInputElement(');
const controlEnd = appSource.indexOf('function blueprintActionDetails(', controlStart);
const transitionStart = appSource.indexOf('function openBlueprintTransition(');
const transitionEnd = appSource.indexOf('function displayLayoutContext(', transitionStart);
const controlSource = appSource.slice(controlStart, controlEnd);
const transitionSource = appSource.slice(transitionStart, transitionEnd);

test('Blueprint integer and bigint inputs use whole-number browser controls', () => {
  assert.ok(controlStart >= 0 && controlEnd > controlStart);
  assert.match(controlSource, /\['integer','bigint'\]\.includes\(type\) \? '1' : 'any'/);
  assert.doesNotMatch(controlSource, /step\s*=\s*'any'[^\n]*integer/);
});

test('Blueprint submit validation rejects fractional and unsafe integers without truncation', () => {
  assert.ok(transitionStart >= 0 && transitionEnd > transitionStart);
  assert.match(transitionSource, /\['integer','bigint'\]\.includes\(control\.dataset\.dt\)/);
  assert.match(transitionSource, /const number = Number\(value\)/);
  assert.match(transitionSource, /Number\.isSafeInteger\(number\)/);
  assert.doesNotMatch(transitionSource, /parseInt\s*\(/);
  assert.ok(
    transitionSource.indexOf('Number.isSafeInteger(number)') < transitionSource.indexOf('proceed.disabled = true'),
    'integer validation must happen before submission is disabled and sent',
  );
});

test('every rendered Blueprint During control has a unique explicit accessible label and description', () => {
  assert.match(transitionSource, /forEach\(\(input, inputIndex\) =>/);
  assert.match(transitionSource, /const controlId = `blueprint-\$\{String\(transition\.id/);
  assert.match(transitionSource, /-\$\{inputIndex\}`/);
  assert.match(transitionSource, /label\.htmlFor = controlId/);
  assert.match(transitionSource, /control\.id = controlId/);
  assert.match(transitionSource, /control\.setAttribute\('aria-describedby', descriptionId\)/);
  assert.match(transitionSource, /description\.id = descriptionId/);
  assert.match(transitionSource, /Required Blueprint transition input\./);
});

test('Blueprint transition modal has dialog semantics, keyboard close, and focus restoration', () => {
  assert.match(transitionSource, /const restoreFocus = document\.activeElement/);
  assert.match(transitionSource, /const heading = el\('h2', 'blueprint-modal-title'/);
  assert.match(transitionSource, /heading\.id = titleId/);
  assert.match(transitionSource, /const x = el\('button', 'x', '✕'\)/);
  assert.match(transitionSource, /x\.setAttribute\('aria-label', `Close \$\{transition\.name\} Blueprint transition`\)/);
  assert.match(transitionSource, /modal\.setAttribute\('role', 'dialog'\)/);
  assert.match(transitionSource, /modal\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(transitionSource, /modal\.setAttribute\('aria-labelledby', titleId\)/);
  assert.match(transitionSource, /modal\.removeAttribute\('aria-labelledby'\)/);
  assert.doesNotMatch(transitionSource, /box\.(?:setAttribute|removeAttribute)\('aria-labelledby'/);
  assert.match(transitionSource, /event\.key === 'Escape'/);
  assert.match(transitionSource, /restoreFocus && document\.contains\(restoreFocus\)[\s\S]{0,80}restoreFocus\.focus\(\)/);
  assert.match(transitionSource, /document\.removeEventListener\('keydown', keyHandler\)/);
  assert.match(transitionSource, /x\.focus\(\)/);
});

test('Blueprint forms remain inspectable but submission follows atomic runtime readiness, not policy eligibility', () => {
  assert.match(transitionSource, /const inspectionOnly = !transition\.runtime_executable/);
  assert.match(transitionSource, /transition\.policy_eligible \? 'Policy eligible · atomic execution unavailable'/);
  assert.match(transitionSource, /if \(inspectionOnly\) control\.disabled = true/);
  assert.match(transitionSource, /if \(!inspectionOnly\) mf\.append\(proceed\)/);
  assert.doesNotMatch(transitionSource, /const inspectionOnly = !transition\.executable/);
});
