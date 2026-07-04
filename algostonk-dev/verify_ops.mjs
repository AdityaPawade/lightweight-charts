import puppeteer from 'puppeteer';
// :8088 is no-auth (synthetic admin) so /ops renders. Verifies the source-centric pipeline board.
const URL = (process.argv[2] || 'http://picloud:8088/') + 'ops';
const OUT = process.argv[3] || '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const R = { url: URL, errors: [], csp: [] };
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error') R.errors.push(t.slice(0, 160)); if (/content security policy/i.test(t)) R.csp.push(t.slice(0, 160)); });
  p.on('pageerror', (e) => R.errors.push('pageerror: ' + String(e.message || e)));
  p.on('response', async (res) => { if (/\/api\/ops\/pipeline$/.test(res.url())) { try { const j = await res.json(); R.pipeline = { sources: j.sources?.length, jobs: (j.jobs || []).map((x) => x.name), cats: [...new Set((j.sources || []).map((s) => s.category))], sample: (j.sources || []).slice(0, 3).map((s) => ({ id: s.id, status: s.status, next: s.nextRun })) }; } catch {} } });
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(3000);
  const info = await p.evaluate(() => {
    const t = document.body.innerText.toLowerCase();
    const has = (s) => t.includes(s.toLowerCase());
    return {
      hasScheduledJobs: has('scheduled jobs'),
      hasMarketData: has('market data'),
      hasSourceDesc: has('daily ohlcv') || has('equity & etf prices'),
      hasNextRunCol: has('next run'),
      hasEodRefresh: has('eod_refresh'),
      tables: document.querySelectorAll('table').length,
      bodyLen: document.body.innerText.length
    };
  });
  R.checks = info;
  await p.screenshot({ path: OUT + '/ops_full.png', fullPage: true });
  console.log(JSON.stringify(R, null, 2));
} catch (e) {
  R.fatal = String(e.message || e); console.log(JSON.stringify(R, null, 2));
} finally { await b.close(); }
