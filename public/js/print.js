// Printable paper backups: bracket sheets per division, rosters, and results.
import { html, mount, Sync, useSync, useState, Loading } from './core.js';
import { ringDivisions, ringLabel, sortedRings, divisionLabel, eventLabel, formatLabel, competitorName, beltLabel } from '/shared/model.js';
import { BracketView } from './bracketView.js';
import { byName } from './forms.js';

const sync = new Sync('print').start();

function DivisionSheet({ state, division: d, ring }) {
  const members = d.competitorIds.map((id) => state.competitors[id]).filter(Boolean).sort(byName);
  const r = d.results || {};
  return html`
    <div class="print-page card" style="margin-bottom:1rem">
      <div class="row-between">
        <div><h2 style="margin:0">${divisionLabel(d)}</h2><div class="muted small">${eventLabel(d.event)} · ${formatLabel(d.format)}${d.grand ? ' · Grand championship' : ''}</div></div>
        <div style="text-align:right"><strong>${ringLabel(ring)}</strong><div class="muted small">${state.tournament.name}</div></div>
      </div>
      ${d.bracket ? html`<div style="margin-top:.75rem"><${BracketView} state=${state} division=${d} interactive=${false} /></div>` : html`
        <table style="margin-top:.75rem">
          <thead><tr><th style="width:2rem">#</th><th>Competitor</th><th>Age</th><th>Belt</th><th>Dojo</th><th style="width:5rem">Present</th>${d.format === 'kata_scores' && html`<th>J1</th><th>J2</th><th>J3</th><th>Total</th>`}</tr></thead>
          <tbody>${members.map((c, i) => html`<tr key=${c.id}><td>${i + 1}</td><td>${competitorName(c)}</td><td>${c.age ?? ''}</td><td>${beltLabel(c.belt)}</td><td>${c.dojo}</td><td>☐</td>${d.format === 'kata_scores' && html`<td></td><td></td><td></td><td></td>`}</tr>`)}</tbody>
        </table>`}
      <div class="row" style="margin-top:1rem;gap:2rem">
        ${[['1st', 'first'], ['2nd', 'second'], ['3rd', 'third']].map(([label, k]) => html`<div key=${k} class="grow" style="border-bottom:1px solid #999;padding-bottom:.25rem"><span class="muted small">${label}:</span> <strong>${r[k] ? competitorName(state.competitors[r[k]]) : ''}</strong></div>`)}
      </div>
    </div>`;
}

function App() {
  useSync(sync);
  const [ringId, setRingId] = useState('all');
  const [mode, setMode] = useState('sheets');
  const state = sync.state;
  if (!state) return html`<${Loading} />`;
  const rings = sortedRings(state).filter((r) => ringId === 'all' || r.id === ringId);
  return html`
    <div class="no-print topbar">
      <span class="title">Print</span>
      <select value=${mode} onChange=${(e) => setMode(e.target.value)}><option value="sheets">Division sheets / brackets</option><option value="results">Results summary</option></select>
      <select value=${ringId} onChange=${(e) => setRingId(e.target.value)}><option value="all">All rings</option>${sortedRings(state).map((r) => html`<option value=${r.id}>${ringLabel(r)}</option>`)}</select>
      <span class="spacer"></span>
      <button class="btn" onClick=${() => window.print()}>🖨 Print</button>
    </div>
    <main>
      ${mode === 'sheets' && rings.map((ring) => ringDivisions(state, ring.id).map((d) => html`<${DivisionSheet} key=${d.id} state=${state} division=${d} ring=${ring} />`))}
      ${mode === 'results' && html`
        <h1>${state.tournament.name} — Results</h1>
        ${rings.map((ring) => html`
          <h2 style="margin-top:1rem">${ringLabel(ring)}</h2>
          <table>
            <thead><tr><th>Division</th><th>1st</th><th>2nd</th><th>3rd</th></tr></thead>
            <tbody>${ringDivisions(state, ring.id).map((d) => html`<tr key=${d.id}><td>${divisionLabel(d)}</td>${['first', 'second', 'third'].map((k) => html`<td>${d.results?.[k] ? competitorName(state.competitors[d.results[k]]) : ''}</td>`)}</tr>`)}</tbody>
          </table>`)}`}
    </main>`;
}

mount(App);
