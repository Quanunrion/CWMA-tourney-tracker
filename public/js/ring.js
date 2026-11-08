// Ring client: runs the brackets for one ring.
import { html, mount, Sync, useSync, useState, useMemo, Login, Loading, ConnectionBadge, Modal, newId, toast, confirmAction } from './core.js';
import { competitorName, ringLabel, ringDivisions, divisionLabel, eventLabel, formatLabel } from '/shared/model.js';
import { generateBracket, computeBracket, activeCompetitors, bracketCompetitors } from '/shared/bracket.js';
import { BracketView } from './bracketView.js';
import { CompetitorForm, CompetitorLine, knownDojos, searchCompetitors } from './forms.js';

const sync = new Sync('ring').start();

const STATUS_TEXT = { pending: 'Not started', in_progress: 'In progress', completed: 'Submitted' };

function App() {
  useSync(sync);
  const [selected, setSelected] = useState(null);
  if (!sync.signedIn) return html`<${Login} sync=${sync} role="ring" title="Ring sign in" />`;
  const state = sync.state;
  if (!state || !sync.actor || sync.actor.role === 'viewer') return html`<${Loading} />`;
  const ring = state.rings[sync.actor.ringId];
  if (!ring) return html`<div class="loading">This ring no longer exists. <button class="btn" onClick=${() => sync.logout()}>Sign out</button></div>`;

  const divisions = ringDivisions(state, ring.id);
  const fallback = ring.currentDivisionId || divisions.find((d) => d.status !== 'completed')?.id || divisions[0]?.id;
  const divisionId = selected && state.divisions[selected]?.ringId === ring.id ? selected : fallback;
  const division = divisionId ? state.divisions[divisionId] : null;
  const pendingMissing = Object.values(state.queue).filter((q) => q.type === 'missing' && q.ringId === ring.id && ['pending_approval', 'queued', 'live'].includes(q.status));

  return html`
    <div class="topbar">
      <span class="title">${ringLabel(ring)}</span>
      <span class="sub">${state.tournament.name}</span>
      <span class="spacer"></span>
      <${ConnectionBadge} sync=${sync} />
      <button class="btn btn-sm" onClick=${() => confirmAction('Sign this device out of the ring?') && sync.logout()}>Sign out</button>
    </div>
    <main>
      <div class="ring-layout">
        <aside class="stack">
          <div class="card card-tight">
            <div class="row-between"><h3 style="margin:0">Schedule</h3><span class="muted small">${divisions.filter((d) => d.status === 'completed').length}/${divisions.length} done</span></div>
          </div>
          <div class="list">
            ${divisions.map((d, i) => html`
              <div key=${d.id} class=${`list-item clickable ${d.id === divisionId ? 'active' : ''} ${d.status === 'completed' ? 'done' : ''}`} onClick=${() => setSelected(d.id)}>
                <span class=${`status-dot status-${d.status}`}></span>
                <div class="grow">
                  <div><strong>${i + 1}. ${d.name || d.code || 'Untitled'}</strong></div>
                  <div class="muted small">${[d.code, eventLabel(d.event), `${d.competitorIds.length} competitors`].filter(Boolean).join(' · ')}</div>
                </div>
                ${d.grand && html`<span class="badge badge-blue">Grand</span>`}
              </div>`)}
            ${!divisions.length && html`<div class="empty">No divisions assigned to this ring yet.</div>`}
          </div>
          ${pendingMissing.length > 0 && html`
            <div class="card card-tight">
              <h3>Missing competitor calls</h3>
              ${pendingMissing.map((q) => html`<div class="small" key=${q.id}>📢 ${competitorName(state.competitors[q.competitorId])} — <span class="muted">${q.status === 'pending_approval' ? 'waiting for display' : q.status === 'live' ? 'on screen now' : 'queued on display'}</span></div>`)}
            </div>`}
        </aside>
        <section>${division ? html`<${DivisionPanel} key=${division.id} state=${state} division=${division} ring=${ring} />` : html`<div class="empty">Pick a division.</div>`}</section>
      </div>
    </main>`;
}

function callMissing(division, competitorId) {
  if (sync.dispatch('missing.request', { divisionId: division.id, competitorId, itemId: newId('q') })) {
    toast(`Missing call sent to the display for ${competitorName(sync.state.competitors[competitorId])}`, 'ok');
  }
}

function DivisionPanel({ state, division, ring }) {
  const [adding, setAdding] = useState(false);
  const view = useMemo(() => computeBracket(division), [division]);
  const hasResults = division.bracket && (Object.keys(division.bracket.winners || {}).length || Object.keys(division.bracket.scores || {}).length);
  const completed = division.status === 'completed';
  const d = division;

  const generate = () => {
    const active = activeCompetitors(d);
    if (!active.length) return toast('No competitors present to put in a bracket', 'warn');
    if (hasResults && !confirmAction('This will throw away the results entered so far. Regenerate the bracket?')) return;
    sync.dispatch('bracket.generate', { divisionId: d.id, bracket: generateBracket(d, state.competitors), force: !!hasResults });
  };
  const reset = () => confirmAction('Clear the bracket and all results entered so far?') && sync.dispatch('bracket.reset', { divisionId: d.id });
  const reopen = () => confirmAction('Reopen this division? Its award slides will be pulled from the display queue until you submit again.') && sync.dispatch('division.reopen', { divisionId: d.id });

  return html`
    <div class="stack">
      <div class="card">
        <div class="row-between">
          <div>
            <h1 style="margin-bottom:.2rem">${divisionLabel(d)}</h1>
            <div class="row small muted">
              <span class=${`badge ${completed ? 'badge-ok' : d.status === 'in_progress' ? 'badge-warn' : ''}`}>${STATUS_TEXT[d.status]}</span>
              <span>${eventLabel(d.event)}</span>·<span>${formatLabel(d.format)}</span>
              ${d.grand && html`<span class="badge badge-blue">Grand championship</span>`}
            </div>
          </div>
          <div class="row">
            ${!completed && html`<button class="btn" onClick=${() => setAdding(true)}>＋ Add / write in competitor</button>`}
            ${!completed && d.bracket && html`<button class="btn btn-danger" onClick=${reset}>Reset bracket</button>`}
            ${completed && html`<button class="btn btn-warn" onClick=${reopen}>Reopen / fix results</button>`}
          </div>
        </div>
      </div>

      ${!d.bracket && !completed && html`<${Roster} state=${state} division=${d} onGenerate=${generate} />`}

      ${d.bracket && html`
        <div class="card">
          <div class="row-between" style="margin-bottom:.5rem">
            <h2 style="margin:0">${d.format === 'kata_scores' ? 'Scores' : 'Bracket'}</h2>
            ${!completed && html`<span class="muted small">${d.format === 'kata_scores' ? 'Enter each judge\'s score (optional) or just choose places below.' : 'Tap a name to mark the winner. Tap again to undo.'}</span>`}
          </div>
          <${BracketView} state=${state} division=${d} view=${view} interactive=${!completed}
            onPick=${(m, winnerId) => sync.dispatch('bracket.setWinner', { divisionId: d.id, matchId: m.id, winnerId })}
            onScore=${(competitorId, scores) => sync.dispatch('kata.setScores', { divisionId: d.id, competitorId, scores })}
            onCall=${(cid) => callMissing(d, cid)} />
          ${!completed && html`<${Withdrawals} state=${state} division=${d} />`}
          ${!completed && !hasResults && html`<div class="row" style="margin-top:.5rem"><button class="btn btn-sm" onClick=${generate}>↻ Re-draw bracket</button><span class="muted small">Use after adding a late competitor.</span></div>`}
          ${!completed && hasResults && d.competitorIds.some((id) => !bracketCompetitors(d.bracket).includes(id) && !(d.absentIds || []).includes(id)) && html`
            <p class="small" style="color:var(--warn)">Someone was added after the bracket was drawn. Reset the bracket to include them.</p>`}
        </div>`}

      ${(d.bracket || d.format === 'placement') && !completed && html`<${SubmitPanel} state=${state} division=${d} view=${view} />`}
      ${completed && html`<${ResultsCard} state=${state} division=${d} />`}
      ${!d.bracket && d.format === 'placement' && !completed && html`<p class="muted small">Manual placement division: choose places below — no bracket needed.</p>`}

      ${adding && html`<${AddCompetitorModal} state=${state} division=${d} onClose=${() => setAdding(false)} />`}
    </div>`;
}

function Roster({ state, division, onGenerate }) {
  const absent = new Set(division.absentIds || []);
  const ids = division.competitorIds;
  const present = ids.filter((id) => !absent.has(id));
  return html`
    <div class="card">
      <div class="row-between">
        <h2 style="margin:0">Roster · ${present.length} present of ${ids.length}</h2>
        ${division.format !== 'placement' && html`<button class="btn btn-primary btn-lg" onClick=${onGenerate} disabled=${!present.length}>Start → draw ${division.format === 'kata_scores' ? 'order' : 'bracket'}</button>`}
        ${division.format === 'placement' && division.status === 'pending' && html`<button class="btn btn-primary btn-lg" onClick=${() => sync.dispatch('division.start', { divisionId: division.id })}>Start division</button>`}
      </div>
      <p class="muted small">Mark anyone who isn't here as absent before drawing. 📢 asks the display to call them to this ring.</p>
      <div>
        ${ids.map((id) => {
          const c = state.competitors[id];
          if (!c) return null;
          const isAbsent = absent.has(id);
          return html`
            <div class="roster-row" key=${id} style=${isAbsent ? 'opacity:.55' : ''}>
              <span class="grow"><${CompetitorLine} c=${c} /></span>
              ${c.flagged && html`<span class="badge badge-warn" title=${c.flagReason}>written in</span>`}
              ${c.checkedIn ? html`<span class="badge badge-ok">checked in</span>` : html`<button class="btn btn-sm" title="Not checked in at the front desk — mark as here" onClick=${() => sync.dispatch('competitor.checkIn', { id, checkedIn: true })}>Mark here</button>`}
              <button class="btn btn-sm" onClick=${() => callMissing(division, id)} title="Call to ring on the display">📢 Call</button>
              <button class=${`btn btn-sm ${isAbsent ? 'btn-warn' : ''}`} onClick=${() => sync.dispatch('division.markAbsent', { divisionId: division.id, competitorId: id, absent: !isAbsent })}>${isAbsent ? 'Absent ✕' : 'Absent?'}</button>
            </div>`;
        })}
        ${!ids.length && html`<div class="empty">No competitors yet — add or write them in.</div>`}
      </div>
    </div>`;
}

function Withdrawals({ state, division }) {
  const [open, setOpen] = useState(false);
  const ids = bracketCompetitors(division.bracket);
  const withdrawn = new Set(division.bracket.withdrawn || []);
  return html`
    <details class="no-print" style="margin-top:.75rem" open=${open} onToggle=${(e) => setOpen(e.target.open)}>
      <summary class="small muted" style="cursor:pointer">Withdrawals / disqualifications${withdrawn.size ? ` (${withdrawn.size})` : ''}</summary>
      <p class="small muted">A withdrawn competitor forfeits their remaining matches — the opponent advances automatically.</p>
      ${ids.map((id) => html`
        <div class="roster-row" key=${id}>
          <span class="grow">${competitorName(state.competitors[id])}</span>
          <button class=${`btn btn-sm ${withdrawn.has(id) ? 'btn-warn' : 'btn-danger'}`}
            onClick=${() => (withdrawn.has(id) || confirmAction(`Withdraw ${competitorName(state.competitors[id])}? Their opponents advance.`)) && sync.dispatch('bracket.withdraw', { divisionId: division.id, competitorId: id, withdrawn: !withdrawn.has(id) })}>
            ${withdrawn.has(id) ? 'Reinstate' : 'Withdraw / DQ'}
          </button>
        </div>`)}
    </details>`;
}

function PlacePicker({ label, medal, value, onChange, options, state }) {
  return html`
    <label class="grow" style="min-width:200px">
      <span class="row"><span class=${`medal medal-${medal}`}>${medal}</span> ${label}</span>
      <select value=${value || ''} onChange=${(e) => onChange(e.target.value || null)}>
        <option value="">— none —</option>
        ${options.map((id) => html`<option value=${id}>${competitorName(state.competitors[id])}</option>`)}
      </select>
    </label>`;
}

function SubmitPanel({ state, division, view }) {
  const suggested = view?.suggested || {};
  const [override, setOverride] = useState({});
  const places = { first: suggested.first, second: suggested.second, third: suggested.third, ...override };
  const options = (division.bracket ? bracketCompetitors(division.bracket) : activeCompetitors(division));
  const complete = !view || view.complete;
  const isGrand = division.grand;
  const set = (k) => (v) => setOverride({ ...override, [k]: v });
  const submit = () => {
    if (!places.first) return toast('Choose a 1st place', 'warn');
    if (!complete && !confirmAction('Not every match has a result yet. Submit these places anyway?')) return;
    if (sync.dispatch('division.submit', { divisionId: division.id, results: places, queueItemId: newId('q') })) {
      toast(state.settings.autoQueueAwards ? 'Results submitted and sent to the display queue' : 'Results submitted', 'ok');
      setOverride({});
    }
  };
  return html`
    <div class="card" style="border-color:${complete ? 'var(--ok)' : 'var(--border)'}">
      <div class="row-between"><h2 style="margin:0">Final places</h2>${complete && division.bracket ? html`<span class="badge badge-ok">Bracket complete</span>` : division.bracket && html`<span class="badge">In progress</span>`}</div>
      <p class="muted small">${division.bracket ? 'Filled in from the bracket — change if needed (e.g. to break a tie).' : 'Choose the places.'}</p>
      <div class="row" style="align-items:flex-end">
        <${PlacePicker} label=${isGrand ? 'Grand Champion' : '1st place'} medal="1" value=${places.first} onChange=${set('first')} options=${options} state=${state} />
        <${PlacePicker} label="2nd place" medal="2" value=${places.second} onChange=${set('second')} options=${options} state=${state} />
        <${PlacePicker} label="3rd place" medal="3" value=${places.third} onChange=${set('third')} options=${options} state=${state} />
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:.75rem">
        <button class="btn btn-ok btn-lg" onClick=${submit}>Submit results ✓</button>
      </div>
    </div>`;
}

function ResultsCard({ state, division }) {
  const r = division.results || {};
  const shown = Object.values(state.queue).filter((q) => q.divisionId === division.id && (q.type === 'award' || q.type === 'grand'));
  const latest = shown.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
  const statusText = { queued: 'Queued on display', live: 'On screen now', done: 'Shown on display', pending_approval: 'Waiting for display', recalled: 'Recalled', rejected: 'Removed by display' };
  return html`
    <div class="card" style="border-color:var(--ok)">
      <div class="row-between"><h2 style="margin:0">Submitted results</h2>${latest && html`<span class="badge badge-blue">${statusText[latest.status]}</span>`}</div>
      <div class="stack" style="margin-top:.75rem">
        ${[['first', 1], ['second', 2], ['third', 3]].map(([k, n]) => r[k] && html`
          <div class="row" key=${k}><span class=${`medal medal-${n}`}>${n}</span> <strong>${competitorName(state.competitors[r[k]])}</strong> <span class="muted small">${state.competitors[r[k]]?.dojo || ''}</span></div>`)}
      </div>
    </div>`;
}

function AddCompetitorModal({ state, division, onClose }) {
  const [mode, setMode] = useState('search');
  const [q, setQ] = useState('');
  const results = useMemo(() => searchCompetitors(state, q, 30).filter((c) => !division.competitorIds.includes(c.id)), [state, q, division]);
  const add = (c) => { if (sync.dispatch('division.addCompetitors', { divisionId: division.id, competitorIds: [c.id] })) { toast(`${competitorName(c)} added`, 'ok'); onClose(); } };
  const create = (fields) => {
    if (sync.dispatch('competitor.create', { competitor: { ...fields, id: newId('c') }, divisionId: division.id })) {
      toast(`${fields.firstName} written in and flagged for the front desk`, 'ok');
      onClose();
    }
  };
  return html`
    <${Modal} title="Add competitor to this division" onClose=${onClose}>
      <div class="row">
        <button class=${`btn ${mode === 'search' ? 'btn-primary' : ''}`} onClick=${() => setMode('search')}>Find registered competitor</button>
        <button class=${`btn ${mode === 'new' ? 'btn-primary' : ''}`} onClick=${() => setMode('new')}>Write in new competitor</button>
      </div>
      ${mode === 'search' ? html`
        <input class="search" placeholder="Search name or dojo…" value=${q} onInput=${(e) => setQ(e.target.value)} autofocus />
        <div class="list" style="max-height:50vh;overflow:auto">
          ${results.map((c) => html`<div class="list-item clickable" key=${c.id} onClick=${() => add(c)}><span class="grow"><${CompetitorLine} c=${c} /></span><span class="btn btn-sm">Add</span></div>`)}
          ${!results.length && html`<div class="empty">No match. <button class="btn btn-sm" onClick=${() => setMode('new')}>Write them in</button></div>`}
        </div>`
      : html`
        <p class="muted small">Written-in competitors go straight into the master list and are flagged for the front desk to follow up.</p>
        <${CompetitorForm} onSubmit=${create} submitLabel="Write in & add" onCancel=${onClose} dojos=${knownDojos(state)} />`}
    <//>`;
}

mount(App);
