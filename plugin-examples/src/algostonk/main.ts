// Algostonk drawing-tools app — a standalone TradingView-style charting surface built on the Lightweight Charts fork.
// Light theme candlestick + volume, a left drawing toolbar, crosshair OHLCV legend, and the overlay DrawingEngine.
import { createChart, ColorType, CrosshairMode, CandlestickSeries, HistogramSeries, type Time } from 'lightweight-charts';
import { DrawingEngine, type ToolType, type Bar } from './drawings';

// ---------- deterministic mock OHLCV (~320 daily bars) ----------
function mockBars(n = 320): Bar[] {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const out: Bar[] = []; let price = 2400; const start = Date.UTC(2024, 8, 1) / 1000;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 26) * 9 + (rnd() - 0.5) * 26;
    const open = price; const close = Math.max(40, open + drift);
    const high = Math.max(open, close) + rnd() * 14; const low = Math.min(open, close) - rnd() * 14;
    const time = (start + i * 86400) as unknown as Time;
    out.push({ time, open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2) });
    price = close;
  }
  return out;
}

const bars = mockBars();
const stage = document.getElementById('stage') as HTMLElement;
const chartEl = document.getElementById('chart') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;

const chart = createChart(chartEl, {
  autoSize: true,
  layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#131722', fontSize: 11 },
  grid: { vertLines: { color: '#eef1f5' }, horzLines: { color: '#eef1f5' } },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: '#e0e3eb' },
  timeScale: { borderColor: '#e0e3eb', rightOffset: 6, fixLeftEdge: true },
});
const candle = chart.addSeries(CandlestickSeries, { upColor: '#089981', downColor: '#f23645', borderUpColor: '#089981', borderDownColor: '#f23645', wickUpColor: '#089981', wickDownColor: '#f23645' }, 0);
candle.setData(bars.map(b => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false }, 0);
vol.setData(bars.map((b, i) => ({ time: b.time as Time, value: 500 + Math.abs(b.close - b.open) * 60 + (i % 7) * 40, color: b.close >= b.open ? 'rgba(8,153,129,.45)' : 'rgba(242,54,69,.45)' })));
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
chart.timeScale().fitContent();

const engine = new DrawingEngine({ canvas: overlay, chart, series: candle, stage, bars, storeKey: 'algostonk:draw:DEMO' });

// ---------- toolbar (TradingView-style grouped flyouts) ----------
const I = (p: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON: Record<string, string> = {
  cursor: I('<path d="M5 3l6 16 2.2-6.5L19 10 5 3z"/>'),
  trend: I('<path d="M4 19L20 5"/><circle cx="4" cy="19" r="1.5"/><circle cx="20" cy="5" r="1.5"/>'),
  ray: I('<path d="M4 18L21 6"/><circle cx="4" cy="18" r="1.5"/>'),
  extended: I('<path d="M2 20L22 4"/>'),
  hline: I('<path d="M3 12h18"/><circle cx="9" cy="12" r="1.5"/>'),
  vline: I('<path d="M12 3v18"/><circle cx="12" cy="9" r="1.5"/>'),
  channel: I('<path d="M4 17L15 5M9 21L20 9"/><circle cx="4" cy="17" r="1.5"/><circle cx="15" cy="5" r="1.5"/>'),
  regression: I('<path d="M4 16L20 8"/><path d="M4 19L20 11" stroke-dasharray="2 2"/><path d="M4 13L20 5" stroke-dasharray="2 2"/>'),
  disjoint: I('<path d="M4 18L11 10M13 16L20 8"/>'),
  fib: I('<path d="M3 6h18M3 10h18M3 14h18M3 18h18"/>'),
  fibext: I('<path d="M4 20L12 8l8 4"/><path d="M3 6h18" stroke-dasharray="2 2"/>'),
  fibchan: I('<path d="M4 18L18 6M7 21L21 9"/>'),
  rect: I('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
  circle: I('<circle cx="12" cy="12" r="7.5"/>'),
  triangle: I('<path d="M12 5L20 19H4z"/>'),
  measure: I('<path d="M3 8h18v8H3z"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>'),
  brush: I('<path d="M4 20c3 0 3-3 6-3 2 0 2 2 4 2 3 0 4-6 6-12"/>'),
  highlighter: I('<path d="M5 19l3 1 11-11-4-4L4 16z"/>'),
  arrow: I('<path d="M5 19L19 5M19 5h-7M19 5v7"/>'),
  text: I('<path d="M5 5h14M12 5v14"/>'),
  callout: I('<path d="M4 5h16v10H10l-4 4v-4H4z"/>'),
  info: I('<path d="M4 19L20 5"/><path d="M13 8h5v5"/>'),
  trendangle: I('<path d="M4 20h16M4 20L18 8"/>'),
  hray: I('<path d="M4 12h17"/><circle cx="4" cy="12" r="1.6"/>'),
  crossline: I('<path d="M3 12h18M12 3v18"/>'),
  arrowup: I('<path d="M12 20V5M6 11l6-6 6 6"/>'),
  arrowdown: I('<path d="M12 4v15M6 13l6 6 6-6"/>'),
  pitchfork: I('<path d="M6 4v16M6 12L18 6M6 12l12 6M18 6v12"/>'),
  schiff: I('<path d="M5 6v13M5 12h13"/>'),
  fibtime: I('<path d="M5 4v16M9 4v16M14 4v16M20 4v16"/>'),
  gannfan: I('<path d="M5 19L20 4M5 19h15M5 19L20 11M5 19L13 4"/>'),
  gannbox: I('<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 5l16 14M4 12h16M12 5v14"/>'),
  pattern: I('<path d="M4 16l4-9 4 6 4-10 4 8"/>'),
  ell: I('<path d="M4 18l4-10 3 6 4-9 4 7"/>'),
  longpos: I('<rect x="5" y="5" width="14" height="6" rx="1"/><rect x="5" y="11" width="14" height="6" rx="1"/>'),
  shortpos: I('<rect x="5" y="7" width="14" height="6" rx="1"/><rect x="5" y="13" width="14" height="6" rx="1"/>'),
  pricerange: I('<path d="M5 6h14M5 18h14M12 6v12"/>'),
  ellipse: I('<ellipse cx="12" cy="12" rx="8" ry="5"/>'),
  arc: I('<path d="M4 18a14 14 0 0 1 16 0"/>'),
  polyline: I('<path d="M4 18l5-9 4 5 7-8"/>'),
  note: I('<path d="M5 4h14v11l-4 4H5z"/>'),
  pricelabel: I('<path d="M3 12h11l4-4v8l-4-4"/>'),
  cyclic: I('<path d="M6 4v16M12 4v16M18 4v16"/>'),
  sine: I('<path d="M3 12c3-8 6 8 9 0s6-8 9 0"/>'),
};
type Item = { label: string; tool?: ToolType; icon: string; sc?: string; star?: boolean; soon?: boolean };
type Group = { name: string; items: Item[]; sepAfter?: boolean };
const GROUPS: Group[] = [
  { name: 'Cursor', items: [{ label: 'Cursor', tool: 'cursor', icon: ICON.cursor }], sepAfter: true },
  { name: 'Lines', items: [
    { label: 'Trend line', tool: 'trend', icon: ICON.trend, sc: 'Alt+T', star: true },
    { label: 'Ray', tool: 'ray', icon: ICON.ray },
    { label: 'Info line', tool: 'info', icon: ICON.info },
    { label: 'Extended line', tool: 'extended', icon: ICON.extended },
    { label: 'Trend angle', tool: 'trendangle', icon: ICON.trendangle },
    { label: 'Arrow', tool: 'arrow', icon: ICON.arrow },
    { label: 'Horizontal line', tool: 'hline', icon: ICON.hline, sc: 'Alt+H' },
    { label: 'Horizontal ray', tool: 'hray', icon: ICON.hray },
    { label: 'Vertical line', tool: 'vline', icon: ICON.vline, sc: 'Alt+V' },
    { label: 'Cross line', tool: 'crossline', icon: ICON.crossline },
  ] },
  { name: 'Channels', items: [
    { label: 'Parallel channel', tool: 'channel', icon: ICON.channel, star: true },
    { label: 'Regression trend', tool: 'regression', icon: ICON.regression },
    { label: 'Disjoint channel', tool: 'disjoint', icon: ICON.disjoint },
  ] },
  { name: 'Pitchforks', items: [
    { label: 'Pitchfork', tool: 'pitchfork', icon: ICON.pitchfork, star: true },
    { label: 'Schiff pitchfork', icon: ICON.schiff, soon: true },
    { label: 'Inside pitchfork', icon: ICON.schiff, soon: true },
  ] },
  { name: 'Fibonacci', items: [
    { label: 'Fib retracement', tool: 'fib', icon: ICON.fib, sc: 'Alt+F', star: true },
    { label: 'Trend-based fib extension', tool: 'fibext', icon: ICON.fibext },
    { label: 'Fib time zone', tool: 'fibtime', icon: ICON.fibtime },
    { label: 'Fib channel', tool: 'fibchannel', icon: ICON.fibchan },
  ] },
  { name: 'Gann', items: [
    { label: 'Gann fan', tool: 'gannfan', icon: ICON.gannfan, star: true },
    { label: 'Gann box', tool: 'gannbox', icon: ICON.gannbox },
  ] },
  { name: 'Patterns', items: [
    { label: 'XABCD pattern', tool: 'xabcd', icon: ICON.pattern, star: true },
    { label: 'ABCD pattern', tool: 'abcd', icon: ICON.pattern },
    { label: 'Head and shoulders', tool: 'hs', icon: ICON.pattern },
    { label: 'Triangle pattern', tool: 'tripattern', icon: ICON.pattern },
    { label: 'Three drives pattern', tool: 'threedrives', icon: ICON.pattern },
  ] },
  { name: 'Elliott waves', items: [
    { label: 'Elliott impulse (1-2-3-4-5)', tool: 'ell5', icon: ICON.ell, star: true },
    { label: 'Elliott correction (A-B-C)', tool: 'ellabc', icon: ICON.ell },
    { label: 'Elliott triangle (A-B-C-D-E)', tool: 'ellabcde', icon: ICON.ell },
  ] },
  { name: 'Forecast', items: [
    { label: 'Long position', tool: 'longpos', icon: ICON.longpos, star: true },
    { label: 'Short position', tool: 'shortpos', icon: ICON.shortpos },
    { label: 'Price range', tool: 'pricerange', icon: ICON.pricerange },
    { label: 'Measure', tool: 'measure', icon: ICON.measure },
  ], sepAfter: true },
  { name: 'Shapes', items: [
    { label: 'Rectangle', tool: 'rect', icon: ICON.rect, sc: 'Alt+R', star: true },
    { label: 'Circle', tool: 'circle', icon: ICON.circle },
    { label: 'Ellipse', tool: 'ellipse', icon: ICON.ellipse },
    { label: 'Triangle', tool: 'triangle', icon: ICON.triangle },
    { label: 'Arc', tool: 'arc', icon: ICON.arc },
    { label: 'Polyline', tool: 'polyline', icon: ICON.polyline },
  ] },
  { name: 'Brushes', items: [
    { label: 'Brush', tool: 'brush', icon: ICON.brush, star: true },
    { label: 'Highlighter', tool: 'highlighter', icon: ICON.highlighter },
    { label: 'Arrow mark up', tool: 'arrowup', icon: ICON.arrowup },
    { label: 'Arrow mark down', tool: 'arrowdown', icon: ICON.arrowdown },
  ] },
  { name: 'Text', items: [
    { label: 'Text', tool: 'text', icon: ICON.text, star: true },
    { label: 'Callout', tool: 'callout', icon: ICON.callout },
    { label: 'Note', tool: 'note', icon: ICON.note },
    { label: 'Price label', tool: 'pricelabel', icon: ICON.pricelabel },
  ] },
  { name: 'Cycles', items: [
    { label: 'Cyclic lines', tool: 'cyclic', icon: ICON.cyclic, star: true },
    { label: 'Sine line', tool: 'sine', icon: ICON.sine },
  ] },
];

const toolbar = document.getElementById('toolbar') as HTMLElement;
const flyout = document.createElement('div'); flyout.id = 'flyout'; document.body.appendChild(flyout);
const current: number[] = GROUPS.map(g => Math.max(0, g.items.findIndex(it => !it.soon)));

function groupIcon(gi: number) { const it = GROUPS[gi].items[current[gi]]; return it.icon + (GROUPS[gi].items.length > 1 ? '<span class="caret"></span>' : ''); }
GROUPS.forEach((g, gi) => {
  const btn = document.createElement('div'); btn.className = 'tool' + (gi === 0 ? ' active' : ''); btn.dataset.g = String(gi);
  btn.dataset.tooltip = g.name; btn.innerHTML = groupIcon(gi);
  btn.addEventListener('click', (e) => { e.stopPropagation(); const it = g.items[current[gi]]; if (it.tool) engine.setTool(it.tool); if (g.items.length > 1) openFlyout(gi, btn); else closeFlyout(); });
  toolbar.appendChild(btn);
  if (g.sepAfter) { const s = document.createElement('div'); s.className = 'sep'; toolbar.appendChild(s); }
});

function openFlyout(gi: number, btn: HTMLElement) {
  const g = GROUPS[gi]; const r = btn.getBoundingClientRect();
  flyout.innerHTML = `<div class="grp">${g.name}</div>` + g.items.map((it, ii) =>
    `<div class="item ${it.soon ? 'soon' : ''} ${(!it.soon && current[gi] === ii && engine.tool === it.tool) ? 'active' : ''}" data-g="${gi}" data-i="${ii}">${it.icon}<span class="nm">${it.label}</span>${it.sc ? `<span class="sc">${it.sc}</span>` : ''}${it.star ? '<span class="star">★</span>' : ''}${it.soon ? '<span class="sc">soon</span>' : ''}</div>`).join('');
  flyout.style.left = (r.right + 6) + 'px'; flyout.style.top = Math.max(8, Math.min(r.top, window.innerHeight - g.items.length * 36 - 40)) + 'px';
  flyout.classList.add('show');
}
function closeFlyout() { flyout.classList.remove('show'); }
flyout.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest('.item') as HTMLElement | null; if (!item || item.classList.contains('soon')) return;
  const gi = +item.dataset.g!, ii = +item.dataset.i!; current[gi] = ii;
  const btn = toolbar.querySelector(`.tool[data-g="${gi}"]`) as HTMLElement; if (btn) btn.innerHTML = groupIcon(gi);
  const it = GROUPS[gi].items[ii]; if (it.tool) engine.setTool(it.tool); closeFlyout();
});
document.addEventListener('click', (e) => { if (!flyout.contains(e.target as Node) && !(e.target as HTMLElement).closest('#toolbar')) closeFlyout(); });

function syncToolbar() { toolbar.querySelectorAll<HTMLElement>('.tool').forEach(btn => { const gi = +btn.dataset.g!; const it = GROUPS[gi].items[current[gi]]; btn.classList.toggle('active', !!it.tool && it.tool === engine.tool); }); }

// ---------- magnet / clear ----------
const btnMagnet = document.getElementById('btnMagnet') as HTMLElement;
btnMagnet.addEventListener('click', () => { engine.magnet = !engine.magnet; btnMagnet.classList.toggle('on', engine.magnet); });
(document.getElementById('btnClear') as HTMLElement).addEventListener('click', () => engine.clearAll());
(document.getElementById('hint') as HTMLElement).textContent = 'Pick a tool, then drag on the chart';

// ---------- style popover ----------
const COLORS = ['#2962ff', '#089981', '#f23645', '#ff9800', '#9c27b0', '#131722'];
const styleEl = document.getElementById('style') as HTMLElement;
document.body.appendChild(styleEl); // move out of #stage so the engine's capture-phase pointerdown can't intercept its clicks
function buildStyle() {
  styleEl.innerHTML = '';
  COLORS.forEach(c => { const s = document.createElement('div'); s.className = 'sw'; s.style.background = c; s.title = c; s.dataset.c = c;
    s.addEventListener('click', () => { engine.setColor(c); renderStyle(); }); styleEl.appendChild(s); });
  const vr = document.createElement('div'); vr.className = 'vr'; styleEl.appendChild(vr);
  [1, 2, 3, 4].forEach(w => { const b = document.createElement('div'); b.className = 'w'; b.textContent = String(w); b.dataset.w = String(w);
    b.addEventListener('click', () => { engine.setWidth(w); renderStyle(); }); styleEl.appendChild(b); });
  const vr2 = document.createElement('div'); vr2.className = 'vr'; styleEl.appendChild(vr2);
  const del = document.createElement('div'); del.className = 'del'; del.title = 'Delete'; del.innerHTML = I('<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>');
  del.addEventListener('click', () => engine.deleteSelected()); styleEl.appendChild(del);
}
function renderStyle() {
  const d = engine.selected();
  if (!d) { styleEl.classList.remove('show'); return; }
  styleEl.classList.add('show');
  styleEl.querySelectorAll<HTMLElement>('.sw').forEach(s => s.classList.toggle('sel', (s as any).dataset.c === d.color));
  styleEl.querySelectorAll<HTMLElement>('.w').forEach(b => b.classList.toggle('sel', b.dataset.w === String(d.width)));
  // position near the drawing's first anchor (clamped into the stage)
  const a = d.anchors[0]; const x = chart.timeScale().logicalToCoordinate(a.logical as any); const y = candle.priceToCoordinate(a.price);
  const r = stage.getBoundingClientRect(); // #style is on <body> now → position with viewport coords
  const sx = Math.max(8, Math.min(r.left + (x ?? 80) + 12, r.right - 234)); const sy = Math.max(8, r.top + (y ?? 40) - 44);
  styleEl.style.left = sx + 'px'; styleEl.style.top = sy + 'px';
}
buildStyle();
engine.onChange = () => { syncToolbar(); renderStyle(); };

// ---------- crosshair legend ----------
const legend = document.getElementById('legend') as HTMLElement;
function setLegend(b?: Bar, prev?: Bar) {
  if (!b) { legend.innerHTML = ''; return; }
  const chg = prev ? ((b.close - prev.close) / prev.close) * 100 : 0; const col = chg >= 0 ? '#089981' : '#f23645';
  legend.innerHTML = `<span class="px">ALGOSTONK</span> &nbsp; O <span class="px">${b.open}</span> H <span class="px">${b.high}</span> L <span class="px">${b.low}</span> C <span class="px">${b.close}</span> <span style="color:${col}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>`;
}
chart.subscribeCrosshairMove(p => {
  if (!p.time) { setLegend(bars[bars.length - 1], bars[bars.length - 2]); return; }
  const i = bars.findIndex(b => b.time === p.time); if (i >= 0) setLegend(bars[i], bars[i - 1]);
});
setLegend(bars[bars.length - 1], bars[bars.length - 2]);

// expose for the puppeteer test harness
(window as any).__algo = { chart, candle, engine, bars };
(window as any).__algo.openFlyout = (name: string) => { const gi = GROUPS.findIndex(g => g.name === name); const btn = toolbar.querySelector(`.tool[data-g="${gi}"]`) as HTMLElement | null; if (btn) openFlyout(gi, btn); };
