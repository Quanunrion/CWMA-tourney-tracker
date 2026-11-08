// Read-only live board: what every ring is doing. Safe to show publicly.
import { html, mount, Sync, useSync, useState, ConnectionBadge, Loading } from './core.js';
import { ringDivisions, ringLabel, sortedRings, divisionLabel, eventLabel, competitorName } from '/shared/model.js';
import { searchCompetitors, CompetitorLine, Assignments } from './forms.js';

const sync = new Sync('status').start();

function App() {
  useSync(sync);
  const [q, setQ] = useState('');
  const state = sync.state;
  if (!state) return html`<${Loading} />`;
  const rings = sortedRings(state);
  const found = q.trim().length >= 2 ? searchCompetitors(state, q, 8) : [];
  return html`
    <div class="topbar">
      <span class="title">${state.tournament.name}</span><span class="sub">Ring status</span>
      <span class="spacer"></span><${ConnectionBadge} sync=${sync} />
    </div>
    <main class="stack">
      <div class="card stack">
        <input class="search" placeholder="Find a competitor — where do I go?" value=${q} onInput=${(e) => setQ(e.target.value)} />
        ${found.map((c) => html`<div key=${c.id} class="list-item" style="align-items:flex-start"><span style="min-width:220px"><${CompetitorLine} c=${c} /></span><${Assignments} state=${state} competitorId=${c.id} /></div>`)}
      </div>
      <div class="board">
        ${rings.map((ring) => {
          const list = ringDivisions(state, ring.id);
          const current = ring.currentDivisionId ? state.divisions[ring.currentDivisionId] : null;
          const upcoming = list.filter((d) => d.status !== 'completed' && d.id !== current?.id);
          const done = list.filter((d) => d.status === 'completed').length;
          const pct = list.length ? Math.round((done / list.length) * 100) : 0;
          return html`
            <div class="card board-ring stack" key=${ring.id}>
              <div class="row-between"><h2 style="margin:0">${ringLabel(ring)}</h2><span class="muted small">${done}/${list.length} divisions</span></div>
              <div class="progress"><div style=${{ width: `${pct}%` }}></div></div>
              <div>
                <div class="muted small">NOW</div>
                ${current ? html`<div><strong style="font-size:1.1rem">${divisionLabel(current)}</strong><div class="muted small">${eventLabel(current.event)} · ${current.competitorIds.length} competitors</div></div>` : html`<div class="muted">—</div>`}
              </div>
              <div>
                <div class="muted small">ON DECK</div>
                ${upcoming.slice(0, 3).map((d, i) => html`<div key=${d.id} style=${i ? 'opacity:.7' : 'font-weight:600'}>${divisionLabel(d)} <span class="muted small">${eventLabel(d.event)}</span></div>`)}
                ${!upcoming.length && html`<div class="muted">—</div>`}
              </div>
              ${list.filter((d) => d.status === 'completed').slice(-2).reverse().map((d) => html`
                <div class="small muted" key=${d.id}>✓ ${divisionLabel(d)}: <strong>${competitorName(state.competitors[d.results?.first])}</strong></div>`)}
            </div>`;
        })}
      </div>
      ${!rings.length && html`<div class="empty">No rings set up yet.</div>`}
    </main>`;
}

mount(App);
