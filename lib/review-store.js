'use strict';

// Monthly Flash Reviews kept in MongoDB, one document per employee workbook, so a review is the
// same on every device. Without MONGODB_URI the routes report "not enabled" and the page keeps
// working from the browser's own storage exactly as before.
//
// Two reviewers can have the same workbook open. Every document carries a revision; a save names
// the revision it started from and is refused if the document has moved on, so the later save
// never silently replaces the earlier one.

const dns = require('node:dns');
const { constants } = require('../public/flash-review');

const COLLECTION = 'flash_reviews';
const EMPLOYEE_ID = /^(?:\d+|local:[a-z0-9-]+)$/;
const PUBLIC_DNS = ['8.8.8.8', '1.1.1.1'];

let connecting = null;

// Some networks hand out a resolver that refuses the SRV lookup a mongodb+srv address needs.
// Only then, and only for this process, ask public resolvers instead.
async function open(uri) {
  const { MongoClient } = require('mongodb');
  const attempt = () => new MongoClient(uri, { serverSelectionTimeoutMS: 10000 }).connect();
  try { return await attempt(); } catch (error) {
    if (!/querySrv/.test(String(error.message))) throw error;
    dns.setServers(PUBLIC_DNS);
    return attempt();
  }
}

function collection(uri = process.env.MONGODB_URI) {
  connecting ||= open(uri).then(client => client.db().collection(COLLECTION)).catch(error => { connecting = null; throw error; });
  return connecting;
}

const key = (policyRole, employeeId) => `${policyRole}:${employeeId}`;
const publicShape = doc => ({ policyRole: doc.policyRole, employeeId: doc.employeeId, state: doc.state, revision: doc.revision, updatedAt: doc.updatedAt });

function createStore(getCollection = collection) {
  return {
    async list() {
      const docs = await (await getCollection()).find({}).toArray();
      return docs.map(publicShape);
    },
    // Returns { saved } or, when the stored copy is newer than the one the save started from, { conflict }.
    async save(policyRole, employeeId, state, baseRevision) {
      const reviews = await getCollection();
      const _id = key(policyRole, employeeId);
      const next = { policyRole, employeeId, state, revision: baseRevision + 1, updatedAt: new Date().toISOString() };
      if (baseRevision === 0) {
        try { await reviews.insertOne({ _id, ...next }); return { saved: publicShape(next) }; } catch (error) { if (error.code !== 11000) throw error; }
      } else {
        const result = await reviews.updateOne({ _id, revision: baseRevision }, { $set: next });
        if (result.matchedCount === 1) return { saved: publicShape(next) };
      }
      const current = await reviews.findOne({ _id });
      return current ? { conflict: publicShape(current) } : { conflict: null };
    },
  };
}

function mountReviews(app, options = {}) {
  const enabled = () => Boolean(options.store || process.env.MONGODB_URI);
  const store = () => options.store || (options.store = createStore());
  // A hosted copy would hand every review to whoever opens the link, so it must sit behind the access code.
  const open = () => !(process.env.VERCEL_ENV && !process.env.ACCESS_CODE);
  const failed = res => res.status(503).json({ error: 'The review database did not answer. Your entries are kept in this browser.' });

  app.get('/api/flash-review/reviews', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!enabled() || !open()) return res.json({ enabled: false, reviews: [] });
    try { return res.json({ enabled: true, reviews: await store().list() }); } catch { return failed(res); }
  });

  app.put('/api/flash-review/reviews/:role/:employeeId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!enabled() || !open()) return res.status(503).json({ error: 'Review storage is not switched on for this site.' });
    const { role, employeeId } = req.params;
    const { state, revision } = req.body || {};
    const valid = Object.hasOwn(constants.ROLE_CONFIGS, role) && EMPLOYEE_ID.test(employeeId)
      && state && typeof state === 'object' && !Array.isArray(state) && state.roleId === role
      && Number.isInteger(revision) && revision >= 0;
    if (!valid) return res.status(400).json({ error: 'This review could not be saved: the workbook or employee is not recognised.' });
    try {
      const result = await store().save(role, employeeId, state, revision);
      if (result.saved) return res.json({ revision: result.saved.revision, updatedAt: result.saved.updatedAt });
      return res.status(409).json({ error: 'Someone else saved this review first.', current: result.conflict });
    } catch { return failed(res); }
  });
}

module.exports = { createStore, mountReviews };
