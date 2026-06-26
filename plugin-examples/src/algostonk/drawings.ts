// Algostonk drawing engine — coordinate-synced overlay-canvas layer over a Lightweight Charts pane.
// Drawings live in DATA space (logical bar index + price) and are projected to pixels every frame so they track the
// chart through pan/zoom. Interaction = TradingView: CLICK-TO-PLACE (click each point; mouse previews the next; click to
// fix). Chart stays pannable between clicks (drags pan; only clicks place points). Ctrl snaps a segment to H/V; Magnet
// snaps to OHLC. Brush/Highlighter are drags; Polyline finishes on double-click. Cursor mode drags to move/edit.
import type { IChartApi, ISeriesApi, Logical } from 'lightweight-charts';

export type ToolType =
  | 'cursor'
  | 'trend' | 'ray' | 'extended' | 'info' | 'trendangle' | 'hline' | 'vline' | 'hray' | 'crossline' | 'arrow'
  | 'channel' | 'regression' | 'disjoint' | 'pitchfork'
  | 'rect' | 'circle' | 'ellipse' | 'triangle' | 'arc' | 'polyline'
  | 'fib' | 'fibext' | 'fibtime' | 'fibchannel' | 'gannfan' | 'gannbox' | 'measure' | 'longpos' | 'shortpos' | 'pricerange'
  | 'brush' | 'highlighter' | 'text' | 'callout' | 'note' | 'pricelabel' | 'arrowup' | 'arrowdown'
  | 'xabcd' | 'abcd' | 'hs' | 'tripattern' | 'threedrives'
  | 'ell5' | 'ellabc' | 'ellabcde'
  | 'cyclic' | 'sine';

export interface Anchor { logical: number; price: number; }
export interface Drawing { id: string; type: ToolType; anchors: Anchor[]; color: string; width: number; text?: string; }
export interface Bar { time: unknown; open: number; high: number; low: number; close: number; }

const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COL = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#2962ff'];
// required click-points per tool (drag tools + variable handled separately); 99 = variable (finish on double-click)
const POINTS: Record<string, number> = {
  trend: 2, ray: 2, extended: 2, info: 2, trendangle: 2, arrow: 2, hline: 1, vline: 1, hray: 1, crossline: 1,
  channel: 3, regression: 2, disjoint: 4, pitchfork: 3,
  rect: 2, circle: 2, ellipse: 2, triangle: 3, arc: 3, polyline: 99,
  fib: 2, fibext: 3, fibtime: 2, fibchannel: 3, gannfan: 2, gannbox: 2, measure: 2, longpos: 2, shortpos: 2, pricerange: 2,
  text: 1, callout: 1, note: 1, pricelabel: 1, arrowup: 1, arrowdown: 1,
  xabcd: 5, abcd: 4, hs: 6, tripattern: 4, threedrives: 7, ell5: 6, ellabc: 4, ellabcde: 6,
  cyclic: 2, sine: 2,
};
// vertex labels for pattern / Elliott tools (rendered via the labeled-path helper)
const LABELS: Partial<Record<ToolType, string[]>> = {
  xabcd: ['X', 'A', 'B', 'C', 'D'], abcd: ['A', 'B', 'C', 'D'], hs: ['', 'LS', '', 'H', '', 'RS'],
  tripattern: ['A', 'B', 'C', 'D'], threedrives: ['', '1', 'A', '2', 'B', '3', ''],
  ell5: ['', '1', '2', '3', '4', '5'], ellabc: ['', 'A', 'B', 'C'], ellabcde: ['', 'A', 'B', 'C', 'D', 'E'],
};
const HIT = 6, ANCHOR_R = 5, CLICK_SLOP = 5;
let _id = 0;
const uid = () => `d${++_id}_${Math.floor(performance.now())}`;
type P = { x: number; y: number };

export class DrawingEngine {
  private canvas: HTMLCanvasElement; private ctx: CanvasRenderingContext2D;
  private chart: IChartApi; private series: ISeriesApi<'Candlestick'>; private stage: HTMLElement;
  private bars: Bar[]; private storeKey: string;

  drawings: Drawing[] = [];
  tool: ToolType = 'cursor';
  color = '#2962ff'; width = 2; magnet = false; keepDrawing = false;
  selectedId: string | null = null;
  onChange?: () => void;

  private draft: Drawing | null = null;
  private down: P | null = null;
  private drag: { id: string; idx: number; orig: Anchor[]; from: Anchor } | null = null;

  constructor(o: { canvas: HTMLCanvasElement; chart: IChartApi; series: ISeriesApi<'Candlestick'>; stage: HTMLElement; bars: Bar[]; storeKey: string; }) {
    this.canvas = o.canvas; this.ctx = o.canvas.getContext('2d')!; this.chart = o.chart; this.series = o.series; this.stage = o.stage; this.bars = o.bars; this.storeKey = o.storeKey;
    this.load(); this.resize();
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.stage.addEventListener('pointerdown', this.onDown, true);
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('keydown', this.onKey);
    this.stage.addEventListener('contextmenu', this.onCtx);
    this.stage.addEventListener('dblclick', this.onDbl, true);
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
  private resize() { const w = this.plotW(), h = this.plotH(), r = this.dpr(); this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; this.canvas.width = Math.round(w * r); this.canvas.height = Math.round(h * r); this.ctx.setTransform(r, 0, 0, r, 0, 0); }
  private x(l: number) { const c = this.chart.timeScale().logicalToCoordinate(l as Logical); return c == null ? null : c; }
  private y(p: number) { const c = this.series.priceToCoordinate(p); return c == null ? null : c; }
  private toLogical(px: number) { return (this.chart.timeScale().coordinateToLogical(px) as number) ?? 0; }
  private toPrice(py: number) { return (this.series.coordinateToPrice(py) as number) ?? 0; }
  private pt(a: Anchor): P | null { const x = this.x(a.logical), y = this.y(a.price); return x == null || y == null ? null : { x, y }; }
  private pointer(e: PointerEvent | MouseEvent) { const r = this.stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  private anchorAt(px: number, py: number, magnet = this.magnet): Anchor { let logical = this.toLogical(px), price = this.toPrice(py); if (magnet) { const b = this.bars[Math.round(logical)]; if (b) { const c = [b.open, b.high, b.low, b.close]; price = c.reduce((p, v) => Math.abs(v - price) < Math.abs(p - price) ? v : p, c[0]); } } return { logical, price }; }
  private snap(px: number, py: number, prev: Anchor | undefined, ctrl: boolean): Anchor { const a = this.anchorAt(px, py, this.magnet && !ctrl); if (ctrl && prev) { const pv = this.pt(prev); if (pv) { if (Math.abs(px - pv.x) >= Math.abs(py - pv.y)) a.price = prev.price; else a.logical = prev.logical; } } return a; }
  private isDrag(t: ToolType) { return t === 'brush' || t === 'highlighter'; }

  // ---------- interaction ----------
  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return; const p = this.pointer(e); if (p.x > this.plotW() || p.y > this.plotH()) return; this.down = p;
    if (this.tool === 'cursor') {
      const hit = this.hitTest(p.x, p.y);
      if (hit) { e.stopPropagation(); e.preventDefault(); this.select(hit.id); this.lockChart(true); this.drag = { id: hit.id, idx: hit.idx, orig: this.drawings.find(d => d.id === hit.id)!.anchors.map(a => ({ ...a })), from: this.anchorAt(p.x, p.y, false) }; }
      else this.select(null);
    } else if (this.isDrag(this.tool)) { e.stopPropagation(); e.preventDefault(); this.lockChart(true); this.draft = { id: uid(), type: this.tool, anchors: [this.anchorAt(p.x, p.y, false)], color: this.color, width: this.tool === 'highlighter' ? Math.max(8, this.width * 4) : this.width }; }
  };
  private onMove = (e: PointerEvent) => {
    const p = this.pointer(e);
    if (this.drag) { const now = this.anchorAt(p.x, p.y, false); const d = this.drawings.find(x => x.id === this.drag!.id); if (!d) return; const dl = now.logical - this.drag.from.logical, dp = now.price - this.drag.from.price; if (this.drag.idx === -1) d.anchors = this.drag.orig.map(o => ({ logical: o.logical + dl, price: o.price + dp })); else { const o = this.drag.orig[this.drag.idx]; d.anchors[this.drag.idx] = { logical: o.logical + dl, price: o.price + dp }; } }
    else if (this.draft && this.isDrag(this.draft.type) && (e.buttons & 1)) { this.draft.anchors.push(this.anchorAt(p.x, p.y, false)); }
    else if (this.draft && e.buttons === 0) { const i = this.draft.anchors.length - 1; this.draft.anchors[i] = this.snap(p.x, p.y, this.draft.anchors[i - 1], e.ctrlKey); }
    else if (this.tool === 'cursor' && !this.drag) { this.stage.style.cursor = this.hitTest(p.x, p.y) ? 'pointer' : 'default'; }
  };
  private onUp = (e: PointerEvent) => {
    const p = this.pointer(e); const moved = this.down ? Math.hypot(p.x - this.down.x, p.y - this.down.y) : 99; this.down = null;
    if (this.drag) { this.drag = null; this.save(); this.lockChart(false); return; }
    if (this.draft && this.isDrag(this.draft.type)) { if (this.draft.anchors.length >= 2) this.commit(this.draft); else this.cancelDraft(); return; }
    if (this.tool !== 'cursor' && !this.isDrag(this.tool) && moved < CLICK_SLOP) this.place(p.x, p.y, e.ctrlKey);
  };
  private onDbl = (e: MouseEvent) => { if (this.draft && this.draft.type === 'polyline') { e.preventDefault(); e.stopPropagation(); if (this.draft.anchors.length >= 3) { this.draft.anchors.pop(); this.commit(this.draft); } else this.cancelDraft(); } };
  private onKey = (e: KeyboardEvent) => { if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) this.deleteSelected(); if (e.key === 'Escape') { this.cancelDraft(); this.setTool('cursor'); } };
  private onCtx = (e: MouseEvent) => { if (this.draft) { e.preventDefault(); this.cancelDraft(); } };

  private place(px: number, py: number, ctrl: boolean) {
    const n = POINTS[this.tool] ?? 2;
    if (!this.draft) {
      const a = this.anchorAt(px, py, this.magnet && !ctrl);
      if (n === 1) { let text: string | undefined; if (this.tool === 'text' || this.tool === 'callout' || this.tool === 'note') { text = window.prompt('Text:', 'Note') || undefined; if (!text) return; } this.commit({ id: uid(), type: this.tool, anchors: [a], color: this.color, width: this.width, text }); return; }
      this.draft = { id: uid(), type: this.tool, anchors: [a, { ...a }], color: this.color, width: this.width }; this.onChange?.();
    } else {
      const i = this.draft.anchors.length - 1; this.draft.anchors[i] = this.snap(px, py, this.draft.anchors[i - 1], ctrl);
      if (this.draft.anchors.length >= n) this.commit(this.draft); else this.draft.anchors.push({ ...this.draft.anchors[i] });
    }
  }
  private commit(d: Drawing) { this.drawings.push(d); this.draft = null; this.lockChart(false); this.save(); this.select(d.id); if (!this.keepDrawing) { this.tool = 'cursor'; this.stage.style.cursor = 'default'; this.onChange?.(); } }
  private lockChart(lock: boolean) { this.chart.applyOptions({ handleScroll: !lock, handleScale: !lock }); }

  // ---------- hit testing ----------
  private hitTest(px: number, py: number): { id: string; idx: number } | null {
    for (let i = this.drawings.length - 1; i >= 0; i--) { const d = this.drawings[i]; const P = d.anchors.map(a => this.pt(a));
      for (let k = 0; k < P.length; k++) { const q = P[k]; if (q && Math.hypot(q.x - px, q.y - py) <= ANCHOR_R + 3) return { id: d.id, idx: k }; }
      for (const s of this.segs(d)) if (this.dist(px, py, s.a, s.b) <= HIT + d.width) return { id: d.id, idx: -1 }; }
    return null;
  }
  private segs(d: Drawing): { a: P; b: P }[] {
    const W = this.plotW(), H = this.plotH(); const P = d.anchors.map(a => this.pt(a)); const out: { a: P; b: P }[] = []; const s = (a: P | null, b: P | null) => { if (a && b) out.push({ a, b }); };
    if ((d.type === 'hline' || d.type === 'pricelabel') && P[0]) s({ x: 0, y: P[0].y }, { x: W, y: P[0].y });
    else if (d.type === 'hray' && P[0]) s(P[0], { x: W, y: P[0].y });
    else if (d.type === 'vline' && P[0]) s({ x: P[0].x, y: 0 }, { x: P[0].x, y: H });
    else if (d.type === 'crossline' && P[0]) { s({ x: 0, y: P[0].y }, { x: W, y: P[0].y }); s({ x: P[0].x, y: 0 }, { x: P[0].x, y: H }); }
    else if ((d.type === 'rect' || d.type === 'measure' || d.type === 'longpos' || d.type === 'shortpos' || d.type === 'pricerange' || d.type === 'ellipse') && P[0] && P[1]) { s(P[0], { x: P[1].x, y: P[0].y }); s({ x: P[1].x, y: P[0].y }, P[1]); s(P[1], { x: P[0].x, y: P[1].y }); s({ x: P[0].x, y: P[1].y }, P[0]); }
    else if (d.type === 'channel' && P[0] && P[1] && P[2]) { const m = this.slope(P[0], P[1]); const yy = (x: number) => P[2]!.y + m * (x - P[2]!.x); s(P[0], P[1]); s({ x: P[0].x, y: yy(P[0].x) }, { x: P[1].x, y: yy(P[1].x) }); }
    else if ((d.type === 'ray' || d.type === 'extended' || d.type === 'hray') && P[0] && P[1]) { const e = this.ext(P[0], P[1], d.type); s(e.a, e.b); }
    else if (d.type === 'circle' && P[0] && P[1]) s({ x: P[0].x - Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y), y: P[0].y }, { x: P[0].x + Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y), y: P[0].y });
    else { for (let i = 1; i < P.length; i++) s(P[i - 1], P[i]); if (P[0] && d.anchors.length === 1) s({ x: P[0].x - 8, y: P[0].y }, { x: P[0].x + 8, y: P[0].y }); }
    return out;
  }
  private slope(a: P, b: P) { return (b.x - a.x) === 0 ? 0 : (b.y - a.y) / (b.x - a.x); }
  private ext(a: P, b: P, type: ToolType): { a: P; b: P } { if (type === 'hray') return { a, b: { x: this.plotW(), y: a.y } }; const big = 1e5, dx = b.x - a.x, dy = b.y - a.y, dir = dx === 0 && dy === 0 ? { x: 1, y: 0 } : { x: dx, y: dy }; return { a: type === 'extended' ? { x: a.x - dir.x * big, y: a.y - dir.y * big } : a, b: { x: a.x + dir.x * big, y: a.y + dir.y * big } }; }
  private dist(px: number, py: number, a: P, b: P) { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy; if (!l2) return Math.hypot(px - a.x, py - a.y); let t = ((px - a.x) * dx + (py - a.y) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)); }

  // ---------- render ----------
  private render() { const ctx = this.ctx, W = this.plotW(), H = this.plotH(); if (this.canvas.style.width !== W + 'px') this.resize(); ctx.clearRect(0, 0, W, H); const all = this.draft ? [...this.drawings, this.draft] : this.drawings; for (const d of all) this.drawOne(ctx, d, W, H, d.id === this.selectedId); }
  private drawOne(ctx: CanvasRenderingContext2D, d: Drawing, W: number, H: number, sel: boolean) {
    const P = d.anchors.map(a => this.pt(a)); if (!P[0]) return;
    ctx.lineWidth = d.width; ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
    const line = (a: P, b: P) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    const t = d.type;
    if (t === 'hline' && P[0]) { line({ x: 0, y: P[0].y }, { x: W, y: P[0].y }); this.tag(ctx, W - 4, P[0].y, this.fmt(d.anchors[0].price), d.color); }
    else if (t === 'pricelabel' && P[0]) { line({ x: 0, y: P[0].y }, { x: W, y: P[0].y }); this.tag(ctx, P[0].x, P[0].y, (d.text ? d.text + ' ' : '') + this.fmt(d.anchors[0].price), d.color, 'left'); }
    else if (t === 'hray' && P[0]) { line(P[0], { x: W, y: P[0].y }); }
    else if (t === 'vline' && P[0]) line({ x: P[0].x, y: 0 }, { x: P[0].x, y: H });
    else if (t === 'crossline' && P[0]) { line({ x: 0, y: P[0].y }, { x: W, y: P[0].y }); line({ x: P[0].x, y: 0 }, { x: P[0].x, y: H }); }
    else if ((t === 'trend') && P[0] && P[1]) line(P[0], P[1]);
    else if ((t === 'ray' || t === 'extended') && P[0] && P[1]) { const e = this.ext(P[0], P[1], t); line(e.a, e.b); }
    else if (t === 'arrow' && P[0] && P[1]) { line(P[0], P[1]); this.head(ctx, P[0], P[1]); }
    else if ((t === 'arrowup' || t === 'arrowdown') && P[0]) this.marker(ctx, P[0], t === 'arrowup');
    else if (t === 'info' && P[0] && P[1]) { line(P[0], P[1]); this.info(ctx, d, P[0], P[1]); }
    else if (t === 'trendangle' && P[0] && P[1]) { line(P[0], P[1]); const ang = -Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x) * 180 / Math.PI; this.lbl(ctx, P[1].x + 6, P[1].y, `${ang.toFixed(1)}°`, d.color); }
    else if (t === 'rect' && P[0] && P[1]) { ctx.globalAlpha = 0.10; ctx.fillRect(P[0].x, P[0].y, P[1].x - P[0].x, P[1].y - P[0].y); ctx.globalAlpha = 1; ctx.strokeRect(P[0].x, P[0].y, P[1].x - P[0].x, P[1].y - P[0].y); }
    else if (t === 'circle' && P[0] && P[1]) { const r = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y); ctx.globalAlpha = 0.08; ctx.beginPath(); ctx.arc(P[0].x, P[0].y, r, 0, 7); ctx.fill(); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(P[0].x, P[0].y, r, 0, 7); ctx.stroke(); }
    else if (t === 'ellipse' && P[0] && P[1]) { ctx.save(); ctx.translate((P[0].x + P[1].x) / 2, (P[0].y + P[1].y) / 2); ctx.scale(Math.abs(P[1].x - P[0].x) / 2 || 1, Math.abs(P[1].y - P[0].y) / 2 || 1); ctx.beginPath(); ctx.arc(0, 0, 1, 0, 7); ctx.restore(); ctx.globalAlpha = 0.08; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke(); }
    else if (t === 'triangle' && P[0] && P[1] && P[2]) { ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); ctx.lineTo(P[1].x, P[1].y); ctx.lineTo(P[2].x, P[2].y); ctx.closePath(); ctx.globalAlpha = 0.08; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke(); }
    else if (t === 'arc' && P[0] && P[1] && P[2]) { ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); ctx.quadraticCurveTo(P[1].x, P[1].y, P[2].x, P[2].y); ctx.stroke(); }
    else if (t === 'polyline') { ctx.beginPath(); P.forEach((q, i) => q && (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); }
    else if (t === 'brush' || t === 'highlighter') { if (t === 'highlighter') ctx.globalAlpha = 0.35; ctx.beginPath(); P.forEach((q, i) => q && (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); ctx.globalAlpha = 1; }
    else if (t === 'text' && P[0]) { ctx.font = '13px -apple-system, Segoe UI, sans-serif'; ctx.fillText(d.text || '', P[0].x + 4, P[0].y - 4); }
    else if ((t === 'callout' || t === 'note') && P[0]) this.callout(ctx, d, P[0]);
    else if (t === 'channel') { if (P[0] && P[1] && P[2]) this.channel(ctx, d, P[0], P[1], P[2]); else if (P[0] && P[1]) line(P[0], P[1]); }
    else if (t === 'disjoint' && P[0] && P[1]) { line(P[0], P[1]); if (P[2] && P[3]) { ctx.globalAlpha = 0.08; ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); ctx.lineTo(P[1].x, P[1].y); ctx.lineTo(P[3].x, P[3].y); ctx.lineTo(P[2].x, P[2].y); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; line(P[2], P[3]); } }
    else if (t === 'regression' && P[0] && P[1]) this.regression(ctx, d, P[0], P[1]);
    else if (t === 'pitchfork') { if (P[0] && P[1] && P[2]) this.pitchfork(ctx, d, P[0], P[1], P[2]); else if (P[0] && P[1]) line(P[0], P[1]); }
    else if (t === 'fib' && P[0] && P[1]) this.fib(ctx, d, P[0], P[1]);
    else if (t === 'fibext' && P[0] && P[1] && P[2]) this.fibExt(ctx, d, P);
    else if (t === 'fibtime' && P[0] && P[1]) this.fibTime(ctx, d, H);
    else if (t === 'fibchannel' && P[0] && P[1] && P[2]) this.fibChannel(ctx, d, P[0], P[1], P[2]);
    else if (t === 'gannfan' && P[0] && P[1]) this.gannFan(ctx, d, P[0], P[1]);
    else if (t === 'gannbox' && P[0] && P[1]) this.gannBox(ctx, d, P[0], P[1]);
    else if (t === 'measure' && P[0] && P[1]) this.measure(ctx, d, P[0], P[1]);
    else if ((t === 'longpos' || t === 'shortpos') && P[0] && P[1]) this.position(ctx, d, P[0], P[1], t === 'longpos');
    else if (t === 'pricerange' && P[0] && P[1]) this.priceRange(ctx, d, P[0], P[1]);
    else if (t === 'cyclic' && P[0] && P[1]) this.cyclic(ctx, d, P[0], P[1], H);
    else if (t === 'sine' && P[0] && P[1]) this.sine(ctx, d, P[0], P[1]);
    else if (LABELS[t]) this.labeledPath(ctx, d, P, LABELS[t]!, t === 'tripattern');
    else if (P[0] && P[1]) line(P[0], P[1]);

    if (sel) for (const q of P) if (q) { ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.strokeStyle = d.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, ANCHOR_R, 0, 7); ctx.fill(); ctx.stroke(); }
  }

  // ---------- per-tool renderers ----------
  private head(ctx: CanvasRenderingContext2D, a: P, b: P) { const ang = Math.atan2(b.y - a.y, b.x - a.x), s = 10 + this.ctx.lineWidth * 2; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - s * Math.cos(ang - 0.4), b.y - s * Math.sin(ang - 0.4)); ctx.lineTo(b.x - s * Math.cos(ang + 0.4), b.y - s * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill(); }
  private marker(ctx: CanvasRenderingContext2D, p: P, up: boolean) { const s = 9, dir = up ? 1 : -1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - s, p.y + dir * s * 1.6); ctx.lineTo(p.x - s / 2, p.y + dir * s * 1.6); ctx.lineTo(p.x - s / 2, p.y + dir * s * 2.8); ctx.lineTo(p.x + s / 2, p.y + dir * s * 2.8); ctx.lineTo(p.x + s / 2, p.y + dir * s * 1.6); ctx.lineTo(p.x + s, p.y + dir * s * 1.6); ctx.closePath(); ctx.fill(); }
  private info(ctx: CanvasRenderingContext2D, d: Drawing, a: P, b: P) { const dp = d.anchors[1].price - d.anchors[0].price, pct = dp / d.anchors[0].price * 100, bars = Math.round(d.anchors[1].logical - d.anchors[0].logical), ang = -Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; this.lbl(ctx, b.x + 8, b.y, `${dp >= 0 ? '+' : ''}${this.fmt(dp)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)  ${Math.abs(bars)} bars  ${ang.toFixed(1)}°`, d.color); }
  private channel(ctx: CanvasRenderingContext2D, d: Drawing, p0: P, p1: P, p2: P) { const m = this.slope(p0, p1), yy = (x: number) => p2.y + m * (x - p2.x), a2 = { x: p0.x, y: yy(p0.x) }, b2 = { x: p1.x, y: yy(p1.x) }; ctx.fillStyle = d.color; ctx.globalAlpha = 0.09; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(a2.x, a2.y); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = d.color; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.stroke(); ctx.setLineDash([5, 4]); ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.moveTo(p0.x, (p0.y + a2.y) / 2); ctx.lineTo(p1.x, (p1.y + b2.y) / 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
  private regression(ctx: CanvasRenderingContext2D, d: Drawing, p0: P, p1: P) {
    const lo = Math.max(0, Math.round(Math.min(d.anchors[0].logical, d.anchors[1].logical))), hi = Math.min(this.bars.length - 1, Math.round(Math.max(d.anchors[0].logical, d.anchors[1].logical))); if (hi - lo < 2) { ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); return; }
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0; for (let i = lo; i <= hi; i++) { const yv = this.bars[i].close; n++; sx += i; sy += yv; sxx += i * i; sxy += i * yv; }
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), a = (sy - b * sx) / n; let sse = 0; for (let i = lo; i <= hi; i++) sse += (this.bars[i].close - (a + b * i)) ** 2; const sd = Math.sqrt(sse / n) * 2;
    const px = (i: number) => this.x(i)!, py = (v: number) => this.y(v)!; const mid: P[] = [{ x: px(lo), y: py(a + b * lo) }, { x: px(hi), y: py(a + b * hi) }];
    ctx.fillStyle = d.color; ctx.globalAlpha = 0.08; ctx.beginPath(); ctx.moveTo(px(lo), py(a + b * lo + sd)); ctx.lineTo(px(hi), py(a + b * hi + sd)); ctx.lineTo(px(hi), py(a + b * hi - sd)); ctx.lineTo(px(lo), py(a + b * lo - sd)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = d.color; ctx.beginPath(); ctx.moveTo(mid[0].x, mid[0].y); ctx.lineTo(mid[1].x, mid[1].y); ctx.stroke(); ctx.globalAlpha = 0.6; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(px(lo), py(a + b * lo + sd)); ctx.lineTo(px(hi), py(a + b * hi + sd)); ctx.moveTo(px(lo), py(a + b * lo - sd)); ctx.lineTo(px(hi), py(a + b * hi - sd)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  private pitchfork(ctx: CanvasRenderingContext2D, d: Drawing, p0: P, p1: P, p2: P) { const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, dx = mid.x - p0.x, dy = mid.y - p0.y, k = 1e4 / (Math.hypot(dx, dy) || 1); const med2 = { x: mid.x + dx * k, y: mid.y + dy * k }; ctx.fillStyle = d.color; ctx.globalAlpha = 0.06; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p1.x + dx * k, p1.y + dy * k); ctx.lineTo(p2.x + dx * k, p2.y + dy * k); ctx.lineTo(p2.x, p2.y); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = d.color; line2(ctx, p1, p2); line2(ctx, p0, med2); line2(ctx, p1, { x: p1.x + dx * k, y: p1.y + dy * k }); line2(ctx, p2, { x: p2.x + dx * k, y: p2.y + dy * k }); }
  private fib(ctx: CanvasRenderingContext2D, d: Drawing, a: P, b: P) { const p0 = d.anchors[0].price, p1 = d.anchors[1].price, L = Math.min(a.x, b.x), R = Math.max(a.x, b.x); let prev: number | null = null; FIB.forEach((lv, i) => { const price = p0 + (p1 - p0) * lv, y = this.y(price); if (y == null) return; ctx.strokeStyle = FIB_COL[i]; ctx.fillStyle = FIB_COL[i]; ctx.lineWidth = 1; if (prev != null) { ctx.globalAlpha = 0.06; ctx.fillRect(L, Math.min(prev, y), R - L, Math.abs(y - prev)); ctx.globalAlpha = 1; } ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); ctx.fillText(`${lv.toFixed(3)}  ${this.fmt(price)}`, L + 4, y - 3); prev = y; }); ctx.strokeStyle = d.color; ctx.lineWidth = d.width; line2(ctx, a, b); }
  private fibExt(ctx: CanvasRenderingContext2D, d: Drawing, pts: (P | null)[]) {
    const a0 = d.anchors[0].price, a1 = d.anchors[1].price, base = d.anchors[2].price;
    const xs = pts.filter((p): p is P => !!p).map(p => p.x); const L = Math.min(...xs), R = Math.max(...xs);
    ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.globalAlpha = 0.5; ctx.beginPath(); pts.forEach((q, i) => q && (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); ctx.globalAlpha = 1;
    const lv = [0, 0.382, 0.5, 0.618, 1, 1.618, 2.618]; let prev: number | null = null;
    lv.forEach((l, i) => { const price = base + (a1 - a0) * l; const y = this.y(price); if (y == null) return; const c = FIB_COL[i % FIB_COL.length]; ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1;
      if (prev != null) { ctx.globalAlpha = 0.05; ctx.fillRect(L, Math.min(prev, y), R - L, Math.abs(y - prev)); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); ctx.fillText(`${l.toFixed(3)}  ${this.fmt(price)}`, L + 4, y - 3); prev = y; });
  }
  private fibTime(ctx: CanvasRenderingContext2D, d: Drawing, H: number) {
    const unit = Math.abs(d.anchors[1].logical - d.anchors[0].logical) || 1; const seq = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55];
    ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineWidth = 1; ctx.globalAlpha = 0.85; ctx.setLineDash([4, 4]);
    for (const n of seq) { const x = this.x(d.anchors[0].logical + n * unit); if (x == null || x > this.plotW()) break; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.fillText(String(n), x + 3, 13); }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  private fibChannel(ctx: CanvasRenderingContext2D, d: Drawing, p0: P, p1: P, p2: P) {
    const m = this.slope(p0, p1), at = (x: number) => p0.y + m * (x - p0.x), off = p2.y - at(p2.x), L = Math.min(p0.x, p1.x), R = Math.max(p0.x, p1.x), lv = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    lv.forEach((l, i) => { const c = FIB_COL[i % FIB_COL.length]; ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1; const yL = at(L) + off * l, yR = at(R) + off * l; ctx.beginPath(); ctx.moveTo(L, yL); ctx.lineTo(R, yR); ctx.stroke(); ctx.fillText(l.toFixed(3), L + 3, yL - 3); });
  }
  private gannFan(ctx: CanvasRenderingContext2D, d: Drawing, p0: P, p1: P) {
    const dx = (p1.x - p0.x) || 1, dy = p1.y - p0.y, base = dy / dx, ratios = [0.25, 1 / 3, 0.5, 1, 2, 3, 4], big = this.plotW(), ex = p0.x + (dx >= 0 ? big : -big);
    ctx.strokeStyle = d.color; ctx.lineWidth = 1; ctx.globalAlpha = 0.85;
    for (const r of ratios) { ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(ex, p0.y + (ex - p0.x) * base * r); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.lineWidth = d.width; line2(ctx, p0, p1);
  }
  private gannBox(ctx: CanvasRenderingContext2D, d: Drawing, p0: P, p1: P) {
    const fr = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1], x0 = Math.min(p0.x, p1.x), x1 = Math.max(p0.x, p1.x), y0 = Math.min(p0.y, p1.y), y1 = Math.max(p0.y, p1.y);
    ctx.strokeStyle = d.color; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
    for (const f of fr) { const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f; line2(ctx, { x, y: y0 }, { x, y: y1 }); line2(ctx, { x: x0, y }, { x: x1, y }); }
    ctx.globalAlpha = 0.75; line2(ctx, { x: x0, y: y0 }, { x: x1, y: y1 }); line2(ctx, { x: x0, y: y1 }, { x: x1, y: y0 });
    ctx.globalAlpha = 1; ctx.lineWidth = d.width; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
  private measure(ctx: CanvasRenderingContext2D, d: Drawing, a: P, b: P) { const up = d.anchors[1].price >= d.anchors[0].price, col = up ? '#089981' : '#f23645'; ctx.fillStyle = col; ctx.strokeStyle = col; ctx.globalAlpha = 0.12; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.globalAlpha = 1; ctx.lineWidth = 1; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); const dp = d.anchors[1].price - d.anchors[0].price, pct = dp / d.anchors[0].price * 100, bars = Math.round(d.anchors[1].logical - d.anchors[0].logical); this.pill(ctx, (a.x + b.x) / 2, b.y + (up ? 16 : -8), `${dp >= 0 ? '+' : ''}${this.fmt(dp)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)  ${Math.abs(bars)} bars`, col); }
  private position(ctx: CanvasRenderingContext2D, d: Drawing, a: P, b: P, long: boolean) { const entry = d.anchors[0].price, target = d.anchors[1].price, risk = long ? entry - (target - entry) : entry + (entry - target); const ey = this.y(entry)!, ty = this.y(target)!, ry = this.y(risk)!, L = Math.min(a.x, b.x), R = Math.max(a.x, b.x); ctx.fillStyle = '#089981'; ctx.globalAlpha = 0.14; ctx.fillRect(L, Math.min(ey, ty), R - L, Math.abs(ty - ey)); ctx.fillStyle = '#f23645'; ctx.fillRect(L, Math.min(ey, ry), R - L, Math.abs(ry - ey)); ctx.globalAlpha = 1; ctx.strokeStyle = '#9598a1'; ctx.lineWidth = 1; ctx.strokeRect(L, Math.min(ty, ry), R - L, Math.abs(ry - ty)); ctx.strokeStyle = '#131722'; ctx.setLineDash([3, 3]); line2(ctx, { x: L, y: ey }, { x: R, y: ey }); ctx.setLineDash([]); const rr = Math.abs(target - entry) / (Math.abs(entry - risk) || 1); this.pill(ctx, (L + R) / 2, Math.min(ty, ry) - 8, `${long ? 'LONG' : 'SHORT'}  R:R ${rr.toFixed(2)}`, long ? '#089981' : '#f23645'); }
  private priceRange(ctx: CanvasRenderingContext2D, d: Drawing, a: P, b: P) { ctx.fillStyle = d.color; ctx.globalAlpha = 0.10; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.globalAlpha = 1; ctx.lineWidth = 1; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); const dp = d.anchors[1].price - d.anchors[0].price, pct = dp / d.anchors[0].price * 100; this.pill(ctx, (a.x + b.x) / 2, (a.y + b.y) / 2, `${this.fmt(Math.abs(dp))} (${pct.toFixed(2)}%)`, d.color); }
  private cyclic(ctx: CanvasRenderingContext2D, d: Drawing, p0: P, p1: P, H: number) { const per = Math.abs(d.anchors[1].logical - d.anchors[0].logical) || 1; ctx.strokeStyle = d.color; ctx.globalAlpha = 0.8; ctx.setLineDash([4, 4]); for (let k = 0; k < 30; k++) { const x = this.x(d.anchors[0].logical + k * per); if (x == null || x > this.plotW()) break; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } ctx.setLineDash([]); ctx.globalAlpha = 1; }
  private sine(ctx: CanvasRenderingContext2D, d: Drawing, a: P, b: P) { const amp = (a.y - b.y) / 2 || 10, midY = (a.y + b.y) / 2; ctx.beginPath(); for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x += 2) { const t = (x - a.x) / ((b.x - a.x) || 1); ctx.lineTo(x, midY - amp * Math.sin(t * Math.PI * 2)); } ctx.stroke(); }
  private labeledPath(ctx: CanvasRenderingContext2D, d: Drawing, P: (P | null)[], labels: string[], fill: boolean) { ctx.beginPath(); P.forEach((q, i) => q && (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); if (fill && P.length > 2) { ctx.closePath(); ctx.globalAlpha = 0.07; ctx.fill(); ctx.globalAlpha = 1; } ctx.stroke(); P.forEach((q, i) => { if (!q || !labels[i]) return; ctx.fillStyle = d.color; this.lbl(ctx, q.x + 6, q.y - 6, labels[i], d.color); }); }
  private callout(ctx: CanvasRenderingContext2D, d: Drawing, p: P) { ctx.font = '12px -apple-system, Segoe UI, sans-serif'; const txt = d.text || 'Note', w = ctx.measureText(txt).width + 16, bx = p.x + 14, by = p.y - 34; ctx.strokeStyle = d.color; ctx.lineWidth = 1; line2(ctx, p, { x: bx, y: by + 11 }); ctx.fillStyle = '#fff'; ctx.strokeStyle = d.color; this.rrect(ctx, bx, by, w, 22, 6); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#131722'; ctx.fillText(txt, bx + 8, by + 15); ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill(); }

  // ---------- label helpers ----------
  private lbl(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) { ctx.font = '12px -apple-system, Segoe UI, sans-serif'; ctx.fillStyle = color; ctx.fillText(text, x, y); }
  private pill(ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string, color: string) { ctx.font = '12px -apple-system, Segoe UI, sans-serif'; const w = ctx.measureText(text).width + 14; ctx.fillStyle = color; this.rrect(ctx, cx - w / 2, cy - 11, w, 20, 5); ctx.fill(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(text, cx, cy + 3); ctx.textAlign = 'left'; }
  private tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, align: 'left' | 'right' = 'right') { ctx.font = '11px ui-monospace, monospace'; const w = ctx.measureText(text).width + 10, bx = align === 'right' ? x - w : x; ctx.fillStyle = color; this.rrect(ctx, bx, y - 9, w, 18, 4); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(text, bx + 5, y + 4); }
  private rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  private fmt(v: number) { return v.toFixed(2); }

  // ---------- persistence ----------
  private save() { try { localStorage.setItem(this.storeKey, JSON.stringify(this.drawings)); } catch { /* ignore */ } this.onChange?.(); }
  private load() { try { const s = localStorage.getItem(this.storeKey); if (s) this.drawings = JSON.parse(s); } catch { /* ignore */ } }
}

function line2(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
