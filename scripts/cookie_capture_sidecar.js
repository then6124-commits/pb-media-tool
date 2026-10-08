/**
 * cookie_capture_sidecar.js — mở Chrome (puppeteer-real-browser) đúng hồ sơ
 * tài khoản, chờ user login, poll đến khi có __Secure-next-auth.session-token
 * (+ PSID/SAPISID nếu có), rồi trả cookie về Python.
 *
 * Giao thức giống mint_sidecar (config JSON argv[2], stdout 1 JSON/dòng):
 *   {"event":"log","message":...}
 *   {"event":"ready"}
 *   {"event":"waiting","hasNextAuth":bool,"hasPsid":bool,"url":...}
 *   {"event":"done","ok":true,"cookies":"a=b; ...","hasNextAuth":true,...}
 *   {"event":"error","message":...}
 * stdin: {"cmd":"quit"}  → đóng Chrome
 *
 * 29/09 — SuperVeo-style dialog handlers:
 *   - accounts.google.com: Verify it's you / Next cho đúng targetEmail
 *   - labs.google/fx: Sign in with Google
 *   - "Make Chrome your own" / "Continue as X": chỉ Continue as ĐÚNG email;
 *     sai email → Use without an account / đóng rồi Sign in lại
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function out(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function log(msg) { out({ event: 'log', message: String(msg) }); }

function requireFrom(dirs, name) {
  for (const d of dirs || []) {
    try { return require(path.join(d, name)); } catch (e) { /* next */ }
  }
  return require(name);
}

function cookieHeader(list) {
  const gop = {};
  for (const c of list || []) {
    if (!c || !c.name) continue;
    gop[c.name] = c.value;
  }
  return Object.keys(gop).map(k => k + '=' + gop[k]).join('; ');
}

function hasName(list, name) {
  return (list || []).some(c => c && c.name === name);
}

function hasPsid(list) {
  return (list || []).some(c => {
    const n = (c && c.name) || '';
    return n === '__Secure-1PSID' || n === 'PSID' || n === '__Secure-1PSIDTS'
      || n === 'SAPISID' || n === '__Secure-3PSID';
  });
}

function normEmail(s) {
  return String(s || '').trim().toLowerCase();
}

// 30/09 — Xac thuc cookie NGAY TRONG TRANG (xem ghi chu dau ban va).
// Hoi lan luot; endpoint dau con song la chot. `trpc/videoFx.getUserSettings`
// cua SuperVeo da bi Google khai tu (404 «Flow RPCs have been deprecated»)
// nen chi de lam du phong, khong de no ket luan.
const DS_XAC_THUC = [
  { url: 'https://labs.google/fx/api/auth/session', kieu: 'session' },
  { url: 'https://labs.google/fx/api/trpc/videoFx.getUserSettings',
    kieu: 'trpc' },
];

async function xacThucTrongTrang(page, flowUrl) {
  // fetch phai same-origin voi labs.google. Dang dung o accounts.google thi
  // ve trang flow truoc, khong thi browser chan CORS va bao "khong hop le"
  // trong khi cookie that ra vua tot.
  let u = '';
  try { u = String(page.url() || ''); } catch (e) { /* */ }
  if (!u.toLowerCase().includes('labs.google')) {
    try {
      await page.goto(flowUrl, { waitUntil: 'domcontentloaded',
                                 timeout: 45000 });
    } catch (e) {
      return { ok: false, status: 0,
               why: 've labs.google loi: ' + (e && e.message) };
    }
  }
  let cuoi = { ok: false, status: 0, why: 'khong hoi duoc endpoint nao',
               khongRo: true };
  for (const muc of DS_XAC_THUC) {
    let r;
    try {
      r = await page.evaluate(async (url) => {
        // `credentials: 'include'` = dung dung cookie jar cua Chrome. Khong
        // the set header Cookie trong trang (browser bo), va cung khong can.
        try {
          const res = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: { accept: 'application/json' },
          });
          let body = '';
          try { body = (await res.text()).slice(0, 400); } catch (e2) { /* */ }
          return { status: res.status, body: body };
        } catch (e3) {
          return { status: 0, body: String((e3 && e3.message) || e3) };
        }
      }, muc.url);
    } catch (e) {
      cuoi = { ok: false, status: 0, khongRo: true,
               why: 'evaluate loi: ' + (e && e.message) };
      continue;
    }
    const st = (r && r.status) || 0;
    const body = String((r && r.body) || '');
    if (st === 200) {
      if (muc.kieu === 'session') {
        // 200 chua du: phien vo dung van tra 200 kem session_error.
        const xau = /ACCESS_TOKEN_REFRESH_NEEDED|RefreshAccessTokenError/i
          .test(body);
        const rong = body.replace(/\s/g, '') === '{}' || body.trim() === '';
        if (xau || rong) {
          return { ok: false, status: st, khongRo: false,
                   why: (xau ? 'session_error: ' : 'session rong: ') + body };
        }
      }
      return { ok: true, status: st, khongRo: false, why: muc.kieu + ' 200' };
    }
    if (st === 401 || st === 403) {
      // Cookie THAT SU khong dung duoc — khong can hoi tiep.
      return { ok: false, status: st, khongRo: false, why: body };
    }
    // 404/410/5xx/0 = endpoint chet hoac mang loi, KHONG phai cookie chet.
    cuoi = { ok: false, status: st, khongRo: true, why: body };
  }
  return cuoi;
}

async function collectCookies(page, browser) {
  const urls = [
    'https://labs.google/',
    'https://labs.google/fx/tools/flow',
    'https://flow.google.com/',
    'https://accounts.google.com/',
    'https://www.google.com/',
  ];
  let all = [];
  try {
    for (const u of urls) {
      try { all = all.concat(await page.cookies(u)); } catch (e) { /* */ }
    }
  } catch (e) { /* */ }
  try {
    const more = await page.cookies();
    all = all.concat(more || []);
  } catch (e) { /* */ }
  try {
    const client = await page.target().createCDPSession();
    const r = await client.send('Network.getAllCookies');
    all = all.concat((r && r.cookies) || []);
    try { await client.detach(); } catch (e) { /* */ }
  } catch (e) { /* */ }
  const rank = (dom) => {
    const d = String(dom || '').replace(/^\./, '').toLowerCase();
    if (d.includes('flow.google')) return 3;
    if (d.includes('labs.google')) return 2;
    if (d.endsWith('google.com')) return 1;
    return 0;
  };
  const gop = {};
  const rk = {};
  for (const c of all) {
    if (!c || !c.name) continue;
    const r = rank(c.domain);
    if (!(c.name in gop) || r >= (rk[c.name] || -1)) {
      gop[c.name] = c;
      rk[c.name] = r;
    }
  }
  return Object.values(gop);
}

/**
 * Tự bấm dialog Google / Chrome profile picker.
 * targetEmail rỗng = TK mới: không Continue as email lạ; Prefer Use without /
 * Sign in trống.
 */
async function handleDialogs(page, browser, targetEmail, state) {
  const em = normEmail(targetEmail);
  const pages = [];
  try {
    if (browser && browser.pages) {
      const ps = await browser.pages();
      for (const p of ps || []) pages.push(p);
    }
  } catch (e) { /* */ }
  if (page) pages.push(page);

  for (const pg of pages) {
    let url = '';
    try { url = pg.url() || ''; } catch (e) { continue; }
    const u = url.toLowerCase();

    // —— accounts.google.com: chọn đúng email / Next / Verify it's you ——
    if (u.includes('accounts.google.com')) {
      try {
        const r = await pg.evaluate((want) => {
          const textOf = (el) => ((el && (el.innerText || el.textContent)) || '').trim();
          const low = (s) => String(s || '').toLowerCase();

          // 0) Màn identifier trống → điền ĐÚNG targetEmail rồi chờ Next
          if (want) {
            const inp = document.querySelector(
              'input[type="email"],input[name="identifier"],input#identifierId,'
              + 'input[autocomplete="username"],input[type="text"][name="identifier"]');
            if (inp && inp.offsetParent !== null) {
              const cur = low(inp.value || '');
              if (!cur || (cur !== want && !want.startsWith(cur) && cur !== want.split('@')[0])) {
                try {
                  inp.focus();
                  const setter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value');
                  if (setter && setter.set) setter.set.call(inp, want);
                  else inp.value = want;
                  inp.dispatchEvent(new Event('input', { bubbles: true }));
                  inp.dispatchEvent(new Event('change', { bubbles: true }));
                  return { act: 'dien_email', email: want };
                } catch (err) { /* */ }
              }
            }
          }

          // 1) Chọn đúng tài khoản trong list
          if (want) {
            const els = document.querySelectorAll(
              '[data-identifier],[data-email],li[data-identifier],div[data-identifier]');
            for (const e of els) {
              const v = low(e.getAttribute('data-identifier')
                || e.getAttribute('data-email') || '');
              if (v === want) {
                e.click();
                return { act: 'chon_tk', email: want };
              }
            }
            // fallback: click phần tử có text = email
            const all = Array.from(document.querySelectorAll('div,span,li,button'));
            for (const e of all) {
              const t = low(textOf(e));
              if (t === want || t.includes(want)) {
                const clickable = e.closest('[role="link"],[role="button"],li,div[data-identifier]') || e;
                try { clickable.click(); return { act: 'chon_tk_text', email: want }; }
                catch (err) { /* */ }
              }
            }
            // Chip khác (không phải want) → Use another account
            let coChipKhac = false;
            for (const e of els) {
              const v = low(e.getAttribute('data-identifier')
                || e.getAttribute('data-email') || '');
              if (v && v !== want) { coChipKhac = true; break; }
            }
            if (coChipKhac) {
              const buttons = Array.from(document.querySelectorAll('div,li,button,a'));
              for (const b of buttons) {
                const t = low(textOf(b));
                if (t.includes('use another account') || t.includes('dùng tài khoản khác')
                    || t.includes('dung tai khoan khac') || t.includes('another account')) {
                  try { b.click(); return { act: 'use_another', email: want }; }
                  catch (err) { /* */ }
                }
              }
            }
          }

          // 2) "Verify it's you" / Next — chỉ khi đã có email đúng trên trang
          //    (hoặc không có target = cho phép Next sau khi user gõ email)
          const body = low(document.body && document.body.innerText || '');
          const verify = body.includes("verify it's you")
            || body.includes('verify its you')
            || body.includes('xác nhận đó là bạn')
            || body.includes('xac nhan do la ban');
          const inpNow = document.querySelector(
            'input[type="email"],input[name="identifier"],input#identifierId,'
            + 'input[autocomplete="username"]');
          const inpVal = low((inpNow && inpNow.value) || '');
          const hasWant = !want || body.includes(want) || inpVal === want
            || (inpVal && want.startsWith(inpVal));
          // Không bấm Next khi đang ở màn password (user tự gõ)
          const pwd = document.querySelector('input[type="password"],input[name="Passwd"],input[name="password"]');
          if (pwd && pwd.offsetParent !== null) {
            return { act: 'cho_mat_khau' };
          }
          // Có targetEmail mà ô identifier đang sai → không Next
          if (want && inpNow && inpNow.offsetParent !== null
              && inpVal && inpVal !== want && !want.startsWith(inpVal)
              && !body.includes(want)) {
            return { act: 'sai_email_nhap', email: inpVal };
          }

          const nextLabels = ['next', 'tiếp theo', 'tiep theo', 'tiếp tục', 'tiep tuc', 'continue'];
          if ((verify || hasWant) && !pwd) {
            const buttons = Array.from(document.querySelectorAll('button,div[role="button"]'));
            for (const b of buttons) {
              const t = low(textOf(b));
              if (nextLabels.some(x => t === x || t.startsWith(x + ' '))) {
                // Tránh bấm "Create account" / "Forgot"
                if (t.includes('create') || t.includes('forgot') || t.includes('quên')) continue;
                try { b.click(); return { act: verify ? 'verify_next' : 'next', text: textOf(b).slice(0, 40) }; }
                catch (err) { /* */ }
              }
            }
            // span "Next" → closest button
            const spans = Array.from(document.querySelectorAll('span'));
            for (const sp of spans) {
              const t = low(textOf(sp));
              if (nextLabels.includes(t)) {
                const btn = sp.closest('button,div[role="button"]');
                if (btn) {
                  try { btn.click(); return { act: 'next_span', text: t }; }
                  catch (err) { /* */ }
                }
              }
            }
          }
          return { act: '' };
        }, em);
        if (r && r.act && r.act !== 'cho_mat_khau') {
          if (!state.bao[r.act + (r.email || '')]) {
            state.bao[r.act + (r.email || '')] = true;
            if (r.act.startsWith('chon')) log('→ Tự chọn tài khoản ' + (r.email || em));
            else if (r.act === 'dien_email') log('→ Điền email «' + (r.email || em) + '» vào ô đăng nhập');
            else if (r.act === 'use_another') log('→ Dùng tài khoản khác (để nhập «' + (r.email || em) + '»)');
            else if (r.act === 'verify_next') log("→ Tự bấm Next (Verify it's you)");
            else log('→ Tự bấm «' + (r.text || 'Next') + '» trên accounts.google.com');
          }
        } else if (r && r.act === 'cho_mat_khau' && !state.bao.pwd) {
          state.bao.pwd = true;
          log('⚠ Google đòi mật khẩu — gõ giúp trong cửa sổ Chrome, tool chờ rồi tự làm tiếp.');
        }
      } catch (e) { /* */ }
      continue;
    }

    // —— Chrome profile / "Make Chrome your own" / "Continue as …" ——
    // Thường hiện trên chrome://  hoặc trang chào / NTP / labs vừa mở
    try {
      const r2 = await pg.evaluate((want) => {
        const textOf = (el) => ((el && (el.innerText || el.textContent)) || '').trim();
        const low = (s) => String(s || '').toLowerCase();
        const body = low(document.body && document.body.innerText || '');

        const hasContinueAs = /continue as\s+/i.test(body)
          || /tiếp tục với\s+/i.test(body)
          || /tiep tuc voi\s+/i.test(body)
          || body.includes('make chrome your own')
          || body.includes('biến chrome thành của bạn')
          || body.includes('bien chrome thanh cua ban');

        if (!hasContinueAs) {
          // Sign in with Google / Sign in / link / form tren labs
          const buttons = Array.from(document.querySelectorAll(
            'button,a,div[role="button"],span[role="button"]'));
          for (const b of buttons) {
            const t = low(textOf(b));
            if (t.includes('sign in with google') || t.includes('dang nhap bang google')
                || (t.includes('continue with google'))
                || (t.includes('google') && t.includes('sign in'))) {
              try { b.click(); return { act: 'signin_google' }; } catch (e) { /* */ }
            }
          }
          for (const b of buttons) {
            const t = low(textOf(b));
            if ((t === 'sign in' || t === 'dang nhap'
                || t.startsWith('sign in') || t.startsWith('dang nhap'))
                && !t.includes('sign out')) {
              try { b.click(); return { act: 'signin_short' }; } catch (e) { /* */ }
            }
          }
          const formBtn = document.querySelector(
            'form[action*="signin/google"] button, a[href*="signin"], a[href*="auth/signin"]');
          if (formBtn) {
            try { formBtn.click(); return { act: 'signin_google_form' }; } catch (e) { /* */ }
          }
          const links = Array.from(document.querySelectorAll('a'));
          for (const a of links) {
            const t = low(textOf(a));
            const href = low(a.getAttribute('href') || '');
            if (href.includes('signin') || href.includes('auth/signin')
                || t.includes('sign in with google') || t === 'sign in') {
              try { a.click(); return { act: 'signin_google_link' }; } catch (e) { /* */ }
            }
          }
          return { act: '' };
        }

        // Parse "Continue as NAME" / email hiện trên dialog
        let shownEmail = '';
        const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
        const emails = body.match(emailRe) || [];
        if (emails.length) shownEmail = emails[0].toLowerCase();

        const buttons = Array.from(document.querySelectorAll('button,a,div[role="button"],input[type="submit"]'));
        const isContinueAs = (t) => t.includes('continue as') || t.includes('tiếp tục với')
          || t.includes('tiep tuc voi') || t.startsWith('continue as');
        const isUseWithout = (t) => t.includes('use without') || t.includes('dùng không cần')
          || t.includes('dung khong can') || t.includes('without an account');
        const isGotIt = (t) => t === 'got it' || t === 'ok' || t.includes('đã hiểu') || t.includes('da hieu');

        // Nếu Continu as đúng email (hoặc không có want và chỉ 1 lựa chọn đúng flow)
        for (const b of buttons) {
          const t = low(textOf(b));
          if (!isContinueAs(t) && !(t.includes('continue') && shownEmail && t.includes(shownEmail.split('@')[0]))) {
            // cũng bắt nút có text ngắn "Continue" cạnh dialog
            if (!(t === 'continue' || t === 'tiếp tục' || t === 'tiep tuc')) continue;
          }
          const btnEmails = (textOf(b).match(emailRe) || []).map(x => x.toLowerCase());
          const asEmail = btnEmails[0] || shownEmail;
          if (want) {
            if (asEmail && asEmail === want) {
              try { b.click(); return { act: 'continue_as_ok', email: asEmail }; } catch (e) { /* */ }
            }
            if (!asEmail && body.includes(want) && isContinueAs(t)) {
              try { b.click(); return { act: 'continue_as_ok', email: want }; } catch (e) { /* */ }
            }
            // sai email → không bấm Continue as
            if (asEmail && asEmail !== want) {
              // tìm Use without
              for (const b2 of buttons) {
                const t2 = low(textOf(b2));
                if (isUseWithout(t2)) {
                  try { b2.click(); return { act: 'use_without_sai_tk', email: asEmail }; } catch (e) { /* */ }
                }
              }
              return { act: 'bo_qua_sai_tk', email: asEmail };
            }
          } else {
            // TK mới: KHÔNG Continue as email có sẵn — Prefer Use without
            if (asEmail || isContinueAs(t)) {
              for (const b2 of buttons) {
                const t2 = low(textOf(b2));
                if (isUseWithout(t2)) {
                  try { b2.click(); return { act: 'use_without_tk_moi', email: asEmail }; } catch (e) { /* */ }
                }
              }
              return { act: 'bo_qua_continue_tk_moi', email: asEmail };
            }
          }
        }

        // Đúng email: bấm Continue as
        if (want && shownEmail === want) {
          for (const b of buttons) {
            const t = low(textOf(b));
            if (isContinueAs(t) || t === 'continue' || t === 'tiếp tục' || t === 'tiep tuc') {
              try { b.click(); return { act: 'continue_as_ok', email: shownEmail }; } catch (e) { /* */ }
            }
          }
        }

        // Sai email → Use without
        if (want && shownEmail && shownEmail !== want) {
          for (const b of buttons) {
            const t = low(textOf(b));
            if (isUseWithout(t)) {
              try { b.click(); return { act: 'use_without_sai_tk', email: shownEmail }; } catch (e) { /* */ }
            }
          }
          return { act: 'bo_qua_sai_tk', email: shownEmail };
        }

        // TK mới + có Continue as → Use without
        if (!want && (shownEmail || /continue as/i.test(body))) {
          for (const b of buttons) {
            const t = low(textOf(b));
            if (isUseWithout(t)) {
              try { b.click(); return { act: 'use_without_tk_moi', email: shownEmail }; } catch (e) { /* */ }
            }
          }
        }

        // Got it / dismiss nhẹ
        for (const b of buttons) {
          const t = low(textOf(b));
          if (isGotIt(t)) {
            try { b.click(); return { act: 'got_it' }; } catch (e) { /* */ }
          }
        }
        return { act: '' };
      }, em);

      if (r2 && r2.act) {
        const key = r2.act + (r2.email || '');
        if (!state.bao[key]) {
          state.bao[key] = true;
          if (r2.act === 'continue_as_ok') {
            log('→ Tự bấm «Continue as ' + (r2.email || em) + '» (đúng TK).');
          } else if (r2.act === 'use_without_sai_tk') {
            log('→ Dialog hiện «Continue as ' + (r2.email || '?')
              + '» (SAI TK, cần ' + (em || 'TK mới')
              + ') — bấm Use without an account, sẽ Sign in đúng email.');
            state.canSignin = true;
          } else if (r2.act === 'use_without_tk_moi') {
            log('→ TK mới: bỏ «Continue as ' + (r2.email || 'email cũ')
              + '» — Use without an account rồi Sign in.');
            state.canSignin = true;
          } else if (r2.act === 'bo_qua_sai_tk' || r2.act === 'bo_qua_continue_tk_moi') {
            log('→ Không bấm Continue as ' + (r2.email || '')
              + ' (sai / TK mới) — chờ nút Use without hoặc Sign in.');
            state.canSignin = true;
          } else if (r2.act.startsWith('signin')) {
            log('→ Tự bấm «Sign in with Google».');
          } else if (r2.act === 'got_it') {
            log('→ Đã dismiss dialog Chrome.');
          }
        }
      }
    } catch (e) { /* */ }
  }
}

// 2026-10 — PB_MEDIA: tu dong go mat khau (keystroke that) khi Google hien o
// password. Dung puppeteer-real-browser (rebrowser) de tranh "browser not secure".
// KHONG log mat khau.
async function autoTypePassword(browser, password, state) {
  if (!password) return;
  if (state.pwdTyped) return;
  let pages = [];
  try { pages = await browser.pages(); } catch (e) { return; }
  const SEL = 'input[type="password"][name="Passwd"],input[type="password"],input[name="password"]';
  for (const pg of pages) {
    let u = '';
    try { u = (pg.url() || '').toLowerCase(); } catch (e) { continue; }
    if (!u.includes('accounts.google.com')) continue;
    let has = false;
    try {
      has = await pg.evaluate((sel) => {
        const el = document.querySelector(sel);
        return !!(el && el.offsetParent !== null && !(el.value && el.value.length));
      }, SEL);
    } catch (e) { continue; }
    if (!has) continue;
    try {
      await pg.waitForSelector(SEL, { visible: true, timeout: 4000 });
      await pg.focus(SEL);
      for (const ch of String(password)) {
        await pg.keyboard.type(ch, { delay: 45 + Math.floor(Math.random() * 95) });
      }
      await new Promise(r => setTimeout(r, 220 + Math.floor(Math.random() * 260)));
      await pg.keyboard.press('Enter');
      state.pwdTyped = true;
      state.bao.pwd = true;
      log('Da tu dien mat khau + Enter (keystroke that).');
    } catch (e) {
      log('tu dien mat khau loi: ' + (e && e.message));
    }
    return;
  }
}

async function main() {
  const cfgPath = process.argv[2];
  if (!cfgPath || !fs.existsSync(cfgPath)) {
    out({ event: 'error', message: 'thieu file config' });
    process.exit(2);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const moduleDirs = cfg.moduleDirs || [];
  // 29/09 — timeout mặc định 180s (có progress); vẫn cho phép Python tăng.
  const timeoutMs = Math.max(30000, parseInt(cfg.timeoutMs, 10) || 180000);
  const pollMs = Math.max(1000, parseInt(cfg.pollMs, 10) || 2000);
  const flowUrl = cfg.flowUrl || 'https://labs.google/fx';
  const signinUrl = 'https://labs.google/fx/api/auth/signin';
  const preferNextAuth = cfg.preferNextAuth !== false;
  const needPsid = cfg.needPsid !== false;
  const targetEmail = normEmail(cfg.targetEmail || cfg.email || '');
  const autoPassword = String(cfg.password || '');
  if (autoPassword) log('auto-login: se tu go email + mat khau (keystroke that).');
  // newAccount chỉ khi Python bảo + không có targetEmail. Có email = TK cũ
  // → labs.google/fx, giữ session, Continue as đúng email.
  const isNewAccount = !!cfg.newAccount && !targetEmail;
  // accounts.google.com signin trống CHỈ cho TK mới; TK cũ → labs.google/fx
  const startUrl = (cfg.startUrl || '').trim()
    || (isNewAccount
      ? 'https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn&flowEntry=ServiceLogin'
      : flowUrl);

  let connect;
  try {
    ({ connect } = requireFrom(moduleDirs, 'puppeteer-real-browser'));
  } catch (e) {
    out({ event: 'error', message: 'khong nap duoc puppeteer-real-browser: ' + e.message });
    process.exit(3);
  }

  const mh = cfg.screen || {};
  const scrW = Math.max(1024, parseInt(mh.width, 10) || 1280);
  const scrH = Math.max(768, parseInt(mh.height, 10) || 900);
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--ignore-certificate-errors',
    `--window-size=${Math.min(1200, scrW)},${Math.min(800, scrH - 48)}`,
    '--window-position=80,60',
    '--lang=vi-VN',
  ];

  const hoSo = (cfg.profileDir || '').trim();
  if (hoSo) {
    try { fs.mkdirSync(hoSo, { recursive: true }); } catch (e) { /* */ }
    log('ho so Chrome: ' + hoSo);
  }
  if (targetEmail) log('target email: ' + targetEmail);
  if (isNewAccount) log('che do TK MOI — man dang nhap trong, khong Continue as email cu');
  else log('che do TK CU — mo ' + startUrl + ' (giu session, Continue as dung email neu hoi)');

  const options = {
    headless: false,
    turnstile: true,
    args,
    customConfig: hoSo ? { userDataDir: hoSo } : {},
    connectOption: { defaultViewport: null },
    disableXvfb: false,
    ignoreAllFlags: false,
  };
  if (cfg.chromePath && fs.existsSync(cfg.chromePath)) {
    options.executablePath = cfg.chromePath;
  }

  let browser, page;
  try {
    ({ browser, page } = await connect(options));
  } catch (e) {
    out({ event: 'error', message: 'connect Chrome hong: ' + e.message });
    process.exit(4);
  }

  out({ event: 'ready' });

  // Chỉ xoá NextAuth khi xoaNextAuth=true VÀ newAccount — Lấy Cookie TK cũ
  // tuyệt đối KHÔNG wipe (giữ LOGIN=CO / Continue as).
  if (cfg.xoaNextAuth && isNewAccount) {
    const TEN = ['__Secure-next-auth.session-token',
                 '__Host-next-auth.csrf-token',
                 '__Secure-next-auth.callback-url'];
    let n = 0;
    for (const u of ['https://labs.google/', 'https://labs.google/fx']) {
      for (const name of TEN) {
        try { await page.deleteCookie({ name, url: u }); n++; } catch (e) { /* */ }
      }
    }
    for (const domain of ['labs.google', '.labs.google']) {
      for (const name of TEN) {
        try { await page.deleteCookie({ name, domain, path: '/' }); n++; }
        catch (e) { /* */ }
      }
    }
    log('Da xoa phien NextAuth cu (' + n + ' luot) — phai DANG NHAP LAI labs.google.');
  } else if (cfg.xoaNextAuth && !isNewAccount) {
    log('Bo qua xoaNextAuth — TK cu / LOGIN=CO: giu session, mo labs.google/fx.');
  }

    // Seed cookie tu Python (restore session sau credit bearer-only / profile trong Google)
  const seedList = Array.isArray(cfg.seedCookies) ? cfg.seedCookies : [];
  if (seedList.length) {
    try {
      try { await page.goto('https://labs.google/fx', { waitUntil: 'domcontentloaded', timeout: 45000 }); }
      catch (e0) { log('goto labs truoc seed: ' + (e0 && e0.message)); }
      let nOk = 0;
      for (const c of seedList) {
        try {
          const spec = Object.assign({}, c);
          if (!spec.url && !spec.domain) spec.url = 'https://labs.google/';
          await page.setCookie(spec);
          nOk++;
        } catch (e1) {
          try {
            const spec2 = {
              name: c.name, value: c.value,
              url: (c.domain && String(c.domain).includes('google.com'))
                ? 'https://www.google.com/' : 'https://labs.google/',
              secure: !!c.secure, httpOnly: !!c.httpOnly,
            };
            await page.setCookie(spec2);
            nOk++;
          } catch (e2) { /* skip */ }
        }
      }
      log('Da seed ' + nOk + '/' + seedList.length + ' cookie vao Chrome (restore session).');
    } catch (e) {
      log('seedCookies loi: ' + (e && e.message));
    }
  }

  if (cfg.forceSignin && targetEmail) {
    log('forceSignin=ON — se bam Sign in with Google + dien ' + targetEmail);
  }

log('Mo ' + startUrl + ' — dang nhap Google neu duoc hoi; tool tu bam Next/Continue as dung TK.');

  try {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    log('goto start: ' + e.message + ' — van tiep tuc poll cookie');
  }


  // Sau seed: neu da co next-auth, khong can doi Sign in
  if (seedList.length) {
    try {
      const list0 = await collectCookies(page, browser);
      if (hasName(list0, '__Secure-next-auth.session-token')) {
        log('Sau seed: da co next-auth — coi nhu restore OK, tiep tuc poll.');
      } else {
        try { await handleDialogs(page, browser, targetEmail, { bao: {}, canSignin: true }); }
        catch (e3) { /* */ }
      }
    } catch (e) { /* */ }
  }
  // Sau login Google, đảm bảo về labs.google/fx (không đứng ở flow.google.com)
  let daGotoFx = !isNewAccount; // existing: đã mở flowUrl; new: mở accounts trước
  if (!isNewAccount && !String(startUrl).includes('labs.google')) {
    daGotoFx = false;
  }

  let stopping = false;
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch (e) { return; }
    if ((msg && msg.cmd) === 'quit') {
      stopping = true;
      log('nhan quit — dong Chrome');
      try { await browser.close(); } catch (e) { /* */ }
      process.exit(0);
    }
  });

  // Giai doan 2 (SuperVeo): co session-token roi moi xac thuc, co tran.
  const xacThucBat = cfg.xacThucTrongTrang !== false;
  const xacThucToiDa = Math.max(1, parseInt(cfg.xacThucToiDa, 10) || 15);
  let soLanXacThuc = 0;
  // Tran auto-poll kieu SuperVeo (xem ghi chu dau ban va 30/09).
  const tranTuDongMs = Math.max(0, parseInt(cfg.tranTuDongMs, 10) || 0);
  let thayHoatDongLogin = false;

  const t0 = Date.now();
  let lastLog = 0;
  let daSangSignin = false;
  let dialogState = { bao: {}, canSignin: false };
  let lastDialog = 0;

  while (!stopping && (Date.now() - t0) < timeoutMs) {
    await new Promise(r => setTimeout(r, pollMs));
    if (stopping) break;

    // Dialog handlers mỗi ~2s
    if (Date.now() - lastDialog >= 1800) {
      lastDialog = Date.now();
      try {
        await handleDialogs(page, browser, targetEmail, dialogState);
      } catch (e) {
        /* ignore */
      }
    }

    // PB_MEDIA auto-login: tu go mat khau khi den man password
    if (autoPassword && !dialogState.pwdTyped) {
      try { await autoTypePassword(browser, autoPassword, dialogState); }
      catch (e) { /* ignore */ }
    }

    let list = [];
    try { list = await collectCookies(page, browser); } catch (e) {
      log('poll cookie loi: ' + e.message);
      continue;
    }
    const na = hasName(list, '__Secure-next-auth.session-token');
    const ps = hasPsid(list);
    let url = '';
    try { url = page.url(); } catch (e) { /* */ }
    out({ event: 'waiting', hasNextAuth: na, hasPsid: ps, url, count: list.length,
          leftSec: Math.max(0, Math.round((timeoutMs - (Date.now() - t0)) / 1000)) });

    const dangDangNhap = hasName(list, '__Secure-next-auth.state')
        || hasName(list, '__Secure-next-auth.pkce.code_verifier');
    // «Co ai dang dang nhap» = trang da nhay sang accounts.google.
    // KHONG dung PSID (ho so tu_dong luon co san) va KHONG dung pkce/state
    // (chinh labs.google/fx tu dat, du khong ai cham gi) — xem ghi chu
    // ban va 30/09.
    if (String(url || '').toLowerCase().includes('accounts.google')) {
      thayHoatDongLogin = true;
    }
    // `!na`: da co session-token thi dang o giai doan XAC THUC, khong phai
    // dang cho login — dung dong Chrome giua luc do, se mat cookie vua chop.
    if (tranTuDongMs && !thayHoatDongLogin && !na
        && (Date.now() - t0) > tranTuDongMs) {
      out({ event: 'error',
            message: 'Tu dong: qua ' + Math.round(tranTuDongMs / 1000)
              + 's khong thay phien va khong ai dang nhap — dong Chrome'
              + ' (kieu SuperVeo, khong treo giu khoa ho so).' });
      try { await browser.close(); } catch (e) { /* */ }
      process.exit(1);
    }
    if (dangDangNhap) {
      if (Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        log('Dang trong vong dang nhap (con pkce/state) — CHUA chop, doi khep vong.');
      }
      continue;
    }

    const ready = preferNextAuth ? na : (na || ps);
    if (ready) {
      // Co session-token KHONG co nghia la cookie dung duoc — phai hoi
      // getUserSettings tu trong trang (SuperVeo lam vay).
      let apiValid = true;
      let apiStatus = -1;
      let apiWhy = 'khong xac thuc (cfg tat)';
      if (xacThucBat) {
        soLanXacThuc += 1;
        const kq = await xacThucTrongTrang(page, flowUrl);
        apiValid = !!kq.ok;
        apiStatus = kq.status;
        apiWhy = kq.why || '';
        if (!apiValid && kq.khongRo) {
          // Endpoint chet / mang loi — KHONG phai cookie chet. Nhan cookie
          // ngay, dung cham chet oan va dung cho het 15 lan vo ich.
          log('Khong xac thuc duoc (endpoint tra ' + apiStatus
            + ') — coi nhu KHONG RO, nhan cookie luon.');
          apiValid = null;
        } else if (apiValid) {
          log('Xac thuc trong trang: ' + apiWhy + ' — cookie SONG.');
        } else {
          log('Xac thuc lan ' + soLanXacThuc + '/' + xacThucToiDa
            + ': phien chua dung duoc (' + apiStatus + ').'
            + (apiWhy ? ' (' + String(apiWhy).slice(0, 120) + ')' : ''));
          out({ event: 'waiting', hasNextAuth: na, hasPsid: ps, url,
                count: list.length, apiValid: false, apiStatus: apiStatus,
                xacThucLan: soLanXacThuc, xacThucToiDa: xacThucToiDa,
                leftSec: Math.max(0, Math.round(
                  (timeoutMs - (Date.now() - t0)) / 1000)) });
          if (soLanXacThuc < xacThucToiDa) continue;
          log('Het ' + xacThucToiDa + ' lan xac thuc — tra cookie kem canh bao'
            + ' apiValid=false, de Python quyet.');
        }
      }
      const cookies = cookieHeader(list);
      const names = list.map(c => c.name).join(', ');
      log('Bat duoc cookie: next-auth=' + na + ' psid=' + ps + ' (' + list.length + ')');
      log('Ten cookie: ' + names.slice(0, 400));
      out({
        event: 'done',
        ok: true,
        cookies,
        hasNextAuth: na,
        hasPsid: ps,
        apiValid: apiValid,
        apiStatus: apiStatus,
        apiWhy: String(apiWhy || '').slice(0, 200),
        cookieCount: list.length,
        currentUrl: url,
        targetEmail: targetEmail || '',
        autoDetected: true,
      });
      try { await browser.close(); } catch (e) { /* */ }
      process.exit(0);
    }

    // Sau khi user login ở accounts.google — sang labs.google/fx
    
    // forceSignin: neu van o labs chua next-auth sau ~6s -> mo auth/signin 1 lan
    if (cfg.forceSignin && !daSangSignin && (Date.now() - t0) > 6000 && !na) {
      const uLow = (url || '').toLowerCase();
      if (uLow.includes('labs.google') && !uLow.includes('accounts.google')) {
        daSangSignin = true;
        try {
          log('forceSignin — mo /fx/api/auth/signin de kich hoat Google OAuth');
          await page.goto(signinUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch (e) {
          log('goto signin: ' + (e && e.message));
        }
        try { await handleDialogs(page, browser, targetEmail, dialogState); }
        catch (e) { /* */ }
      }
    }

const elapsed = Date.now() - t0;
    if (!daGotoFx && elapsed > 4000) {
      // Nếu đang ở accounts và chưa xong password thì đợi; nếu đã rời accounts hoặc đã lâu → fx
      const onAccounts = (url || '').includes('accounts.google.com');
      const onPwd = onAccounts && dialogState.bao.pwd;
      if (!onAccounts || elapsed > 25000) {
        daGotoFx = true;
        log('Sang https://labs.google/fx de lay phien NextAuth…');
        try {
          await page.goto(flowUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch (e) {
          log('goto fx: ' + e.message);
        }
        continue;
      }
      if (onPwd) {
        // chờ user gõ password
      }
    }

    // Chưa có NextAuth → Sign in labs
    if (!na && elapsed > 8000 && (!daSangSignin || dialogState.canSignin)) {
      if (!daSangSignin || (dialogState.canSignin && elapsed > 12000)) {
        daSangSignin = true;
        dialogState.canSignin = false;
        log('Chua co phien NextAuth — sang trang dang nhap labs.google.');
        try {
          await page.goto(signinUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch (e) {
          log('goto signin: ' + e.message);
        }
        try {
          await new Promise(r => setTimeout(r, 1000));
          const nut = await page.$('form[action*="signin/google"] button');
          if (nut) {
            await nut.click();
            log('Da bam «Sign in with Google» — chon dung tai khoan trong cua so.');
          } else {
            log('Khong thay nut dang nhap — bam «Sign in with Google» giup.');
          }
        } catch (e) {
          log('khong bam duoc nut dang nhap: ' + e.message);
        }
        continue;
      }
    }

    // Progress mỗi 5s (ngắn hơn 8s cũ)
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      const left = Math.max(0, Math.round((timeoutMs - (Date.now() - t0)) / 1000));
      log('Dang cho login… next-auth=' + (na ? 'YES' : 'no')
        + ' PSID=' + (ps ? 'YES' : 'no') + ' con ~' + left + 's · ' + (url || ''));
    }
  }

  out({ event: 'error', message: 'Timeout cho cookie (next-auth/PSID) — dang nhap trong cua so Chrome roi bam lai' });
  try { await browser.close(); } catch (e) { /* */ }
  process.exit(1);
}

main().catch(e => {
  out({ event: 'error', message: String(e && e.message || e) });
  process.exit(1);
});
