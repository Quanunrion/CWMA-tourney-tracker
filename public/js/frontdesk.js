// Front desk + admin portal.
import { html, mount, useSync, useState, Login, Loading, ConnectionBadge, confirmAction } from './core.js';
import { sync } from './fd/sync.js';
import { CheckIn, Competitors, Flagged } from './fd/checkin.js';
import { Divisions, Results } from './fd/divisions.js';
import { Rings } from './fd/rings.js';
import { Settings, AuditLog } from './fd/settings.js';

const TABS = [
  { id: 'checkin', label: 'Check-in', View: CheckIn },
  { id: 'flagged', label: 'Flagged', View: Flagged },
  { id: 'competitors', label: 'Competitors', View: Competitors },
  { id: 'divisions', label: 'Divisions', View: Divisions },
  { id: 'rings', label: 'Rings', View: Rings },
  { id: 'results', label: 'Results', View: Results },
  { id: 'settings', label: 'Settings & exports', View: Settings },
  { id: 'log', label: 'History', View: AuditLog },
];

function App() {
  useSync(sync);
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'checkin');
  if (!sync.signedIn) return html`<${Login} sync=${sync} role="admin" title="Front desk sign in" />`;
  const state = sync.state;
  if (!state || !sync.actor || sync.actor.role === 'viewer') return html`<${Loading} />`;
  const flagged = Object.values(state.competitors).filter((c) => c.flagged).length;
  const current = TABS.find((t) => t.id === tab) || TABS[0];
  const go = (id) => { setTab(id); history.replaceState(null, '', `#${id}`); };
  return html`
    <div class="topbar">
      <span class="title">${state.tournament.name}</span>
      <span class="sub">Front Desk</span>
      <span class="spacer"></span>
      <a class="btn btn-sm" href="/status" target="_blank">Status board ↗</a>
      <${ConnectionBadge} sync=${sync} />
      <button class="btn btn-sm" onClick=${() => confirmAction('Sign out?') && sync.logout()}>Sign out</button>
    </div>
    <nav class="tabs">
      ${TABS.map((t) => html`<button key=${t.id} class=${`tab ${t.id === current.id ? 'active' : ''}`} onClick=${() => go(t.id)}>${t.label}${t.id === 'flagged' && flagged ? html`<span class="count">${flagged}</span>` : ''}</button>`)}
    </nav>
    <main><${current.View} state=${state} /></main>`;
}

mount(App);
