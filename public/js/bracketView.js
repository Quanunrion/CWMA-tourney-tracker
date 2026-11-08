// Bracket rendering shared by the ring client (interactive) and the print view (static).
import { html } from './core.js';
import { competitorName } from '/shared/model.js';
import { roundName, computeBracket } from '/shared/bracket.js';

function Slot({ state, id, match, interactive, onPick, onCall, withdrawn }) {
  if (id === undefined) return html`<div class="slot bye">—</div>`;
  if (id === null) return html`<div class="slot bye">bye</div>`;
  const c = state.competitors[id];
  const isWinner = match.winner === id && (match.state === 'done' || match.state === 'forfeit');
  const isLoser = match.loser === id;
  const cls = `slot ${isWinner ? 'winner' : ''} ${isLoser ? 'loser' : ''} ${withdrawn ? 'withdrawn' : ''}`;
  const canPick = interactive && (match.state === 'ready' || match.state === 'done') && !withdrawn;
  const label = html`${isWinner ? '✔ ' : ''}${competitorName(c)}${withdrawn ? ' (withdrawn)' : ''}${c?.dojo ? html`<span class="dojo">${c.dojo}</span>` : ''}`;
  return html`
    <div class="row" style="gap:0;flex-wrap:nowrap">
      ${canPick
        ? html`<button class=${cls} onClick=${() => onPick(match, isWinner ? null : id)} title=${isWinner ? 'Tap to undo' : 'Tap to mark winner'}>${label}</button>`
        : html`<div class=${cls}>${label}</div>`}
      ${interactive && onCall && !isLoser && html`<button class="btn btn-ghost btn-sm no-print" title="Call missing competitor to this ring" onClick=${() => onCall(id)}>📢</button>`}
    </div>`;
}

function MatchBox({ state, match, label, interactive, onPick, onCall, withdrawn }) {
  const stateLabel = { ready: 'ready', done: 'done', forfeit: 'forfeit', bye: 'bye', waiting: 'waiting', empty: '' }[match.state];
  return html`
    <div class=${`match ${interactive && match.state === 'ready' ? 'ready' : ''}`}>
      <div class="match-label"><span>${label}</span><span>${stateLabel}</span></div>
      <${Slot} state=${state} id=${match.a} match=${match} interactive=${interactive} onPick=${onPick} onCall=${onCall} withdrawn=${withdrawn.has(match.a)} />
      <${Slot} state=${state} id=${match.b} match=${match} interactive=${interactive} onPick=${onPick} onCall=${onCall} withdrawn=${withdrawn.has(match.b)} />
    </div>`;
}

export function SingleElimView({ state, division, view, interactive, onPick, onCall }) {
  const withdrawn = new Set(division.bracket.withdrawn || []);
  let n = 0;
  const numbered = new Map();
  for (const m of view.matches) if (m.state !== 'bye' && m.state !== 'empty') numbered.set(m.id, ++n);
  const label = (m) => (numbered.has(m.id) ? `Match ${numbered.get(m.id)}` : '');
  return html`
    <div class="bracket">
      ${view.rounds.map((ms, i) => html`
        <div class="bracket-round" key=${i}>
          <h4>${roundName(i + 1, view.rounds.length)}</h4>
          <div class="bracket-matches">
            ${ms.map((m) => (m.state === 'empty' ? html`<div style="min-height:20px"></div>` : html`<${MatchBox} key=${m.id} state=${state} match=${m} label=${label(m)} interactive=${interactive} onPick=${onPick} onCall=${onCall} withdrawn=${withdrawn} />`))}
          </div>
        </div>`)}
      ${view.third && view.third.state !== 'empty' && html`
        <div class="bracket-round">
          <h4>3rd place</h4>
          <div class="bracket-matches"><${MatchBox} state=${state} match=${view.third} label=${label(view.third)} interactive=${interactive} onPick=${onPick} onCall=${onCall} withdrawn=${withdrawn} /></div>
        </div>`}
    </div>`;
}

export function RoundRobinView({ state, division, view, interactive, onPick, onCall }) {
  const withdrawn = new Set(division.bracket.withdrawn || []);
  return html`
    <div class="grid-2">
      <div class="stack">
        <h3>Matches</h3>
        ${view.matches.map((m, i) => html`<${MatchBox} key=${m.id} state=${state} match=${m} label=${`Match ${i + 1} · Round ${m.round}`} interactive=${interactive} onPick=${onPick} onCall=${onCall} withdrawn=${withdrawn} />`)}
      </div>
      <div>
        <h3>Standings</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Competitor</th><th>W</th><th>L</th></tr></thead>
            <tbody>
              ${view.standings.map((s, i) => html`
                <tr key=${s.id}>
                  <td>${i + 1}</td>
                  <td>${competitorName(state.competitors[s.id])}${withdrawn.has(s.id) ? html` <span class="badge badge-bad">withdrawn</span>` : ''}</td>
                  <td>${s.wins}</td><td>${s.losses}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>
        ${view.ties.length > 0 && html`<p class="small" style="color:var(--warn)">Tie in the standings — choose the final places below.</p>`}
      </div>
    </div>`;
}

export function KataView({ state, division, view, interactive, onScore, onCall }) {
  const judges = division.bracket.judges;
  return html`
    <div class="table-wrap">
      <table>
        <thead><tr><th>Order</th><th>Competitor</th>${Array.from({ length: judges }, (_, i) => html`<th>J${i + 1}</th>`)}<th>Total</th><th>Rank</th>${interactive && html`<th class="no-print"></th>`}</tr></thead>
        <tbody>
          ${view.rows.map((r) => {
            const rank = view.ranking.indexOf(r.id);
            const c = state.competitors[r.id];
            return html`
              <tr key=${r.id} style=${r.withdrawn ? 'opacity:.5' : ''}>
                <td>${r.order}</td>
                <td><strong>${competitorName(c)}</strong>${c?.dojo ? html` <span class="muted small">${c.dojo}</span>` : ''}${r.withdrawn ? html` <span class="badge badge-bad">withdrawn</span>` : ''}</td>
                ${Array.from({ length: judges }, (_, j) => html`<td>${interactive && !r.withdrawn
                  ? html`<input class="score-input" type="number" step="0.1" inputmode="decimal" value=${r.scores[j] ?? ''} onChange=${(e) => { const next = [...Array(judges)].map((_, k) => (k === j ? e.target.value : (r.scores[k] ?? ''))); onScore(r.id, next); }} />`
                  : (r.scores[j] ?? '')}</td>`)}
                <td><strong>${r.total ?? ''}</strong></td>
                <td>${rank >= 0 && rank < 3 ? html`<span class=${`medal medal-${rank + 1}`}>${rank + 1}</span>` : rank >= 0 ? rank + 1 : ''}</td>
                ${interactive && html`<td class="no-print">${!r.withdrawn && html`<button class="btn btn-ghost btn-sm" title="Call missing competitor" onClick=${() => onCall(r.id)}>📢</button>`}</td>`}
              </tr>`;
          })}
        </tbody>
      </table>
    </div>
    ${view.ties.length > 0 && html`<p class="small" style="color:var(--warn)">Tied scores — choose the final places below.</p>`}`;
}

export function BracketView(props) {
  const view = props.view || computeBracket(props.division);
  if (!view) return null;
  if (view.kind === 'single_elim') return html`<${SingleElimView} ...${props} view=${view} />`;
  if (view.kind === 'round_robin') return html`<${RoundRobinView} ...${props} view=${view} />`;
  if (view.kind === 'kata_scores') return html`<${KataView} ...${props} view=${view} />`;
  return null;
}
