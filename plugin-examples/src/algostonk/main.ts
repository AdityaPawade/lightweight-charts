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

// ---------- toolbar ----------
const I = (p: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const TOOLS: { tool: ToolType | 'sep'; name?: string; icon?: string }[] = [
  { tool: 'cursor', name: 'Cursor', icon: I('<path d="M5 3l6 16 2.2-6.5L19 10 5 3z"/>') },
  { tool: 'sep' },
  { tool: 'trend', name: 'Trend line', icon: I('<path d="M4 19L20 5"/><circle cx="4" cy="19" r="1.6"/><circle cx="20" cy="5" r="1.6"/>') },
  { tool: 'ray', name: 'Ray', icon: I('<path d="M4 18L21 6"/><circle cx="4" cy="18" r="1.6"/>') },
  { tool: 'extended', name: 'Extended line', icon: I('<path d="M2 20L22 4"/>') },
  { tool: 'hline', name: 'Horizontal line', icon: I('<path d="M3 12h18"/><circle cx="9" cy="12" r="1.6"/>') },
  { tool: 'vline', name: 'Vertical line', icon: I('<path d="M12 3v18"/><circle cx="12" cy="9" r="1.6"/>') },
  { tool: 'sep' },
  { tool: 'rect', name: 'Rectangle', icon: I('<rect x="4" y="6" width="16" height="12" rx="1"/>') },
  { tool: 'fib', name: 'Fib retracement', icon: I('<path d="M3 6h18M3 10h18M3 14h18M3 18h18"/>') },
  { tool: 'measure', name: 'Measure', icon: I('<path d="M3 8h18v8H3z"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>') },
  { tool: 'sep' },
  { tool: 'brush', name: 'Brush', icon: I('<path d="M4 20c3 0 3-3 6-3 2 0 2 2 4 2 3 0 4-6 6-12"/>') },
  { tool: 'text', name: 'Text', icon: I('<path d="M5 5h14M12 5v14"/>') },
];
const toolbar = document.getElementById('toolbar') as HTMLElement;
for (const t of TOOLS) {
  if (t.tool === 'sep') { const s = document.createElement('div'); s.className = 'sep'; toolbar.appendChild(s); continue; }
  const el = document.createElement('div'); el.className = 'tool' + (t.tool === 'cursor' ? ' active' : ''); el.dataset.tool = t.tool;
  el.dataset.tooltip = t.name!; el.innerHTML = t.icon!;
  el.addEventListener('click', () => { engine.setTool(t.tool as ToolType); });
  toolbar.appendChild(el);
}
function syncToolbar() { toolbar.querySelectorAll<HTMLElement>('.tool').forEach(el => el.classList.toggle('active', el.dataset.tool === engine.tool)); }

// ---------- magnet / clear ----------
const btnMagnet = document.getElementById('btnMagnet') as HTMLElement;
btnMagnet.addEventListener('click', () => { engine.magnet = !engine.magnet; btnMagnet.classList.toggle('on', engine.magnet); });
(document.getElementById('btnClear') as HTMLElement).addEventListener('click', () => engine.clearAll());
(document.getElementById('hint') as HTMLElement).textContent = 'Pick a tool, then drag on the chart';

// ---------- style popover ----------
const COLORS = ['#2962ff', '#089981', '#f23645', '#ff9800', '#9c27b0', '#131722'];
const styleEl = document.getElementById('style') as HTMLElement;
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
  const sx = Math.max(8, Math.min((x ?? 80) + 12, stage.clientWidth - 230)); const sy = Math.max(8, (y ?? 40) - 44);
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
