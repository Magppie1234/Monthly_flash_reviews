'use strict';

// No stable authenticated local principal, Blueprint authorization evaluator,
// or per-request audit-actor binding is mounted today. This status is a
// server-owned fact: request bodies, headers, and environment flags cannot
// widen it.
const CURRENT_STATUS = Object.freeze({
  request_principal_verified: false,
  identity_authorization_verified: false,
  audit_actor_binding_verified: false,
});

function getBlueprintIdentityAuthorizationStatus() {
  return CURRENT_STATUS;
}

module.exports = {
  getBlueprintIdentityAuthorizationStatus,
};
