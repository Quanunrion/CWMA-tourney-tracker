import { html, mount, useState, useEffect } from './core.js';

const screens = [
  { href: '/frontdesk', icon: '🗂️', title: 'Front Desk & Admin', text: 'Check competitors in, add walk-ins, set up divisions and rings, PINs, exports.' },
  { href: '/ring', icon: '🥋', title: 'Ring', text: 'Run the brackets for one ring: write-ins, results, missing competitor calls.' },
  { href: '/display', icon: '🎛️', title: 'Display Control', text: 'Operator console: approve and queue slides, go live, design slide looks.' },
  { href: '/output', icon: '📺', title: 'Display Output', text: 'Full-screen slides for the projector / TV. Open on the second monitor.' },
  { href: '/status', icon: '📋', title: 'Ring Status Board', text: 'Live view of every ring: now competing, on deck, progress.' },
  { href: '/print', icon: '🖨️', title: 'Print', text: 'Paper backup bracket sheets, rosters and results.' },
];

function App() {
  const [info, setInfo] = useState(null);
  useEffect(() => { fetch('/api/info').then((r) => r.json()).then(setInfo).catch(() => {}); }, []);
  return html`
    <div class="launcher">
      <h1>${info?.name || 'Tournament'}</h1>
      <p class="muted">Pick the screen for this device.</p>
      <div class="grid-2" style="margin-top:1rem">
        ${screens.map((s) => html`
          <a class="card" href=${s.href}>
            <div class="icon">${s.icon}</div>
            <h2>${s.title}</h2>
            <p class="muted">${s.text}</p>
          </a>`)}
      </div>
      ${info?.addresses?.length > 0 && html`
        <div class="card" style="margin-top:1.5rem">
          <h3>Connect other devices</h3>
          <p class="muted small">On the same network, open one of these addresses in a browser:</p>
          ${info.addresses.map((a) => html`<div><code>${a}</code></div>`)}
        </div>`}
    </div>`;
}

mount(App);
