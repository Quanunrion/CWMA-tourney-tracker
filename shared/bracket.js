// Bracket generation and scoring for every division format.
//
// Brackets store only *primary* data (seeding, picked winners, scores, withdrawals).
// Everything else (who advances, byes, forfeits, standings, suggested places) is
// derived by computeBracket(), so editing an earlier result automatically fixes
// everything downstream.

function shuffle(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextPow2(n) {
  let s = 2;
  while (s < n) s *= 2;
  return s;
}

function dojoKey(competitorsById, id) {
  const d = (competitorsById[id]?.dojo || '').trim().toLowerCase();
  return d || `__solo_${id}`; // no dojo listed: treat as unique
}

// Split competitors into two halves, keeping members of the same dojo apart
// as evenly as possible (best effort).
function splitByDojo(list, competitorsById, rand) {
  const groups = new Map();
  for (const id of list) {
    const k = dojoKey(competitorsById, id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(id);
  }
  const ordered = shuffle([...groups.values()], rand).sort((a, b) => b.length - a.length);
  const capL = Math.ceil(list.length / 2);
  const capR = list.length - capL;
  const left = [];
  const right = [];
  for (const group of ordered) {
    let inL = 0;
    let inR = 0;
    for (const id of shuffle(group, rand)) {
      let goLeft;
      if (left.length >= capL) goLeft = false;
      else if (right.length >= capR) goLeft = true;
      else if (inL !== inR) goLeft = inL < inR;
      else if (capL - left.length !== capR - right.length) goLeft = capL - left.length > capR - right.length;
      else goLeft = rand() < 0.5;
      if (goLeft) {
        left.push(id);
        inL++;
      } else {
        right.push(id);
        inR++;
      }
    }
  }
  return rand() < 0.5 ? [left, right] : [right, left];
}

function buildSlots(list, size, competitorsById, rand) {
  if (size === 1) return [list[0] ?? null];
  if (size === 2) {
    const s = shuffle(list, rand);
    return [s[0] ?? null, s[1] ?? null].sort((a, b) => (a === null) - (b === null));
  }
  const [l, r] = splitByDojo(list, competitorsById, rand);
  return [...buildSlots(l, size / 2, competitorsById, rand), ...buildSlots(r, size / 2, competitorsById, rand)];
}

// Performance / seeding order that spreads out same-dojo competitors.
export function spreadOrder(list, competitorsById, rand = Math.random) {
  if (list.length <= 1) return [...list];
  const size = nextPow2(list.length);
  return buildSlots(list, size, competitorsById, rand).filter(Boolean);
}

// Round robin pairings via the circle method so nobody fights back-to-back too often.
function roundRobinPairs(ids) {
  const list = [...ids];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const pairs = [];
  for (let round = 0; round < n - 1; round++) {
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a && b) pairs.push({ id: `rr${pairs.length + 1}`, round: round + 1, a, b });
    }
    list.splice(1, 0, list.pop());
  }
  return pairs;
}

export function activeCompetitors(division) {
  const absent = new Set(division.absentIds || []);
  return division.competitorIds.filter((id) => !absent.has(id));
}

export function generateBracket(division, competitorsById, rand = Math.random) {
  const ids = activeCompetitors(division);
  const base = { type: division.format, winners: {}, scores: {}, withdrawn: [], generatedAt: null };
  switch (division.format) {
    case 'single_elim': {
      const size = nextPow2(Math.max(ids.length, 2));
      return {
        ...base,
        size,
        rounds: Math.log2(size),
        slots: buildSlots(ids, size, competitorsById, rand),
        thirdPlace: division.options?.thirdPlace || 'match',
      };
    }
    case 'round_robin': {
      const order = spreadOrder(ids, competitorsById, rand);
      return { ...base, competitorIds: order, pairs: roundRobinPairs(order) };
    }
    case 'kata_scores':
      return {
        ...base,
        competitorIds: spreadOrder(ids, competitorsById, rand),
        judges: Number(division.options?.judges) || 3,
      };
    case 'placement':
    default:
      return { ...base, type: 'placement', competitorIds: [...ids] };
  }
}

// ---------- computation ----------

const isId = (v) => typeof v === 'string' && v.length > 0;

function resolveMatch(m, bracket) {
  const { a, b } = m;
  const withdrawn = bracket.withdrawn || [];
  if (a === undefined || b === undefined) {
    m.state = 'waiting';
    m.winner = undefined;
  } else if (!isId(a) && !isId(b)) {
    m.state = 'empty';
    m.winner = null;
  } else if (isId(a) && !isId(b)) {
    m.state = 'bye';
    m.winner = a;
  } else if (isId(b) && !isId(a)) {
    m.state = 'bye';
    m.winner = b;
  } else {
    const wa = withdrawn.includes(a);
    const wb = withdrawn.includes(b);
    if (wa && wb) {
      m.state = 'empty';
      m.winner = null;
    } else if (wa || wb) {
      m.state = 'forfeit';
      m.winner = wa ? b : a;
    } else {
      const picked = bracket.winners?.[m.id];
      if (picked === a || picked === b) {
        m.state = 'done';
        m.winner = picked;
      } else {
        m.state = 'ready';
        m.winner = undefined;
      }
    }
  }
  if (m.state === 'done' || m.state === 'forfeit') m.loser = m.winner === a ? b : a;
  else if (m.state === 'bye' || m.state === 'empty') m.loser = null;
  else m.loser = undefined;
  m.score = bracket.scores?.[m.id] || null;
  return m;
}

function outcome(m) {
  return m.winner; // id, null (nobody), or undefined (not decided)
}

function computeSingleElim(bracket) {
  const rounds = [];
  let prev = null;
  for (let r = 1; r <= bracket.rounds; r++) {
    const count = bracket.size / 2 ** r;
    const ms = [];
    for (let i = 0; i < count; i++) {
      const m = { id: `r${r}m${i}`, round: r, index: i };
      if (r === 1) {
        m.a = bracket.slots[2 * i] ?? null;
        m.b = bracket.slots[2 * i + 1] ?? null;
      } else {
        m.a = outcome(prev[2 * i]);
        m.b = outcome(prev[2 * i + 1]);
      }
      ms.push(resolveMatch(m, bracket));
    }
    rounds.push(ms);
    prev = ms;
  }
  const final = rounds[rounds.length - 1][0];
  let third = null;
  if (bracket.rounds >= 2 && bracket.thirdPlace !== 'manual') {
    const semis = rounds[rounds.length - 2];
    third = resolveMatch({ id: 'third', round: bracket.rounds, index: 1, a: semis[0].loser, b: semis[1].loser, isThird: true }, bracket);
  }
  const decided = (m) => !m || m.winner !== undefined;
  const complete = decided(final) && decided(third);
  const suggested = {
    first: isId(final.winner) ? final.winner : null,
    second: isId(final.loser) ? final.loser : null,
    third: third && isId(third.winner) ? third.winner : null,
  };
  const matches = [...rounds.flat(), ...(third ? [third] : [])];
  return { kind: 'single_elim', rounds, third, final, matches, complete, suggested, ties: [] };
}

function computeRoundRobin(bracket) {
  const matches = bracket.pairs.map((p) => resolveMatch({ ...p }, bracket));
  const table = new Map(bracket.competitorIds.map((id) => [id, { id, wins: 0, losses: 0, pf: 0, pa: 0, played: 0 }]));
  for (const m of matches) {
    if (m.state !== 'done' && m.state !== 'forfeit') continue;
    const w = table.get(m.winner);
    const l = table.get(m.loser);
    if (w) { w.wins++; w.played++; }
    if (l) { l.losses++; l.played++; }
    if (m.score) {
      const sa = Number(m.score.a) || 0;
      const sb = Number(m.score.b) || 0;
      const ra = table.get(m.a);
      const rb = table.get(m.b);
      if (ra) { ra.pf += sa; ra.pa += sb; }
      if (rb) { rb.pf += sb; rb.pa += sa; }
    }
  }
  const headToHead = (x, y) => {
    const m = matches.find((mm) => (mm.a === x && mm.b === y) || (mm.a === y && mm.b === x));
    if (!m || !isId(m.winner)) return 0;
    return m.winner === x ? -1 : 1;
  };
  const withdrawn = new Set(bracket.withdrawn || []);
  const standings = [...table.values()].sort((x, y) =>
    (withdrawn.has(x.id) - withdrawn.has(y.id)) ||
    (y.wins - x.wins) ||
    headToHead(x.id, y.id) ||
    ((y.pf - y.pa) - (x.pf - x.pa)));
  const ties = [];
  for (let i = 1; i < standings.length; i++) {
    const a = standings[i - 1];
    const b = standings[i];
    if (a.wins === b.wins && headToHead(a.id, b.id) === 0 && (a.pf - a.pa) === (b.pf - b.pa) && i <= 3) ties.push([a.id, b.id]);
  }
  const complete = matches.every((m) => m.winner !== undefined);
  const ranked = standings.filter((s) => !withdrawn.has(s.id)).map((s) => s.id);
  return {
    kind: 'round_robin',
    matches,
    standings,
    complete,
    ties,
    suggested: { first: ranked[0] || null, second: ranked[1] || null, third: ranked[2] || null },
  };
}

export function kataTotal(scores, judges) {
  if (!Array.isArray(scores)) return null;
  const vals = scores.slice(0, judges).map((s) => (s === '' || s == null ? NaN : Number(s)));
  if (vals.length < judges || vals.some((v) => Number.isNaN(v))) return null;
  // No drops: straight total of every judge's score.
  return Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100;
}

function computeKata(bracket) {
  const withdrawn = new Set(bracket.withdrawn || []);
  const rows = bracket.competitorIds.map((id, i) => ({
    id,
    order: i + 1,
    scores: bracket.scores?.[id] || [],
    total: kataTotal(bracket.scores?.[id], bracket.judges),
    withdrawn: withdrawn.has(id),
  }));
  const ranked = rows.filter((r) => !r.withdrawn && r.total != null).sort((a, b) => b.total - a.total);
  const ties = [];
  for (let i = 1; i < Math.min(ranked.length, 4); i++) {
    if (ranked[i].total === ranked[i - 1].total) ties.push([ranked[i - 1].id, ranked[i].id]);
  }
  const anyScores = rows.some((r) => r.total != null);
  return {
    kind: 'kata_scores',
    rows,
    ranking: ranked.map((r) => r.id),
    complete: rows.every((r) => r.withdrawn || r.total != null),
    anyScores,
    ties,
    suggested: { first: ranked[0]?.id || null, second: ranked[1]?.id || null, third: ranked[2]?.id || null },
  };
}

export function computeBracket(division) {
  const b = division?.bracket;
  if (!b) return null;
  switch (b.type) {
    case 'single_elim': return computeSingleElim(b);
    case 'round_robin': return computeRoundRobin(b);
    case 'kata_scores': return computeKata(b);
    default:
      return { kind: 'placement', complete: true, ties: [], suggested: { first: null, second: null, third: null } };
  }
}

// Every competitor that is part of the generated bracket.
export function bracketCompetitors(bracket) {
  if (!bracket) return [];
  if (bracket.type === 'single_elim') return bracket.slots.filter(Boolean);
  return bracket.competitorIds || [];
}

export function matchIds(bracket) {
  if (!bracket) return [];
  if (bracket.type === 'single_elim') {
    const ids = [];
    for (let r = 1; r <= bracket.rounds; r++) {
      for (let i = 0; i < bracket.size / 2 ** r; i++) ids.push(`r${r}m${i}`);
    }
    if (bracket.rounds >= 2 && bracket.thirdPlace !== 'manual') ids.push('third');
    return ids;
  }
  if (bracket.type === 'round_robin') return bracket.pairs.map((p) => p.id);
  return [];
}

export function roundName(round, totalRounds) {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round ${round}`;
}
