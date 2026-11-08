// Display operator console: approve, queue, preview, go live, and design slides.
import { html, mount, Sync, useSync, useState, useEffect, Login, Loading, ConnectionBadge, Modal, newId, toast, confirmAction } from './core.js';
import { SLIDE_TYPES, FONTS, competitorName, divisionLabel, ringLabel, sortedRings } from '/shared/model.js';
import { Slide, itemLabel, SAMPLE_DATA } from './slides.js';
import { searchCompetitors, CompetitorLine } from './forms.js';

const sync = new Sync('display').start();
let outputWindow = null;
const openOutput = () => {
  outputWindow = window.open('/output', 'cwma-output', 'popup,width=1280,height=720');
  if (!outputWindow) toast('Pop-up blocked — open /output in a new window on the projector screen', 'warn', 7000);
};

function App() {
  useSync(sync);
  const [tab, setTab] = useState('control');
  if (!sync.signedIn) return html`<${Login} sync=${sync} role="display" title="Display operator sign in" />`;
  const state = sync.state;
  if (!state || !sync.actor || sync.actor.role === 'viewer') return html`<${Loading} />`;
  const pending = Object.values(state.queue).filter((q) => q.status === 'pending_approval').length;
  return html`
    <div class="topbar">
      <span class="title">Display Control</span>
      <span class="sub">${state.tournament.name}</span>
      <span class="spacer"></span>
      <button class="btn btn-sm" onClick=${openOutput}>Open output window ↗</button>
      <${ConnectionBadge} sync=${sync} />
      <button class="btn btn-sm" onClick=${() => confirmAction('Sign out?') && sync.logout()}>Sign out</button>
    </div>
    <nav class="tabs">
      <button class=${`tab ${tab === 'control' ? 'active' : ''}`} onClick=${() => setTab('control')}>Live control${pending ? html`<span class="count">${pending}</span>` : ''}</button>
      <button class=${`tab ${tab === 'design' ? 'active' : ''}`} onClick=${() => setTab('design')}>Slide design</button>
      <button class=${`tab ${tab === 'custom' ? 'active' : ''}`} onClick=${() => setTab('custom')}>Custom slides & idle</button>
    </nav>
    <main>
      ${tab === 'control' && html`<${Control} state=${state} />`}
      ${tab === 'design' && html`<${Design} state=${state} />`}
      ${tab === 'custom' && html`<${CustomSlides} state=${state} />`}
    </main>`;
}

const KIND_LABEL = { award: 'Awards', grand: 'Grand', missing: 'Missing', logo: 'Logo', custom: 'Slide' };

function Control({ state }) {
  const [previewId, setPreviewId] = useState(null);
  const [adding, setAdding] = useState(false);
  const live = state.display.live ? state.queue[state.display.live] : null;
  const queue = state.queueOrder.map((id) => state.queue[id]).filter(Boolean);
  const incoming = Object.values(state.queue).filter((q) => q.status === 'pending_approval').sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const history = Object.values(state.queue).filter((q) => ['done', 'rejected', 'recalled'].includes(q.status)).sort((a, b) => (b.shownAt || b.createdAt || '').localeCompare(a.shownAt || a.createdAt || '')).slice(0, 30);
  const previewItem = previewId && state.queue[previewId] && state.queue[previewId].status !== 'live' ? state.queue[previewId] : queue[0] || null;

  const goLive = (item) => {
    if (sync.dispatch('display.goLive', { itemId: item ? item.id : null })) setPreviewId(null);
  };
  const next = () => queue[0] && goLive(queue[0]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input,textarea,select')) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (previewItem) goLive(previewItem); }
      if (e.key === 'l' || e.key === 'L') goLive(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return html`
    <div class="op-layout">
      <div class="stack">
        <div>
          <div class="row-between"><h3 style="margin:0">On screen now</h3><span class="muted small">${live ? itemLabel(state, live) : 'Tournament logo'}</span></div>
          <div class="screen-frame live" style="margin-top:.4rem"><span class="frame-label">LIVE</span><${Slide} state=${state} item=${live} animate=${false} /></div>
        </div>
        <div>
          <div class="row-between"><h3 style="margin:0">Preview</h3><span class="muted small">${previewItem ? itemLabel(state, previewItem) : 'Queue is empty'}</span></div>
          <div class="screen-frame" style="margin-top:.4rem"><span class="frame-label">PREVIEW</span>${previewItem ? html`<${Slide} state=${state} item=${previewItem} animate=${false} />` : html`<div class="slide" style="color:#777">Nothing queued</div>`}</div>
        </div>
        <div class="row">
          <button class="btn btn-ok btn-lg grow" disabled=${!previewItem} onClick=${() => goLive(previewItem)}>▶ Go live with preview <span class="small" style="opacity:.75">(Space)</span></button>
          <button class="btn btn-lg" onClick=${() => goLive(null)}>Show logo <span class="small muted">(L)</span></button>
        </div>
        ${live && html`<div class="row">
          <button class="btn" onClick=${() => sync.dispatch('queue.requeue', { id: live.id, position: 'front' })}>↩ Pull back to queue</button>
          <span class="muted small">Going live with another slide marks this one as done.</span>
        </div>`}
      </div>

      <div class="stack">
        ${incoming.length > 0 && html`
          <div class="card stack" style="border-color:#f1b5af">
            <h3 style="margin:0">Needs approval (${incoming.length})</h3>
            ${incoming.map((item) => html`
              <div class="queue-item" key=${item.id} onClick=${() => setPreviewId(item.id)}>
                <span class=${`kind kind-${item.type}`}>${KIND_LABEL[item.type]}</span>
                <span class="grow">${itemLabel(state, item)}<div class="muted small">from ${ringLabel(state.rings[item.requestedBy || item.ringId])} · ${timeAgo(item.createdAt)}</div></span>
                <button class="btn btn-sm btn-ok" onClick=${(e) => { e.stopPropagation(); sync.dispatch('queue.approve', { id: item.id, position: 'front' }); }} title="Approve and put next in line">Approve → next</button>
                <button class="btn btn-sm" onClick=${(e) => { e.stopPropagation(); sync.dispatch('queue.approve', { id: item.id, position: 'end' }); }}>→ end</button>
                <button class="btn btn-sm btn-danger" onClick=${(e) => { e.stopPropagation(); sync.dispatch('queue.reject', { id: item.id }); }}>Reject</button>
              </div>`)}
          </div>`}

        <div class="card stack">
          <div class="row-between">
            <h3 style="margin:0">Queue (${queue.length})</h3>
            <div class="row"><button class="btn btn-sm" onClick=${() => setAdding(true)}>＋ Add slide</button><button class="btn btn-sm btn-primary" disabled=${!queue.length} onClick=${next}>Take next live</button></div>
          </div>
          ${queue.map((item, i) => html`
            <div key=${item.id} class=${`queue-item ${previewItem?.id === item.id ? 'selected' : ''}`} onClick=${() => setPreviewId(item.id)}>
              <span class="muted small" style="width:1.4rem">${i + 1}</span>
              <span class=${`kind kind-${item.type}`}>${KIND_LABEL[item.type]}</span>
              <span class="grow">${itemLabel(state, item)}${item.ringId ? html`<div class="muted small">${ringLabel(state.rings[item.ringId])}</div>` : ''}</span>
              <button class="btn btn-sm btn-ghost" disabled=${i === 0} onClick=${(e) => { e.stopPropagation(); sync.dispatch('queue.move', { id: item.id, toIndex: i - 1 }); }} title="Move up">▲</button>
              <button class="btn btn-sm btn-ghost" disabled=${i === queue.length - 1} onClick=${(e) => { e.stopPropagation(); sync.dispatch('queue.move', { id: item.id, toIndex: i + 1 }); }} title="Move down">▼</button>
              <button class="btn btn-sm btn-ok" onClick=${(e) => { e.stopPropagation(); goLive(item); }}>Live</button>
              <button class="btn btn-sm btn-ghost" title="Skip / mark done" onClick=${(e) => { e.stopPropagation(); sync.dispatch('queue.markDone', { id: item.id }); }}>✓</button>
              <button class="btn btn-sm btn-ghost" title="Remove" onClick=${(e) => { e.stopPropagation(); sync.dispatch('queue.remove', { id: item.id }); }}>✕</button>
            </div>`)}
          ${!queue.length && html`<div class="empty">Award slides appear here when rings submit results.</div>`}
        </div>

        <details class="card">
          <summary style="cursor:pointer"><strong>History</strong> <span class="muted small">(${history.length})</span></summary>
          <div class="stack" style="margin-top:.5rem">
            ${history.map((item) => html`
              <div class="queue-item" key=${item.id} onClick=${() => setPreviewId(null)}>
                <span class=${`kind kind-${item.type}`}>${KIND_LABEL[item.type]}</span>
                <span class="grow small">${itemLabel(state, item)} <span class="badge">${item.status}</span></span>
                ${item.status !== 'recalled' && html`<button class="btn btn-sm" onClick=${() => sync.dispatch('queue.requeue', { id: item.id })}>Requeue</button>`}
              </div>`)}
            ${history.length > 0 && html`<button class="btn btn-sm" onClick=${() => sync.dispatch('queue.clearHistory')}>Clear history</button>`}
          </div>
        </details>
      </div>
      ${adding && html`<${AddSlideModal} state=${state} onClose=${() => setAdding(false)} />`}
    </div>`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(iso).toLocaleTimeString();
}

function AddSlideModal({ state, onClose }) {
  const [kind, setKind] = useState('award');
  const [q, setQ] = useState('');
  const [ringId, setRingId] = useState(sortedRings(state)[0]?.id || '');
  const add = (item, position = 'end') => {
    if (sync.dispatch('queue.add', { item: { id: newId('q'), ...item }, position })) { toast('Added to queue', 'ok'); onClose(); }
  };
  const completed = Object.values(state.divisions).filter((d) => d.status === 'completed').sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
  const customs = Object.values(state.customSlides);
  return html`
    <${Modal} title="Add a slide to the queue" onClose=${onClose} wide>
      <div class="row">
        ${[['award', 'Division awards'], ['missing', 'Missing competitor'], ['logo', 'Logo'], ['custom', 'Custom slide']].map(([k, l]) => html`<button class=${`btn ${kind === k ? 'btn-primary' : ''}`} onClick=${() => setKind(k)}>${l}</button>`)}
      </div>
      ${kind === 'award' && html`
        <p class="muted small">Re-show results for any completed division.</p>
        <div class="list" style="max-height:50vh;overflow:auto">
          ${completed.map((d) => html`<div class="list-item clickable" key=${d.id} onClick=${() => add({ type: d.grand ? 'grand' : 'award', divisionId: d.id, ringId: d.ringId })}>
            <span class="grow"><strong>${divisionLabel(d)}</strong> <span class="muted small">${d.grand ? 'Grand · ' : ''}${competitorName(state.competitors[d.results?.first])}</span></span><span class="btn btn-sm">Add</span></div>`)}
          ${!completed.length && html`<div class="empty">No completed divisions yet.</div>`}
        </div>`}
      ${kind === 'missing' && html`
        <div class="row">
          <label>Report to <select value=${ringId} onChange=${(e) => setRingId(e.target.value)}>${sortedRings(state).map((r) => html`<option value=${r.id}>${ringLabel(r)}</option>`)}</select></label>
          <label class="grow">Competitor <input placeholder="Search name…" value=${q} onInput=${(e) => setQ(e.target.value)} autofocus /></label>
        </div>
        <div class="list" style="max-height:45vh;overflow:auto">
          ${searchCompetitors(state, q, 25).map((c) => html`<div class="list-item clickable" key=${c.id} onClick=${() => add({ type: 'missing', competitorId: c.id, ringId }, 'front')}><span class="grow"><${CompetitorLine} c=${c} /></span><span class="btn btn-sm">Add next</span></div>`)}
        </div>`}
      ${kind === 'logo' && html`<button class="btn btn-primary" onClick=${() => add({ type: 'logo' })}>Add logo slide to queue</button>`}
      ${kind === 'custom' && html`
        <div class="list">
          ${customs.map((s) => html`<div class="list-item clickable" key=${s.id} onClick=${() => add({ type: 'custom', customSlideId: s.id })}><span class="grow">${s.title || 'Untitled slide'}</span><span class="btn btn-sm">Add</span></div>`)}
          ${!customs.length && html`<div class="empty">Create custom slides on the “Custom slides & idle” tab.</div>`}
        </div>`}
    <//>`;
}

// ---------- slide design ----------

function Design({ state }) {
  const [type, setType] = useState('award');
  const theme = state.themes[type];
  const update = (patch) => sync.dispatch('theme.update', { slideType: type, patch });
  const field = (k, conv = (v) => v) => (e) => update({ [k]: conv(e.target.value) });
  const num = (v) => Number(v);
  const uploadBg = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { update({ backgroundImage: await sync.upload(file) }); } catch (err) { toast(err.message, 'error'); }
  };
  const textFields = {
    logo: [['title', 'Title (optional)'], ['subtitle', 'Subtitle (optional)']],
    missing: [['title', 'Heading'], ['message', 'Message ({ring} = ring number)']],
    award: [['title', 'Heading ({division} = division name)'], ['firstLabel', '1st place label'], ['secondLabel', '2nd place label'], ['thirdLabel', '3rd place label']],
    grand: [['title', 'Heading']],
    custom: [],
  }[type];
  const range = (k, label, min, max, step = 0.5) => html`
    <label>${label} <span class="muted">${theme[k]}</span><input type="range" min=${min} max=${max} step=${step} value=${theme[k]} onInput=${field(k, num)} /></label>`;
  return html`
    <div class="stack">
      <div class="row">
        ${SLIDE_TYPES.map((t) => html`<button key=${t.id} class=${`btn ${type === t.id ? 'btn-primary' : ''}`} onClick=${() => setType(t.id)}>${t.label}</button>`)}
      </div>
      <div class="theme-editor">
        <div class="card stack">
          ${textFields.map(([k, label]) => html`<label key=${k}>${label}<input value=${theme[k] ?? ''} onChange=${field(k)} /></label>`)}
          ${type === 'award' && html`<label class="inline"><input type="checkbox" checked=${!!theme.showThird} onChange=${(e) => update({ showThird: e.target.checked })} /> Also show 3rd place</label>`}
          <div class="row">
            <label>Background <input type="color" value=${theme.background} onInput=${field('background')} /></label>
            <label>Text <input type="color" value=${theme.textColor} onInput=${field('textColor')} /></label>
            <label>Accent <input type="color" value=${theme.accentColor} onInput=${field('accentColor')} /></label>
          </div>
          <label>Background image <input type="file" accept="image/*" onChange=${uploadBg} /></label>
          ${theme.backgroundImage && html`
            <div class="row">
              <select value=${theme.backgroundFit} onChange=${field('backgroundFit')}><option value="cover">Fill</option><option value="contain">Fit</option></select>
              <button class="btn btn-sm btn-danger" onClick=${() => update({ backgroundImage: '' })}>Remove image</button>
            </div>
            ${range('overlayOpacity', 'Darken image', 0, 0.9, 0.05)}`}
          <label>Font <select value=${theme.fontFamily} onChange=${field('fontFamily')}>${FONTS.map((f) => html`<option value=${f} style=${{ fontFamily: f }}>${f.split(',')[0].replace(/"/g, '')}</option>`)}</select></label>
          ${range('titleSize', 'Heading size', 2, 14)}
          ${type !== 'logo' && type !== 'custom' && range('nameSize', 'Name size', 3, 16)}
          ${range('bodySize', 'Body text size', 1.5, 8)}
          <div class="row">
            <label class="inline"><input type="checkbox" checked=${theme.showLogo} onChange=${(e) => update({ showLogo: e.target.checked })} /> Show logo</label>
            ${type !== 'logo' && html`<select value=${theme.logoPosition} onChange=${field('logoPosition')}><option value="top">Logo on top</option><option value="bottom">Logo at bottom</option><option value="corner">Logo in corner</option></select>`}
          </div>
          ${range('logoSize', 'Logo size', 5, 80, 1)}
          <div class="row">
            <label>Align <select value=${theme.align} onChange=${field('align')}><option value="center">Center</option><option value="left">Left</option><option value="right">Right</option></select></label>
            <label>Transition <select value=${theme.transition} onChange=${field('transition')}><option value="fade">Fade</option><option value="slide">Slide up</option><option value="none">None</option></select></label>
          </div>
          ${!state.tournament.logoUrl && html`<p class="small muted">Upload the tournament logo at Front Desk → Settings.</p>`}
          <div><button class="btn btn-sm btn-danger" onClick=${() => confirmAction('Reset this slide type to the default look?') && sync.dispatch('theme.reset', { slideType: type })}>Reset to default</button></div>
        </div>
        <div class="stack" style="position:sticky;top:110px">
          <div class="screen-frame"><span class="frame-label">SAMPLE</span><${Slide} state=${state} sample=${SAMPLE_DATA[type]} slideType=${type} animate=${false} /></div>
          <p class="muted small">Changes apply instantly to every slide of this type — including the one on screen.</p>
        </div>
      </div>
    </div>`;
}

// ---------- custom slides & idle rotation ----------

function CustomSlides({ state }) {
  const slides = Object.values(state.customSlides);
  const [selectedId, setSelectedId] = useState(null);
  const s = selectedId && state.customSlides[selectedId];
  const idle = state.idle;
  const create = () => { const id = newId('s'); if (sync.dispatch('customSlide.create', { slide: { id, title: 'New slide', body: '' } })) setSelectedId(id); };
  const upd = (patch) => sync.dispatch('customSlide.update', { id: s.id, patch });
  return html`
    <div class="theme-editor">
      <div class="stack">
        <div class="card stack">
          <div class="row-between"><h3 style="margin:0">Custom / sponsor slides</h3><button class="btn btn-sm btn-primary" onClick=${create}>＋ New</button></div>
          ${slides.map((x) => html`<div key=${x.id} class=${`list-item clickable ${selectedId === x.id ? 'active' : ''}`} onClick=${() => setSelectedId(x.id)}><span class="grow">${x.title || 'Untitled'}</span>
            <label class="inline small" onClick=${(e) => e.stopPropagation()}><input type="checkbox" checked=${idle.slideIds.includes(x.id)} onChange=${(e) => sync.dispatch('idle.update', { patch: { slideIds: e.target.checked ? [...idle.slideIds, x.id] : idle.slideIds.filter((i) => i !== x.id) } })} /> idle</label></div>`)}
          ${!slides.length && html`<div class="muted small">None yet.</div>`}
        </div>
        <div class="card stack">
          <h3 style="margin:0">Idle rotation</h3>
          <p class="muted small">When the logo is showing, rotate between the logo and the slides ticked “idle”.</p>
          <label class="inline"><input type="checkbox" checked=${idle.enabled} onChange=${(e) => sync.dispatch('idle.update', { patch: { enabled: e.target.checked } })} /> Enabled</label>
          <label>Seconds per slide <input type="number" min="3" value=${idle.intervalSec} onChange=${(e) => sync.dispatch('idle.update', { patch: { intervalSec: Number(e.target.value) || 12 } })} /></label>
        </div>
      </div>
      <div>
        ${s ? html`
          <div class="card stack">
            <label>Title <input value=${s.title} onChange=${(e) => upd({ title: e.target.value })} /></label>
            <label>Text <textarea value=${s.body} onChange=${(e) => upd({ body: e.target.value })}></textarea></label>
            <label>Image <input type="file" accept="image/*" onChange=${async (e) => { const f = e.target.files[0]; if (f) { try { upd({ imageUrl: await sync.upload(f) }); } catch (err) { toast(err.message, 'error'); } } }} /></label>
            ${s.imageUrl && html`<button class="btn btn-sm btn-danger" onClick=${() => upd({ imageUrl: '' })}>Remove image</button>`}
            <div class="screen-frame"><${Slide} state=${state} item=${{ id: s.id, type: 'custom', customSlideId: s.id }} animate=${false} /></div>
            <div class="row" style="justify-content:flex-end">
              <button class="btn btn-danger" onClick=${() => confirmAction('Delete this slide?') && sync.dispatch('customSlide.delete', { id: s.id }) && setSelectedId(null)}>Delete</button>
            </div>
          </div>` : html`<div class="empty">Select or create a slide. Its colours and fonts come from the “Custom / sponsor” look on the Slide design tab.</div>`}
      </div>
    </div>`;
}

mount(App);
