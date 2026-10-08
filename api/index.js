// Production is intentionally snapshot-only while the external CRM/database
// connection is paused. The connected server remains available explicitly via
// `npm run start:connected` for a future reviewed re-enable.
module.exports = require('../server-offline.js');
