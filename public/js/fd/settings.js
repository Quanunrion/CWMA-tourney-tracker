import { html, useState, useEffect, toast, confirmAction } from '../core.js';
import { sync } from './sync.js';

export function Settings({ state }) {
  const t = state.tournament;
  const s = state.settings;
  const [pins, setPins] = useState(null);
  const [newPins, setNewPins] = useState({ adminPin: '', displayPin: '' });
  const [info, setInfo] = useState(null);
  useEffect(() => {
    sync.api('/api/pins').then(setPins).catch(() => {});
    fetch('/api/info').then((r) => r.json()).then(setInfo).catch(() => {});
  }, []);
  const upd = (k) => (e) => sync.dispatch('tournament.update', { patch: { [k]: e.target.value } });
  const setting = (patch) => sync.dispatch('settings.update', { patch });

  const uploadLogo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { const url = await sync.upload(file); sync.dispatch('tournament.update', { patch: { logoUrl: url } }); toast('Logo uploaded', 'ok'); } catch (err) { toast(err.message, 'error'); }
  };
  const savePins = async () => {
    const body = Object.fromEntries(Object.entries(newPins).filter(([, v]) => v));
    if (!Object.keys(body).length) return;
    try { setPins(await sync.api('/api/pins', { method: 'POST', body: JSON.stringify(body) })); setNewPins({ adminPin: '', displayPin: '' }); toast('PINs updated', 'ok'); } catch (err) { toast(err.message, 'error'); }
  };
  const restore = async (e) => {
    const file = e.target.files[0];
    if (!file || !confirmAction('Replace the ENTIRE master list with this backup? (The current data is saved to the backups folder first.)')) return;
    try { await sync.api('/api/restore', { method: 'POST', body: await file.text() }); toast('Backup restored', 'ok'); } catch (err) { toast(err.message, 'error'); }
  };
  const exp = (file) => `/api/export/${file}?token=${encodeURIComponent(sync.token)}`;

  return html`
    <div class="grid-2" style="align-items:start">
      <div class="card stack">
        <h2>Tournament</h2>
        <label>Name <input value=${t.name} onChange=${upd('name')} /></label>
        <div class="form-grid">
          <label>Date <input type="date" value=${t.date} onChange=${upd('date')} /></label>
          <label>Location <input value=${t.location} onChange=${upd('location')} /></label>
        </div>
        <label>Logo (used on display slides)
          <input type="file" accept="image/*" onChange=${uploadLogo} />
        </label>
        ${t.logoUrl && html`<div class="row"><img src=${t.logoUrl} alt="Logo" style="max-height:90px;background:#0b1d3a;padding:6px;border-radius:6px" /><button class="btn btn-sm btn-danger" onClick=${() => sync.dispatch('tournament.update', { patch: { logoUrl: '' } })}>Remove</button></div>`}
      </div>

      <div class="card stack">
        <h2>Results & display</h2>
        <label class="inline"><input type="checkbox" checked=${s.autoQueueAwards} onChange=${(e) => setting({ autoQueueAwards: e.target.checked })} /> Submitted results go straight into the display queue</label>
        <label>Places shown on award slides
          <select value=${s.awardPlacesShown} onChange=${(e) => setting({ awardPlacesShown: Number(e.target.value) })}>
            <option value="2">1st & 2nd</option><option value="3">1st, 2nd & 3rd</option>
          </select>
        </label>
        <div class="form-grid">
          <label>Default kumite / chambara format
            <select value=${s.defaultKumiteFormat} onChange=${(e) => setting({ defaultKumiteFormat: e.target.value })}>
              <option value="single_elim">Single elimination</option><option value="round_robin">Round robin</option>
            </select>
          </label>
          <label>Default 3rd place
            <select value=${s.defaultThirdPlace} onChange=${(e) => setting({ defaultThirdPlace: e.target.value })}>
              <option value="match">3rd place match</option><option value="manual">Ring chooses</option>
            </select>
          </label>
          <label>Default kata judges <input type="number" min="1" max="7" value=${s.defaultJudges} onChange=${(e) => setting({ defaultJudges: Number(e.target.value) || 3 })} /></label>
        </div>
      </div>

      <div class="card stack">
        <h2>PINs</h2>
        ${pins && html`<p class="small">Front desk/admin PIN: <code>${pins.adminPin}</code> · Display PIN: <code>${pins.displayPin}</code> <span class="muted">(ring PINs are on the Rings tab; the admin PIN also unlocks any ring or the display)</span></p>`}
        <div class="form-grid">
          <label>New admin PIN <input value=${newPins.adminPin} onInput=${(e) => setNewPins({ ...newPins, adminPin: e.target.value })} /></label>
          <label>New display PIN <input value=${newPins.displayPin} onInput=${(e) => setNewPins({ ...newPins, displayPin: e.target.value })} /></label>
        </div>
        <div><button class="btn btn-primary" onClick=${savePins}>Save PINs</button></div>
      </div>

      <div class="card stack">
        <h2>Connecting devices</h2>
        <p class="small muted">Rings, the display and status boards open this address in a browser on the same network:</p>
        ${info?.addresses?.map((a) => html`<code key=${a}>${a}</code>`)}
        <h3 style="margin-top:.5rem">Connected now</h3>
        <div class="small">${sync.presence.map((p) => html`<div key=${p.id}>● ${p.view}${p.ringId ? ` · ${state.rings[p.ringId]?.name || `Ring ${state.rings[p.ringId]?.number ?? ''}`}` : ''} <span class="muted">${p.device}</span></div>`)}</div>
      </div>

      <div class="card stack">
        <h2>Exports & backup</h2>
        <div class="row">
          <a class="btn" href=${exp('results.csv')}>Results CSV</a>
          <a class="btn" href=${exp('medals.csv')}>Medal count by dojo</a>
          <a class="btn" href=${exp('competitors.csv')}>Competitors CSV</a>
          <a class="btn" href="/print" target="_blank">Printable brackets & results</a>
        </div>
        <div class="row">
          <a class="btn" href=${exp('backup.json')}>⬇ Download full backup</a>
          <label class="btn" style="flex-direction:row">⬆ Restore backup<input type="file" accept=".json" style="display:none" onChange=${restore} /></label>
        </div>
        <p class="small muted">The server also saves an automatic backup every 5 minutes in its <code>data/backups</code> folder.</p>
      </div>
    </div>`;
}

export function AuditLog() {
  const [entries, setEntries] = useState([]);
  const [q, setQ] = useState('');
  const load = () => sync.api('/api/audit?limit=1000').then(setEntries).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);
  const list = q ? entries.filter((e) => JSON.stringify(e).toLowerCase().includes(q.toLowerCase())) : entries;
  const who = (a) => (a ? `${a.role}${a.ringId ? ` · ${sync.state.rings[a.ringId]?.name || `Ring ${sync.state.rings[a.ringId]?.number ?? '?'}`}` : ''}` : '');
  return html`
    <div class="stack">
      <div class="row-between"><h2 style="margin:0">Change history</h2><div class="row"><input placeholder="Filter…" value=${q} onInput=${(e) => setQ(e.target.value)} /><button class="btn" onClick=${load}>Refresh</button></div></div>
      <div class="table-wrap" style="max-height:75vh">
        <table>
          <thead><tr><th>Time</th><th>Who</th><th>What</th><th>Type</th></tr></thead>
          <tbody>${list.map((e, i) => html`<tr key=${i}><td class="nowrap small">${new Date(e.at).toLocaleTimeString()}</td><td class="small">${who(e.actor)}</td><td>${e.summary}</td><td class="small muted">${e.type}</td></tr>`)}</tbody>
        </table>
      </div>
    </div>`;
}
