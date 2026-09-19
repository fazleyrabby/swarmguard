/**
 * Total-visit counter — fully client-side, no backend (Abacus API).
 *
 * Increments at most once per browser session, skipping dev/localhost and
 * likely bots. Shows a cached value immediately, then animates to the live
 * total. Same approach used on the-web-was-here (TrendTimeline).
 *
 * Abacus endpoints: GET /hit/{ns}/{key} (increment) and /get/{ns}/{key}.
 */

const ABACUS_BASE = 'https://abacus.jasoncameron.dev';
const ABACUS_NS = 'swarmguard';
const ABACUS_KEY = 'visits';
const CACHE_KEY = 'swarmguard:visits';
const SESSION_KEY = 'swarmguard:visitTracked';

function isDev(): boolean {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local') || window.location.port !== '';
}

function isBot(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  const botMarkers = [
    'bot', 'spider', 'crawler', 'preview', 'lighthouse', 'headless',
    'phantomjs', 'selenium', 'puppeteer', 'playwright', 'curl', 'wget',
    'monitor', 'uptime', 'scrap',
  ];
  return botMarkers.some((p) => ua.includes(p)) || navigator.webdriver === true;
}

function readCache(): number {
  try {
    return parseInt(localStorage.getItem(CACHE_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function writeCache(value: number): void {
  try {
    localStorage.setItem(CACHE_KEY, String(value));
  } catch {
    /* storage unavailable */
  }
}

function animateCount(el: HTMLElement, start: number, end: number, duration = 900): void {
  if (start === end) {
    el.textContent = end.toLocaleString();
    return;
  }
  const t0 = performance.now();
  const tick = (now: number): void => {
    const p = Math.min((now - t0) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(start + (end - start) * eased).toLocaleString();
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = end.toLocaleString();
  };
  requestAnimationFrame(tick);
}

function buildWidget(count: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'visitor-counter';
  wrap.id = 'visitor-counter';
  wrap.title = 'Total site visits — live';
  wrap.innerHTML = `
    <span class="visitor-counter__pulse" aria-hidden="true">
      <span class="visitor-counter__ping"></span>
      <span class="visitor-counter__core"></span>
    </span>
    <span class="visitor-counter__label">Visits</span>
    <span class="visitor-counter__count" id="visitor-count-number" aria-live="polite">${count.toLocaleString()}</span>
  `;
  return wrap;
}

export async function initVisitorCounter(): Promise<void> {
  const mount = document.getElementById('visitor-counter-mount');
  if (!mount || mount.dataset.loaded === 'true') return;
  mount.dataset.loaded = 'true';

  const cached = readCache();
  const widget = buildWidget(cached);
  mount.appendChild(widget);
  const countEl = document.getElementById('visitor-count-number');

  const alreadyTracked = (() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  })();

  const shouldTrack = !isDev() && !isBot() && !alreadyTracked;
  const endpoint = shouldTrack
    ? `${ABACUS_BASE}/hit/${ABACUS_NS}/${ABACUS_KEY}`
    : `${ABACUS_BASE}/get/${ABACUS_NS}/${ABACUS_KEY}`;
  if (shouldTrack) {
    try {
      sessionStorage.setItem(SESSION_KEY, 'true');
    } catch {
      /* storage unavailable */
    }
  }

  let current = cached;
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = (await res.json()) as { value?: number };
      if (typeof data.value === 'number') current = data.value;
    }
  } catch {
    /* offline / API down — keep the cached value */
  }

  writeCache(current);
  if (countEl) animateCount(countEl, cached, current);
}
