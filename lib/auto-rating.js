'use strict';
// Turns a Work row's fetched figure into Above / Meets / Below using that row's documented target
// (config/auto-rating.json). Rows without a rule, figures with a warning and missing figures are left
// unrated, so a number is never marked on partial or absent data.
const RULES = require('../config/auto-rating.json').rules;
const TARGETS = require('../config/sales-targets.json').monthlyBookingCrore;

const firstNumber = value => {
  const match = /-?\d+(?:\.\d+)?/.exec(String(value ?? '').replace(/,/g, ''));
  return match ? Number(match[0]) : null;
};

// The figure in the rule's unit, and the wording of the target behind the mark.
function measure(rule, item, { policy, team }) {
  if (rule.unit === 'percentOfBookingTarget') {
    const target = TARGETS[policy];
    if (!target || !Number.isFinite(item.crore)) return null;
    return { value: (100 * item.crore) / target, unit: `% of the ₹${target} Cr target` };
  }
  const value = firstNumber(item.value);
  if (value === null) return null;
  if (rule.unit === 'countPerSalesManager') {
    const managers = (team || []).filter(person => person.role === 'sales_manager').length;
    if (!managers) return null;
    return { value: value / managers, unit: ' per Sales Manager' };
  }
  return { value, unit: { percent: '%', days: ' days', count: '' }[rule.unit] ?? '' };
}

function describe(rule, unit) {
  const sign = rule.better === 'lower' ? '≤' : '≥';
  const meets = `Meets at ${sign} ${rule.meets}${unit}`;
  return rule.above === undefined ? meets : `${meets}, Above at ${sign} ${rule.above}${unit}`;
}

function rate(item, context) {
  const rule = RULES[item.id];
  if (!rule || item.warning || item.value === null || item.value === undefined) return null;
  const figure = measure(rule, item, context);
  if (!figure) return null;
  const { value } = figure;
  const reached = level => (rule.better === 'lower' ? value <= level : value >= level);
  const mark = rule.above !== undefined && reached(rule.above) ? 'above' : reached(rule.meets) ? 'meets' : 'below';
  return { value: mark, basis: describe(rule, figure.unit) };
}

// Adds a rating to every item that has a rule and a usable figure.
function rateItems(items, context) {
  return items.map(item => {
    const rating = rate(item, context);
    return rating ? { ...item, rating } : item;
  });
}

module.exports = { rate, rateItems, RULES };
