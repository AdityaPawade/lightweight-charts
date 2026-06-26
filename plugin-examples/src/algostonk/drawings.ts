// Algostonk drawing engine — a coordinate-synced overlay-canvas layer over a Lightweight Charts pane.
// Drawings are stored in DATA space (logical bar index + price) so they stick to the chart through pan/zoom; every
// animation frame we project them to pixels via the chart's time/price scales and repaint. Handles draw / select /
// move / delete, magnet snap-to-OHLC, per-drawing style, and localStorage persistence.
import type { IChartApi, ISeriesApi, Logical } from 'lightweight-charts';

export type ToolType =
  | 'cursor' | 'trend' | 'ray' | 'extended' | 'hline' | 'vline'
  | 'rect' | 'fib' | 'measure' | 'brush' | 'text';

export interface Anchor { logical: number; price: number; }
export interface Drawing { id: string; type: ToolType; anchors: Anchor[]; color: string; width: number; text?: string; }

export interface Bar { time: unknown; open: number; high: number; low: number; close: number; }

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const TWO_POINT: ToolType[] = ['trend', 'ray', 'extended', 'rect', 'fib', 'measure'];
const HIT = 6; // px hit tolerance for lines
const ANCHOR_R = 5; // px anchor radius

let _id = 0;
const uid = () => `d${++_id}_${Math.floor(performance.now())}`;

export class DrawingEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private chart: IChartApi;
  private series: ISeriesApi<'Candlestick'>;
  private stage: HTMLElement;
  private bars: Bar[];
  private storeKey: string;

  drawings: Drawing[] = [];
  tool: ToolType = 'cursor';
  color = '#2962ff';
  width = 2;
  magnet = false;
  keepDrawing = false;
  selectedId: string | null = null;

  private draft: Drawing | null = null;
  private drag: { id: string; idx: number; orig: Anchor[]; from: Anchor } | null = null;
  private hoverId: string | null = null;

  onChange?: () => void; // fired when selection/drawing set changes (for toolbar + style popover)

  constructor(opts: { canvas: HTMLCanvasElement; chart: IChartApi; series: ISeriesApi<'Candlestick'>; stage: HTMLElement; bars: Bar[]; storeKey: string; }) {
    this.canvas = opts.canvas;
    this.ctx = opts.canvas.getContext('2d')!;
    this.chart = opts.chart;
    this.series = opts.series;
    this.stage = opts.stage;
    this.bars = opts.bars;
    this.storeKey = opts.storeKey;
    this.load();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.stage.addEventListener('pointerdown', this.onDown, true);
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('keydown', this.onKey);
    const loop = () => { this.render(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  setTool(t: ToolType) { this.tool = t; if (t !== 'cursor') this.select(null); this.onChange?.(); }
  setColor(c: string) { this.color = c; const d = this.selected(); if (d) { d.color = c; this.save(); } }
  setWidth(w: number) { this.width = w; const d = this.selected(); if (d) { d.width = w; this.save(); } }
  selected() { return this.drawings.find(d => d.id === this.selectedId) || null; }
  select(id: string | null) { this.selectedId = id; this.onChange?.(); }
  clearAll() { this.drawings = []; this.select(null); this.save(); }
  deleteSelected() { if (this.selectedId) { this.drawings = this.drawings.filter(d => d.id !== this.selectedId); this.select(null); this.save(); } }

  // ---------- geometry / projection ----------
  private dpr() { return window.devicePixelRatio || 1; }
  private plotW() { return this.chart.timeScale().width(); }
  private plotH() { return this.stage.clientHeight - this.chart.timeScale().height(); }
  private resize() {
    const w = this.plotW(), h = this.plotH(), r = this.dpr();
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.canvas.width = Math.round(w * r); this.canvas.height = Math.round(h * r);
    this.ctx.setTransform(r, 0, 0, r, 0, 0);
  }
  private x(logical: number): number | null { const c = this.chart.timeScale().logicalToCoordinate(logical as Logical); return c == null ? null : c; }
  private y(price: number): number | null { const c = this.series.priceToCoordinate(price); return c == null ? null : c; }
  private toLogical(px: number): number { return (this.chart.timeScale().coordinateToLogical(px) as number) ?? 0; }
  private toPrice(py: number): number { return (this.series.coordinateToPrice(py) as number) ?? 0; }
  private pt(a: Anchor): { x: number; y: number } | null { const x = this.x(a.logical), y = this.y(a.price); return x == null || y == null ? null : { x, y }; }

  private pointer(e: PointerEvent) { const r = this.stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  private anchorAt(px: number, py: number): Anchor {
    let logical = this.toLogical(px), price = this.toPrice(py);
    if (this.magnet) { const b = this.bars[Math.round(logical)]; if (b) { const cands = [b.open, b.high, b.low, b.close]; price = cands.reduce((p, v) => Math.abs(v - price) < Math.abs(p - price) ? v : p, cands[0]); } }
    return { logical, price };
  }

  // ---------- interaction ----------
  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const p = this.pointer(e);
    if (p.x > this.plotW() || p.y > this.plotH()) return; // ignore axes
    if (this.tool === 'cursor') {
      const hit = this.hitTest(p.x, p.y);
      if (hit) { e.stopPropagation(); e.preventDefault(); this.select(hit.id); this.lockChart(true);
        this.drag = { id: hit.id, idx: hit.idx, orig: this.drawings.find(d => d.id === hit.id)!.anchors.map(a => ({ ...a })), from: this.anchorAt(p.x, p.y) }; }
      else { this.select(null); } // let chart pan
      return;
    }
    // drawing mode
    e.stopPropagation(); e.preventDefault(); this.lockChart(true);
    const a = this.anchorAt(p.x, p.y);
    if (this.tool === 'hline') { this.commit({ id: uid(), type: 'hline', anchors: [a], color: this.color, width: this.width }); return; }
    if (this.tool === 'vline') { this.commit({ id: uid(), type: 'vline', anchors: [a], color: this.color, width: this.width }); return; }
    if (this.tool === 'text') { const t = window.prompt('Text:', 'Note'); if (t) this.commit({ id: uid(), type: 'text', anchors: [a], color: this.color, width: this.width, text: t }); else this.lockChart(false); return; }
    if (this.tool === 'brush') { this.draft = { id: uid(), type: 'brush', anchors: [a], color: this.color, width: this.width }; return; }
    this.draft = { id: uid(), type: this.tool, anchors: [a, { ...a }], color: this.color, width: this.width }; // 2-point
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointer(e);
    if (this.draft) {
      const a = this.anchorAt(p.x, p.y);
      if (this.draft.type === 'brush') this.draft.anchors.push(a); else this.draft.anchors[this.draft.anchors.length - 1] = a;
    } else if (this.drag) {
      const now = this.anchorAt(p.x, p.y); const d = this.drawings.find(x => x.id === this.drag!.id); if (!d) return;
      const dl = now.logical - this.drag.from.logical, dp = now.price - this.drag.from.price;
      if (this.drag.idx === -1) d.anchors = this.drag.orig.map(o => ({ logical: o.logical + dl, price: o.price + dp }));
      else { const o = this.drag.orig[this.drag.idx]; d.anchors[this.drag.idx] = { logical: o.logical + dl, price: o.price + dp }; }
    } else if (this.tool === 'cursor') {
      const hit = this.hitTest(p.x, p.y); this.hoverId = hit?.id ?? null; this.stage.style.cursor = hit ? 'pointer' : 'default';
    } else { this.stage.style.cursor = 'crosshair'; }
  };

  private onUp = () => {
    if (this.draft) { if (this.draft.anchors.length >= (this.draft.type === 'brush' ? 2 : 2)) this.commit(this.draft); else this.lockChart(false); this.draft = null; }
    else if (this.drag) { this.drag = null; this.save(); this.lockChart(false); }
  };

  private onKey = (e: KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) { this.deleteSelected(); }
    if (e.key === 'Escape') { this.draft = null; this.setTool('cursor'); this.lockChart(false); }
  };

  private commit(d: Drawing) {
    this.drawings.push(d); this.draft = null; this.save();
    this.select(d.id);
    if (!this.keepDrawing) { this.tool = 'cursor'; this.lockChart(false); this.onChange?.(); }
  }
  private lockChart(lock: boolean) { this.chart.applyOptions({ handleScroll: !lock, handleScale: !lock }); }

  // ---------- hit testing ----------
  private hitTest(px: number, py: number): { id: string; idx: number } | null {
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i]; const segs = this.screenSegs(d); const pts = d.anchors.map(a => this.pt(a));
      for (let k = 0; k < pts.length; k++) { const q = pts[k]; if (q && Math.hypot(q.x - px, q.y - py) <= ANCHOR_R + 3) return { id: d.id, idx: k }; }
      for (const s of segs) if (this.distSeg(px, py, s.a.x, s.a.y, s.b.x, s.b.y) <= HIT + d.width) return { id: d.id, idx: -1 };
    }
    return null;
  }
  private screenSegs(d: Drawing): { a: { x: number; y: number }; b: { x: number; y: number } }[] {
    const W = this.plotW(), H = this.plotH(); const P = d.anchors.map(a => this.pt(a));
    const out: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
    const seg = (a: any, b: any) => { if (a && b) out.push({ a, b }); };
    if (d.type === 'hline' && P[0]) seg({ x: 0, y: P[0].y }, { x: W, y: P[0].y });
    else if (d.type === 'vline' && P[0]) seg({ x: P[0].x, y: 0 }, { x: P[0].x, y: H });
    else if (d.type === 'rect' && P[0] && P[1]) { seg(P[0], { x: P[1].x, y: P[0].y }); seg({ x: P[1].x, y: P[0].y }, P[1]); seg(P[1], { x: P[0].x, y: P[1].y }); seg({ x: P[0].x, y: P[1].y }, P[0]); }
    else if (d.type === 'brush') for (let i = 1; i < P.length; i++) seg(P[i - 1], P[i]);
    else if ((d.type === 'ray' || d.type === 'extended') && P[0] && P[1]) { const e = this.extend(P[0], P[1], d.type, W); seg(e.a, e.b); }
    else if (d.type === 'text' && P[0]) seg({ x: P[0].x - 6, y: P[0].y }, { x: P[0].x + 40, y: P[0].y });
    else if (P[0] && P[1]) seg(P[0], P[1]); // trend / fib / measure baseline
    return out;
  }
  private extend(a: { x: number; y: number }, b: { x: number; y: number }, type: ToolType, W: number) {
    const dx = b.x - a.x, dy = b.y - a.y; const big = 1e5; const dir = dx === 0 && dy === 0 ? { x: 1, y: 0 } : { x: dx, y: dy };
    const end = { x: a.x + dir.x * big, y: a.y + dir.y * big };
    const start = type === 'extended' ? { x: a.x - dir.x * big, y: a.y - dir.y * big } : a;
    return { a: start, b: end };
  }
  private distSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1, dy = y2 - y1; const l2 = dx * dx + dy * dy; if (!l2) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  // ---------- render ----------
  private render() {
    const ctx = this.ctx; const W = this.plotW(), H = this.plotH();
    if (this.canvas.style.width !== W + 'px') this.resize();
    ctx.clearRect(0, 0, W, H);
    const all = this.draft ? [...this.drawings, this.draft] : this.drawings;
    for (const d of all) this.drawOne(ctx, d, W, H, d.id === this.selectedId);
  }
  private drawOne(ctx: CanvasRenderingContext2D, d: Drawing, W: number, H: number, sel: boolean) {
    const P = d.anchors.map(a => this.pt(a)); if (P.some(p => p == null) && d.type !== 'hline' && d.type !== 'vline') { if (!P[0]) return; }
    ctx.lineWidth = d.width; ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
    const line = (a: any, b: any) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };

    if (d.type === 'hline' && P[0]) { line({ x: 0, y: P[0].y }, { x: W, y: P[0].y }); this.tag(ctx, W - 4, P[0].y, this.fmt(d.anchors[0].price), d.color, 'right'); }
    else if (d.type === 'vline' && P[0]) { line({ x: P[0].x, y: 0 }, { x: P[0].x, y: H }); }
    else if (d.type === 'trend' && P[0] && P[1]) { line(P[0], P[1]); }
    else if ((d.type === 'ray' || d.type === 'extended') && P[0] && P[1]) { const e = this.extend(P[0], P[1], d.type, W); line(e.a, e.b); }
    else if (d.type === 'rect' && P[0] && P[1]) { ctx.globalAlpha = 0.10; ctx.fillRect(P[0].x, P[0].y, P[1].x - P[0].x, P[1].y - P[0].y); ctx.globalAlpha = 1; ctx.strokeRect(P[0].x, P[0].y, P[1].x - P[0].x, P[1].y - P[0].y); }
    else if (d.type === 'brush') { ctx.beginPath(); P.forEach((q, i) => q && (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); }
    else if (d.type === 'text' && P[0]) { ctx.font = '13px -apple-system, Segoe UI, sans-serif'; ctx.fillText(d.text || '', P[0].x + 4, P[0].y - 4); }
    else if (d.type === 'fib' && P[0] && P[1]) this.drawFib(ctx, d, P[0], P[1], W);
    else if (d.type === 'measure' && P[0] && P[1]) this.drawMeasure(ctx, d, P[0], P[1]);

    if (sel) for (const q of P) if (q) { ctx.fillStyle = '#fff'; ctx.strokeStyle = d.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, ANCHOR_R, 0, 7); ctx.fill(); ctx.stroke(); }
  }
  private drawFib(ctx: CanvasRenderingContext2D, d: Drawing, a: { x: number; y: number }, b: { x: number; y: number }, W: number) {
    const colors = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#2962ff'];
    const p0 = d.anchors[0].price, p1 = d.anchors[1].price; const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
    let prevY: number | null = null;
    FIB_LEVELS.forEach((lv, i) => {
      const price = p0 + (p1 - p0) * lv; const y = this.y(price); if (y == null) return;
      ctx.strokeStyle = colors[i % colors.length]; ctx.fillStyle = colors[i % colors.length]; ctx.lineWidth = 1;
      if (prevY != null) { ctx.globalAlpha = 0.06; ctx.fillRect(left, Math.min(prevY, y), right - left, Math.abs(y - prevY)); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.fillText(`${lv.toFixed(3)}  ${this.fmt(price)}`, left + 4, y - 3); prevY = y;
    });
    ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  private drawMeasure(ctx: CanvasRenderingContext2D, d: Drawing, a: { x: number; y: number }, b: { x: number; y: number }) {
    const up = d.anchors[1].price >= d.anchors[0].price; const col = up ? '#089981' : '#f23645';
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.globalAlpha = 0.12; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.globalAlpha = 1;
    ctx.lineWidth = 1; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    const dPrice = d.anchors[1].price - d.anchors[0].price; const pct = (dPrice / d.anchors[0].price) * 100; const bars = Math.round(d.anchors[1].logical - d.anchors[0].logical);
    const label = `${dPrice >= 0 ? '+' : ''}${this.fmt(dPrice)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)  ${Math.abs(bars)} bars`;
    const mx = (a.x + b.x) / 2, my = b.y + (up ? 16 : -8); ctx.font = '12px -apple-system, Segoe UI, sans-serif';
    const w = ctx.measureText(label).width + 14; ctx.fillStyle = col; this.rrect(ctx, mx - w / 2, my - 11, w, 20, 5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, mx, my + 3); ctx.textAlign = 'left';
  }
  private tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, align: 'left' | 'right') {
    ctx.font = '11px ui-monospace, monospace'; const w = ctx.measureText(text).width + 10; const bx = align === 'right' ? x - w : x;
    ctx.fillStyle = color; this.rrect(ctx, bx, y - 9, w, 18, 4); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(text, bx + 5, y + 4);
  }
  private rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  private fmt(v: number) { return v.toFixed(2); }

  // ---------- persistence ----------
  private save() { try { localStorage.setItem(this.storeKey, JSON.stringify(this.drawings)); } catch { /* ignore */ } this.onChange?.(); }
  private load() { try { const s = localStorage.getItem(this.storeKey); if (s) this.drawings = JSON.parse(s); } catch { /* ignore */ } }
}
