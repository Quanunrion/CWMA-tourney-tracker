import { toCsv } from '../shared/csv.js';
import { competitorName, beltLabel, eventLabel, divisionLabel, ringLabel } from '../shared/model.js';

export function buildExports(state, file) {
  const stamp = new Date().toISOString().slice(0, 10);
  const comp = (id) => state.competitors[id];
  switch (file) {
    case 'competitors.csv': {
      const rows = [['First name', 'Last name', 'Age', 'Sex', 'Belt', 'Dojo', 'Checked in', 'Source', 'Flagged', 'Flag reason', 'Divisions', 'Rings']];
      for (const c of Object.values(state.competitors)) {
        const divs = Object.values(state.divisions).filter((d) => d.competitorIds.includes(c.id));
        rows.push([c.firstName, c.lastName, c.age ?? '', c.sex, beltLabel(c.belt), c.dojo, c.checkedIn ? 'yes' : 'no', c.source, c.flagged ? 'yes' : 'no', c.flagReason,
          divs.map(divisionLabel).join('; '), [...new Set(divs.map((d) => ringLabel(state.rings[d.ringId])))].join('; ')]);
      }
      return { filename: `competitors-${stamp}.csv`, type: 'text/csv', body: toCsv(rows) };
    }
    case 'results.csv': {
      const rows = [['Division code', 'Division', 'Event', 'Grand', 'Ring', 'Status', 'Place', 'Competitor', 'Dojo']];
      for (const d of Object.values(state.divisions)) {
        const ring = ringLabel(state.rings[d.ringId]);
        if (!d.results) { rows.push([d.code, d.name, eventLabel(d.event), d.grand ? 'yes' : '', ring, d.status, '', '', '']); continue; }
        for (const [place, key] of [['1st', 'first'], ['2nd', 'second'], ['3rd', 'third']]) {
          const c = comp(d.results[key]);
          if (c) rows.push([d.code, d.name, eventLabel(d.event), d.grand ? 'yes' : '', ring, d.status, place, competitorName(c), c.dojo]);
        }
      }
      return { filename: `results-${stamp}.csv`, type: 'text/csv', body: toCsv(rows) };
    }
    case 'medals.csv': {
      const tally = new Map();
      for (const d of Object.values(state.divisions)) {
        if (!d.results) continue;
        for (const key of ['first', 'second', 'third']) {
          const c = comp(d.results[key]);
          if (!c) continue;
          const dojo = c.dojo || '(no dojo listed)';
          if (!tally.has(dojo)) tally.set(dojo, { first: 0, second: 0, third: 0 });
          tally.get(dojo)[key]++;
        }
      }
      const rows = [['Dojo', '1st', '2nd', '3rd', 'Total']];
      [...tally.entries()].sort((a, b) => b[1].first - a[1].first || b[1].second - a[1].second || b[1].third - a[1].third)
        .forEach(([dojo, t]) => rows.push([dojo, t.first, t.second, t.third, t.first + t.second + t.third]));
      return { filename: `medal-count-${stamp}.csv`, type: 'text/csv', body: toCsv(rows) };
    }
    case 'backup.json':
      return { filename: `tournament-backup-${stamp}.json`, type: 'application/json', body: JSON.stringify({ state }, null, 1) };
    default:
      return null;
  }
}
