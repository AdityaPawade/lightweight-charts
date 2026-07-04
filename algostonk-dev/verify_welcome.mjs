import puppeteer from 'puppeteer';
// Forces the logged-out welcome on the no-auth :8088 view by faking /api/auth/me -> 401.
const URL = process.argv[2] || 'http://picloud:8088/';
const OUT = process.argv[3] || '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const R = { url: URL, errors: [], csp: [] };
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error') R.errors.push(t.slice(0, 160)); if (/content security policy/i.test(t)) R.csp.push(t.slice(0, 160)); });
  p.on('pageerror', (e) => R.errors.push('pageerror: ' + String(e.message || e)));
  await p.setRequestInterception(true);
  p.on('request', (req) => {
    if (/\/api\/auth\/me$/.test(req.url())) { req.respond({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }); return; }
    req.continue();
  });
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(2500);

  const info = await p.evaluate(() => {
    const t = document.body.innerText.toLowerCase();
    const has = (s) => t.includes(s.toLowerCase());
    const aside = document.querySelector('aside');
    const navText = (aside?.innerText || '').toLowerCase();
    return {
      hasSidebar: !!aside,
      sidebarHasWatchlist: navText.includes('watchlist'),
      sidebarHasSmartMoney: navText.includes('smart money'),
      sidebarHidesAdmin: !navText.includes('ops') && !navText.includes('developer') && !navText.includes('strategy'),
      hasWelcomeContent: has('can i take equity risk'),
      hasContinueGoogle: has('continue with google'),
      hasSignInToView: has('sign in to view'),
      lockIcons: aside ? aside.querySelectorAll('svg').length : 0,
      bodyLen: document.body.innerText.length
    };
  });
  R.checks = info;
  await p.screenshot({ path: OUT + '/welcome_full.png', fullPage: true });
  await p.screenshot({ path: OUT + '/welcome_viewport.png' });
  console.log(JSON.stringify(R, null, 2));
} catch (e) {
  R.fatal = String(e.message || e); console.log(JSON.stringify(R, null, 2));
} finally { await b.close(); }
