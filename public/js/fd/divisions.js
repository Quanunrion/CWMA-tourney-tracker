import { html, useState, useMemo, Modal, newId, toast, confirmAction } from '../core.js';
import { EVENTS, FORMATS, BELTS, SEXES, GRAND_GROUPS, competitorName, divisionLabel, eventLabel, ringLabel, sortedRings, matchesCriteria, formatLabel } from '/shared/model.js';
import { parseCsvObjects } from '/shared/csv.js';
import { CompetitorLine, byName, searchCompetitors } from '../forms.js';
import { sync } from './sync.js';

function defaultFormat(event, settings) {
  if (event === 'kata') return 'kata_scores';
  if (event === 'kumite' || event === 'chambara') return settings.defaultKumiteFormat || 'single_elim';
  return 'single_elim';
}

export function newDivisionPayload(state, fields = {}) {
  const event = fields.event || 'kata';
  return {
    id: newId('d'),
    code: '',
    name: '',
    event,
    format: defaultFormat(event, state.settings),
    options: { thirdPlace: state.settings.defaultThirdPlace || 'match', judges: state.settings.defaultJudges || 3 },
    criteria: { sex: 'any', ageMin: '', ageMax: '', belts: [] },
    ...fields,
  };
}

export function Divisions({ state }) {
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState({ q: '', event: '', ring: '', status: '' });
  const [bulk, setBulk] = useState(false);
  const rings = sortedRings(state);
  let list = Object.values(state.divisions);
  if (filter.q) list = list.filter((d) => divisionLabel(d).toLowerCase().includes(filter.q.toLowerCase()));
  if (filter.event) list = list.filter((d) => d.event === filter.event);
  if (filter.ring) list = list.filter((d) => (filter.ring === 'none' ? !d.ringId : d.ringId === filter.ring));
  if (filter.status) list = list.filter((d) => d.status === filter.status);
  list.sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }) || (a.name || '').localeCompare(b.name || ''));
  const selected = selectedId && state.divisions[selectedId];
  const create = () => {
    const d = newDivisionPayload(state, { code: `D${Object.keys(state.divisions).length + 1}`, name: 'New division' });
    if (sync.dispatch('division.create', { division: d })) setSelectedId(d.id);
  };
  const set = (k) => (e) => setFilter({ ...filter, [k]: e.target.value });
  return html`
    <div class="grid-2" style="grid-template-columns:minmax(300px,.8fr) minmax(400px,1.6fr);align-items:start">
      <div class="stack">
        <div class="row-between">
          <h2 style="margin:0">Divisions <span class="muted small">(${Object.keys(state.divisions).length})</span></h2>
          <div class="row"><button class="btn" onClick=${() => setBulk(true)}>Bulk add</button><button class="btn btn-primary" onClick=${create}>＋ New</button></div>
        </div>
        <input placeholder="Search divisions…" value=${filter.q} onInput=${set('q')} />
        <div class="row">
          <select value=${filter.event} onChange=${set('event')}><option value="">All events</option>${EVENTS.map((e) => html`<option value=${e.id}>${e.label}</option>`)}</select>
          <select value=${filter.ring} onChange=${set('ring')}><option value="">All rings</option><option value="none">Unassigned</option>${rings.map((r) => html`<option value=${r.id}>${ringLabel(r)}</option>`)}</select>
          <select value=${filter.status} onChange=${set('status')}><option value="">Any status</option><option value="pending">Not started</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select>
        </div>
        <div class="list" style="max-height:70vh;overflow:auto">
          ${list.map((d) => html`
            <div key=${d.id} class=${`list-item clickable ${selectedId === d.id ? 'active' : ''}`} onClick=${() => setSelectedId(d.id)}>
              <span class=${`status-dot status-${d.status}`}></span>
              <div class="grow">
                <strong>${divisionLabel(d)}</strong>
                <div class="muted small">${eventLabel(d.event)} · ${d.competitorIds.length} competitors · ${ringLabel(state.rings[d.ringId])}</div>
              </div>
              ${d.grand && html`<span class="badge badge-blue">Grand</span>`}
            </div>`)}
          ${!list.length && html`<div class="empty">No divisions.</div>`}
        </div>
      </div>
      <div>${selected ? html`<${DivisionEditor} key=${selected.id} state=${state} division=${selected} onSelect=${setSelectedId} />` : html`<div class="empty">Select or create a division.</div>`}</div>
      ${bulk && html`<${BulkModal} state=${state} onClose=${() => setBulk(false)} />`}
    </div>`;
}

function DivisionEditor({ state, division: d, onSelect }) {
  const [splitMode, setSplitMode] = useState(false);
  const [splitIds, setSplitIds] = useState([]);
  const [merging, setMerging] = useState(false);
  const [addQ, setAddQ] = useState('');
  const update = (patch) => sync.dispatch('division.update', { id: d.id, patch });
  const field = (k, conv = (v) => v) => (e) => update({ [k]: conv(e.target.value) });
  const crit = (k) => (e) => update({ criteria: { [k]: e.target.value } });
  const locked = !!d.bracket || d.status === 'completed';

  // Suggestions: match criteria and not already in another division of the same event.
  const takenSameEvent = new Set(Object.values(state.divisions).filter((x) => x.id !== d.id && x.event === d.event && !x.grand).flatMap((x) => x.competitorIds));
  const suggestions = useMemo(() => Object.values(state.competitors)
    .filter((c) => !d.competitorIds.includes(c.id) && matchesCriteria(c, d.criteria) && (d.grand || !takenSameEvent.has(c.id)))
    .sort(byName), [state, d]);
  const searchResults = addQ ? searchCompetitors(state, addQ, 20).filter((c) => !d.competitorIds.includes(c.id)) : [];
  const members = d.competitorIds.map((id) => state.competitors[id]).filter(Boolean).sort(byName);

  const duplicate = () => {
    const copy = newDivisionPayload(state, { ...structuredClone({ code: d.code, name: `${d.name} (copy)`, event: d.event, format: d.format, options: d.options, criteria: d.criteria, grand: d.grand, grandGroup: d.grandGroup }), ringId: d.ringId });
    if (sync.dispatch('division.create', { division: copy })) onSelect(copy.id);
  };
  const doSplit = () => {
    const nd = { id: newId('d'), code: `${d.code}B`, name: `${d.name} (B)` };
    if (sync.dispatch('division.split', { id: d.id, competitorIds: splitIds, newDivision: nd })) { setSplitMode(false); setSplitIds([]); onSelect(nd.id); }
  };
  const remove = () => confirmAction(`Delete division "${divisionLabel(d)}"? Competitors stay in the master list.`) && sync.dispatch('division.delete', { id: d.id }) && onSelect(null);

  return html`
    <div class="card stack">
      <div class="row-between">
        <h2 style="margin:0">${divisionLabel(d)}</h2>
        <div class="row">
          <button class="btn btn-sm" onClick=${duplicate}>Duplicate</button>
          <button class="btn btn-sm" onClick=${() => setMerging(true)} disabled=${locked}>Merge…</button>
          <button class="btn btn-sm" onClick=${() => setSplitMode(!splitMode)} disabled=${locked}>${splitMode ? 'Cancel split' : 'Split…'}</button>
          <button class="btn btn-sm btn-danger" onClick=${remove}>Delete</button>
        </div>
      </div>
      <div class="form-grid">
        <label>Code <input value=${d.code} onChange=${field('code')} /></label>
        <label style="grid-column:span 2">Name <input value=${d.name} onChange=${field('name')} /></label>
        <label>Event <select value=${d.event} onChange=${field('event')}>${EVENTS.map((e) => html`<option value=${e.id}>${e.label}</option>`)}</select></label>
        <label>Format
          <select value=${d.format} onChange=${field('format')} disabled=${!!d.bracket}>${FORMATS.map((f) => html`<option value=${f.id}>${f.label}</option>`)}</select>
        </label>
        <label>Ring
          <select value=${d.ringId || ''} onChange=${(e) => sync.dispatch('division.assignRing', { id: d.id, ringId: e.target.value || null })}>
            <option value="">Unassigned</option>
            ${sortedRings(state).map((r) => html`<option value=${r.id}>${ringLabel(r)}</option>`)}
          </select>
        </label>
        ${d.format === 'single_elim' && html`
          <label>3rd place
            <select value=${d.options.thirdPlace} onChange=${(e) => update({ options: { thirdPlace: e.target.value } })} disabled=${!!d.bracket}>
              <option value="match">3rd place match</option>
              <option value="manual">Ring chooses 3rd</option>
            </select>
          </label>`}
        ${d.format === 'kata_scores' && html`<label>Judges <input type="number" min="1" max="7" value=${d.options.judges} onChange=${(e) => update({ options: { judges: Number(e.target.value) || 3 } })} disabled=${!!d.bracket} /></label>`}
      </div>
      <div class="row">
        <label class="inline"><input type="checkbox" checked=${d.grand} onChange=${(e) => update({ grand: e.target.checked, grandGroup: e.target.checked ? (d.grandGroup || 'under18') : null })} /> Grand championship (shows Grand Champion slide)</label>
        ${d.grand && html`<select value=${d.grandGroup || 'under18'} onChange=${field('grandGroup')}>${GRAND_GROUPS.map((g) => html`<option value=${g.id}>${g.label}</option>`)}</select>`}
      </div>
      ${d.bracket && html`<p class="small muted">The ring has drawn a bracket, so format options are locked. ${d.status !== 'completed' ? 'The ring can reset it.' : ''}</p>`}

      <details open=${!d.competitorIds.length}>
        <summary style="cursor:pointer"><strong>Criteria</strong> <span class="muted small">(used only to suggest competitors)</span></summary>
        <div class="form-grid" style="margin-top:.5rem">
          <label>Sex <select value=${d.criteria.sex || 'any'} onChange=${crit('sex')}><option value="any">Any</option>${SEXES.map((s) => html`<option value=${s.id}>${s.label}</option>`)}</select></label>
          <label>Min age <input type="number" value=${d.criteria.ageMin ?? ''} onChange=${crit('ageMin')} /></label>
          <label>Max age <input type="number" value=${d.criteria.ageMax ?? ''} onChange=${crit('ageMax')} /></label>
        </div>
        <div class="row" style="margin-top:.5rem">
          ${BELTS.map((b) => html`<label class="inline" key=${b.id}><input type="checkbox" checked=${d.criteria.belts?.includes(b.id)}
            onChange=${(e) => update({ criteria: { belts: e.target.checked ? [...(d.criteria.belts || []), b.id] : (d.criteria.belts || []).filter((x) => x !== b.id) } })} /> ${b.label}</label>`)}
        </div>
      </details>

      <div>
        <div class="row-between">
          <h3 style="margin:0">Competitors (${members.length})</h3>
          ${splitMode && html`<button class="btn btn-sm btn-primary" disabled=${!splitIds.length} onClick=${doSplit}>Move ${splitIds.length} to new division</button>`}
        </div>
        ${splitMode && html`<p class="muted small">Tick the competitors to move into a new division (it's placed right after this one in the same ring).</p>`}
        <div class="list" style="margin-top:.4rem">
          ${members.map((c) => html`
            <div class="list-item" key=${c.id}>
              ${splitMode && html`<input type="checkbox" checked=${splitIds.includes(c.id)} onChange=${(e) => setSplitIds(e.target.checked ? [...splitIds, c.id] : splitIds.filter((x) => x !== c.id))} />`}
              <span class="grow"><${CompetitorLine} c=${c} /></span>
              ${c.checkedIn ? html`<span class="badge badge-ok">in</span>` : html`<span class="badge">not in</span>`}
              ${!splitMode && html`<button class="btn btn-sm btn-ghost" title="Remove from division" onClick=${() => sync.dispatch('division.removeCompetitor', { divisionId: d.id, competitorId: c.id })}>✕</button>`}
            </div>`)}
          ${!members.length && html`<div class="muted small">Nobody yet.</div>`}
        </div>
      </div>

      ${d.status !== 'completed' && html`
        <div>
          <h3>Add competitors</h3>
          <input placeholder="Search anyone by name…" value=${addQ} onInput=${(e) => setAddQ(e.target.value)} style="width:100%" />
          ${addQ ? html`
            <div class="list" style="margin-top:.4rem">${searchResults.map((c) => html`
              <div class="list-item" key=${c.id}><span class="grow"><${CompetitorLine} c=${c} /></span><button class="btn btn-sm btn-primary" onClick=${() => sync.dispatch('division.addCompetitors', { divisionId: d.id, competitorIds: [c.id] })}>Add</button></div>`)}</div>`
          : html`
            <div class="row-between" style="margin-top:.5rem">
              <span class="muted small">${suggestions.length} match the criteria and aren't in another ${eventLabel(d.event)} division</span>
              ${suggestions.length > 0 && html`<button class="btn btn-sm" onClick=${() => sync.dispatch('division.addCompetitors', { divisionId: d.id, competitorIds: suggestions.map((c) => c.id) })}>Add all ${suggestions.length}</button>`}
            </div>
            <div class="list" style="margin-top:.4rem;max-height:300px;overflow:auto">${suggestions.slice(0, 100).map((c) => html`
              <div class="list-item" key=${c.id}><span class="grow"><${CompetitorLine} c=${c} /></span><button class="btn btn-sm btn-primary" onClick=${() => sync.dispatch('division.addCompetitors', { divisionId: d.id, competitorIds: [c.id] })}>Add</button></div>`)}</div>`}
        </div>`}

      ${merging && html`<${MergeModal} state=${state} division=${d} onClose=${() => setMerging(false)} />`}
    </div>`;
}

function MergeModal({ state, division, onClose }) {
  const [sourceId, setSourceId] = useState('');
  const options = Object.values(state.divisions).filter((x) => x.id !== division.id && x.status !== 'completed' && !x.bracket);
  const go = () => {
    if (sync.dispatch('division.merge', { targetId: division.id, sourceId })) { toast('Divisions merged', 'ok'); onClose(); }
  };
  return html`
    <${Modal} title=${`Merge into ${divisionLabel(division)}`} onClose=${onClose}>
      <p class="muted small">Everyone in the chosen division moves into this one, and the chosen division is deleted.</p>
      <select value=${sourceId} onChange=${(e) => setSourceId(e.target.value)}>
        <option value="">Choose division…</option>
        ${options.map((x) => html`<option value=${x.id}>${divisionLabel(x)} (${x.competitorIds.length}) — ${eventLabel(x.event)}</option>`)}
      </select>
      <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" disabled=${!sourceId} onClick=${go}>Merge</button></div>
    <//>`;
}

function BulkModal({ state, onClose }) {
  const [text, setText] = useState('code,name,event,format,sex,agemin,agemax,belts,ring\nC1,Youth Chambara 5-6,chambara,single_elim,any,5,6,,1\nC2,Youth Chambara 7-8,chambara,single_elim,any,7,8,beginner;intermediate,1');
  const rows = parseCsvObjects(text);
  const ringByNumber = Object.fromEntries(sortedRings(state).map((r) => [String(r.number), r.id]));
  const create = () => {
    let n = 0;
    for (const r of rows) {
      const event = EVENTS.some((e) => e.id === r.event) ? r.event : 'other';
      const format = FORMATS.some((f) => f.id === r.format) ? r.format : undefined;
      const div = newDivisionPayload(state, {
        code: r.code || '', name: r.name || r.code || 'Division', event,
        ...(format ? { format } : {}),
        criteria: { sex: ['M', 'F'].includes((r.sex || '').toUpperCase()) ? r.sex.toUpperCase() : 'any', ageMin: r.agemin || '', ageMax: r.agemax || '', belts: (r.belts || '').split(/[;|]/).map((b) => b.trim()).filter(Boolean) },
        ringId: ringByNumber[r.ring] || null,
      });
      if (sync.dispatch('division.create', { division: div })) n++;
    }
    toast(`Created ${n} divisions`, 'ok');
    onClose();
  };
  return html`
    <${Modal} title="Bulk add divisions" onClose=${onClose} wide>
      <p class="muted small">Paste CSV (one division per line). Columns: <code>code, name, event</code> (${EVENTS.map((e) => e.id).join(' / ')}), <code>format</code> (${FORMATS.map((f) => f.id).join(' / ')}), <code>sex</code> (M / F / any), <code>agemin, agemax</code>, <code>belts</code> (separate with ;), <code>ring</code> (ring number). Only <code>name</code> is required.</p>
      <textarea style="min-height:220px;font-family:monospace" value=${text} onInput=${(e) => setText(e.target.value)}></textarea>
      <div class="row-between"><span class="muted small">${rows.length} divisions</span><button class="btn btn-primary" disabled=${!rows.length} onClick=${create}>Create ${rows.length} divisions</button></div>
    <//>`;
}

// ---------- results (admin corrections) ----------

export function Results({ state }) {
  const [editing, setEditing] = useState(null);
  const list = Object.values(state.divisions).sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || '') || (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }));
  const name = (id) => (id ? competitorName(state.competitors[id]) : '');
  const done = list.filter((d) => d.status === 'completed').length;
  return html`
    <div class="stack">
      <div class="row-between"><h2 style="margin:0">Results</h2><span class="badge badge-ok">${done} / ${list.length} divisions complete</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Division</th><th>Ring</th><th>Status</th><th>1st</th><th>2nd</th><th>3rd</th><th></th></tr></thead>
          <tbody>
            ${list.map((d) => html`
              <tr key=${d.id}>
                <td><strong>${divisionLabel(d)}</strong> <span class="muted small">${eventLabel(d.event)}${d.grand ? ' · Grand' : ''}</span></td>
                <td>${ringLabel(state.rings[d.ringId])}</td>
                <td><span class=${`status-dot status-${d.status}`}></span> ${d.status.replace('_', ' ')}</td>
                <td>${name(d.results?.first)}</td><td>${name(d.results?.second)}</td><td>${name(d.results?.third)}</td>
                <td class="nowrap">
                  <button class="btn btn-sm" onClick=${() => setEditing(d.id)}>Fix</button>
                  ${d.status === 'completed' && html` <button class="btn btn-sm btn-warn" onClick=${() => confirmAction('Reopen so the ring can change the bracket? Queued award slides are recalled.') && sync.dispatch('division.reopen', { divisionId: d.id })}>Reopen</button>`}
                </td>
              </tr>`)}
          </tbody>
        </table>
      </div>
      ${editing && state.divisions[editing] && html`<${FixResultsModal} state=${state} division=${state.divisions[editing]} onClose=${() => setEditing(null)} />`}
    </div>`;
}

function FixResultsModal({ state, division, onClose }) {
  const [r, setR] = useState({ first: '', second: '', third: '', ...(division.results || {}) });
  const opts = division.competitorIds;
  const sel = (k, label) => html`
    <label>${label}
      <select value=${r[k] || ''} onChange=${(e) => setR({ ...r, [k]: e.target.value || null })}>
        <option value="">— none —</option>
        ${opts.map((id) => html`<option value=${id}>${competitorName(state.competitors[id])}</option>`)}
      </select>
    </label>`;
  const save = () => {
    if (sync.dispatch('division.setResults', { divisionId: division.id, results: r })) { toast('Results corrected — display slides update automatically', 'ok'); onClose(); }
  };
  return html`
    <${Modal} title=${`Fix results · ${divisionLabel(division)}`} onClose=${onClose}>
      <p class="muted small">Overrides the final places without touching the bracket. Award slides use the corrected names. Format: ${formatLabel(division.format)}.</p>
      ${sel('first', division.grand ? 'Grand Champion' : '1st place')}${sel('second', '2nd place')}${sel('third', '3rd place')}
      <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" onClick=${save}>Save results</button></div>
    <//>`;
}
