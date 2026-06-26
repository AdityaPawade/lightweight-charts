# Algostonk × Lightweight Charts — TradingView parity roadmap

Fork of `tradingview/lightweight-charts` (v5.2.0). Goal: bring the chart to TradingView-grade plotting/charting feature
parity for Algostonk, developed + tested standalone in this repo, then integrated into the Algostonk frontend.

Dev/test loop: build the lib (`npm run build`) → `plugin-examples` vite dev server (`npm run dev`) as the standalone
browser playground → drive it with `algostonk-dev/drive.mjs` (puppeteer: real synthetic pointer/touch sequences +
screenshot to disk) so every drawing tool can be developed and regression-tested in-browser.

## What LWC core already gives us

- Chart types: Candlestick, Bar, Line, Area, Baseline, Histogram.
- Multi-pane (v5), price scales, time scale, crosshair, markers, price lines, watermark, autoscale, fit/visible-range.
- Primitives/plugins API (ISeriesPrimitive / IPanePrimitive) — the extension point for drawing tools + custom series.

## Already in this repo's plugin-examples (build on these)

- Drawing/interaction: **trend-line**, **vertical-line**, **rectangle-drawing-tool**, user-price-lines,
  user-price-alerts, expiring-price-alerts, delta-tooltip, tooltip, highlight-bar-crosshair, anchored-text,
  partial-price-line, overlay-price-scale, image-watermark, session-highlighting, accessibility.
- Series: volume-profile, bands-indicator, brushable-area, heatmap, hlc-area, lollipop, rounded-candles, stacked-area,
  stacked-bars, grouped-bars, box-whisker, dual-range-histogram, background-shade, pretty-histogram.

## TradingView drawing-tool catalog → parity gap (P0/P1/P2)

Legend: ✅ exists (extend) · 🔨 build · ⏸ later

### Trend-line family — P0 (most-used)

- ✅ Trend line · 🔨 Ray · 🔨 Extended line · 🔨 Horizontal line · 🔨 Horizontal ray · ✅ Vertical line · 🔨 Cross line
- 🔨 Info line (price/%/bars/angle readout) · ⏸ Trend angle

### Channels — P0/P1

- 🔨 Parallel channel · ⏸ Regression trend · ⏸ Flat top/bottom · ⏸ Disjoint channel

### Fibonacci — P0 (retracement) then P1

- 🔨 Fib retracement · 🔨 Trend-based fib extension · ⏸ Fib channel/time-zone/fan/circles/spiral/wedge/arcs

### Shapes — P1

- ✅ Rectangle · 🔨 Ellipse/Circle · 🔨 Triangle · 🔨 Path/Polyline · ⏸ Rotated rectangle/Arc/Curve

### Annotations — P1

- 🔨 Text · 🔨 Callout · 🔨 Note/Price note · 🔨 Price label · 🔨 Arrow / arrow marks · ⏸ Pin/Table/Signpost/Flag/Image/Emoji

### Forecasting & measurement — P1/P2

- 🔨 Measure (price Δ, %, bars, time) · 🔨 Long/Short position tool · 🔨 Price range / Date range / Date+price range
- ✅ Anchored VWAP (backend computes; add interactive anchor) · ✅ Fixed-range volume profile (extend) · ⏸ Forecast/Ghost feed

### Pitchforks / Gann / Patterns / Elliott — P2 (advanced, lower ROI first)

- ⏸ Pitchfork (classic/Schiff/modified/inside) · ⏸ Gann fan/box/square · ⏸ XABCD/ABCD/triangle/3-drives/H&S/Elliott

### Cursors & global controls — P0 (UX shell)

- 🔨 Cursor modes (cross/dot/arrow/eraser) · 🔨 Magnet (snap to OHLC) · 🔨 Keep-drawing · 🔨 Lock all · 🔨 Hide all
- 🔨 Per-drawing style editor (color/width/line-style/text) · 🔨 Select/move/delete + multi-select · 🔨 Persistence (per symbol)

## Beyond drawings (charting parity)

- Chart types: 🔨 Heikin Ashi (transform) · ⏸ Renko / Line Break / Kagi / Point&Figure / Range.
- Indicators: ✅ MA/EMA/BOLL/RSI/MACD (computed in TS) · 🔨 more (VWAP, Stoch, ATR, ADX, OBV, Ichimoku, Supertrend,
  Donchian, Keltner) — see `indicator-examples`.
- Bar replay (P2) · drawing templates/favourites toolbar (P1) · multi-chart layouts (⏸).

## Phasing

1. **Foundation (done):** fork + build + standalone playground + headless browser-control harness (synthetic
   pointer/touch + screenshot, proven by drawing a trend line via a synthetic drag).
2. **P0 drawing core:** a unified drawing-tool framework (base primitive: anchors, hit-test, drag, style, persistence,
   magnet) + toolbar/cursor shell; ship trend-line family + horizontal/ray + rectangle + fib-retracement + measure.
3. **P1:** channels, more shapes, annotations, position tool, more indicators, Heikin-Ashi, templates.
4. **P2:** pitchforks/gann/patterns/elliott, replay, exotic chart types.
5. **Integrate:** publish the drawing-tool package; Algostonk frontend consumes it (replace the plain LWC dep).
