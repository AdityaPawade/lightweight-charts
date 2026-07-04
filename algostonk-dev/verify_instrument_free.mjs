import puppeteer from 'puppeteer';
// Fakes a logged-in FREE user (roles: []) to verify the instrument page locks the Pro sections.
const BASE = process.argv[2] || 'http://picloud:8088';
const OUT = process.argv[3] || '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const R = { errors: [], csp: [] };
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1100 });
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error') R.errors.push(t.slice(0, 160)); if (/content security policy/i.test(t)) R.csp.push(t.slice(0, 160)); });
  p.on('pageerror', (e) => R.errors.push('pageerror: ' + String(e.message || e)));
  await p.setRequestInterception(true);
  p.on('request', (req) => {
    if (/\/api\/auth\/me$/.test(req.url())) { req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'free@test', name: 'Free', roles: [] }) }); return; }
    req.continue();
  });
  await p.goto(BASE + '/instrument/RELIANCE', { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(4000);
  const info = await p.evaluate(() => {
    const t = document.body.innerText;
    const has = (s) => t.includes(s);
    return {
      // free teaser still present
      hasChart: document.querySelectorAll('canvas').length > 0,
      hasLatestClose: has('Latest close'),
      hasTrend: has('Trend') || has('Stage'),
      // locked Pro sections present
      lockCatalysts: has('Catalysts & Activity (Pro)'),
      lockMetrics: has('Instrument metrics (Pro)'),
      lockFinancials: has('Quarterly financials (Pro)'),
      lockFactorScores: has('Factor scores & breakdown (Pro)'),
      lockSmartMoney: has('Smart-money & liquidity (Pro)') || has('Smart-money &amp; liquidity (Pro)'),
      overallScoreLocked: has('Final factor score — Pro') || has('🔒'),
      // pro-only content must NOT be visible
      leaksFactorBreakdownRows: has("how it's built") || has('weighted blend of the six factors'),
      bodyLen: t.length
    };
  });
  R.checks = info;
  await p.screenshot({ path: OUT + '/instrument_free.png', fullPage: true });
  console.log(JSON.stringify(R, null, 2));
} catch (e) {
  R.fatal = String(e.message || e); console.log(JSON.stringify(R, null, 2));
} finally { await b.close(); }
