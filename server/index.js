// Tournament server: holds the master list and syncs every ring, front desk and display.
//
//   npm start            -> http://<this-machine>:3000
//   PORT=8080 npm start  -> custom port
//   DATA_DIR=/path       -> where the master list, backups and uploads are kept

import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Store } from './store.js';
import { buildExports } from './exports.js';
import { CommandError } from '../shared/reducer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createServer({ dataDir = process.env.DATA_DIR || path.join(root, 'data'), quiet = false } = {}) {
  const store = new Store(dataDir);
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 20e6 });

  app.use(express.json({ limit: '20mb' }));
  app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use('/vendor/preact', express.static(path.join(root, 'node_modules/preact')));
  app.use('/vendor/htm', express.static(path.join(root, 'node_modules/htm')));
  app.use('/uploads', express.static(store.uploadDir, { maxAge: '1h' }));

  const tokenFrom = (req) => req.get('x-token') || req.query.token || '';
  const requireRole = (...roles) => (req, res, next) => {
    const s = store.session(tokenFrom(req));
    if (!s || !roles.includes(s.role)) return res.status(401).json({ error: 'Sign in required' });
    req.actor = s;
    next();
  };

  app.get('/api/info', (req, res) => {
    const addresses = Object.values(os.networkInterfaces()).flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal)
      .map((a) => `http://${a.address}:${server.address()?.port}`);
    res.json({ name: store.state.tournament.name, addresses, version: store.state.version });
  });

  app.get('/api/rings', (req, res) => {
    res.json(Object.values(store.state.rings).sort((a, b) => a.number - b.number).map(({ id, number, name }) => ({ id, number, name })));
  });

  app.post('/api/login', (req, res) => {
    const { role, pin, ringId, device } = req.body || {};
    if (!['admin', 'ring', 'display'].includes(role)) return res.status(400).json({ error: 'Unknown role' });
    if (!store.checkPin(role, pin, ringId)) return res.status(401).json({ error: 'Wrong PIN' });
    const actor = { role, ringId: role === 'ring' ? ringId : null, device: String(device || '').slice(0, 60) };
    const token = store.createSession(actor);
    store.audit({ at: new Date().toISOString(), actor, type: 'auth.login', summary: `Signed in as ${role}${ringId ? ` (${ringId})` : ''}` });
    res.json({ token, actor });
  });

  app.post('/api/logout', (req, res) => {
    store.endSession(tokenFrom(req));
    res.json({ ok: true });
  });

  app.get('/api/session', (req, res) => {
    const s = store.session(tokenFrom(req));
    if (!s) return res.status(401).json({ error: 'Not signed in' });
    res.json({ actor: s });
  });

  app.get('/api/pins', requireRole('admin'), (req, res) => res.json(store.pinsForAdmin()));
  app.post('/api/pins', requireRole('admin'), (req, res) => {
    store.setPins(req.body || {});
    store.audit({ at: new Date().toISOString(), actor: req.actor, type: 'auth.pins', summary: 'Changed PINs' });
    res.json(store.pinsForAdmin());
  });

  app.get('/api/audit', requireRole('admin'), (req, res) => res.json(store.readAudit(Number(req.query.limit) || 500)));

  // Image uploads (logo, slide backgrounds). Body is the raw file.
  app.post('/api/upload', requireRole('admin', 'display'), express.raw({ type: 'image/*', limit: '15mb' }), (req, res) => {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[req.get('content-type')];
    if (!ext || !req.body?.length) return res.status(400).json({ error: 'Upload a PNG, JPG, GIF, WEBP or SVG image' });
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(store.uploadDir, name), req.body);
    res.json({ url: `/uploads/${name}` });
  });

  app.get('/api/export/:file', requireRole('admin'), (req, res) => {
    const out = buildExports(store.state, req.params.file);
    if (!out) return res.status(404).json({ error: 'Unknown export' });
    res.set('content-type', out.type);
    res.set('content-disposition', `attachment; filename="${out.filename}"`);
    res.send(out.body);
  });

  app.post('/api/restore', requireRole('admin'), (req, res) => {
    const incoming = req.body?.state;
    if (!incoming || typeof incoming !== 'object' || !incoming.competitors || !incoming.divisions) {
      return res.status(400).json({ error: 'That file is not a tournament backup' });
    }
    store.saveNow();
    store.replaceState(incoming);
    store.audit({ at: new Date().toISOString(), actor: req.actor, type: 'admin.restore', summary: 'Restored from backup' });
    io.emit('snapshot', { state: store.state });
    res.json({ ok: true });
  });

  // ----- live sync -----
  const presence = new Map();
  const broadcastPresence = () => io.emit('presence', [...presence.values()]);

  io.on('connection', (socket) => {
    const actor = store.session(socket.handshake.auth?.token) || { role: 'viewer' };
    const view = socket.handshake.auth?.view || actor.role;
    presence.set(socket.id, { id: socket.id, role: actor.role, ringId: actor.ringId || null, view, device: actor.device || '', since: new Date().toISOString() });
    broadcastPresence();
    socket.emit('hello', { actor });
    socket.emit('snapshot', { state: store.state });

    socket.on('resync', () => socket.emit('snapshot', { state: store.state }));

    socket.on('command', (cmd, ack = () => {}) => {
      if (actor.role === 'viewer') return ack({ ok: false, error: 'Read-only connection — sign in first' });
      try {
        const result = store.apply(cmd, actor);
        if (!result.duplicate) {
          if (cmd.type === 'ring.create') store.ensureRingPin(cmd.payload.ring.id);
          io.emit('applied', { cmd, version: result.version, actor: { role: actor.role, ringId: actor.ringId || null } });
        }
        ack({ ok: true, duplicate: result.duplicate });
      } catch (err) {
        if (!(err instanceof CommandError)) console.error(err);
        ack({ ok: false, error: err.message });
      }
    });

    socket.on('disconnect', () => {
      presence.delete(socket.id);
      broadcastPresence();
    });
  });

  const shutdown = () => store.saveNow();
  return { app, server, io, store, shutdown };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { server, store, shutdown } = createServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => {
    const addrs = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
    console.log(`\n  ${store.state.tournament.name} — tournament server running\n`);
    console.log(`  On this machine:   http://localhost:${port}`);
    for (const a of addrs) console.log(`  Other devices:     http://${a}:${port}`);
    console.log(`\n  Master list stored in: ${store.dataDir}`);
    if (store.secrets.adminPin === '1234') console.log('  ⚠  Default admin/display PIN is 1234 — change it in Front Desk → Settings.\n');
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { shutdown(); process.exit(0); });
}
