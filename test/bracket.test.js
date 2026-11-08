import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBracket, computeBracket, spreadOrder } from '../shared/bracket.js';
import { newDivision } from '../shared/model.js';

function seeded(seed = 1) {
  return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
}

const comps = (n, dojos = []) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i}`, { id: `c${i}`, firstName: `C${i}`, dojo: dojos[i] || '' }]));

function division(format, n, extra = {}) {
  return newDivision({ id: 'd1', format, competitorIds: Array.from({ length: n }, (_, i) => `c${i}`), ...extra });
}

test('single elimination with byes auto-advances and produces places', () => {
  const d = division('single_elim', 5);
  d.bracket = generateBracket(d, comps(5), seeded(3));
  assert.equal(d.bracket.size, 8);
  assert.equal(d.bracket.slots.filter(Boolean).length, 5);
  // No round-one match should be bye vs bye.
  for (let i = 0; i < 4; i++) assert.ok(d.bracket.slots[2 * i] || d.bracket.slots[2 * i + 1]);

  let view = computeBracket(d);
  assert.equal(view.complete, false);
  // Play every ready match picking side "a" until complete.
  for (let guard = 0; guard < 20 && !view.complete; guard++) {
    const m = view.matches.find((x) => x.state === 'ready');
    d.bracket.winners[m.id] = m.a;
    view = computeBracket(d);
  }
  assert.equal(view.complete, true);
  const { first, second, third } = view.suggested;
  assert.ok(first && second && third);
  assert.equal(new Set([first, second, third]).size, 3);
});

test('changing an early result clears dependent later results', () => {
  const d = division('single_elim', 4);
  d.bracket = generateBracket(d, comps(4), seeded(5));
  let v = computeBracket(d);
  const [s1, s2] = v.rounds[0];
  d.bracket.winners[s1.id] = s1.a;
  d.bracket.winners[s2.id] = s2.a;
  d.bracket.winners.r2m0 = s1.a;
  v = computeBracket(d);
  assert.equal(v.final.winner, s1.a);
  d.bracket.winners[s1.id] = s1.b; // correction
  v = computeBracket(d);
  assert.equal(v.final.state, 'ready');
  assert.equal(v.final.winner, undefined);
});

test('withdrawal forfeits the match to the opponent', () => {
  const d = division('single_elim', 2);
  d.bracket = generateBracket(d, comps(2), seeded(7));
  d.bracket.withdrawn = [d.bracket.slots[0]];
  const v = computeBracket(d);
  assert.equal(v.final.state, 'forfeit');
  assert.equal(v.suggested.first, d.bracket.slots[1]);
  assert.equal(v.complete, true);
});

test('three competitors: bye in a semifinal still yields a third place', () => {
  const d = division('single_elim', 3);
  d.bracket = generateBracket(d, comps(3), seeded(11));
  let v = computeBracket(d);
  const ready = v.matches.filter((m) => m.state === 'ready');
  assert.equal(ready.length, 1);
  d.bracket.winners[ready[0].id] = ready[0].a;
  v = computeBracket(d);
  d.bracket.winners.r2m0 = v.final.a;
  v = computeBracket(d);
  assert.equal(v.complete, true);
  assert.equal(v.suggested.third, ready[0].b);
});

test('same-dojo competitors are split across halves when possible', () => {
  const dojos = ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D'];
  for (let s = 1; s < 30; s++) {
    const d = division('single_elim', 8);
    const b = generateBracket(d, comps(8, dojos), seeded(s));
    for (let i = 0; i < 4; i++) {
      const [x, y] = [b.slots[2 * i], b.slots[2 * i + 1]];
      assert.notEqual(dojos[+x.slice(1)], dojos[+y.slice(1)], `seed ${s}: first-round same-dojo match`);
    }
    const top = b.slots.slice(0, 4).map((id) => dojos[+id.slice(1)]);
    assert.equal(new Set(top).size, 4, `seed ${s}: dojo pair in same half`);
  }
});

test('round robin standings rank by wins', () => {
  const d = division('round_robin', 4);
  d.bracket = generateBracket(d, comps(4), seeded(2));
  assert.equal(d.bracket.pairs.length, 6);
  // c0 beats everyone, c1 beats c2 & c3, c2 beats c3.
  const rank = { c0: 0, c1: 1, c2: 2, c3: 3 };
  for (const p of d.bracket.pairs) d.bracket.winners[p.id] = rank[p.a] < rank[p.b] ? p.a : p.b;
  const v = computeBracket(d);
  assert.equal(v.complete, true);
  assert.deepEqual([v.suggested.first, v.suggested.second, v.suggested.third], ['c0', 'c1', 'c2']);
});

test('kata scores total three judges with no drops', () => {
  const d = division('kata_scores', 3, { options: { judges: 3 } });
  d.bracket = generateBracket(d, comps(3), seeded(4));
  d.bracket.scores = { c0: [8, 8, 8], c1: [9, 7, 9.5], c2: [7, 7, 7] };
  const v = computeBracket(d);
  assert.deepEqual(v.ranking, ['c1', 'c0', 'c2']);
  assert.equal(v.rows.find((r) => r.id === 'c1').total, 25.5);
  assert.equal(v.complete, true);
});

test('spreadOrder keeps everyone exactly once', () => {
  const order = spreadOrder(['c0', 'c1', 'c2', 'c3', 'c4'], comps(5, ['A', 'A', 'A', 'B', 'C']), seeded(9));
  assert.deepEqual([...order].sort(), ['c0', 'c1', 'c2', 'c3', 'c4']);
});

test('absent competitors are left out of the bracket', () => {
  const d = division('single_elim', 4, { absentIds: ['c2'] });
  const b = generateBracket(d, comps(4), seeded(1));
  assert.ok(!b.slots.includes('c2'));
  assert.equal(b.slots.filter(Boolean).length, 3);
});
