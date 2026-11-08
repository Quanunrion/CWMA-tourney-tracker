// Client-side sync engine + shared UI helpers.
//
// Each client keeps the last state confirmed by the server plus a list of its own
// pending commands. What you see = confirmed state + pending commands applied on top.
// Pending commands are saved in localStorage, so if the network drops a ring can keep
// working; everything is re-sent (and de-duplicated by the server) on reconnect.

import { html, render } from 'htm/preact';
import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import { applyCommand } from '/shared/reducer.js';
import { newId } from '/shared/ids.js';

export { html, render, useState, useEffect, useRef, useMemo, useCallback, newId };

const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

// ---------- toasts ----------
const toastListeners = new Set();
let toasts = [];
export function toast(message, kind = 'info', ms = 4000) {
  const t = { id: newId('t'), message, kind };
  toasts = [...toasts, t];
  toastListeners.forEach((fn) => fn(toasts));
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); toastListeners.forEach((fn) => fn(toasts)); }, ms);
}
export function Toasts() {
  const [list, setList] = useState(toasts);
  useEffect(() => { toastListeners.add(setList); return () => toastListeners.delete(setList); }, []);
  return html`<div class="toasts">${list.map((t) => html`<div class=${`toast toast-${t.kind}`} key=${t.id}>${t.message}</div>`)}</div>`;
}

// ---------- sync ----------
export class Sync {
  constructor(view) {
    this.view = view;
    this.tokenKey = `cwma:token:${view}`;
    this.pendingKey = `cwma:pending:${view}`;
    this.cacheKey = `cwma:cache:${view}`;
    this.token = read(this.tokenKey, null);
    this.pending = read(this.pendingKey, []);
    this.confirmed = read(this.cacheKey, null);
    this.state = null;
    this.actor = null;
    this.connected = false;
    this.presence = [];
    this.listeners = new Set();
    this.recompute();
  }

  get signedIn() { return !!this.token; }

  setToken(token) {
    this.token = token;
    write(this.tokenKey, token);
    this.reconnect();
  }

  async logout() {
    if (this.token) await fetch('/api/logout', { method: 'POST', headers: { 'x-token': this.token } }).catch(() => {});
    this.token = null;
    this.actor = null;
    localStorage.removeItem(this.tokenKey);
    this.reconnect();
  }

  start() {
    // global `io` comes from /socket.io/socket.io.js
    this.socket = window.io({ auth: { token: this.token, view: this.view }, reconnectionDelayMax: 3000 });
    this.socket.on('connect', () => { this.connected = true; this.notify(); });
    this.socket.on('disconnect', () => { this.connected = false; this.notify(); });
    this.socket.on('hello', ({ actor }) => {
      if (this.token && actor.role === 'viewer') {
        // Session no longer valid (PIN changed, ring deleted, server data reset).
        this.token = null;
        localStorage.removeItem(this.tokenKey);
        toast('Your sign-in expired — please sign in again', 'warn');
      }
      this.actor = actor;
      this.notify();
    });
    this.socket.on('snapshot', ({ state }) => {
      this.confirmed = state;
      this.flush();
      this.recompute();
    });
    this.socket.on('applied', ({ cmd, version, actor }) => {
      if (!this.confirmed || version !== this.confirmed.version + 1) {
        this.socket.emit('resync');
        return;
      }
      try {
        applyCommand(this.confirmed, cmd, actor);
        this.confirmed.version = version;
      } catch (err) {
        console.warn('Local apply failed, resyncing', err);
        this.socket.emit('resync');
      }
      this.pending = this.pending.filter((p) => p.id !== cmd.id);
      this.savePending();
      this.recompute();
    });
    this.socket.on('presence', (list) => { this.presence = list; this.notify(); });
    return this;
  }

  reconnect() {
    if (!this.socket) return;
    this.socket.auth = { token: this.token, view: this.view };
    this.socket.disconnect().connect();
  }

  savePending() { write(this.pendingKey, this.pending); }

  recompute() {
    if (!this.confirmed) { this.state = null; this.notify(); return; }
    const view = structuredClone(this.confirmed);
    for (const cmd of this.pending) {
      try { applyCommand(view, cmd, this.actor); } catch { /* will be rejected by server */ }
    }
    this.state = view;
    if (this.cacheTimer == null) {
      this.cacheTimer = setTimeout(() => { this.cacheTimer = null; write(this.cacheKey, this.confirmed); }, 1500);
    }
    this.notify();
  }

  // Returns true if the change was accepted locally.
  dispatch(type, payload = {}) {
    if (!this.state) { toast('Still loading — try again in a moment', 'warn'); return false; }
    const cmd = { id: newId('cmd'), type, payload, at: new Date().toISOString() };
    try {
      applyCommand(structuredClone(this.state), cmd, this.actor);
    } catch (err) {
      toast(err.message, 'error');
      return false;
    }
    this.pending.push(cmd);
    this.savePending();
    this.recompute();
    this.send(cmd);
    return true;
  }

  send(cmd) {
    if (!this.connected) return;
    this.socket.emit('command', cmd, (ack) => {
      if (ack?.ok && !ack.duplicate) return; // the 'applied' broadcast clears it
      this.pending = this.pending.filter((p) => p.id !== cmd.id);
      this.savePending();
      if (!ack?.ok) toast(`Not saved: ${ack?.error || 'unknown error'}`, 'error', 7000);
      this.recompute();
    });
  }

  flush() { for (const cmd of this.pending) this.send(cmd); }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify() { this.listeners.forEach((fn) => fn()); }

  async api(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { 'content-type': 'application/json', 'x-token': this.token || '', ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body;
  }

  async upload(file) {
    const res = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': file.type, 'x-token': this.token || '' }, body: file });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body.url;
  }
}

export function useSync(sync) {
  const [, setTick] = useState(0);
  useEffect(() => sync.subscribe(() => setTick((t) => t + 1)), [sync]);
  return sync;
}

// ---------- shared components ----------

export function ConnectionBadge({ sync }) {
  const pending = sync.pending.length;
  if (sync.connected && !pending) return html`<span class="badge badge-ok" title="Connected to the tournament server">● Live</span>`;
  if (sync.connected) return html`<span class="badge badge-warn">Syncing ${pending}…</span>`;
  return html`<span class="badge badge-bad" title="Changes are kept on this device and sent when the connection returns">● Offline${pending ? ` · ${pending} unsent` : ''}</span>`;
}

export function Login({ sync, role, title }) {
  const [pin, setPin] = useState('');
  const [rings, setRings] = useState([]);
  const [ringId, setRingId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (role === 'ring') fetch('/api/rings').then((r) => r.json()).then((list) => { setRings(list); if (list[0]) setRingId(list[0].id); }).catch(() => setError('Cannot reach the tournament server'));
  }, [role]);
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const device = navigator.userAgent.match(/\(([^)]+)\)/)?.[1] || '';
      const { token } = await sync.api('/api/login', { method: 'POST', body: JSON.stringify({ role, pin, ringId, device }) });
      sync.setToken(token);
    } catch (err) { setError(err.message); }
  };
  return html`
    <div class="login">
      <form class="card login-card" onSubmit=${submit}>
        <h1>${title}</h1>
        ${role === 'ring' && html`
          <label>Ring
            <select value=${ringId} onChange=${(e) => setRingId(e.target.value)}>
              ${rings.map((r) => html`<option value=${r.id}>${r.name || `Ring ${r.number}`}</option>`)}
            </select>
          </label>
          ${!rings.length && html`<p class="muted">No rings yet. Create rings at the front desk first.</p>`}`}
        <label>PIN <input type="password" inputmode="numeric" autofocus value=${pin} onInput=${(e) => setPin(e.target.value)} /></label>
        ${error && html`<p class="error">${error}</p>`}
        <button class="btn btn-primary btn-lg" type="submit">Sign in</button>
        <a class="muted small" href="/">← All screens</a>
      </form>
    </div>`;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`
    <div class="modal-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose?.()}>
      <div class=${`modal card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-label=${title}>
        <div class="modal-head"><h2>${title}</h2><button class="btn btn-ghost" onClick=${onClose} aria-label="Close">✕</button></div>
        <div class="modal-body">${children}</div>
      </div>
    </div>`;
}

export function Loading() {
  return html`<div class="loading">Connecting to tournament server…</div>`;
}

export function confirmAction(message) {
  return window.confirm(message);
}

export function mount(App) {
  render(html`<${App} /><${Toasts} />`, document.getElementById('app'));
}
