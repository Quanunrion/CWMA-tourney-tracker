// Renders a slide for the display output and every preview. Sizes use container
// units (cqw/cqh) so a thumbnail looks exactly like the projector, just smaller.

import { html } from './core.js';
import { competitorName, ringLabel, divisionLabel } from '/shared/model.js';

export function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
}

// Turns a queue item into plain slide data (type + text), so the renderer stays dumb.
export function slideData(state, item) {
  const t = state.tournament;
  if (!item || item.type === 'logo') return { type: 'logo', vars: { tournament: t.name } };
  const division = item.divisionId ? state.divisions[item.divisionId] : null;
  const ring = item.ringId ? state.rings[item.ringId] : division?.ringId ? state.rings[division.ringId] : null;
  const vars = {
    tournament: t.name,
    division: division?.name || divisionLabel(division) || '',
    code: division?.code || '',
    ring: ring ? (ring.name || ring.number) : '?',
    ringName: ringLabel(ring),
  };
  if (item.type === 'missing') {
    const c = state.competitors[item.competitorId];
    return { type: 'missing', vars: { ...vars, name: item.name || competitorName(c) } };
  }
  if (item.type === 'award' || item.type === 'grand') {
    const r = division?.results || {};
    const name = (id) => (id && state.competitors[id] ? competitorName(state.competitors[id]) : '');
    return { type: item.type, vars, places: { first: name(r.first), second: name(r.second), third: name(r.third) }, missingResults: !division?.results };
  }
  if (item.type === 'custom') {
    const s = state.customSlides[item.customSlideId] || {};
    return { type: 'custom', vars: { ...vars, title: s.title || item.title || '', body: s.body || item.body || '' }, imageUrl: s.imageUrl || '', theme: s.theme };
  }
  return { type: 'logo', vars };
}

export function itemLabel(state, item) {
  if (!item) return 'Tournament logo';
  const d = slideData(state, item);
  if (item.type === 'missing') return `Missing: ${d.vars.name} → Ring ${d.vars.ring}`;
  if (item.type === 'award') return `Awards: ${d.vars.division}`;
  if (item.type === 'grand') return `Grand Champion: ${d.vars.division}`;
  if (item.type === 'custom') return `Slide: ${d.vars.title || 'Custom'}`;
  return 'Tournament logo';
}

function Logo({ url, theme, position }) {
  if (!url || !theme.showLogo || position === 'hidden') return null;
  return html`<img class=${`slide-logo ${position === 'corner' ? 'corner' : ''}`} src=${url} alt="" style=${{ height: `${theme.logoSize}cqh` }} />`;
}

export function Slide({ state, item, themeOverride, slideType, animate = true, sample }) {
  const data = sample || slideData(state, item);
  const type = slideType || data.type;
  const theme = { ...state.themes[type], ...(data.theme || {}), ...(themeOverride || {}) };
  const logoUrl = state.tournament.logoUrl;
  const pos = theme.logoPosition;
  const v = data.vars;
  const accent = theme.accentColor;
  const sz = (n) => `${n}cqw`;

  let body;
  if (type === 'logo') {
    const title = fill(theme.title, v);
    body = html`
      ${logoUrl && theme.showLogo ? html`<img class="slide-logo" src=${logoUrl} alt="" style=${{ height: `${theme.logoSize}cqh` }} />`
        : html`<h1 class="slide-title" style=${{ fontSize: sz(theme.titleSize) }}>${v.tournament}</h1>`}
      ${title && html`<h1 class="slide-title" style=${{ fontSize: sz(theme.titleSize) }}>${title}</h1>`}
      ${theme.subtitle && html`<div style=${{ fontSize: sz(theme.bodySize), color: accent }}>${fill(theme.subtitle, v)}</div>`}`;
  } else if (type === 'missing') {
    body = html`
      <h1 class="slide-title" style=${{ fontSize: sz(theme.titleSize), color: accent }}>${fill(theme.title, v)}</h1>
      <div class="slide-name" style=${{ fontSize: sz(theme.nameSize) }}>${v.name}</div>
      <div style=${{ fontSize: sz(theme.bodySize * 1.3), fontWeight: 700 }}>${fill(theme.message, v)}</div>
      ${v.division && html`<div style=${{ fontSize: sz(theme.bodySize * 0.8), opacity: 0.85 }}>${v.division}</div>`}`;
  } else if (type === 'award') {
    const shown = state.settings.awardPlacesShown >= 3 || theme.showThird ? 3 : 2;
    const places = [
      ['first', theme.firstLabel, data.places?.first],
      ['second', theme.secondLabel, data.places?.second],
      ['third', theme.thirdLabel, data.places?.third],
    ].slice(0, shown).filter(([, , name]) => name);
    body = html`
      <h1 class="slide-title" style=${{ fontSize: sz(theme.titleSize), color: accent }}>${fill(theme.title, v)}</h1>
      ${places.map(([key, label, name], i) => html`
        <div class="slide-place" key=${key}>
          <div class="slide-place-label" style=${{ fontSize: sz(theme.bodySize), color: accent, opacity: i ? 0.85 : 1 }}>${label}</div>
          <div class="slide-name" style=${{ fontSize: sz(i === 0 ? theme.nameSize : theme.nameSize * 0.78) }}>${name}</div>
        </div>`)}
      ${data.missingResults && html`<div style=${{ fontSize: sz(theme.bodySize) }}>Results not available</div>`}`;
  } else if (type === 'grand') {
    body = html`
      <h1 class="slide-title" style=${{ fontSize: sz(theme.titleSize), color: accent }}>${fill(theme.title, v)}</h1>
      <div style=${{ fontSize: sz(theme.bodySize) }}>${v.division}</div>
      <div class="slide-name" style=${{ fontSize: sz(theme.nameSize) }}>${data.places?.first || '—'}</div>`;
  } else {
    body = html`
      ${data.imageUrl && html`<img src=${data.imageUrl} alt="" style=${{ maxHeight: '55cqh', maxWidth: '80cqw', objectFit: 'contain' }} />`}
      ${v.title && html`<h1 class="slide-title" style=${{ fontSize: sz(theme.titleSize), color: accent }}>${v.title}</h1>`}
      ${v.body && html`<div style=${{ fontSize: sz(theme.bodySize), whiteSpace: 'pre-line' }}>${v.body}</div>`}`;
  }

  const anim = animate && theme.transition !== 'none' ? `slide-anim-${theme.transition}` : '';
  const align = theme.align === 'left' ? 'flex-start' : theme.align === 'right' ? 'flex-end' : 'center';
  return html`
    <div class="slide" style=${{ background: theme.background, color: theme.textColor, fontFamily: theme.fontFamily }}>
      ${theme.backgroundImage && html`<div class="slide-bg" style=${{ backgroundImage: `url("${theme.backgroundImage}")`, backgroundSize: theme.backgroundFit }}></div>`}
      ${theme.backgroundImage && html`<div class="slide-overlay" style=${{ opacity: theme.overlayOpacity }}></div>`}
      <div class=${`slide-content ${anim}`} key=${item?.id || type} style=${{ alignItems: align, textAlign: theme.align }}>
        ${type !== 'logo' && pos === 'top' && html`<${Logo} url=${logoUrl} theme=${theme} position=${pos} />`}
        ${body}
        ${type !== 'logo' && pos === 'bottom' && html`<${Logo} url=${logoUrl} theme=${theme} position=${pos} />`}
      </div>
      ${type !== 'logo' && pos === 'corner' && html`<${Logo} url=${logoUrl} theme=${{ ...theme, logoSize: Math.min(theme.logoSize, 16) }} position="corner" />`}
    </div>`;
}

export const SAMPLE_DATA = {
  logo: { type: 'logo', vars: { tournament: 'CWMA Tournament' } },
  missing: { type: 'missing', vars: { name: 'Jordan Rivera', ring: 3, ringName: 'Ring 3', division: 'Youth Kumite 8-9 Intermediate' } },
  award: { type: 'award', vars: { division: 'Youth Kata 10-11 Advanced' }, places: { first: 'Alex Kim', second: 'Sam Patel', third: 'Riley Chen' } },
  grand: { type: 'grand', vars: { division: 'Grand Championship Kata — Under 18' }, places: { first: 'Morgan Lee' } },
  custom: { type: 'custom', vars: { title: 'Thank you to our sponsors', body: 'Concessions open in the lobby' } },
};
