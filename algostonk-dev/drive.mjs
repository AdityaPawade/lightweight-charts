// Algostonk dev/test driver for the Lightweight Charts fork.
//
// Headless-Chrome harness (puppeteer) that loads a chart page, simulates REAL pointer/touch interaction sequences, and
// writes a PNG to disk — the reliable browser-control loop for developing + regression-testing drawing tools.
//
// Usage:
//   node algostonk-dev/drive.mjs --url <url> --out <png> [--scenario <name>] [--w 1280] [--h 720] [--touch]
//   node algostonk-dev/drive.mjs --url <url> --out <png> --actions '[["move",0.3,0.6],["down"],["move",0.7,0.3,12],["up"]]'
//
// Action ops (coords are FRACTIONS of the first <canvas> box): move x y [steps] · down · up · click x y ·
//   dblclick x y · key NAME · wheel dy · wait ms · eval "<js>".  --touch routes down/move/up through the touchscreen.
import puppeteer from 'puppeteer';

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
function flag(name) { return process.argv.includes(`--${name}`); }

const url = arg('url');
const out = arg('out', 'shot.png');
const scenario = arg('scenario', '');
const width = Number(arg('w', '1280'));
const height = Number(arg('h', '720'));
const useTouch = flag('touch');
if (!url) { console.error('need --url'); process.exit(2); }

const SCENARIOS = {
  // diagonal drag across the chart (draw a 2-point tool: down -> move -> up)
  drag: [['move', 0.30, 0.62], ['down'], ['move', 0.50, 0.46, 12], ['move', 0.70, 0.30, 12], ['up'], ['wait', 250]],
  // two discrete clicks (tools that take click-to-place points)
  twoClicks: [['click', 0.30, 0.62], ['wait', 150], ['click', 0.70, 0.34], ['wait', 250]],
  // hover the middle (crosshair / tooltip)
  hover: [['move', 0.55, 0.45], ['wait', 250]],
  none: [['wait', 200]],
};
let actions = SCENARIOS[scenario] || SCENARIOS.none;
const actionsArg = arg('actions');
if (actionsArg) { try { actions = JSON.parse(actionsArg); } catch (e) { console.error('bad --actions json', e.message); process.exit(2); } }

async function launch() {
  try { return await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
  catch (e) { console.error('bundled chromium failed, trying system chrome:', e.message);
    return await puppeteer.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox'] }); }
}

const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, hasTouch: useTouch });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('canvas', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 700)); // let the chart paint

  const box = await page.$eval('canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const X = (fx) => box.x + box.w * fx;
  const Y = (fy) => box.y + box.h * fy;
  const ts = page.touchscreen;

  for (const a of actions) {
    const [op, p1, p2, p3] = a;
    if (op === 'move') { if (useTouch) { /* touch move handled in drag below */ } await page.mouse.move(X(p1), Y(p2), { steps: p3 || 1 }); }
    else if (op === 'down') { useTouch ? await ts.touchStart(X(actions.cur?.[0] ?? 0.5), Y(actions.cur?.[1] ?? 0.5)) : await page.mouse.down(); }
    else if (op === 'up') { useTouch ? await ts.touchEnd() : await page.mouse.up(); }
    else if (op === 'click') { await page.mouse.click(X(p1), Y(p2)); }
    else if (op === 'dblclick') { await page.mouse.click(X(p1), Y(p2), { clickCount: 2 }); }
    else if (op === 'key') { await page.keyboard.press(p1); }
    else if (op === 'wheel') { await page.mouse.move(X(0.5), Y(0.5)); await page.mouse.wheel({ deltaY: p1 }); }
    else if (op === 'wait') { await new Promise((r) => setTimeout(r, p1)); }
    else if (op === 'eval') { await page.evaluate(p1); }
  }

  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ ok: true, out, box, errors: errors.slice(0, 8) }));
} finally {
  await browser.close();
}
