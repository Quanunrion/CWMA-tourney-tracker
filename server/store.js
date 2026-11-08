// Persistence for the master list. Today this is a JSON file on the front-desk machine;
// everything goes through this module, so it can be swapped for a cloud database later.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { emptyState, DEFAULT_THEMES } from '../shared/model.js';
import { applyCommand, authorize, describeCommand } from '../shared/reducer.js';

const MAX_REMEMBERED_COMMANDS = 20000;

function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.stateFile = path.join(dataDir, 'tournament.json');
    this.secretsFile = path.join(dataDir, 'secrets.json');
    this.auditFile = path.join(dataDir, 'audit.log');
    this.backupDir = path.join(dataDir, 'backups');
    this.uploadDir = path.join(dataDir, 'uploads');
    for (const dir of [dataDir, this.backupDir, this.uploadDir]) fs.mkdirSync(dir, { recursive: true });
    this.load();
    this.saveTimer = null;
    this.lastBackup = 0;
  }

  load() {
    let saved = null;
    if (fs.existsSync(this.stateFile)) saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    const base = emptyState();
    this.state = saved ? { ...base, ...saved.state, themes: { ...base.themes, ...(saved.state?.themes || {}) } } : base;
    for (const k of Object.keys(DEFAULT_THEMES)) this.state.themes[k] = { ...DEFAULT_THEMES[k], ...this.state.themes[k] };
    this.applied = new Set(saved?.appliedIds || []);
    this.appliedOrder = saved?.appliedIds || [];

    if (fs.existsSync(this.secretsFile)) {
      this.secrets = JSON.parse(fs.readFileSync(this.secretsFile, 'utf8'));
    } else {
      this.secrets = { adminPin: '1234', displayPin: '1234', ringPins: {}, sessions: {} };
      this.saveSecrets();
    }
    this.secrets.sessions ||= {};
    this.secrets.ringPins ||= {};
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const appliedIds = this.appliedOrder.slice(-MAX_REMEMBERED_COMMANDS);
    writeAtomic(this.stateFile, JSON.stringify({ state: this.state, appliedIds }));
    const now = Date.now();
    if (now - this.lastBackup > 5 * 60 * 1000) {
      this.lastBackup = now;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      writeAtomic(path.join(this.backupDir, `tournament-${stamp}.json`), JSON.stringify({ state: this.state }));
      const backups = fs.readdirSync(this.backupDir).filter((f) => f.endsWith('.json')).sort();
      for (const old of backups.slice(0, Math.max(0, backups.length - 50))) fs.unlinkSync(path.join(this.backupDir, old));
    }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.saveNow(), 250);
  }

  saveSecrets() {
    writeAtomic(this.secretsFile, JSON.stringify(this.secrets, null, 2));
  }

  audit(entry) {
    fs.appendFileSync(this.auditFile, `${JSON.stringify(entry)}\n`);
  }

  readAudit(limit = 500) {
    if (!fs.existsSync(this.auditFile)) return [];
    const lines = fs.readFileSync(this.auditFile, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l)).reverse();
  }

  // Apply a command from a client. Returns { duplicate } or throws CommandError.
  apply(cmd, actor) {
    if (!cmd || typeof cmd.id !== 'string' || typeof cmd.type !== 'string') throw new Error('Malformed command');
    if (this.applied.has(cmd.id)) return { duplicate: true };
    authorize(this.state, cmd, actor);
    // Apply to a copy so a failing command never leaves the master list half-changed.
    const draft = structuredClone(this.state);
    applyCommand(draft, cmd, actor);
    const summary = describeCommand(this.state, cmd);
    draft.version = this.state.version + 1;
    this.state = draft;
    this.applied.add(cmd.id);
    this.appliedOrder.push(cmd.id);
    if (this.appliedOrder.length > MAX_REMEMBERED_COMMANDS * 1.5) {
      const drop = this.appliedOrder.splice(0, this.appliedOrder.length - MAX_REMEMBERED_COMMANDS);
      for (const id of drop) this.applied.delete(id);
    }
    this.audit({
      at: new Date().toISOString(),
      clientAt: cmd.at,
      version: draft.version,
      actor: { role: actor.role, ringId: actor.ringId || null, device: actor.device || '' },
      type: cmd.type,
      summary,
      payload: cmd.payload,
    });
    this.scheduleSave();
    return { duplicate: false, version: draft.version };
  }

  replaceState(newState) {
    const base = emptyState();
    this.state = { ...base, ...newState, version: this.state.version + 1 };
    this.saveNow();
  }

  // ----- auth -----
  checkPin(role, pin, ringId) {
    pin = String(pin ?? '');
    if (role === 'admin') return pin === String(this.secrets.adminPin);
    if (role === 'display') return pin === String(this.secrets.displayPin) || pin === String(this.secrets.adminPin);
    if (role === 'ring') {
      if (!this.state.rings[ringId]) return false;
      const ringPin = this.secrets.ringPins[ringId];
      return pin === String(ringPin ?? '') || pin === String(this.secrets.adminPin);
    }
    return false;
  }

  createSession(actor) {
    const token = crypto.randomBytes(24).toString('hex');
    this.secrets.sessions[token] = { ...actor, createdAt: new Date().toISOString() };
    this.saveSecrets();
    return token;
  }

  session(token) {
    const s = token && this.secrets.sessions[token];
    if (!s) return null;
    if (s.role === 'ring' && !this.state.rings[s.ringId]) return null;
    return s;
  }

  endSession(token) {
    delete this.secrets.sessions[token];
    this.saveSecrets();
  }

  ensureRingPin(ringId) {
    if (!this.secrets.ringPins[ringId]) {
      this.secrets.ringPins[ringId] = String(crypto.randomInt(1000, 10000));
      this.saveSecrets();
    }
    return this.secrets.ringPins[ringId];
  }

  setPins({ adminPin, displayPin, ringPins }) {
    if (adminPin) this.secrets.adminPin = String(adminPin);
    if (displayPin) this.secrets.displayPin = String(displayPin);
    if (ringPins) Object.assign(this.secrets.ringPins, ringPins);
    // Changing a PIN signs out existing sessions for that role.
    for (const [token, s] of Object.entries(this.secrets.sessions)) {
      if ((adminPin && s.role === 'admin') || (displayPin && s.role === 'display') || (ringPins && s.role === 'ring' && ringPins[s.ringId])) {
        delete this.secrets.sessions[token];
      }
    }
    this.saveSecrets();
  }

  pinsForAdmin() {
    for (const id of Object.keys(this.state.rings)) this.ensureRingPin(id);
    return { adminPin: this.secrets.adminPin, displayPin: this.secrets.displayPin, ringPins: { ...this.secrets.ringPins } };
  }
}
