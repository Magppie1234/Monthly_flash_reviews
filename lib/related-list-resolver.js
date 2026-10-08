'use strict';

const POLYMORPHIC_LINK_FIELDS = new Set(['What_Id', 'Who_Id', 'Parent_Id']);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function scalarId(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function isLookup(field) {
  return field?.data_type === 'lookup' && field.lookup && typeof field.lookup === 'object';
}

function lookupTargetsParent(field, parentModule) {
  const target = field?.lookup?.module?.api_name;
  return target === parentModule || target === 'se_module';
}

function lookupNamesRelation(field, relatedList) {
  const lookupId = scalarId(field?.lookup?.id);
  const relatedListId = scalarId(relatedList?.id);
  return (
    (lookupId !== null && relatedListId !== null && lookupId === relatedListId)
    || (field?.lookup?.api_name && field.lookup.api_name === relatedList?.api_name)
  );
}

/**
 * Resolve only source-described relationship fields.
 *
 * A target module can appear more than once under one parent (for example
 * Tasks and Tasks_History, or Deals and All_Orders). Reusing every lookup to
 * the parent for every sibling list makes distinct source relationships return
 * the same plausible-but-wrong rows. Exact lookup metadata wins. The only
 * fallback is a standard, base-module related list backed by Zoho's explicit
 * polymorphic activity fields.
 */
function resolveRelatedListLinkFields({ parentModule, relatedList, fields }) {
  const relationName = relatedList?.api_name;
  const targetModule = relatedList?.module?.api_name;
  if (!relationName || !targetModule) {
    return {
      available: false,
      reason_code: 'RELATED_TARGET_MODULE_UNRESOLVED',
      link_fields: [],
    };
  }

  const lookupFields = array(fields).filter(isLookup);
  const exactFields = lookupFields.filter(field => (
    lookupTargetsParent(field, parentModule)
    && lookupNamesRelation(field, relatedList)
  ));
  if (exactFields.length) {
    return {
      available: true,
      reason_code: null,
      link_fields: [...new Set(exactFields.map(field => field.api_name))].sort(),
      basis: 'Exact source lookup relation',
    };
  }

  if (relationName === targetModule) {
    const polymorphicFields = lookupFields.filter(field => (
      field?.lookup?.module?.api_name === 'se_module'
      && POLYMORPHIC_LINK_FIELDS.has(field.api_name)
    ));
    if (polymorphicFields.length) {
      return {
        available: true,
        reason_code: null,
        link_fields: [...new Set(polymorphicFields.map(field => field.api_name))].sort(),
        basis: 'Source polymorphic base relation',
      };
    }
  }

  return {
    available: false,
    reason_code: 'RELATED_LINK_PATH_UNRESOLVED',
    link_fields: [],
  };
}

module.exports = {
  resolveRelatedListLinkFields,
};
