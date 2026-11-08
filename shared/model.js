// Shared data model: constants, defaults, and helpers used by the server and every client.

export const BELTS = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'black', label: 'Black Belt' },
];

export const SEXES = [
  { id: 'M', label: 'Male' },
  { id: 'F', label: 'Female' },
];

export const EVENTS = [
  { id: 'kata', label: 'Kata' },
  { id: 'kumite', label: 'Kumite' },
  { id: 'weapons', label: 'Weapons' },
  { id: 'chambara', label: 'Chambara' },
  { id: 'other', label: 'Other' },
];

// Division formats. Admin picks one per division.
export const FORMATS = [
  { id: 'single_elim', label: 'Single elimination bracket' },
  { id: 'round_robin', label: 'Round robin' },
  { id: 'kata_scores', label: 'Judged / scored (kata)' },
  { id: 'placement', label: 'Manual placement only' },
];

export const GRAND_GROUPS = [
  { id: 'under18', label: 'Under 18' },
  { id: 'adult', label: '18 & over' },
];

export const DIVISION_STATUS = ['pending', 'in_progress', 'completed'];

// Display queue item lifecycle.
//   pending_approval -> queued -> live -> done
//   pending_approval -> rejected
//   queued -> recalled (ring reopened the division)
export const QUEUE_STATUS = ['pending_approval', 'queued', 'live', 'done', 'rejected', 'recalled'];

export const SLIDE_TYPES = [
  { id: 'logo', label: 'Tournament logo' },
  { id: 'missing', label: 'Missing competitor' },
  { id: 'award', label: 'Division awards' },
  { id: 'grand', label: 'Grand champion' },
  { id: 'custom', label: 'Custom / sponsor' },
];

export const FONTS = [
  'Inter, Arial, sans-serif',
  'Georgia, serif',
  '"Trebuchet MS", sans-serif',
  'Impact, "Arial Black", sans-serif',
  '"Courier New", monospace',
];

const baseTheme = {
  background: '#0b1d3a',
  backgroundImage: '',
  backgroundFit: 'cover',
  overlayOpacity: 0.35,
  textColor: '#ffffff',
  accentColor: '#f5c518',
  fontFamily: FONTS[0],
  titleSize: 6,     // vw units
  nameSize: 7,      // vw units
  bodySize: 3.5,    // vw units
  showLogo: true,
  logoPosition: 'top', // top | bottom | corner | hidden
  logoSize: 14,     // vh units
  align: 'center',
  transition: 'fade', // fade | slide | none
};

export const DEFAULT_THEMES = {
  logo: { ...baseTheme, logoSize: 55, logoPosition: 'center', title: '', subtitle: '' },
  missing: { ...baseTheme, background: '#5a0b0b', accentColor: '#ffd166', title: 'Competitor Needed', message: 'Please report to Ring {ring}' },
  award: { ...baseTheme, title: '{division}', firstLabel: '1st Place', secondLabel: '2nd Place', thirdLabel: '3rd Place', showThird: false },
  grand: { ...baseTheme, background: '#1a1033', accentColor: '#ffd700', title: 'Grand Champion', nameSize: 9 },
  custom: { ...baseTheme },
};

export function emptyState() {
  return {
    version: 0,
    tournament: { name: 'CWMA Tournament', date: '', logoUrl: '', location: '' },
    settings: {
      autoQueueAwards: true,   // submitted results go straight into the display queue
      awardPlacesShown: 2,     // 1st & 2nd on screen (3rd is still recorded)
      defaultKumiteFormat: 'single_elim',
      defaultThirdPlace: 'match',
      defaultJudges: 3,
    },
    rings: {},
    competitors: {},
    divisions: {},
    queue: {},          // display queue items by id
    queueOrder: [],     // ordering of queued items
    display: { live: null, liveSince: null },
    themes: structuredClone(DEFAULT_THEMES),
    customSlides: {},   // backend for sponsor / custom slides
    idle: { enabled: false, slideIds: [], intervalSec: 12 }, // backend for idle rotation
  };
}

export function competitorName(c) {
  if (!c) return 'Unknown';
  return `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unnamed';
}

export function beltLabel(id) {
  return BELTS.find((b) => b.id === id)?.label || id || '';
}

export function eventLabel(id) {
  return EVENTS.find((e) => e.id === id)?.label || id || '';
}

export function formatLabel(id) {
  return FORMATS.find((f) => f.id === id)?.label || id || '';
}

export function normalizeBelt(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return 'beginner';
  if (v.startsWith('beg')) return 'beginner';
  if (v.startsWith('int')) return 'intermediate';
  if (v.startsWith('adv')) return 'advanced';
  if (v.includes('black') || v === 'bb') return 'black';
  return BELTS.some((b) => b.id === v) ? v : 'beginner';
}

export function normalizeSex(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v.startsWith('m') || v === 'boy') return 'M';
  if (v.startsWith('f') || v.startsWith('w') || v === 'girl') return 'F';
  return '';
}

export function newCompetitor(fields = {}) {
  return {
    id: fields.id,
    firstName: '',
    lastName: '',
    age: null,
    sex: '',
    belt: 'beginner',
    dojo: '',
    notes: '',
    checkedIn: false,
    checkedInAt: null,
    source: 'frontdesk',     // import | frontdesk | ring
    flagged: false,
    flagReason: '',
    addedByRingId: null,
    // Placeholders for future features (payment, waiver, contact for text notifications).
    extra: { paymentStatus: null, waiverSigned: null, phone: null },
    createdAt: null,
    ...fields,
  };
}

export function newDivision(fields = {}) {
  return {
    id: fields.id,
    code: '',
    name: '',
    event: 'kata',
    grand: false,
    grandGroup: null,
    format: 'kata_scores',
    options: { thirdPlace: 'match', judges: 3 },
    criteria: { sex: 'any', ageMin: null, ageMax: null, belts: [] },
    competitorIds: [],
    absentIds: [],
    ringId: null,
    status: 'pending',
    bracket: null,
    results: null,
    submittedAt: null,
    createdAt: null,
    ...fields,
  };
}

export function divisionLabel(d) {
  if (!d) return '';
  return [d.code, d.name].filter(Boolean).join(' · ') || 'Untitled division';
}

// Does a competitor match a division's criteria? Used to suggest assignments.
export function matchesCriteria(c, criteria = {}) {
  if (criteria.sex && criteria.sex !== 'any' && c.sex !== criteria.sex) return false;
  if (criteria.ageMin != null && criteria.ageMin !== '' && (c.age == null || c.age < Number(criteria.ageMin))) return false;
  if (criteria.ageMax != null && criteria.ageMax !== '' && (c.age == null || c.age > Number(criteria.ageMax))) return false;
  if (criteria.belts && criteria.belts.length && !criteria.belts.includes(c.belt)) return false;
  return true;
}

// Ordered list of divisions for a ring (schedule order, then any stragglers).
export function ringDivisions(state, ringId) {
  const ring = state.rings[ringId];
  if (!ring) return [];
  const listed = (ring.schedule || []).map((id) => state.divisions[id]).filter(Boolean);
  const extras = Object.values(state.divisions).filter((d) => d.ringId === ringId && !ring.schedule.includes(d.id));
  return [...listed, ...extras];
}

// Where a competitor needs to be: each division they're in, with ring info.
export function competitorAssignments(state, competitorId) {
  return Object.values(state.divisions)
    .filter((d) => d.competitorIds.includes(competitorId))
    .map((d) => {
      const ring = d.ringId ? state.rings[d.ringId] : null;
      const order = ring ? ring.schedule.indexOf(d.id) : -1;
      return { division: d, ring, order };
    });
}

export function ringLabel(ring) {
  if (!ring) return 'Unassigned';
  return ring.name || `Ring ${ring.number}`;
}

export function sortedRings(state) {
  return Object.values(state.rings).sort((a, b) => (a.number || 0) - (b.number || 0));
}
