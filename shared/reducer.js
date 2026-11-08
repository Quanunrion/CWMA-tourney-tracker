// The single source of truth for how the master list changes.
//
// Every change in the system is a *command* ({ id, type, payload, at }). The server
// runs applyCommand() to update the master list and then broadcasts the command;
// every client runs the very same function to stay in sync (and to apply its own
// changes instantly while offline). Commands must therefore be deterministic:
// any random choices (ids, bracket seeding) are made by the sender and carried
// in the payload.

import { newCompetitor, newDivision, DEFAULT_THEMES, competitorName, ringLabel } from './model.js';
import { matchIds, bracketCompetitors } from './bracket.js';

export class CommandError extends Error {}

const fail = (msg) => { throw new CommandError(msg); };

const DISPLAY_COMMANDS = /^(queue|display|theme|customSlide|idle)\./;
const RING_COMMANDS = new Set([
  'competitor.create', 'competitor.checkIn',
  'division.start', 'division.markAbsent', 'division.addCompetitors', 'division.submit', 'division.reopen',
  'bracket.generate', 'bracket.reset', 'bracket.setWinner', 'bracket.setScore', 'bracket.withdraw',
  'kata.setScores', 'missing.request', 'ring.setCurrent',
]);

function getDivision(state, id) {
  return state.divisions[id] || fail('Division not found');
}

function getRing(state, id) {
  return state.rings[id] || fail('Ring not found');
}

function getCompetitor(state, id) {
  return state.competitors[id] || fail('Competitor not found');
}

// Throws if the actor may not run this command.
export function authorize(state, cmd, actor) {
  if (!actor || !actor.role) fail('Not signed in');
  if (actor.role === 'admin') return;
  if (actor.role === 'display') {
    if (DISPLAY_COMMANDS.test(cmd.type)) return;
    fail('The display can only manage slides');
  }
  if (actor.role === 'ring') {
    if (!RING_COMMANDS.has(cmd.type)) fail('Rings cannot do that — ask the front desk');
    const p = cmd.payload || {};
    if (cmd.type === 'ring.setCurrent' && p.ringId !== actor.ringId) fail('Not your ring');
    if (cmd.type === 'competitor.checkIn') {
      const inMyRing = Object.values(state.divisions).some((d) => d.ringId === actor.ringId && d.competitorIds.includes(p.id));
      if (!inMyRing) fail('That competitor is not in one of your divisions');
      return;
    }
    if (p.divisionId) {
      const d = getDivision(state, p.divisionId);
      if (d.ringId !== actor.ringId) fail('That division belongs to another ring');
    }
    return;
  }
  fail('Read-only connection');
}

function removeFromSchedules(state, divisionId) {
  for (const ring of Object.values(state.rings)) {
    ring.schedule = ring.schedule.filter((id) => id !== divisionId);
    if (ring.currentDivisionId === divisionId) ring.currentDivisionId = null;
  }
}

function placeInRing(state, division, ringId, position) {
  removeFromSchedules(state, division.id);
  division.ringId = ringId || null;
  if (!ringId) return;
  const ring = getRing(state, ringId);
  const pos = position == null || position < 0 || position > ring.schedule.length ? ring.schedule.length : position;
  ring.schedule.splice(pos, 0, division.id);
}

function dequeue(state, itemId) {
  state.queueOrder = state.queueOrder.filter((id) => id !== itemId);
}

function recallDivisionItems(state, divisionId) {
  for (const item of Object.values(state.queue)) {
    if (item.divisionId === divisionId && (item.type === 'award' || item.type === 'grand') && (item.status === 'queued' || item.status === 'pending_approval')) {
      item.status = 'recalled';
      dequeue(state, item.id);
    }
  }
}

function bracketHasResults(division) {
  const b = division.bracket;
  if (!b) return false;
  return Object.keys(b.winners || {}).length > 0 || Object.keys(b.scores || {}).length > 0;
}

function assertEditable(division) {
  if (division.status === 'completed') fail('Results were already submitted — reopen the division first');
}

function sanitizePatch(patch, blocked = []) {
  const out = { ...(patch || {}) };
  for (const k of ['id', ...blocked]) delete out[k];
  return out;
}

function addQueueItem(state, item, at, position = 'end') {
  if (!item?.id) fail('Queue item needs an id');
  if (state.queue[item.id]) return state.queue[item.id];
  const full = { status: 'queued', createdAt: at, ...item };
  state.queue[full.id] = full;
  if (full.status === 'queued') {
    if (position === 'front') state.queueOrder.unshift(full.id);
    else state.queueOrder.push(full.id);
  }
  return full;
}

const handlers = {
  // ----- tournament & settings -----
  'tournament.update'(state, p) {
    Object.assign(state.tournament, sanitizePatch(p.patch));
  },
  'settings.update'(state, p) {
    Object.assign(state.settings, sanitizePatch(p.patch));
  },

  // ----- rings -----
  'ring.create'(state, p) {
    const r = p.ring || fail('Missing ring');
    if (!r.id) fail('Ring needs an id');
    if (state.rings[r.id]) return;
    state.rings[r.id] = { id: r.id, number: Number(r.number) || Object.keys(state.rings).length + 1, name: r.name || '', schedule: [], currentDivisionId: null };
  },
  'ring.update'(state, p) {
    Object.assign(getRing(state, p.id), sanitizePatch(p.patch, ['schedule']));
  },
  'ring.delete'(state, p) {
    getRing(state, p.id);
    for (const d of Object.values(state.divisions)) if (d.ringId === p.id) d.ringId = null;
    delete state.rings[p.id];
  },
  'ring.setSchedule'(state, p) {
    const ring = getRing(state, p.id);
    const ids = (p.divisionIds || []).filter((id) => state.divisions[id]);
    for (const id of ids) {
      const d = state.divisions[id];
      if (d.ringId && d.ringId !== ring.id) {
        state.rings[d.ringId].schedule = state.rings[d.ringId].schedule.filter((x) => x !== id);
      }
      d.ringId = ring.id;
    }
    for (const id of ring.schedule) if (!ids.includes(id) && state.divisions[id]) state.divisions[id].ringId = null;
    ring.schedule = ids;
  },
  'ring.setCurrent'(state, p) {
    const ring = getRing(state, p.ringId);
    ring.currentDivisionId = p.divisionId || null;
  },

  // ----- competitors -----
  'competitor.create'(state, p, actor, at) {
    const c = p.competitor || fail('Missing competitor');
    if (!c.id) fail('Competitor needs an id');
    if (state.competitors[c.id]) return;
    if (!c.firstName && !c.lastName) fail('Competitor needs a name');
    const fromRing = actor?.role === 'ring';
    const ring = fromRing ? state.rings[actor.ringId] : null;
    state.competitors[c.id] = newCompetitor({
      ...c,
      age: c.age === '' || c.age == null ? null : Number(c.age),
      createdAt: at,
      source: fromRing ? 'ring' : (c.source || 'frontdesk'),
      flagged: fromRing ? true : !!c.flagged,
      flagReason: fromRing ? `Written in at ${ringLabel(ring)}` : (c.flagReason || ''),
      addedByRingId: fromRing ? actor.ringId : null,
      checkedIn: fromRing ? true : !!c.checkedIn,
      checkedInAt: fromRing || c.checkedIn ? at : null,
    });
    if (p.divisionId) {
      const d = getDivision(state, p.divisionId);
      if (!d.competitorIds.includes(c.id)) d.competitorIds.push(c.id);
    }
  },
  'competitor.import'(state, p, actor, at) {
    for (const c of p.competitors || []) {
      if (!c.id || state.competitors[c.id]) continue;
      state.competitors[c.id] = newCompetitor({ ...c, source: 'import', createdAt: at });
    }
  },
  'competitor.update'(state, p) {
    const c = getCompetitor(state, p.id);
    const patch = sanitizePatch(p.patch, ['createdAt', 'source']);
    if ('age' in patch) patch.age = patch.age === '' || patch.age == null ? null : Number(patch.age);
    if (patch.extra) patch.extra = { ...c.extra, ...patch.extra };
    Object.assign(c, patch);
  },
  'competitor.delete'(state, p) {
    getCompetitor(state, p.id);
    for (const d of Object.values(state.divisions)) {
      if (bracketCompetitors(d.bracket).includes(p.id)) {
        fail(`Competitor is in a running bracket (${d.name || d.code}). Withdraw them there instead.`);
      }
    }
    for (const d of Object.values(state.divisions)) {
      d.competitorIds = d.competitorIds.filter((id) => id !== p.id);
      d.absentIds = (d.absentIds || []).filter((id) => id !== p.id);
    }
    delete state.competitors[p.id];
  },
  'competitor.checkIn'(state, p, actor, at) {
    const c = getCompetitor(state, p.id);
    c.checkedIn = p.checkedIn !== false;
    c.checkedInAt = c.checkedIn ? at : null;
  },
  'competitor.clearFlag'(state, p) {
    const c = getCompetitor(state, p.id);
    c.flagged = false;
  },

  // ----- divisions -----
  'division.create'(state, p, actor, at) {
    const d = p.division || fail('Missing division');
    if (!d.id) fail('Division needs an id');
    if (state.divisions[d.id]) return;
    const div = newDivision({ ...d, ringId: null, createdAt: at, competitorIds: [...(d.competitorIds || [])].filter((id) => state.competitors[id]) });
    state.divisions[div.id] = div;
    if (d.ringId) placeInRing(state, div, d.ringId, p.position);
  },
  'division.update'(state, p) {
    const d = getDivision(state, p.id);
    const patch = sanitizePatch(p.patch, ['ringId', 'bracket', 'results', 'competitorIds', 'status']);
    if (patch.format && patch.format !== d.format && d.bracket) fail('Reset the bracket before changing the format');
    if (patch.options) patch.options = { ...d.options, ...patch.options };
    if (patch.criteria) patch.criteria = { ...d.criteria, ...patch.criteria };
    Object.assign(d, patch);
  },
  'division.delete'(state, p) {
    getDivision(state, p.id);
    removeFromSchedules(state, p.id);
    recallDivisionItems(state, p.id);
    delete state.divisions[p.id];
  },
  'division.assignRing'(state, p) {
    const d = getDivision(state, p.id);
    placeInRing(state, d, p.ringId, p.position);
  },
  'division.addCompetitors'(state, p) {
    const d = getDivision(state, p.divisionId || p.id);
    assertEditable(d);
    for (const id of p.competitorIds || []) {
      getCompetitor(state, id);
      if (!d.competitorIds.includes(id)) d.competitorIds.push(id);
    }
  },
  'division.removeCompetitor'(state, p) {
    const d = getDivision(state, p.divisionId || p.id);
    if (bracketCompetitors(d.bracket).includes(p.competitorId)) fail('Competitor is in the bracket — withdraw them or reset the bracket first');
    d.competitorIds = d.competitorIds.filter((id) => id !== p.competitorId);
    d.absentIds = (d.absentIds || []).filter((id) => id !== p.competitorId);
  },
  'division.markAbsent'(state, p) {
    const d = getDivision(state, p.divisionId);
    assertEditable(d);
    const set = new Set(d.absentIds || []);
    if (p.absent) set.add(p.competitorId);
    else set.delete(p.competitorId);
    d.absentIds = [...set];
  },
  'division.start'(state, p) {
    const d = getDivision(state, p.divisionId);
    if (d.status === 'pending') d.status = 'in_progress';
    if (d.ringId) state.rings[d.ringId].currentDivisionId = d.id;
  },
  'division.merge'(state, p) {
    const target = getDivision(state, p.targetId);
    const source = getDivision(state, p.sourceId);
    if (target.id === source.id) fail('Pick two different divisions');
    if (bracketHasResults(target) || bracketHasResults(source) || target.status === 'completed' || source.status === 'completed') {
      fail('Cannot merge divisions that already have results');
    }
    for (const id of source.competitorIds) if (!target.competitorIds.includes(id)) target.competitorIds.push(id);
    target.bracket = null;
    removeFromSchedules(state, source.id);
    delete state.divisions[source.id];
  },
  'division.split'(state, p, actor, at) {
    const d = getDivision(state, p.id);
    if (bracketHasResults(d) || d.status === 'completed') fail('Cannot split a division that already has results');
    const moving = (p.competitorIds || []).filter((id) => d.competitorIds.includes(id));
    if (!moving.length) fail('Pick at least one competitor to move');
    const nd = p.newDivision || fail('Missing new division');
    d.competitorIds = d.competitorIds.filter((id) => !moving.includes(id));
    d.bracket = null;
    const created = newDivision({ ...d, ...nd, id: nd.id, competitorIds: moving, absentIds: [], status: 'pending', bracket: null, results: null, ringId: null, createdAt: at });
    state.divisions[created.id] = created;
    const ringId = nd.ringId !== undefined ? nd.ringId : d.ringId;
    if (ringId) {
      const pos = d.ringId === ringId ? state.rings[ringId].schedule.indexOf(d.id) + 1 : undefined;
      placeInRing(state, created, ringId, pos);
    }
  },
  'division.submit'(state, p, actor, at) {
    const d = getDivision(state, p.divisionId);
    const r = p.results || fail('Missing results');
    if (!r.first) fail('Pick a 1st place');
    const places = [r.first, r.second, r.third].filter(Boolean);
    if (new Set(places).size !== places.length) fail('The same competitor is in two places');
    for (const id of places) if (!d.competitorIds.includes(id)) fail('Placed competitor is not in this division');
    d.results = { first: r.first || null, second: r.second || null, third: r.third || null };
    d.status = 'completed';
    d.submittedAt = at;
    recallDivisionItems(state, d.id);
    if (state.settings.autoQueueAwards && p.queueItemId) {
      addQueueItem(state, { id: p.queueItemId, type: d.grand ? 'grand' : 'award', divisionId: d.id, ringId: d.ringId, status: 'queued' }, at);
    }
    const ring = d.ringId && state.rings[d.ringId];
    if (ring && ring.currentDivisionId === d.id) ring.currentDivisionId = null;
  },
  'division.reopen'(state, p) {
    const d = getDivision(state, p.divisionId);
    if (d.status !== 'completed') return;
    d.status = 'in_progress';
    d.previousResults = d.results;
    d.results = null;
    d.submittedAt = null;
    recallDivisionItems(state, d.id);
    if (d.ringId) state.rings[d.ringId].currentDivisionId = d.id;
  },
  'division.setResults'(state, p, actor, at) {
    // Admin correction of final placements (division stays completed; slides update automatically).
    const d = getDivision(state, p.divisionId);
    const r = p.results || {};
    for (const id of [r.first, r.second, r.third].filter(Boolean)) if (!d.competitorIds.includes(id)) fail('Placed competitor is not in this division');
    d.results = { first: r.first || null, second: r.second || null, third: r.third || null };
    if (d.status !== 'completed') { d.status = 'completed'; d.submittedAt = at; }
  },

  // ----- brackets -----
  'bracket.generate'(state, p, actor, at) {
    const d = getDivision(state, p.divisionId);
    assertEditable(d);
    if (bracketHasResults(d) && !p.force) fail('This bracket already has results. Reset it first.');
    const b = p.bracket || fail('Missing bracket');
    for (const id of bracketCompetitors(b)) if (!d.competitorIds.includes(id)) fail('Bracket contains someone not in this division');
    d.bracket = { ...b, generatedAt: at };
    if (d.status === 'pending') d.status = 'in_progress';
    if (d.ringId) state.rings[d.ringId].currentDivisionId = d.id;
  },
  'bracket.reset'(state, p) {
    const d = getDivision(state, p.divisionId);
    assertEditable(d);
    d.bracket = null;
  },
  'bracket.setWinner'(state, p) {
    const d = getDivision(state, p.divisionId);
    assertEditable(d);
    if (!d.bracket) fail('No bracket yet');
    if (!matchIds(d.bracket).includes(p.matchId)) fail('Unknown match');
    if (p.winnerId) d.bracket.winners[p.matchId] = p.winnerId;
    else delete d.bracket.winners[p.matchId];
  },
  'bracket.setScore'(state, p) {
    // Backend for point scoring: { a, b, penaltiesA, penaltiesB } per match.
    const d = getDivision(state, p.divisionId);
    assertEditable(d);
    if (!d.bracket) fail('No bracket yet');
    if (!matchIds(d.bracket).includes(p.matchId)) fail('Unknown match');
    if (p.score) d.bracket.scores[p.matchId] = { ...p.score };
    else delete d.bracket.scores[p.matchId];
  },
  'bracket.withdraw'(state, p) {
    const d = getDivision(state, p.divisionId);
    assertEditable(d);
    if (!d.bracket) fail('No bracket yet');
    const set = new Set(d.bracket.withdrawn || []);
    if (p.withdrawn === false) set.delete(p.competitorId);
    else set.add(p.competitorId);
    d.bracket.withdrawn = [...set];
  },
  'kata.setScores'(state, p) {
    const d = getDivision(state, p.divisionId);
    assertEditable(d);
    if (!d.bracket || d.bracket.type !== 'kata_scores') fail('Not a scored division');
    if (!d.bracket.competitorIds.includes(p.competitorId)) fail('Competitor not in this division');
    if (p.scores && p.scores.some((s) => s !== '' && s != null)) d.bracket.scores[p.competitorId] = p.scores.map((s) => (s === '' || s == null ? '' : Number(s)));
    else delete d.bracket.scores[p.competitorId];
  },

  // ----- missing competitor requests (ring -> display approval) -----
  'missing.request'(state, p, actor, at) {
    const d = getDivision(state, p.divisionId);
    getCompetitor(state, p.competitorId);
    const dup = Object.values(state.queue).find((q) => q.type === 'missing' && q.competitorId === p.competitorId && q.ringId === d.ringId && ['pending_approval', 'queued', 'live'].includes(q.status));
    if (dup) return;
    addQueueItem(state, { id: p.itemId, type: 'missing', competitorId: p.competitorId, divisionId: d.id, ringId: d.ringId, status: 'pending_approval', requestedBy: actor?.role === 'ring' ? actor.ringId : null }, at);
  },

  // ----- display queue -----
  'queue.add'(state, p, actor, at) {
    const item = p.item || fail('Missing item');
    if (!['logo', 'missing', 'award', 'grand', 'custom'].includes(item.type)) fail('Unknown slide type');
    addQueueItem(state, { ...item, status: 'queued' }, at, p.position);
  },
  'queue.approve'(state, p, actor, at) {
    const item = state.queue[p.id] || fail('Queue item not found');
    if (item.status !== 'pending_approval') return;
    item.status = 'queued';
    item.approvedAt = at;
    dequeue(state, item.id);
    if (p.position === 'front') state.queueOrder.unshift(item.id);
    else state.queueOrder.push(item.id);
  },
  'queue.reject'(state, p) {
    const item = state.queue[p.id] || fail('Queue item not found');
    item.status = 'rejected';
    dequeue(state, item.id);
  },
  'queue.move'(state, p) {
    if (!state.queueOrder.includes(p.id)) fail('Item is not in the queue');
    dequeue(state, p.id);
    const idx = Math.max(0, Math.min(state.queueOrder.length, Number(p.toIndex) || 0));
    state.queueOrder.splice(idx, 0, p.id);
  },
  'queue.remove'(state, p) {
    if (state.display.live === p.id) state.display.live = null;
    dequeue(state, p.id);
    delete state.queue[p.id];
  },
  'queue.requeue'(state, p) {
    const item = state.queue[p.id] || fail('Queue item not found');
    if (state.display.live === item.id) state.display.live = null;
    item.status = 'queued';
    dequeue(state, item.id);
    if (p.position === 'front') state.queueOrder.unshift(item.id);
    else state.queueOrder.push(item.id);
  },
  'queue.markDone'(state, p) {
    const item = state.queue[p.id] || fail('Queue item not found');
    item.status = 'done';
    dequeue(state, item.id);
    if (state.display.live === item.id) state.display.live = null;
  },
  'queue.clearHistory'(state) {
    for (const item of Object.values(state.queue)) {
      if (['done', 'rejected', 'recalled'].includes(item.status)) delete state.queue[item.id];
    }
  },
  'display.goLive'(state, p, actor, at) {
    const prev = state.display.live && state.queue[state.display.live];
    if (prev && prev.id !== p.itemId && prev.status === 'live') prev.status = 'done';
    if (p.itemId) {
      const item = state.queue[p.itemId] || fail('Queue item not found');
      item.status = 'live';
      item.shownAt = at;
      dequeue(state, item.id);
      state.display.live = item.id;
    } else {
      state.display.live = null; // tournament logo
    }
    state.display.liveSince = at;
  },

  // ----- slide look & feel -----
  'theme.update'(state, p) {
    if (!DEFAULT_THEMES[p.slideType]) fail('Unknown slide type');
    state.themes[p.slideType] = { ...state.themes[p.slideType], ...sanitizePatch(p.patch) };
  },
  'theme.reset'(state, p) {
    if (!DEFAULT_THEMES[p.slideType]) fail('Unknown slide type');
    state.themes[p.slideType] = structuredClone(DEFAULT_THEMES[p.slideType]);
  },
  'customSlide.create'(state, p, actor, at) {
    const s = p.slide || fail('Missing slide');
    if (!s.id) fail('Slide needs an id');
    state.customSlides[s.id] = { title: '', body: '', imageUrl: '', theme: {}, createdAt: at, ...s };
  },
  'customSlide.update'(state, p) {
    const s = state.customSlides[p.id] || fail('Slide not found');
    Object.assign(s, sanitizePatch(p.patch));
  },
  'customSlide.delete'(state, p) {
    delete state.customSlides[p.id];
    state.idle.slideIds = state.idle.slideIds.filter((id) => id !== p.id);
  },
  'idle.update'(state, p) {
    Object.assign(state.idle, sanitizePatch(p.patch));
  },
};

export const COMMAND_TYPES = Object.keys(handlers);

export function applyCommand(state, cmd, actor) {
  const handler = handlers[cmd.type] || fail(`Unknown command: ${cmd.type}`);
  handler(state, cmd.payload || {}, actor, cmd.at || new Date().toISOString());
  return state;
}

// Human readable one-liner for the audit log.
export function describeCommand(state, cmd) {
  const p = cmd.payload || {};
  const c = (id) => competitorName(state.competitors[id]);
  const d = (id) => state.divisions[id]?.name || state.divisions[id]?.code || id;
  switch (cmd.type) {
    case 'competitor.create': return `Added competitor ${competitorName(p.competitor)}`;
    case 'competitor.import': return `Imported ${(p.competitors || []).length} competitors`;
    case 'competitor.checkIn': return `${p.checkedIn === false ? 'Un-checked' : 'Checked in'} ${c(p.id)}`;
    case 'competitor.update': return `Edited ${c(p.id)}`;
    case 'competitor.delete': return `Deleted competitor ${p.id}`;
    case 'division.submit': return `Submitted results for ${d(p.divisionId)}`;
    case 'division.reopen': return `Reopened ${d(p.divisionId)}`;
    case 'division.setResults': return `Corrected results for ${d(p.divisionId)}`;
    case 'bracket.setWinner': return `${d(p.divisionId)}: ${p.matchId} winner ${p.winnerId ? c(p.winnerId) : '(cleared)'}`;
    case 'bracket.withdraw': return `${d(p.divisionId)}: ${p.withdrawn === false ? 'reinstated' : 'withdrew'} ${c(p.competitorId)}`;
    case 'missing.request': return `Missing competitor request: ${c(p.competitorId)}`;
    default: return cmd.type;
  }
}
