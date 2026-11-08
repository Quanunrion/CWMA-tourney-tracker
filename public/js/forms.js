import { html, useState } from './core.js';
import { BELTS, SEXES, competitorName, beltLabel, competitorAssignments, ringLabel, divisionLabel } from '/shared/model.js';

export function CompetitorForm({ initial = {}, onSubmit, submitLabel = 'Save', onCancel, dojos = [] }) {
  const [f, setF] = useState({ firstName: '', lastName: '', age: '', sex: '', belt: 'beginner', dojo: '', notes: '', ...initial, age: initial.age ?? '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    if (!f.firstName.trim() && !f.lastName.trim()) return;
    onSubmit({ ...f, firstName: f.firstName.trim(), lastName: f.lastName.trim(), dojo: f.dojo.trim(), age: f.age === '' ? null : Number(f.age) });
  };
  return html`
    <form class="stack" onSubmit=${submit}>
      <div class="form-grid">
        <label>First name <input required=${!f.lastName} value=${f.firstName} onInput=${set('firstName')} autofocus /></label>
        <label>Last name <input value=${f.lastName} onInput=${set('lastName')} /></label>
        <label>Age <input type="number" min="1" max="120" inputmode="numeric" value=${f.age} onInput=${set('age')} /></label>
        <label>Sex
          <select value=${f.sex} onChange=${set('sex')}>
            <option value="">—</option>
            ${SEXES.map((s) => html`<option value=${s.id}>${s.label}</option>`)}
          </select>
        </label>
        <label>Belt level
          <select value=${f.belt} onChange=${set('belt')}>
            ${BELTS.map((b) => html`<option value=${b.id}>${b.label}</option>`)}
          </select>
        </label>
        <label>Dojo / school <input list="dojo-list" value=${f.dojo} onInput=${set('dojo')} /></label>
      </div>
      <datalist id="dojo-list">${dojos.map((d) => html`<option value=${d} />`)}</datalist>
      <label>Notes <input value=${f.notes} onInput=${set('notes')} /></label>
      <div class="row" style="justify-content:flex-end">
        ${onCancel && html`<button type="button" class="btn" onClick=${onCancel}>Cancel</button>`}
        <button class="btn btn-primary" type="submit">${submitLabel}</button>
      </div>
    </form>`;
}

export function knownDojos(state) {
  return [...new Set(Object.values(state.competitors).map((c) => c.dojo).filter(Boolean))].sort();
}

export function searchCompetitors(state, query, limit = 50) {
  const q = query.trim().toLowerCase();
  const all = Object.values(state.competitors);
  if (!q) return all.sort(byName).slice(0, limit);
  const terms = q.split(/\s+/);
  return all
    .filter((c) => {
      const hay = `${c.firstName} ${c.lastName} ${c.dojo}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    })
    .sort(byName)
    .slice(0, limit);
}

export function byName(a, b) {
  return (a.lastName || '').localeCompare(b.lastName || '') || (a.firstName || '').localeCompare(b.firstName || '');
}

export function CompetitorLine({ c }) {
  return html`<span><strong>${competitorName(c)}</strong> <span class="muted small">${[c.age != null ? `${c.age}y` : '', c.sex, beltLabel(c.belt), c.dojo].filter(Boolean).join(' · ')}</span></span>`;
}

const STATUS = { pending: 'not started', in_progress: 'competing now', completed: 'done' };

export function Assignments({ state, competitorId }) {
  const list = competitorAssignments(state, competitorId);
  if (!list.length) return html`<span class="muted small">No divisions yet</span>`;
  return html`<div class="stack" style="gap:.25rem">${list.map(({ division: d, ring, order }) => html`
    <div class="small" key=${d.id}>
      <strong>${ringLabel(ring)}</strong>${ring && order >= 0 ? html` <span class="muted">(#${order + 1} of ${ring.schedule.length})</span>` : ''} — ${divisionLabel(d)}
      <span class=${`badge ${d.status === 'in_progress' ? 'badge-warn' : d.status === 'completed' ? 'badge-ok' : ''}`}>${STATUS[d.status]}</span>
    </div>`)}</div>`;
}

