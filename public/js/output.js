// Projector / TV output. Read-only: it shows whatever the display operator put live.
import { html, mount, Sync, useSync, useState, useEffect } from './core.js';
import { Slide } from './slides.js';

const sync = new Sync('output').start();
document.title = 'Display Output';
document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;cursor:none';

function App() {
  useSync(sync);
  const [idleIndex, setIdleIndex] = useState(0);
  const state = sync.state;
  const idle = state?.idle;
  const liveItem = state?.display.live ? state.queue[state.display.live] : null;
  const idleSlides = (idle?.slideIds || []).filter((id) => state?.customSlides[id]);
  const rotating = !liveItem && idle?.enabled && idleSlides.length > 0;

  useEffect(() => {
    if (!rotating) return undefined;
    const t = setInterval(() => setIdleIndex((i) => i + 1), Math.max(3, Number(idle.intervalSec) || 12) * 1000);
    return () => clearInterval(t);
  }, [rotating, idle?.intervalSec]);

  if (!state) return html`<div style="color:#666;font:16px sans-serif;padding:2rem">Connecting…</div>`;

  // Idle rotation alternates the logo with custom slides when nothing is live.
  let item = liveItem;
  if (rotating) {
    const seq = [null, ...idleSlides];
    const pick = seq[idleIndex % seq.length];
    item = pick ? { id: `idle-${pick}-${idleIndex}`, type: 'custom', customSlideId: pick } : null;
  }

  return html`
    <div style="position:fixed;inset:0" onDblClick=${() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()}>
      <${Slide} state=${state} item=${item} />
      ${!sync.connected && html`<div style="position:fixed;bottom:6px;right:8px;width:10px;height:10px;border-radius:50%;background:#e5383b;opacity:.7" title="Disconnected"></div>`}
    </div>`;
}

mount(App);

// One-time hint for operators.
const hint = document.createElement('div');
hint.textContent = 'Double-click for full screen';
hint.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);color:#fff;padding:6px 14px;border-radius:6px;font:14px sans-serif;z-index:9;transition:opacity 1s';
document.body.appendChild(hint);
setTimeout(() => { hint.style.opacity = '0'; }, 4000);
setTimeout(() => hint.remove(), 5200);
