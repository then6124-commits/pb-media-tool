/**
 * grok_login_sidecar.js — mở Chrome (puppeteer-real-browser) với hồ sơ riêng của
 * tài khoản Grok, vào trang đăng nhập x.ai, tự điền email + mật khẩu (nếu có),
 * rồi chờ tới khi grok.com có cookie đăng nhập `sso` → trả cookie về.
 *
 * Captcha / mã xác minh / đăng nhập Google-Apple: người dùng tự bấm trong cửa sổ
 * Chrome, sidecar vẫn chờ (tới timeoutMs).
 *
 * Giao thức như cookie_capture_sidecar.js (config JSON ở argv[2], stdout 1 JSON/dòng):
 *   {"event":"log","message":...}
 *   {"event":"done","ok":true,"cookies":"a=b; ...","cookieCount":N}
 *   {"event":"error","message":...}
 */
'use strict';

const fs = require('fs');
const path = require('path');

function out(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function log(msg) { out({ event: 'log', message: String(msg) }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function requireFrom(dirs, name) {
  for (const d of dirs || []) {
    try { return require(path.join(d, name)); } catch (e) { /* thử thư mục khác */ }
  }
  return require(name);
}

function cookieHeader(list) {
  const gop = {};
  for (const c of list || []) if (c && c.name) gop[c.name] = c.value;
  return Object.keys(gop).map((k) => k + '=' + gop[k]).join('; ');
}

/** Gõ vào ô đầu tiên khớp một trong các selector (trả true nếu gõ được). */
async function goVao(page, selectors, text) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (!el) continue;
      const box = await el.boundingBox();
      if (!box) continue;
      await el.click({ clickCount: 3 });
      await el.type(text, { delay: 35 });
      return true;
    } catch (e) { /* selector khác */ }
  }
  return false;
}

/** Chờ tới khi có ô nhập hiện ra (trang x.ai là SPA, tải chậm) rồi gõ vào. */
async function choVaGo(page, selectors, text, ms = 25000) {
  const het = Date.now() + ms;
  while (Date.now() < het) {
    if (await goVao(page, selectors, text)) return true;
    await sleep(700);
  }
  return false;
}

/** Đóng bảng cookie của x.ai (che mất nút). */
async function dongBangCookie(page) {
  await page.evaluate(() => {
    const chu = /^(reject all|accept all cookies|accept all|từ chối tất cả|chấp nhận tất cả)$/i;
    const b = Array.from(document.querySelectorAll('button')).find((x) => chu.test((x.innerText || '').trim()));
    if (b) b.click();
  }).catch(() => {});
}

/** Bấm nút có chữ khớp regex (vd «Login with email»). */
async function bamChu(page, re) {
  return page.evaluate((src) => {
    const r = new RegExp(src, 'i');
    const b = Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .find((x) => x.offsetParent !== null && r.test((x.innerText || '').trim()));
    if (b) { b.click(); return true; }
    return false;
  }, re.source).catch(() => false);
}

/** Bấm nút gửi form: nút submit, hoặc nút có chữ Next/Tiếp/Sign in/Đăng nhập/Continue. */
async function bamTiep(page) {
  const ok = await page.evaluate(() => {
    const chu = /^(next|tiếp|tiếp theo|tiếp tục|continue|sign in|log in|login|đăng nhập)$/i;
    const nut = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
      .filter((b) => b.offsetParent !== null && !b.disabled);
    const hop = nut.find((b) => chu.test((b.innerText || b.value || '').trim()))
      || nut.find((b) => b.type === 'submit');
    if (hop) { hop.click(); return true; }
    return false;
  }).catch(() => false);
  if (!ok) await page.keyboard.press('Enter').catch(() => {});
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const email = String(cfg.email || '').trim();
  const password = String(cfg.password || '');
  const timeoutMs = Number(cfg.timeoutMs) || 300000;

  let connect;
  try {
    ({ connect } = requireFrom(cfg.moduleDirs, 'puppeteer-real-browser'));
  } catch (e) {
    out({ event: 'error', message: 'Thiếu puppeteer-real-browser: ' + e.message });
    process.exit(3);
  }
  const hoSo = String(cfg.profileDir || '').trim();
  if (hoSo) { try { fs.mkdirSync(hoSo, { recursive: true }); } catch (e) { /* */ } }

  const options = {
    headless: false,
    turnstile: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1100,800',
      '--window-position=80,60',
    ],
    customConfig: hoSo ? { userDataDir: hoSo } : {},
    connectOption: { defaultViewport: null },
  };
  if (cfg.chromePath && fs.existsSync(cfg.chromePath)) options.executablePath = cfg.chromePath;

  let browser, page;
  try {
    ({ browser, page } = await connect(options));
  } catch (e) {
    out({ event: 'error', message: 'Không mở được Chrome: ' + e.message });
    process.exit(4);
  }

  const layCookie = async () => {
    try {
      const ds = await page.cookies('https://grok.com', 'https://accounts.x.ai', 'https://x.ai');
      return ds;
    } catch (e) { return []; }
  };
  const coSso = (ds) => ds.some((c) => c.name === 'sso' || c.name === 'sso-rw');

  // Hồ sơ đã đăng nhập từ lần trước → vào thẳng grok.com
  try { await page.goto('https://grok.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) { /* */ }
  await sleep(2500);
  if (!coSso(await layCookie())) {
    log('Mở trang đăng nhập x.ai');
    try {
      // email=true → vào thẳng form «Log in with your email», khỏi màn chọn Google/X/Email
      await page.goto('https://accounts.x.ai/sign-in?redirect=grok-com&email=true', {
        waitUntil: 'domcontentloaded', timeout: 60000,
      });
    } catch (e) { /* */ }
    await sleep(1500);
    await dongBangCookie(page);
    const O_EMAIL = ['input[type="email"]', 'input[name="email"]', 'input[autocomplete="email"]',
      'input[autocomplete="username"]', 'form input[type="text"]', 'input:not([type="hidden"]):not([type="password"])'];
    if (email) {
      let daGo = await choVaGo(page, O_EMAIL, email, 12000);
      if (!daGo) {
        // Còn ở màn chọn cách đăng nhập → bấm «Login with email» rồi thử lại
        await bamChu(page, /(log ?in|sign ?in|continue) with email|email/);
        daGo = await choVaGo(page, O_EMAIL, email, 15000);
      }
      log(daGo ? 'Đã điền email' : 'Không thấy ô email — điền tay trong cửa sổ Chrome');
      if (daGo) {
        await dongBangCookie(page);
        await bamTiep(page);
      }
    }
    if (password) {
      const daGo = await choVaGo(page, ['input[type="password"]', 'input[name="password"]'], password, 30000);
      log(daGo ? 'Đã điền mật khẩu' : 'Không thấy ô mật khẩu — điền tay trong cửa sổ Chrome');
      if (daGo) {
        await dongBangCookie(page);
        await bamTiep(page);
      }
    }
    log('Chờ đăng nhập xong (captcha/mã xác minh thì bấm tay trong Chrome)…');
  }

  const het = Date.now() + timeoutMs;
  let daVaoGrok = false;
  while (Date.now() < het) {
    const ds = await layCookie();
    if (coSso(ds)) {
      // Vào grok.com một lần để có đủ cookie của grok.com rồi mới trả
      if (!daVaoGrok) {
        daVaoGrok = true;
        try { await page.goto('https://grok.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) { /* */ }
        await sleep(2500);
        continue;
      }
      const grok = (await page.cookies('https://grok.com').catch(() => [])) || [];
      const ds2 = grok.length ? grok : ds;
      out({ event: 'done', ok: true, cookies: cookieHeader(ds2), cookieCount: ds2.length });
      try { await browser.close(); } catch (e) { /* */ }
      process.exit(0);
    }
    await sleep(2500);
  }
  out({ event: 'error', message: 'Hết giờ chờ đăng nhập Grok — đăng nhập xong trong Chrome rồi bấm lại' });
  try { await browser.close(); } catch (e) { /* */ }
  process.exit(5);
}

main().catch((e) => { out({ event: 'error', message: String(e && e.message || e) }); process.exit(1); });
