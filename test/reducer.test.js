import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../shared/model.js';
import { applyCommand, authorize } from '../shared/reducer.js';
import { generateBracket } from '../shared/bracket.js';

const admin = { role: 'admin' };
const ring1 = { role: 'ring', ringId: 'r1' };
const display = { role: 'display' };
let n = 0;
const run = (state, actor, type, payload) => {
  const cmd = { id: `cmd${++n}`, type, payload, at: '2026-11-08T10:00:00Z' };
  authorize(state, cmd, actor);
  applyCommand(state, cmd, actor);
  return state;
};

function setup() {
  const s = emptyState();
  run(s, admin, 'ring.create', { ring: { id: 'r1', number: 1 } });
  run(s, admin, 'ring.create', { ring: { id: 'r2', number: 2 } });
  for (const id of ['a', 'b', 'c']) run(s, admin, 'competitor.create', { competitor: { id, firstName: id.toUpperCase(), lastName: 'X', age: 10 } });
  run(s, admin, 'division.create', { division: { id: 'd1', name: 'Youth Kumite', event: 'kumite', format: 'single_elim', competitorIds: ['a', 'b', 'c'], ringId: 'r1' } });
  run(s, admin, 'division.create', { division: { id: 'd2', name: 'Youth Kata', event: 'kata', format: 'kata_scores', competitorIds: ['a'], ringId: 'r2' } });
  return s;
}

test('ring write-in is flagged, checked in and added to the division', () => {
  const s = setup();
  run(s, ring1, 'competitor.create', { competitor: { id: 'w', firstName: 'Walk', lastName: 'In' }, divisionId: 'd1' });
  const c = s.competitors.w;
  assert.equal(c.flagged, true);
  assert.equal(c.source, 'ring');
  assert.equal(c.addedByRingId, 'r1');
  assert.equal(c.checkedIn, true);
  assert.ok(s.divisions.d1.competitorIds.includes('w'));
});

test('rings cannot touch other rings or admin-only commands', () => {
  const s = setup();
  assert.throws(() => run(s, ring1, 'division.start', { divisionId: 'd2' }), /another ring/);
  assert.throws(() => run(s, ring1, 'division.delete', { id: 'd1' }), /Rings cannot/);
  assert.throws(() => run(s, display, 'competitor.checkIn', { id: 'a' }), /display/);
  assert.throws(() => run(s, { role: 'viewer' }, 'queue.add', {}), /Read-only/);
});

test('submit queues an award; reopen recalls it; display flow works', () => {
  const s = setup();
  const d = s.divisions.d1;
  run(s, ring1, 'bracket.generate', { divisionId: 'd1', bracket: generateBracket(d, s.competitors) });
  run(s, ring1, 'division.submit', { divisionId: 'd1', results: { first: 'a', second: 'b', third: 'c' }, queueItemId: 'q1' });
  assert.equal(s.divisions.d1.status, 'completed');
  assert.equal(s.queue.q1.type, 'award');
  assert.deepEqual(s.queueOrder, ['q1']);

  run(s, ring1, 'division.reopen', { divisionId: 'd1' });
  assert.equal(s.queue.q1.status, 'recalled');
  assert.deepEqual(s.queueOrder, []);

  run(s, ring1, 'division.submit', { divisionId: 'd1', results: { first: 'b', second: 'a' }, queueItemId: 'q2' });
  run(s, display, 'display.goLive', { itemId: 'q2' });
  assert.equal(s.display.live, 'q2');
  assert.equal(s.queue.q2.status, 'live');
  run(s, display, 'display.goLive', { itemId: null });
  assert.equal(s.queue.q2.status, 'done');
  assert.equal(s.display.live, null);
});

test('missing competitor requests wait for display approval and dedupe', () => {
  const s = setup();
  run(s, ring1, 'missing.request', { divisionId: 'd1', competitorId: 'a', itemId: 'm1' });
  run(s, ring1, 'missing.request', { divisionId: 'd1', competitorId: 'a', itemId: 'm2' });
  assert.equal(Object.keys(s.queue).length, 1);
  assert.equal(s.queue.m1.status, 'pending_approval');
  assert.deepEqual(s.queueOrder, []);
  run(s, display, 'queue.approve', { id: 'm1', position: 'front' });
  assert.deepEqual(s.queueOrder, ['m1']);
});

test('grand division submits a grand slide', () => {
  const s = setup();
  run(s, admin, 'division.create', { division: { id: 'g', name: 'Grand Kata U18', grand: true, format: 'placement', competitorIds: ['a', 'b'], ringId: 'r1' } });
  run(s, ring1, 'division.submit', { divisionId: 'g', results: { first: 'a' }, queueItemId: 'gq' });
  assert.equal(s.queue.gq.type, 'grand');
});

test('assigning, splitting and merging divisions keeps ring schedules consistent', () => {
  const s = setup();
  run(s, admin, 'division.assignRing', { id: 'd2', ringId: 'r1', position: 0 });
  assert.deepEqual(s.rings.r1.schedule, ['d2', 'd1']);
  assert.deepEqual(s.rings.r2.schedule, []);
  run(s, admin, 'division.split', { id: 'd1', competitorIds: ['c'], newDivision: { id: 'd1b', name: 'Youth Kumite B' } });
  assert.deepEqual(s.rings.r1.schedule, ['d2', 'd1', 'd1b']);
  assert.deepEqual(s.divisions.d1b.competitorIds, ['c']);
  run(s, admin, 'division.merge', { targetId: 'd1', sourceId: 'd1b' });
  assert.deepEqual(s.rings.r1.schedule, ['d2', 'd1']);
  assert.deepEqual(s.divisions.d1.competitorIds.sort(), ['a', 'b', 'c']);
});

test('cannot edit a submitted bracket until reopened', () => {
  const s = setup();
  run(s, ring1, 'bracket.generate', { divisionId: 'd1', bracket: generateBracket(s.divisions.d1, s.competitors) });
  run(s, ring1, 'division.submit', { divisionId: 'd1', results: { first: 'a' } });
  assert.throws(() => run(s, ring1, 'bracket.setWinner', { divisionId: 'd1', matchId: 'r1m0', winnerId: 'a' }), /reopen/);
});
