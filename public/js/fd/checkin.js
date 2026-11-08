import { html, useState, useMemo, Modal, newId, toast, confirmAction } from '../core.js';
import { competitorName, competitorAssignments, ringLabel, divisionLabel, eventLabel, beltLabel, normalizeBelt, normalizeSex, matchesCriteria } from '/shared/model.js';
import { parseCsvObjects } from '/shared/csv.js';
import { CompetitorForm, CompetitorLine, knownDojos, searchCompetitors, byName, Assignments } from '../forms.js';
export { Assignments };
import { sync } from './sync.js';

export function CheckIn({ state }) {
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [adding, setAdding] = useState(false);
  const all = Object.values(state.competitors);
  const checked = all.filter((c) => c.checkedIn).length;
  const results = useMemo(() => searchCompetitors(state, q, 60), [state, q]);
  const selected = selectedId && state.competitors[selectedId];

  return html`
    <div class="grid-2" style="grid-template-columns:minmax(320px,1fr) minmax(320px,1fr);align-items:start">
      <div class="stack">
        <div class="row-between">
          <h2 style="margin:0">Check in</h2>
          <div class="row"><span class="badge badge-ok">${checked} / ${all.length} checked in</span><button class="btn btn-primary" onClick=${() => setAdding(true)}>＋ Walk-in</button></div>
        </div>
        <input class="search" placeholder="Type a name or dojo…" value=${q} onInput=${(e) => setQ(e.target.value)} autofocus />
        <div class="list">
          ${results.map((c) => html`
            <div key=${c.id} class=${`list-item clickable ${selectedId === c.id ? 'active' : ''}`} onClick=${() => setSelectedId(c.id)}>
              <span class="grow"><${CompetitorLine} c=${c} /></span>
              ${c.flagged && html`<span class="badge badge-warn" title=${c.flagReason}>flag</span>`}
              <button class=${`btn btn-sm ${c.checkedIn ? 'btn-ok' : ''}`} onClick=${(e) => { e.stopPropagation(); sync.dispatch('competitor.checkIn', { id: c.id, checkedIn: !c.checkedIn }); setSelectedId(c.id); }}>
                ${c.checkedIn ? '✓ Checked in' : 'Check in'}
              </button>
            </div>`)}
          ${!results.length && html`<div class="empty">Nobody found. <button class="btn btn-sm" onClick=${() => setAdding(true)}>Add as walk-in</button></div>`}
        </div>
      </div>
      <div>${selected ? html`<${CompetitorDetail} state=${state} competitor=${selected} onDeleted=${() => setSelectedId(null)} />` : html`<div class="empty">Select a competitor to see where they compete.</div>`}</div>
      ${adding && html`
        <${Modal} title="Walk-in registration" onClose=${() => setAdding(false)}>
          <p class="muted small">Collect payment in the payment system, then add them here. They'll be checked in automatically.</p>
          <${CompetitorForm} initial=${{ firstName: q.split(' ')[0] || '', lastName: q.split(' ').slice(1).join(' ') }} dojos=${knownDojos(state)} submitLabel="Add & check in" onCancel=${() => setAdding(false)}
            onSubmit=${(f) => { const id = newId('c'); if (sync.dispatch('competitor.create', { competitor: { ...f, id, checkedIn: true } })) { setAdding(false); setSelectedId(id); toast('Walk-in added — now assign divisions', 'ok'); } }} />
        <//>`}
    </div>`;
}

export function CompetitorDetail({ state, competitor: c, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [divQ, setDivQ] = useState('');
  const memberOf = Object.values(state.divisions).filter((d) => d.competitorIds.includes(c.id));
  const suggestions = Object.values(state.divisions)
    .filter((d) => !d.competitorIds.includes(c.id) && d.status !== 'completed')
    .filter((d) => (divQ ? divisionLabel(d).toLowerCase().includes(divQ.toLowerCase()) : matchesCriteria(c, d.criteria)))
    .slice(0, 12);
  return html`
    <div class="card stack">
      <div class="row-between">
        <div>
          <h2 style="margin:0">${competitorName(c)}</h2>
          <div class="muted small">${[c.age != null ? `Age ${c.age}` : '', c.sex, beltLabel(c.belt), c.dojo].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="row">
          <button class=${`btn ${c.checkedIn ? 'btn-ok' : 'btn-primary'}`} onClick=${() => sync.dispatch('competitor.checkIn', { id: c.id, checkedIn: !c.checkedIn })}>${c.checkedIn ? '✓ Checked in' : 'Check in'}</button>
          <button class="btn" onClick=${() => setEditing(true)}>Edit</button>
        </div>
      </div>
      ${c.flagged && html`<div class="row badge-warn" style="padding:.5rem;border-radius:8px"><span class="grow">⚑ ${c.flagReason || 'Flagged'}</span><button class="btn btn-sm" onClick=${() => sync.dispatch('competitor.clearFlag', { id: c.id })}>Mark reviewed</button></div>`}
      <div>
        <h3>Where to go</h3>
        <${Assignments} state=${state} competitorId=${c.id} />
      </div>
      <div>
        <h3>Divisions</h3>
        <div class="list">
          ${memberOf.map((d) => html`
            <div class="list-item" key=${d.id}>
              <span class="grow">${divisionLabel(d)} <span class="muted small">${eventLabel(d.event)} · ${ringLabel(state.rings[d.ringId])}</span></span>
              <button class="btn btn-sm btn-danger" onClick=${() => sync.dispatch('division.removeCompetitor', { divisionId: d.id, competitorId: c.id })}>Remove</button>
            </div>`)}
        </div>
        <div style="margin-top:.6rem">
          <input placeholder="Search divisions to add…" value=${divQ} onInput=${(e) => setDivQ(e.target.value)} style="width:100%" />
          <p class="muted small">${divQ ? 'Matching divisions:' : 'Suggested (matching age / sex / belt):'}</p>
          <div class="list">
            ${suggestions.map((d) => html`
              <div class="list-item" key=${d.id}>
                <span class="grow">${divisionLabel(d)} <span class="muted small">${eventLabel(d.event)} · ${ringLabel(state.rings[d.ringId])} · ${d.competitorIds.length} in</span></span>
                <button class="btn btn-sm btn-primary" onClick=${() => sync.dispatch('division.addCompetitors', { divisionId: d.id, competitorIds: [c.id] })}>Add</button>
              </div>`)}
            ${!suggestions.length && html`<div class="muted small">No matching divisions.</div>`}
          </div>
        </div>
      </div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn btn-sm btn-danger" onClick=${() => confirmAction(`Delete ${competitorName(c)} from the master list?`) && sync.dispatch('competitor.delete', { id: c.id }) && onDeleted?.()}>Delete competitor</button>
      </div>
      ${editing && html`
        <${Modal} title="Edit competitor" onClose=${() => setEditing(false)}>
          <${CompetitorForm} initial=${c} dojos=${knownDojos(state)} onCancel=${() => setEditing(false)}
            onSubmit=${(f) => { const { firstName, lastName, age, sex, belt, dojo, notes } = f; if (sync.dispatch('competitor.update', { id: c.id, patch: { firstName, lastName, age, sex, belt, dojo, notes } })) setEditing(false); }} />
        <//>`}
    </div>`;
}

export function Flagged({ state }) {
  const list = Object.values(state.competitors).filter((c) => c.flagged).sort(byName);
  const [selectedId, setSelectedId] = useState(null);
  const selected = selectedId && state.competitors[selectedId];
  return html`
    <div class="grid-2" style="align-items:start">
      <div class="stack">
        <h2>Flagged competitors</h2>
        <p class="muted small">Competitors written in at a ring (or otherwise flagged). Confirm their details and payment, then mark reviewed.</p>
        <div class="list">
          ${list.map((c) => html`
            <div key=${c.id} class=${`list-item clickable ${selectedId === c.id ? 'active' : ''}`} onClick=${() => setSelectedId(c.id)}>
              <span class="grow"><${CompetitorLine} c=${c} /><div class="small" style="color:var(--warn)">${c.flagReason}</div></span>
              <button class="btn btn-sm" onClick=${(e) => { e.stopPropagation(); sync.dispatch('competitor.clearFlag', { id: c.id }); }}>Reviewed ✓</button>
            </div>`)}
          ${!list.length && html`<div class="empty">Nothing to review.</div>`}
        </div>
      </div>
      <div>${selected && html`<${CompetitorDetail} state=${state} competitor=${selected} onDeleted=${() => setSelectedId(null)} />`}</div>
    </div>`;
}

// ---------- competitor list + import ----------

const COLS = {
  first: ['first name', 'firstname', 'first', 'given name'],
  last: ['last name', 'lastname', 'last', 'surname', 'family name'],
  name: ['name', 'full name', 'competitor', 'competitor name'],
  age: ['age'],
  sex: ['sex', 'gender'],
  belt: ['belt', 'belt level', 'rank', 'level', 'belt rank'],
  dojo: ['dojo', 'school', 'club', 'team'],
};
const pick = (row, keys) => { for (const k of keys) if (row[k] != null && row[k] !== '') return row[k]; return ''; };

export function rowsToCompetitors(rows) {
  return rows.map((r) => {
    let firstName = pick(r, COLS.first);
    let lastName = pick(r, COLS.last);
    if (!firstName && !lastName) {
      const full = pick(r, COLS.name).trim();
      const parts = full.split(/\s+/);
      lastName = parts.length > 1 ? parts.pop() : '';
      firstName = parts.join(' ');
    }
    const age = parseInt(pick(r, COLS.age), 10);
    return { id: newId('c'), firstName, lastName, age: Number.isNaN(age) ? null : age, sex: normalizeSex(pick(r, COLS.sex)), belt: normalizeBelt(pick(r, COLS.belt)), dojo: pick(r, COLS.dojo) };
  }).filter((c) => c.firstName || c.lastName);
}

function ImportModal({ state, onClose }) {
  const [rows, setRows] = useState(null);
  const [skipDupes, setSkipDupes] = useState(true);
  const existing = new Set(Object.values(state.competitors).map((c) => `${c.firstName}|${c.lastName}|${c.age}`.toLowerCase()));
  const parsed = rows ? rowsToCompetitors(rows) : [];
  const dupes = parsed.filter((c) => existing.has(`${c.firstName}|${c.lastName}|${c.age}`.toLowerCase()));
  const toImport = skipDupes ? parsed.filter((c) => !dupes.includes(c)) : parsed;
  const onFile = async (e) => {
    const file = e.target.files[0];
    if (file) setRows(parseCsvObjects(await file.text()));
  };
  const doImport = () => {
    if (sync.dispatch('competitor.import', { competitors: toImport })) { toast(`Imported ${toImport.length} competitors`, 'ok'); onClose(); }
  };
  return html`
    <${Modal} title="Import registrations (CSV)" onClose=${onClose} wide>
      <p class="muted small">Export from the registration site as CSV. Recognised columns: <code>First Name</code>, <code>Last Name</code> (or <code>Name</code>), <code>Age</code>, <code>Sex</code>/<code>Gender</code>, <code>Belt</code> (Beginner / Intermediate / Advanced / Black Belt), and optional <code>Dojo</code>/<code>School</code>.</p>
      <input type="file" accept=".csv,text/csv" onChange=${onFile} />
      ${rows && html`
        <div class="row"><span class="badge badge-blue">${parsed.length} rows</span>${dupes.length > 0 && html`<span class="badge badge-warn">${dupes.length} already in the list</span><label class="inline"><input type="checkbox" checked=${skipDupes} onChange=${(e) => setSkipDupes(e.target.checked)} /> Skip duplicates</label>`}</div>
        <div class="table-wrap" style="max-height:45vh">
          <table><thead><tr><th>First</th><th>Last</th><th>Age</th><th>Sex</th><th>Belt</th><th>Dojo</th></tr></thead>
            <tbody>${parsed.slice(0, 200).map((c) => html`<tr key=${c.id} style=${dupes.includes(c) ? 'opacity:.5' : ''}><td>${c.firstName}</td><td>${c.lastName}</td><td>${c.age ?? ''}</td><td>${c.sex}</td><td>${beltLabel(c.belt)}</td><td>${c.dojo}</td></tr>`)}</tbody>
          </table>
        </div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" disabled=${!toImport.length} onClick=${doImport}>Import ${toImport.length} competitors</button></div>`}
    <//>`;
}

export function Competitors({ state }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [importing, setImporting] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [adding, setAdding] = useState(false);
  const inDivision = new Set(Object.values(state.divisions).flatMap((d) => d.competitorIds));
  let list = searchCompetitors(state, q, 5000);
  if (filter === 'unassigned') list = list.filter((c) => !inDivision.has(c.id));
  if (filter === 'notin') list = list.filter((c) => !c.checkedIn);
  if (filter === 'in') list = list.filter((c) => c.checkedIn);
  if (filter === 'flagged') list = list.filter((c) => c.flagged);
  const selected = selectedId && state.competitors[selectedId];
  return html`
    <div class="stack">
      <div class="row-between">
        <h2 style="margin:0">Competitors <span class="muted small">(${Object.keys(state.competitors).length})</span></h2>
        <div class="row">
          <button class="btn" onClick=${() => setImporting(true)}>⇪ Import CSV</button>
          <button class="btn btn-primary" onClick=${() => setAdding(true)}>＋ Add competitor</button>
        </div>
      </div>
      <div class="row">
        <input class="grow" placeholder="Search…" value=${q} onInput=${(e) => setQ(e.target.value)} />
        <select value=${filter} onChange=${(e) => setFilter(e.target.value)}>
          <option value="all">Everyone</option>
          <option value="unassigned">Not in any division</option>
          <option value="notin">Not checked in</option>
          <option value="in">Checked in</option>
          <option value="flagged">Flagged</option>
        </select>
      </div>
      <div class="grid-2" style="grid-template-columns:minmax(380px,1.4fr) minmax(320px,1fr);align-items:start">
        <div class="table-wrap" style="max-height:70vh">
          <table>
            <thead><tr><th>Name</th><th>Age</th><th>Sex</th><th>Belt</th><th>Dojo</th><th>Divs</th><th>In</th></tr></thead>
            <tbody>
              ${list.map((c) => html`
                <tr key=${c.id} class=${`clickable ${selectedId === c.id ? 'selected' : ''}`} onClick=${() => setSelectedId(c.id)}>
                  <td><strong>${competitorName(c)}</strong>${c.flagged ? ' ⚑' : ''}</td><td>${c.age ?? ''}</td><td>${c.sex}</td><td>${beltLabel(c.belt)}</td><td>${c.dojo}</td>
                  <td>${Object.values(state.divisions).filter((d) => d.competitorIds.includes(c.id)).length || html`<span class="badge badge-warn">0</span>`}</td>
                  <td>${c.checkedIn ? '✓' : ''}</td>
                </tr>`)}
            </tbody>
          </table>
          ${!list.length && html`<div class="empty">No competitors. Import the registration CSV to get started.</div>`}
        </div>
        <div>${selected && html`<${CompetitorDetail} state=${state} competitor=${selected} onDeleted=${() => setSelectedId(null)} />`}</div>
      </div>
      ${importing && html`<${ImportModal} state=${state} onClose=${() => setImporting(false)} />`}
      ${adding && html`
        <${Modal} title="Add competitor" onClose=${() => setAdding(false)}>
          <${CompetitorForm} dojos=${knownDojos(state)} onCancel=${() => setAdding(false)} submitLabel="Add"
            onSubmit=${(f) => { const id = newId('c'); if (sync.dispatch('competitor.create', { competitor: { ...f, id } })) { setAdding(false); setSelectedId(id); } }} />
        <//>`}
    </div>`;
}
