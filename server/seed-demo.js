// Creates a demo tournament so you can try every screen.
//   npm run demo            (writes ./data-demo and starts the server on it)
//   node server/seed-demo.js <dataDir> [--start]
import fs from 'node:fs';
import path from 'node:path';
import { emptyState } from '../shared/model.js';
import { applyCommand } from '../shared/reducer.js';

const args = process.argv.slice(2);
const startAfter = args.includes('--start');
const dir = args.find((a) => !a.startsWith('--')) || 'data-demo';
fs.mkdirSync(dir, { recursive: true });

const state = emptyState();
const admin = { role: 'admin' };
let n = 0;
const run = (type, payload) => applyCommand(state, { id: `seed${++n}`, type, payload, at: new Date().toISOString() }, admin);

run('tournament.update', { patch: { name: 'CWMA Fall Classic (Demo)', date: new Date().toISOString().slice(0, 10) } });
for (let i = 1; i <= 3; i++) run('ring.create', { ring: { id: `ring${i}`, number: i } });

const first = ['Alex', 'Sam', 'Riley', 'Jordan', 'Morgan', 'Casey', 'Taylor', 'Jamie', 'Avery', 'Quinn', 'Rowan', 'Skyler', 'Drew', 'Reese', 'Parker', 'Emerson', 'Hayden', 'Kai', 'Logan', 'Sage', 'Blake', 'Cameron', 'Dakota', 'Finley'];
const last = ['Kim', 'Patel', 'Chen', 'Rivera', 'Lee', 'Nguyen', 'Garcia', 'Smith', 'Johnson', 'Brown', 'Davis', 'Lopez', 'Wilson', 'Clark', 'Lewis', 'Young', 'Hall', 'Allen', 'King', 'Wright', 'Scott', 'Green', 'Adams', 'Baker'];
const dojos = ['Central Dojo', 'Westside Karate', 'Tiger Martial Arts', 'North Valley'];
const belts = ['beginner', 'intermediate', 'advanced', 'black'];
const ids = [];
for (let i = 0; i < 24; i++) {
  const id = `c${i + 1}`;
  ids.push(id);
  run('competitor.create', { competitor: { id, firstName: first[i], lastName: last[i], age: i < 16 ? 8 + (i % 8) : 18 + i, sex: i % 2 ? 'F' : 'M', belt: belts[i % 4], dojo: dojos[i % 4], checkedIn: i % 5 !== 0, source: 'import' } });
}

const div = (id, ringId, fields, members) => run('division.create', { division: { id, ringId, competitorIds: members, options: { thirdPlace: 'match', judges: 3 }, ...fields } });
div('d1', 'ring1', { code: 'K1', name: 'Youth Kata 8-11', event: 'kata', format: 'kata_scores' }, ids.slice(0, 8));
div('d2', 'ring1', { code: 'KU1', name: 'Youth Kumite 8-11', event: 'kumite', format: 'single_elim' }, ids.slice(0, 7));
div('d3', 'ring2', { code: 'CH1', name: 'Youth Chambara 12-15', event: 'chambara', format: 'single_elim' }, ids.slice(8, 16));
div('d4', 'ring2', { code: 'KU2', name: 'Adult Kumite', event: 'kumite', format: 'round_robin' }, ids.slice(16, 21));
div('d5', 'ring3', { code: 'GK1', name: 'Grand Championship Kata — Under 18', event: 'kata', format: 'placement', grand: true, grandGroup: 'under18' }, ['c1', 'c9', 'c3']);
div('d6', 'ring3', { code: 'GK2', name: 'Grand Championship Black Belt Kumite — 18+', event: 'kumite', format: 'single_elim', grand: true, grandGroup: 'adult' }, ['c20', 'c24', 'c17', 'c21']);

fs.writeFileSync(path.join(dir, 'tournament.json'), JSON.stringify({ state, appliedIds: [] }));
fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ adminPin: '1234', displayPin: '1234', ringPins: { ring1: '1111', ring2: '2222', ring3: '3333' }, sessions: {} }, null, 2));
console.log(`Demo tournament written to ${dir}  (admin/display PIN 1234, ring PINs 1111 / 2222 / 3333)`);

if (startAfter) {
  const { createServer } = await import('./index.js');
  const { server, shutdown } = createServer({ dataDir: path.resolve(dir) });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`Demo running at http://localhost:${port}`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { shutdown(); process.exit(0); });
}
