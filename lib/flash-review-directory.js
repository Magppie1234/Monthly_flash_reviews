'use strict';

const ORG_ID = '60046349006';

// Zoho stores a first and a last name. Where someone has only one, it was entered in both, and
// the full name reads "Sudhakar Sudhakar". Show it once.
function displayName(name) {
  const words = String(name || '').trim().split(/\s+/);
  return words.length > 1 && words.every(word => word.toLowerCase() === words[0].toLowerCase()) ? words[0] : words.join(' ');
}

function buildReviewDirectory(roster, mapping) {
  if (roster?.orgId !== ORG_ID || mapping?.orgId !== ORG_ID || !Array.isArray(roster.employees) || !Number.isFinite(Date.parse(roster.fetchedAt))) {
    throw new Error('Unverified staff directory');
  }
  const roles = {};
  for (const [key, ids] of Object.entries(mapping.roles)) {
    if (!Array.isArray(ids)) throw new Error('Invalid role mapping');
    const seen = new Set();
    const employees = roster.employees.filter(person => {
      if (person.status !== 'active' || !ids.includes(person.roleId) || !/^\d+$/.test(person.id) || !person.name || seen.has(person.id)) return false;
      seen.add(person.id);
      return true;
    }).map(({ id, name, roleName }) => ({ id, name: displayName(name), roleName })).sort((a,b) => a.name.localeCompare(b.name));
    roles[key] = { employees };
  }
  // User-approved department membership is local application configuration.
  // Resolve identities by CRM ID, never edit or infer the source CRM role.
  for (const [key, assignments] of Object.entries(mapping.localAssignments || {})) {
    if (!roles[key] || !Array.isArray(assignments)) throw new Error('Invalid local assignment');
    const seen = new Set();
    const employees = [];
    for (const assignment of assignments) {
      if (!roles[assignment.policyRoleId]) throw new Error('Unknown review policy');
      const person = assignment.id.startsWith('local:')
        ? (mapping.projectPeople || []).find(p => p.id === assignment.id && p.status === 'active' && p.name)
        : roster.employees.find(p => p.id === assignment.id && p.status === 'active');
      if (!person || seen.has(person.id)) continue;
      seen.add(person.id);
      employees.push({id:person.id,name:displayName(person.name),roleName:person.roleName,department:assignment.department,assignedRole:assignment.assignedRole,policyRoleId:assignment.policyRoleId});
    }
    roles[key] = { employees, assignmentSource: 'project' };
  }
  const hierarchy = mapping.reportingHierarchy;
  if (hierarchy) {
    for (const [key, role] of Object.entries(roles)) {
      for (const employee of role.employees) {
        const identity = hierarchy.employeeNodes?.[employee.id];
        const manager = hierarchy.parents?.[identity] || hierarchy.workbookManagers?.[key];
        if (manager) employee.reportingManager = {
          name: manager,
          type: hierarchy.departments?.includes(manager) ? 'department' : 'person',
          source: 'project'
        };
      }
    }
  }
  return { orgId: ORG_ID, fetchedAt: roster.fetchedAt, roles };
}

module.exports = { buildReviewDirectory, displayName };
