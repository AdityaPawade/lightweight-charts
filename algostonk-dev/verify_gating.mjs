import puppeteer from 'puppeteer';
// Simulate a FREE (logged-in, no roles) user and verify the new gating + layout across pages.
const BASE = process.argv[2] || 'http://picloud:8088';
const OUT = process.argv[3] || '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const R = { base: BASE, pages: {} };

async function freePage() {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1200 });
  await p.setRequestInterception(true);
  p.on('request', (req) => {
    if (/\/api\/auth\/me$/.test(req.url())) { req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'free@test', name: 'Free', roles: [] }) }); return; }
    req.continue();
  });
  return p;
}
const rawIso = (t) => /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(t);  // ugly machine ISO still on screen?

try {
  // --- Overview ---
  let p = await freePage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 45000 }); await sleep(4000);
  R.pages.overview = await p.evaluate(() => {
    const flat = document.body.innerText.replace(/\s+/g, ' ');
    // setups card region text (innerText upcases the title via CSS, so match case-insensitively)
    const lower = flat.toLowerCase();
    const setupsIdx = lower.indexOf('best stock setups');
    const setupsText = setupsIdx >= 0 ? flat.slice(setupsIdx, setupsIdx + 1400) : '';
    return {
      setupsLocks: (setupsText.match(/🔒/g) || []).length,        // top-5 names locked
      setupsSaysTop10: /Top 10 by final score/i.test(flat),
      hasSortIndicator: document.body.innerHTML.includes('↕') || document.body.innerHTML.includes('↓'),
      hasRawIso: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(document.body.innerText),
      asOfHuman: (/As of ([^\n·]+)/.exec(document.body.innerText) || [])[1]?.trim()?.slice(0, 28) || null
    };
  });
  await p.screenshot({ path: OUT + '/gate_overview.png', fullPage: true }); await p.close();

  // --- Watchlist ---
  p = await freePage();
  await p.goto(BASE + '/watchlist', { waitUntil: 'networkidle2', timeout: 45000 }); await sleep(4000);
  R.pages.watchlist = await p.evaluate(() => {
    const t = document.body.innerText;
    return {
      lockCount: (t.match(/🔒/g) || []).length,                  // constituent scores + locked names
      hasOverallHeader: /Overall/.test(t),
      hasRawIso: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(t),
      rows: document.querySelectorAll('tbody tr').length
    };
  });
  await p.screenshot({ path: OUT + '/gate_watchlist.png', fullPage: true }); await p.close();

  // --- Instrument (free) ---
  p = await freePage();
  await p.goto(BASE + '/instrument/RELIANCE', { waitUntil: 'networkidle2', timeout: 45000 }); await sleep(4000);
  R.pages.instrument = await p.evaluate(() => {
    const t = document.body.innerText;
    return {
      removedTradingContext: !/Trading Context/i.test(t),         // should be TRUE (removed)
      hasVolumeInHeader: /Latest volume/i.test(t),
      hasValuationTile: /Valuation & momentum/i.test(t),
      valuationLocked: /PE, near-52w-high/i.test(t) && /Pro/.test(t),
      hasRawIso: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(t)
    };
  });
  await p.screenshot({ path: OUT + '/gate_instrument.png', fullPage: true }); await p.close();

  // --- Sectors page: avg-score ordering (read the table's last column top-to-bottom). Needs Pro. ---
  p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1200 });
  await p.setRequestInterception(true);
  p.on('request', (req) => {
    if (/\/api\/auth\/me$/.test(req.url())) { req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'pro@test', name: 'Pro', roles: ['pro'] }) }); return; }
    req.continue();
  });
  await p.goto(BASE + '/sectors', { waitUntil: 'networkidle2', timeout: 45000 }); await sleep(4000);
  R.pages.sectors = await p.evaluate(() => {
    const tbl = document.querySelector('table');
    if (!tbl) return { found: false };
    const rows = [...tbl.querySelectorAll('tbody tr')];
    const scores = rows.map((r) => { const tds = r.querySelectorAll('td'); return Number((tds[tds.length - 1]?.textContent || '').trim()); }).filter((n) => Number.isFinite(n));
    const desc = scores.every((v, i) => i === 0 || scores[i - 1] >= v);
    return { found: true, scores: scores.slice(0, 8), sortedByScoreDesc: desc };
  });
  await p.screenshot({ path: OUT + '/gate_sectors.png', fullPage: true }); await p.close();

  console.log(JSON.stringify(R, null, 2));
} catch (e) {
  R.fatal = String(e.message || e); console.log(JSON.stringify(R, null, 2));
} finally { await b.close(); }
