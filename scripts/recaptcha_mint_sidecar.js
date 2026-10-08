/**
 * recaptcha_mint_sidecar.js  (CommonJS; scripts/package.json = commonjs)
 * Mo Chrome ho so da DANG NHAP (browser_N) bang puppeteer-real-browser,
 * warm-up google.com -> flow.google.com, cho grecaptcha san sang, roi goi
 * grecaptcha.enterprise.execute(SITE_KEY, {action}) de lay reCAPTCHA token
 * (giong MUSE TOOL / SuperVeo). In 1 dong JSON ket qua ra stdout.
 *
 * Config JSON = argv[2]:
 *   { profileDir, chromePath, moduleDirs, action, timeoutMs }
 * Output (stdout, 1 JSON/dong):
 *   {"event":"log","message":...}
 *   {"event":"done","ok":true,"token":"...","len":N,"mode":"enterprise"}
 *   {"event":"error","message":...}
 */
'use strict';
const fs = require('fs');
const path = require('path');

function out(o) { process.stdout.write(JSON.stringify(o) + '\n'); }
function log(m) { out({ event: 'log', message: String(m) }); }

function requireFrom(dirs, name) {
  for (const d of dirs || []) {
    try { return require(path.join(d, name)); } catch (e) { /* next */ }
  }
  return require(name);
}

// Site key cua Google Flow (labs.google/fx) - nguon: K:\MUSE TOOL\flow_api.py
const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

const JS_MINT = `async ([siteKey, action]) => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitMode = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const g = window.grecaptcha;
      if (g && g.enterprise && typeof g.enterprise.execute === 'function') return 'enterprise';
      if (g && typeof g.execute === 'function') return 'standard';
      if (g && typeof g.ready === 'function') { try { await new Promise(res => g.ready(res)); } catch (e) {} }
      await sleep(250);
    }
    return null;
  };
  const mode = await waitMode(25000);
  if (!mode) return { ok: false, error: 'grecaptcha chua load (can dang nhap Flow tren Chrome ho so nay)' };
  try {
    const tok = mode === 'enterprise'
      ? await window.grecaptcha.enterprise.execute(siteKey, { action })
      : await window.grecaptcha.execute(siteKey, { action });
    return { ok: true, token: tok, mode };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}`;

async function main() {
  const cfgPath = process.argv[2];
  if (!cfgPath || !fs.existsSync(cfgPath)) { out({ event: 'error', message: 'thieu config' }); process.exit(2); }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const action = (cfg.action || 'IMAGE_GENERATION').trim();
  const timeoutMs = Math.max(30000, parseInt(cfg.timeoutMs, 10) || 90000);
  const moduleDirs = cfg.moduleDirs || [];
  const profileDir = (cfg.profileDir || '').trim();

  let connect;
  try { ({ connect } = requireFrom(moduleDirs, 'puppeteer-real-browser')); }
  catch (e) { out({ event: 'error', message: 'khong nap duoc puppeteer-real-browser: ' + e.message }); process.exit(3); }

  if (profileDir) { try { fs.mkdirSync(profileDir, { recursive: true }); } catch (e) {} }
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--window-size=1100,820', '--window-position=90,70', '--lang=vi-VN',
  ];
  const options = {
    headless: false, turnstile: true, args,
    customConfig: profileDir ? { userDataDir: profileDir } : {},
    connectOption: { defaultViewport: null },
    disableXvfb: false, ignoreAllFlags: false,
  };
  if (cfg.chromePath && fs.existsSync(cfg.chromePath)) options.executablePath = cfg.chromePath;

  let browser, page;
  try { ({ browser, page } = await connect(options)); }
  catch (e) { out({ event: 'error', message: 'connect Chrome hong: ' + e.message }); process.exit(4); }

  const done = (o) => { try { browser.close(); } catch (e) {} out(o); process.exit(o && o.ok ? 0 : 1); };
  const timer = setTimeout(() => done({ event: 'error', message: 'Timeout mint reCAPTCHA' }), timeoutMs + 8000);

  try {
    try { await page.goto('https://www.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) {}
    await new Promise(r => setTimeout(r, 700));
    // flow.google.com cho token diem cao (labs.google/fx hay bi 403) - nguon MUSE TOOL
    const urls = ['https://flow.google.com/', 'https://labs.google/fx/tools/flow', 'https://labs.google/fx'];
    let loaded = false;
    for (const u of urls) {
      try { await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 }); loaded = true; log('warm-up ' + u); break; }
      catch (e) { log('warm-up ' + u + ': ' + (e && e.message)); }
    }
    if (!loaded) { clearTimeout(timer); return done({ event: 'error', message: 'khong mo duoc Flow de mint' }); }
    try {
      await page.mouse.move(120 + Math.random() * 80, 160 + Math.random() * 60);
      await page.evaluate('window.scrollTo(0, Math.min(200, document.body.scrollHeight/8))');
    } catch (e) {}
    await new Promise(r => setTimeout(r, 900));

    let curUrl = '';
    try { curUrl = page.url(); } catch (e) {}
    const r = await page.evaluate(JS_MINT, [SITE_KEY, action]);
    clearTimeout(timer);
    if (r && r.ok && r.token && String(r.token).length > 20) {
      return done({ event: 'done', ok: true, token: r.token, len: String(r.token).length, mode: r.mode, action });
    }
    // Chua dang nhap Flow: flow.google.com -> /about (marketing), token rong.
    const notLoggedIn = /\/about|signin|accounts\.google/i.test(curUrl || '');
    const msg = (r && r.error)
      || (notLoggedIn
        ? 'Chua dang nhap Flow trong Chrome profile nay (trang ve ' + (curUrl || '').slice(0, 60) + '). Hay Start Auto Login / Lay Cookie dang nhap Flow roi thu lai.'
        : 'Mint tra token rong - thu mo flow.google.com va dang nhap lai tai khoan.');
    return done({ event: 'error', message: msg });
  } catch (e) {
    clearTimeout(timer);
    return done({ event: 'error', message: 'mint loi: ' + (e && e.message) });
  }
}
main();
