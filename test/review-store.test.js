'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createStore, mountReviews } = require('../lib/review-store');

// The few collection calls the store makes, held in memory.
function fakeCollection() {
  const docs = new Map();
  return {
    docs,
    find: () => ({ toArray: async () => [...docs.values()] }),
    findOne: async ({ _id }) => docs.get(_id) || null,
    insertOne: async doc => { if (docs.has(doc._id)) throw Object.assign(new Error('duplicate'), { code: 11000 }); docs.set(doc._id, doc); },
    updateOne: async ({ _id, revision }, { $set }) => {
      const current = docs.get(_id);
      if (!current || current.revision !== revision) return { matchedCount: 0 };
      docs.set(_id, { ...current, ...$set });
      return { matchedCount: 1 };
    },
  };
}
const state = (roleId, note) => ({ version: 2, roleId, setup: {}, reviews: { Sep: { overallRemark: note } } });

test('a save moves the revision on, and a save from a stale copy is refused with the stored one', async () => {
  const store = createStore(async () => collection);
  const collection = fakeCollection();
  const first = await store.save('psm', '101', state('psm', 'first'), 0);
  assert.equal(first.saved.revision, 1);
  const second = await store.save('psm', '101', state('psm', 'second'), 1);
  assert.equal(second.saved.revision, 2);
  // another device still holding revision 1
  const stale = await store.save('psm', '101', state('psm', 'stale'), 1);
  assert.equal(stale.saved, undefined);
  assert.equal(stale.conflict.revision, 2);
  assert.equal(stale.conflict.state.reviews.Sep.overallRemark, 'second');
  // two devices both creating the first copy: only one wins
  const duplicate = await store.save('psm', '101', state('psm', 'again'), 0);
  assert.equal(duplicate.conflict.revision, 2);
  assert.deepEqual((await store.list()).map(doc => [doc.policyRole, doc.employeeId, doc.revision]), [['psm', '101', 2]]);
  assert.equal(Object.hasOwn((await store.list())[0], '_id'), false);
});

async function serve(t, options) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  mountReviews(app, options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/flash-review/reviews`;
  const put = (path, body) => fetch(base + path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { base, put };
}

test('review routes: load, save, conflict and rejected input', async t => {
  const collection = fakeCollection();
  const { base, put } = await serve(t, { store: createStore(async () => collection) });
  assert.deepEqual(await (await fetch(base)).json(), { enabled: true, reviews: [] });

  const saved = await put('/psm/101', { state: state('psm', 'hello'), revision: 0 });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 1);
  const project = await put(`/designer/${encodeURIComponent('local:designer-rashi')}`, { state: state('designer', 'd'), revision: 0 });
  assert.equal(project.status, 200);

  const conflict = await put('/psm/101', { state: state('psm', 'late'), revision: 0 });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).current.state.reviews.Sep.overallRemark, 'hello');

  const listed = await (await fetch(base)).json();
  assert.deepEqual(listed.reviews.map(doc => doc.employeeId).sort(), ['101', 'local:designer-rashi']);

  for (const [path, body] of [
    ['/not_a_role/101', { state: state('not_a_role', 'x'), revision: 0 }],
    ['/psm/..%2Fadmin', { state: state('psm', 'x'), revision: 0 }],
    ['/psm/101', { state: state('asm', 'x'), revision: 0 }],      // state filed under the wrong workbook
    ['/psm/101', { state: state('psm', 'x'), revision: -1 }],
    ['/psm/101', { state: 'text', revision: 0 }],
  ]) assert.equal((await put(path, body)).status, 400, path);
});

test('without a database the page is told to stay on browser storage; a database error is not a crash', async t => {
  const previous = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  t.after(() => { if (previous !== undefined) process.env.MONGODB_URI = previous; });
  const off = await serve(t, {});
  assert.deepEqual(await (await fetch(off.base)).json(), { enabled: false, reviews: [] });
  assert.equal((await off.put('/psm/101', { state: state('psm', 'x'), revision: 0 })).status, 503);

  const broken = await serve(t, { store: { list: async () => { throw new Error('down'); }, save: async () => { throw new Error('down'); } } });
  assert.equal((await fetch(broken.base)).status, 503);
  assert.equal((await broken.put('/psm/101', { state: state('psm', 'x'), revision: 0 })).status, 503);
});
