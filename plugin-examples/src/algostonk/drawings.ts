// Algostonk drawing engine — a coordinate-synced overlay-canvas layer over a Lightweight Charts pane.
// Drawings live in DATA space (logical bar index + price) so they stick to the chart through pan/zoom; every animation
// frame we project them to pixels via the chart's time/price scales and repaint.
//
// Interaction model = TradingView: drawing tools are CLICK-TO-PLACE (click each point; the mouse previews the next
// point; click again to fix it). Between clicks the chart stays fully pannable/zoomable (drags pan; only clicks place
// points) — mobile-friendly. Hold Ctrl while placing to snap a segment to the horizontal/vertical axis. Magnet snaps to
// OHLC. Brush is the one drag tool. Cursor mode drags to move/edit existing drawings. Esc / right-click cancels a draft.
import type { IChartApi, ISeriesApi, Logical } from 'lightweight-charts';

export type ToolType =
  | 'cursor' | 'trend' | 'ray' | 'extended' | 'hline' | 'vline'
  | 'rect' | 'fib' | 'measure' | 'brush' | 'text' | 'channel';

export interface Anchor { logical: number; price: number; }
export interface Drawing { id: string; type: ToolType; anchors: Anchor[]; color: string; width: number; text?: string; }
export interface Bar { time: unknown; open: number; high: number; low: number; close: number; }

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const POINTS: Record<string, number> = { trend: 2, ray: 2, extended: 2, rect: 2, fib: 2, measure: 2, channel: 3, hline: 1, vline: 1, text: 1 };
const HIT = 6, ANCHOR_R = 5, CLICK_SLOP = 5;

let _id = 0;
const uid = () => `d${++_id}_${Math.floor(performance.now())}`;

export class DrawingEngine {
  private canvas: HTMLCanvasElement; private ctx: CanvasRenderingContext2D;
  private chart: IChartApi; private series: ISeriesApi<'Candlestick'>; private stage: HTMLElement;
  private bars: Bar[]; private storeKey: string;

  drawings: Drawing[] = [];
  tool: ToolType = 'cursor';
  color = '#2962ff'; width = 2; magnet = false; keepDrawing = false;
  selectedId: string | null = null;

  private draft: Drawing | null = null;            // in-progress click-to-place / brush drawing
  private down: { x: number; y: number } | null = null; // pointer-down pos (click-vs-drag discrimination)
  private drag: { id: string; idx: number; orig: Anchor[]; from: Anchor } | null = null;
  onChange?: () => void;

  constructor(opts: { canvas: HTMLCanvasElement; chart: IChartApi; series: ISeriesApi<'Candlestick'>; stage: HTMLElement; bars: Bar[]; storeKey: string; }) {
    this.canvas = opts.canvas; this.ctx = opts.canvas.getContext('2d')!;
    this.chart = opts.chart; this.series = opts.series; this.stage = opts.stage; this.bars = opts.bars; this.storeKey = opts.storeKey;
    this.load(); this.resize();
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.stage.addEventListener('pointerdown', this.onDown, true);
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('keydown', this.onKey);
    this.stage.addEventListener('contextmenu', this.onCtx);
    const loop = () => { this.render(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  }

  setTool(t: ToolType) { this.cancelDraft(); this.tool = t; if (t !== 'cursor') this.select(null); this.stage.style.cursor = t === 'cursor' ? 'default' : 'crosshair'; this.onChange?.(); }
  setColor(c: string) { this.color = c; const d = this.selected(); if (d) { d.color = c; this.save(); } }
  setWidth(w: number) { this.width = w; const d = this.selected(); if (d) { d.width = w; this.save(); } }
  selected() { return this.drawings.find(d => d.id === this.selectedId) || null; }
  select(id: string | null) { this.selectedId = id; this.onChange?.(); }
  clearAll() { this.drawings = []; this.cancelDraft(); this.select(null); this.save(); }
  deleteSelected() { if (this.selectedId) { this.drawings = this.drawings.filter(d => d.id !== this.selectedId); this.select(null); this.save(); } }
  private cancelDraft() { if (this.draft) { this.draft = null; this.lockChart(false); } }

  // ---------- projection ----------
  private dpr() { return window.devicePixelRatio || 1; }
  private plotW() { return this.chart.timeScale().width(); }
  private plotH() { return this.stage.clientHeight - this.chart.timeScale().height(); }
  private resize() { const w = this.plotW(), h = this.plotH(), r = this.dpr();
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; this.canvas.width = Math.round(w * r); this.canvas.height = Math.round(h * r); this.ctx.setTransform(r, 0, 0, r, 0, 0); }
  private x(l: number) { const c = this.chart.timeScale().logicalToCoordinate(l as Logical); return c == null ? null : c; }
  private y(p: number) { const c = this.series.priceToCoordinate(p); return c == null ? null : c; }
  private toLogical(px: number) { return (this.chart.timeScale().coordinateToLogical(px) as number) ?? 0; }
  private toPrice(py: number) { return (this.series.coordinateToPrice(py) as number) ?? 0; }
  private pt(a: Anchor) { const x = this.x(a.logical), y = this.y(a.price); return x == null || y == null ? null : { x, y }; }
  private pointer(e: PointerEvent) { const r = this.stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  private anchorAt(px: number, py: number, magnet = this.magnet): Anchor {
    let logical = this.toLogical(px), price = this.toPrice(py);
    if (magnet) { const b = this.bars[Math.round(logical)]; if (b) { const c = [b.open, b.high, b.low, b.close]; price = c.reduce((p, v) => Math.abs(v - price) < Math.abs(p - price) ? v : p, c[0]); } }
    return { logical, price };
  }
  // magnet snap + Ctrl axis-snap (segment from `prev` goes horizontal or vertical, whichever is closer on screen)
  private snap(px: number, py: number, prev: Anchor | undefined, ctrl: boolean): Anchor {
    const a = this.anchorAt(px, py, this.magnet && !ctrl);
    if (ctrl && prev) { const pv = this.pt(prev); if (pv) { if (Math.abs(px - pv.x) >= Math.abs(py - pv.y)) a.price = prev.price; else a.logical = prev.logical; } }
    return a;
  }

  // ---------- interaction (click-to-place) ----------
  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const p = this.pointer(e); if (p.x > this.plotW() || p.y > this.plotH()) return;
    this.down = { x: p.x, y: p.y };
    if (this.tool === 'cursor') {
      const hit = this.hitTest(p.x, p.y);
      if (hit) { e.stopPropagation(); e.preventDefault(); this.select(hit.id); this.lockChart(true);
        this.drag = { id: hit.id, idx: hit.idx, orig: this.drawings.find(d => d.id === hit.id)!.anchors.map(a => ({ ...a })), from: this.anchorAt(p.x, p.y, false) }; }
      else this.select(null);
    } else if (this.tool === 'brush') {
      e.stopPropagation(); e.preventDefault(); this.lockChart(true);
      this.draft = { id: uid(), type: 'brush', anchors: [this.anchorAt(p.x, p.y, false)], color: this.color, width: this.width };
    }
    // click-to-place tools: do NOT intercept on down — let the chart pan on drag; placement happens on click (onUp).
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointer(e);
    if (this.drag) { const now = this.anchorAt(p.x, p.y, false); const d = this.drawings.find(x => x.id === this.drag!.id); if (!d) return;
      const dl = now.logical - this.drag.from.logical, dp = now.price - this.drag.from.price;
      if (this.drag.idx === -1) d.anchors = this.drag.orig.map(o => ({ logical: o.logical + dl, price: o.price + dp }));
      else { const o = this.drag.orig[this.drag.idx]; d.anchors[this.drag.idx] = { logical: o.logical + dl, price: o.price + dp }; } }
    else if (this.draft && this.draft.type === 'brush' && (e.buttons & 1)) { this.draft.anchors.push(this.anchorAt(p.x, p.y, false)); }
    else if (this.draft && e.buttons === 0) { const i = this.draft.anchors.length - 1; this.draft.anchors[i] = this.snap(p.x, p.y, this.draft.anchors[i - 1], e.ctrlKey); }
    else if (this.tool === 'cursor' && !this.drag) { this.stage.style.cursor = this.hitTest(p.x, p.y) ? 'pointer' : 'default'; }
  };

  private onUp = (e: PointerEvent) => {
    const p = this.pointer(e); const moved = this.down ? Math.hypot(p.x - this.down.x, p.y - this.down.y) : 99; this.down = null;
    if (this.drag) { this.drag = null; this.save(); this.lockChart(false); return; }
    if (this.draft && this.draft.type === 'brush') { if (this.draft.anchors.length >= 2) this.commit(this.draft); else this.cancelDraft(); return; }
    if (this.tool !== 'cursor' && this.tool !== 'brush' && moved < CLICK_SLOP) this.place(p.x, p.y, e.ctrlKey);
  };

  private place(px: number, py: number, ctrl: boolean) {
    const n = POINTS[this.tool] ?? 2;
    if (!this.draft) {
      const a = this.anchorAt(px, py, this.magnet && !ctrl);
      if (n === 1) { const text = this.tool === 'text' ? (window.prompt('Text:', 'Note') || undefined) : undefined; if (this.tool === 'text' && !text) return; this.commit({ id: uid(), type: this.tool, anchors: [a], color: this.color, width: this.width, text }); return; }
      this.draft = { id: uid(), type: this.tool, anchors: [a, { ...a }], color: this.color, width: this.width }; this.onChange?.();
    } else {
      const i = this.draft.anchors.length - 1; this.draft.anchors[i] = this.snap(px, py, this.draft.anchors[i - 1], ctrl);
      if (this.draft.anchors.length >= n) this.commit(this.draft);
      else this.draft.anchors.push({ ...this.draft.anchors[i] });
    }
  }
  private commit(d: Drawing) { this.drawings.push(d); this.draft = null; this.lockChart(false); this.save(); this.select(d.id); if (!this.keepDrawing) { this.tool = 'cursor'; this.stage.style.cursor = 'default'; this.onChange?.(); } }
  private lockChart(lock: boolean) { this.chart.applyOptions({ handleScroll: !lock, handleScale: !lock }); }
  private onKey = (e: KeyboardEvent) => { if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) this.deleteSelected(); if (e.key === 'Escape') { this.cancelDraft(); this.setTool('cursor'); } };
  private onCtx = (e: MouseEvent) => { if (this.draft) { e.preventDefault(); this.cancelDraft(); } };

  // ---------- hit testing ----------
  private hitTest(px: number, py: number): { id: string; idx: number } | null {
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i]; const pts = d.anchors.map(a => this.pt(a));
      for (let k = 0; k < pts.length; k++) { const q = pts[k]; if (q && Math.hypot(q.x - px, q.y - py) <= ANCHOR_R + 3) return { id: d.id, idx: k }; }
      for (const s of this.screenSegs(d)) if (this.distSeg(px, py, s.a.x, s.a.y, s.b.x, s.b.y) <= HIT + d.width) return { id: d.id, idx: -1 };
    }
    return null;
  }
  private screenSegs(d: Drawing) {
    const W = this.plotW(), H = this.plotH(); const P = d.anchors.map(a => this.pt(a));
    const out: { a: { x: number; y: number }; b: { x: number; y: number } }[] = []; const seg = (a: any, b: any) => { if (a && b) out.push({ a, b }); };
    if (d.type === 'hline' && P[0]) seg({ x: 0, y: P[0].y }, { x: W, y: P[0].y });
    else if (d.type === 'vline' && P[0]) seg({ x: P[0].x, y: 0 }, { x: P[0].x, y: H });
    else if (d.type === 'rect' && P[0] && P[1]) { seg(P[0], { x: P[1].x, y: P[0].y }); seg({ x: P[1].x, y: P[0].y }, P[1]); seg(P[1], { x: P[0].x, y: P[1].y }); seg({ x: P[0].x, y: P[1].y }, P[0]); }
    else if (d.type === 'channel' && P[0] && P[1] && P[2]) { const m = this.slope(P[0], P[1]); const yy = (x: number) => P[2]!.y + m * (x - P[2]!.x); seg(P[0], P[1]); seg({ x: P[0].x, y: yy(P[0].x) }, { x: P[1].x, y: yy(P[1].x) }); }
    else if (d.type === 'brush') for (let i = 1; i < P.length; i++) seg(P[i - 1], P[i]);
    else if ((d.type === 'ray' || d.type === 'extended') && P[0] && P[1]) { const e = this.extend(P[0], P[1], d.type); seg(e.a, e.b); }
    else if (d.type === 'text' && P[0]) seg({ x: P[0].x - 6, y: P[0].y }, { x: P[0].x + 40, y: P[0].y });
    else if (P[0] && P[1]) seg(P[0], P[1]);
    return out;
  }
  private slope(a: { x: number; y: number }, b: { x: number; y: number }) { return (b.x - a.x) === 0 ? 0 : (b.y - a.y) / (b.x - a.x); }
  private extend(a: { x: number; y: number }, b: { x: number; y: number }, type: ToolType) { const big = 1e5; const dx = b.x - a.x, dy = b.y - a.y; const dir = dx === 0 && dy === 0 ? { x: 1, y: 0 } : { x: dx, y: dy }; return { a: type === 'extended' ? { x: a.x - dir.x * big, y: a.y - dir.y * big } : a, b: { x: a.x + dir.x * big, y: a.y + dir.y * big } }; }
  private distSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number) { const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy; if (!l2) return Math.hypot(px - x1, py - y1); let t = ((px - x1) * dx + (py - y1) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)); }

  // ---------- render ----------
  private render() { const ctx = this.ctx, W = this.plotW(), H = this.plotH(); if (this.canvas.style.width !== W + 'px') this.resize(); ctx.clearRect(0, 0, W, H); const all = this.draft ? [...this.drawings, this.draft] : this.drawings; for (const d of all) this.drawOne(ctx, d, W, H, d.id === this.selectedId); }
  private drawOne(ctx: CanvasRenderingContext2D, d: Drawing, W: number, H: number, sel: boolean) {
    const P = d.anchors.map(a => this.pt(a)); if (!P[0] && d.type !== 'hline' && d.type !== 'vline') return;
    ctx.lineWidth = d.width; ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
    const line = (a: any, b: any) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    if (d.type === 'hline' && P[0]) { line({ x: 0, y: P[0].y }, { x: W, y: P[0].y }); this.tag(ctx, W - 4, P[0].y, this.fmt(d.anchors[0].price), d.color); }
    else if (d.type === 'vline' && P[0]) line({ x: P[0].x, y: 0 }, { x: P[0].x, y: H });
    else if (d.type === 'trend' && P[0] && P[1]) line(P[0], P[1]);
    else if ((d.type === 'ray' || d.type === 'extended') && P[0] && P[1]) { const e = this.extend(P[0], P[1], d.type); line(e.a, e.b); }
    else if (d.type === 'rect' && P[0] && P[1]) { ctx.globalAlpha = 0.10; ctx.fillRect(P[0].x, P[0].y, P[1].x - P[0].x, P[1].y - P[0].y); ctx.globalAlpha = 1; ctx.strokeRect(P[0].x, P[0].y, P[1].x - P[0].x, P[1].y - P[0].y); }
    else if (d.type === 'channel') { if (P[0] && P[1] && P[2]) this.drawChannel(ctx, d, P[0], P[1], P[2]); else if (P[0] && P[1]) line(P[0], P[1]); }
    else if (d.type === 'brush') { ctx.beginPath(); P.forEach((q, i) => q && (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); }
    else if (d.type === 'text' && P[0]) { ctx.font = '13px -apple-system, Segoe UI, sans-serif'; ctx.fillText(d.text || '', P[0].x + 4, P[0].y - 4); }
    else if (d.type === 'fib' && P[0] && P[1]) this.drawFib(ctx, d, P[0], P[1]);
    else if (d.type === 'measure' && P[0] && P[1]) this.drawMeasure(ctx, d, P[0], P[1]);
    if (sel) for (const q of P) if (q) { ctx.fillStyle = '#fff'; ctx.strokeStyle = d.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, ANCHOR_R, 0, 7); ctx.fill(); ctx.stroke(); }
  }
  private drawChannel(ctx: CanvasRenderingContext2D, d: Drawing, p0: any, p1: any, p2: any) {
    const m = this.slope(p0, p1); const yy = (x: number) => p2.y + m * (x - p2.x); const a2 = { x: p0.x, y: yy(p0.x) }, b2 = { x: p1.x, y: yy(p1.x) };
    ctx.fillStyle = d.color; ctx.globalAlpha = 0.09; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(a2.x, a2.y); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
    ctx.setLineDash([5, 4]); ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.moveTo(p0.x, (p0.y + a2.y) / 2); ctx.lineTo(p1.x, (p1.y + b2.y) / 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  private drawFib(ctx: CanvasRenderingContext2D, d: Drawing, a: any, b: any) {
    const colors = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#2962ff']; const p0 = d.anchors[0].price, p1 = d.anchors[1].price; const L = Math.min(a.x, b.x), R = Math.max(a.x, b.x); let prevY: number | null = null;
    FIB_LEVELS.forEach((lv, i) => { const price = p0 + (p1 - p0) * lv; const y = this.y(price); if (y == null) return; ctx.strokeStyle = colors[i % colors.length]; ctx.fillStyle = colors[i % colors.length]; ctx.lineWidth = 1;
      if (prevY != null) { ctx.globalAlpha = 0.06; ctx.fillRect(L, Math.min(prevY, y), R - L, Math.abs(y - prevY)); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); ctx.fillText(`${lv.toFixed(3)}  ${this.fmt(price)}`, L + 4, y - 3); prevY = y; });
    ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  private drawMeasure(ctx: CanvasRenderingContext2D, d: Drawing, a: any, b: any) {
    const up = d.anchors[1].price >= d.anchors[0].price; const col = up ? '#089981' : '#f23645'; ctx.fillStyle = col; ctx.strokeStyle = col; ctx.globalAlpha = 0.12; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.globalAlpha = 1; ctx.lineWidth = 1; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    const dPrice = d.anchors[1].price - d.anchors[0].price, pct = (dPrice / d.anchors[0].price) * 100, bars = Math.round(d.anchors[1].logical - d.anchors[0].logical);
    const label = `${dPrice >= 0 ? '+' : ''}${this.fmt(dPrice)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)  ${Math.abs(bars)} bars`; const mx = (a.x + b.x) / 2, my = b.y + (up ? 16 : -8); ctx.font = '12px -apple-system, Segoe UI, sans-serif';
    const w = ctx.measureText(label).width + 14; ctx.fillStyle = col; this.rrect(ctx, mx - w / 2, my - 11, w, 20, 5); ctx.fill(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, mx, my + 3); ctx.textAlign = 'left';
  }
  private tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) { ctx.font = '11px ui-monospace, monospace'; const w = ctx.measureText(text).width + 10; const bx = x - w; ctx.fillStyle = color; this.rrect(ctx, bx, y - 9, w, 18, 4); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(text, bx + 5, y + 4); }
  private rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  private fmt(v: number) { return v.toFixed(2); }

  // ---------- persistence ----------
  private save() { try { localStorage.setItem(this.storeKey, JSON.stringify(this.drawings)); } catch { /* ignore */ } this.onChange?.(); }
  private load() { try { const s = localStorage.getItem(this.storeKey); if (s) this.drawings = JSON.parse(s); } catch { /* ignore */ } }
}
