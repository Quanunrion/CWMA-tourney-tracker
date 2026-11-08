import { html, useState, useEffect, newId, confirmAction, toast } from '../core.js';
import { ringLabel, sortedRings, divisionLabel, eventLabel, ringDivisions } from '/shared/model.js';
import { sync } from './sync.js';

export function Rings({ state }) {
  const [pins, setPins] = useState({});
  const rings = sortedRings(state);
  const ringIds = rings.map((r) => r.id).join(',');
  useEffect(() => { sync.api('/api/pins').then((p) => setPins(p.ringPins || {})).catch(() => {}); }, [ringIds]);
  const unassigned = Object.values(state.divisions).filter((d) => !d.ringId).sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }));
  const addRing = () => {
    const number = (rings.at(-1)?.number || 0) + 1;
    sync.dispatch('ring.create', { ring: { id: newId('r'), number } });
  };
  const changePin = async (ring) => {
    const pin = window.prompt(`New PIN for ${ringLabel(ring)}`, pins[ring.id] || '');
    if (!pin) return;
    try { const p = await sync.api('/api/pins', { method: 'POST', body: JSON.stringify({ ringPins: { [ring.id]: pin } }) }); setPins(p.ringPins); toast('PIN changed — that ring must sign in again', 'ok'); } catch (e) { toast(e.message, 'error'); }
  };
  return html`
    <div class="stack">
      <div class="row-between">
        <h2 style="margin:0">Rings & schedules</h2>
        <button class="btn btn-primary" onClick=${addRing}>＋ Add ring</button>
      </div>
      ${unassigned.length > 0 && html`<div class="card card-tight badge-warn" style="border-radius:8px">⚠ ${unassigned.length} division(s) are not assigned to a ring.</div>`}
      <div class="board">
        ${rings.map((ring) => html`<${RingCard} key=${ring.id} state=${state} ring=${ring} pin=${pins[ring.id]} onPin=${() => changePin(ring)} unassigned=${unassigned} />`)}
      </div>
      ${!rings.length && html`<div class="empty">No rings yet. Add one for each competition area.</div>`}
    </div>`;
}

function RingCard({ state, ring, pin, onPin, unassigned }) {
  const list = ringDivisions(state, ring.id);
  const online = sync.presence.filter((p) => p.role === 'ring' && p.ringId === ring.id);
  const move = (i, delta) => {
    const ids = list.map((d) => d.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    sync.dispatch('ring.setSchedule', { id: ring.id, divisionIds: ids });
  };
  return html`
    <div class="card board-ring stack">
      <div class="row-between">
        <input value=${ring.name || ''} placeholder=${`Ring ${ring.number}`} style="font-weight:700;font-size:1.1rem;width:60%" onChange=${(e) => sync.dispatch('ring.update', { id: ring.id, patch: { name: e.target.value } })} />
        ${online.length ? html`<span class="badge badge-ok">● ${online.length} device${online.length > 1 ? 's' : ''}</span>` : html`<span class="badge">offline</span>`}
      </div>
      <div class="row small"><span class="muted">Number</span>
        <input type="number" style="width:70px" value=${ring.number} onChange=${(e) => sync.dispatch('ring.update', { id: ring.id, patch: { number: Number(e.target.value) } })} />
        <span class="muted">PIN</span> <code>${pin || '…'}</code> <button class="btn btn-sm" onClick=${onPin}>Change</button>
      </div>
      <div class="list">
        ${list.map((d, i) => html`
          <div key=${d.id} class=${`list-item ${ring.currentDivisionId === d.id ? 'active' : ''} ${d.status === 'completed' ? 'done' : ''}`} style="flex-wrap:wrap">
            <span class=${`status-dot status-${d.status}`}></span>
            <span class="grow small" style="min-width:150px"><strong>${i + 1}. ${divisionLabel(d)}</strong><br /><span class="muted">${eventLabel(d.event)} · ${d.competitorIds.length}</span></span>
            <button class="btn btn-sm btn-ghost" disabled=${i === 0} onClick=${() => move(i, -1)} title="Move up">▲</button>
            <button class="btn btn-sm btn-ghost" disabled=${i === list.length - 1} onClick=${() => move(i, 1)} title="Move down">▼</button>
            <select style="min-height:30px;max-width:110px;padding:.2rem .4rem;font-size:.85rem" value=${ring.id} onChange=${(e) => sync.dispatch('division.assignRing', { id: d.id, ringId: e.target.value || null })} title="Move to another ring">
              ${sortedRings(state).map((r) => html`<option value=${r.id}>${ringLabel(r)}</option>`)}
              <option value="">Unassign</option>
            </select>
          </div>`)}
        ${!list.length && html`<div class="muted small">No divisions scheduled.</div>`}
      </div>
      ${unassigned.length > 0 && html`
        <select value="" onChange=${(e) => e.target.value && sync.dispatch('division.assignRing', { id: e.target.value, ringId: ring.id })}>
          <option value="">＋ Add unassigned division…</option>
          ${unassigned.map((d) => html`<option value=${d.id}>${divisionLabel(d)} (${d.competitorIds.length})</option>`)}
        </select>`}
      <div class="row" style="justify-content:flex-end">
        <button class="btn btn-sm btn-danger" onClick=${() => confirmAction(`Delete ${ringLabel(ring)}? Its divisions become unassigned.`) && sync.dispatch('ring.delete', { id: ring.id })}>Delete ring</button>
      </div>
    </div>`;
}
