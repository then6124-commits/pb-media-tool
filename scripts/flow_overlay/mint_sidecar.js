/**
 * mint_sidecar.js — bộ mint reCAPTCHA bằng puppeteer-real-browser (rebrowser).
 *
 * VÌ SAO CÓ FILE NÀY
 * ------------------
 * Bộ mint cũ chạy Playwright. Playwright để lộ rò rỉ CDP `Runtime.enable`,
 * và BotGuard của reCAPTCHA Enterprise dùng đúng tín hiệu đó để nhận ra
 * trình duyệt bị điều khiển tự động → token bị chấm điểm nền thấp → mọi
 * lệnh video ăn 403 PUBLIC_ERROR_UNUSUAL_ACTIVITY ngay token đầu.
 *
 * `puppeteer-real-browser` (qua `rebrowser-puppeteer-core`) vá đúng rò rỉ đó.
 * Đây là cách SuperVeo mint (đã soi `capture-sidecar.js` của nó). Script này
 * là bản viết LẠI của riêng tool, chỉ dùng chung thư viện OSS (MIT), không
 * chép code của SuperVeo.
 *
 * GIAO THỨC (nói chuyện với puppeteer_minter.py qua stdin/stdout)
 * --------------------------------------------------------------
 *   argv[2] = đường dẫn file config JSON:
 *     { cookies, projectId, siteKey, action, chromePath, moduleDirs[],
 *       offscreen, blockResources }
 *   stdout, mỗi dòng một JSON:
 *     {"event":"log","message":...}       ghi log cho Python in ra
 *     {"event":"ready"}                    Chrome + grecaptcha sẵn sàng
 *     {"event":"error","message":...}      hỏng không cứu được → Python dựng lại
 *     {"id":N,"ok":true,"tokens":[...]}    trả token cho lệnh mint id=N
 *     {"id":N,"ok":false,"error":...}
 *   stdin, mỗi dòng một JSON:
 *     {"id":N,"cmd":"mint","count":1,"action":"VIDEO_GENERATION","projectId":"..."}
 *     {"id":N,"cmd":"fetch","url":"...","headers":{...},"body":"...","timeoutMs":90000}
 *     {"cmd":"quit"}
 *   fetch → {"id":N,"kind":"fetch","ok":true,"status":200,"body":"..."}
 *   (POST aisandbox trong CÙNG Chrome vừa mint — cookies/session/BotGuard khớp token)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function out(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function log(msg) { out({ event: 'log', message: String(msg) }); }

// ── Nạp puppeteer-real-browser từ một trong các thư mục node_modules được đưa ──
function requireFrom(dirs, name) {
  for (const d of dirs) {
    try {
      return require(path.join(d, name));
    } catch (e) { /* thử thư mục kế */ }
  }
  // thử require thường (NODE_PATH / cùng cây)
  return require(name);
}

async function main() {
  const cfgPath = process.argv[2];
  if (!cfgPath || !fs.existsSync(cfgPath)) {
    out({ event: 'error', message: 'thiếu file config' });
    process.exit(2);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (cfg.mintUrl && String(cfg.mintUrl).indexOf('labs.google') >= 0) {
    log('BO mintUrl labs.google/fx — chi flow.google.com');
    cfg.mintUrl = '';
  }
  const moduleDirs = cfg.moduleDirs || [];
  const siteKeyDefault = cfg.siteKey;
  const actionDefault = cfg.action || 'VIDEO_GENERATION';

  let connect;
  try {
    ({ connect } = requireFrom(moduleDirs, 'puppeteer-real-browser'));
  } catch (e) {
    out({ event: 'error', message: 'không nạp được puppeteer-real-browser: ' + e.message });
    process.exit(3);
  }

  // ── Cờ Chrome ──
  //
  // Bộ dưới đây SOI TỪ TIẾN TRÌNH THẬT của SuperVeo đang chạy (29/08), không
  // phải đọc mã của nó — vì mã nguồn khai một đằng, Chrome chạy một nẻo.
  // Khác biệt đáng kể so với bản cũ của tool:
  //
  //   window-size : 2048x1104 (bằng màn hình) — bản cũ để 800x600. Cửa sổ
  //                 800x600 là dấu hiệu bot kinh điển; người thật mở to.
  //   start-maximized : có
  //   lang        : en-US — bản cũ để vi-VN
  //   KHÔNG dùng --app=, chỉ mở about:blank rồi goto
  //   KHÔNG --disable-gpu (SuperVeo để GPU thật chạy, WebGL khai đúng card)
  //
  // Đo trên trình duyệt mint sống của SuperVeo:
  //   screen 2048x1152 · window 2048x1025 · hasFocus true · webdriver false
  //   WebGL: ANGLE (NVIDIA GeForce RTX 4060 … D3D11)
  const nhuSuperVeo = cfg.superveoMode !== false;
  const mh = cfg.screen || {};
  const scrW = Math.max(1024, parseInt(mh.width, 10) || 1920);
  const scrH = Math.max(768, parseInt(mh.height, 10) || 1080);
  // 01/10 — mintAbout: duc tren /about bang ho so TAM, khong dang nhap
  // (xem ghi chu dau ban va). Bat tu Python qua cfg.mintAbout.
  const mintAbout = cfg.mintAbout === true;
  const args = [
    '--disable-blink-features=AutomationControlled',
    // SuperVeo dung ca --disable-features=AutomationControlled (khac
    // --disable-blink-features o tren). Them cho giong han.
    '--disable-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--ignore-certificate-errors',
  ];
  // 28/09: ĐO TIẾN TRÌNH THẬT của SuperVeo 3.7.2 lúc nó đang dựng video —
  // đây là bộ cờ nó tự thêm (phần còn lại là cờ mặc định của
  // puppeteer-real-browser):
  //
  //   --window-size=2048,1025   (bằng màn hình, KHÔNG phải 800x600)
  //   --window-position=-32000,-32000
  //   --lang=vi-VN              (KHÔNG phải en-US)
  //   --no-sandbox --disable-dev-shm-usage
  //   --ignore-certificate-errors --disable-translate --mute-audio
  //   --user-data-dir=<hồ sơ RIÊNG, đã đăng nhập Google>
  //
  // KHÔNG có: --incognito, --app=…, --disable-gpu, --start-maximized.
  // (Mã nguồn bản cũ của nó khai --incognito + 800x600 + --app — bản đang
  //  chạy đã bỏ hết; tin tiến trình, đừng tin mã nguồn cũ.)
  if (nhuSuperVeo) {
    args.push(`--window-size=${scrW},${scrH - 48}`,
              '--lang=vi-VN',
              '--no-sandbox',
              '--disable-translate',
              '--mute-audio');
  } else {
    args.push('--disable-gpu',
              '--window-size=800,600',
              '--app=https://flow.google.com/');
  }
  if (cfg.offscreen !== false) args.push('--window-position=-32000,-32000');

  // Proxy dân cư (KiotProxy) cho trình duyệt mint — reCAPTCHA chấm điểm theo IP
  // lúc mint. Chrome --proxy-server nhận http/https/socks5, KHÔNG nhận user:pass
  // trong URL; nếu proxy có auth thì bóc ra để xử lý ở page.authenticate().
  let proxyAuth = null;
  if (cfg.proxyUrl) {
    try {
      const u = new URL(cfg.proxyUrl);
      if (u.username || u.password) {
        proxyAuth = { username: decodeURIComponent(u.username),
                      password: decodeURIComponent(u.password) };
      }
      const scheme = u.protocol.replace(':', '');
      args.push(`--proxy-server=${scheme}://${u.host}`);
    } catch (e) {
      // URL không phân tích được → đưa nguyên (dạng ip:port)
      args.push(`--proxy-server=${cfg.proxyUrl}`);
    }
  }

  // Hồ sơ Chrome THẬT của tài khoản (24/09). Mint bằng hồ sơ tạm + nhồi cookie
  // thì reCAPTCHA chấm điểm thấp → batchexecute trả PUBLIC_ERROR_UNUSUAL_ACTIVITY,
  // trong khi Chrome thật của người dùng tạo video bình thường. Dùng đúng hồ sơ
  // đã đăng nhập sẵn cho giống hệt.
  // mintAbout: BO QUA profileDir — de puppeteer-real-browser tu tao ho
  // so tam (giong `lighthouse.*` cua SuperVeo). Khong dang nhap, khong
  // khoa ho so cua tai khoan, khong lo CookieMismatch.
  const hoSo = mintAbout ? '' : (cfg.profileDir || '').trim();
  if (mintAbout) {
    log('mintAbout: duc token tren flow.google.com/about bang HO SO TAM'
      + ' (khong dang nhap) — kieu SuperVeo 01/10.');
  }
  if (hoSo) {
    // Thư mục PHẢI do node tạo, đừng tin bên Python đã tạo: tool chạy bằng
    // Python của Microsoft Store nên mọi lần nó ghi %LOCALAPPDATA%\PBMedia
    // đều bị chuyển hướng vào LocalCache của gói, còn node.exe thấy đường
    // thật → puppeteer mở chrome-out.log trong thư mục chưa tồn tại và ném
    // ENOENT, sidecar chết dựng lại vô hạn (đo 28/09).
    try { fs.mkdirSync(hoSo, { recursive: true }); }
    catch (e) { log('không tạo được thư mục hồ sơ mint: ' + e.message); }
    log('hồ sơ Chrome: ' + hoSo);
  }
  const options = {
    headless: false,
    turnstile: true,
    args,
    customConfig: hoSo ? { userDataDir: hoSo } : {},
    connectOption: { defaultViewport: { width: scrW, height: Math.max(600, scrH - 48) } },
    disableXvfb: false,
    ignoreAllFlags: false,
  };
  if (cfg.chromePath && fs.existsSync(cfg.chromePath)) options.executablePath = cfg.chromePath;

  let browser, page;
  try {
    ({ browser, page } = await connect(options));
  } catch (e) {
    out({ event: 'error', message: 'connect Chrome hỏng: ' + e.message });
    process.exit(4);
  }

  // 01/10 — mintAbout: flow.google.com bat Trusted Types, gan script.src
  // bang chuoi bi chan ('This document requires TrustedScriptURL').
  // Tat CSP cho trang mint qua CDP thi chen duoc script reCAPTCHA.
  // Phai goi TRUOC khi goto moi an.
  if (mintAbout) {
    try {
      await page.setBypassCSP(true);
      log('mintAbout: da tat CSP cho trang mint (de chen reCAPTCHA).');
    } catch (e) {
      log('mintAbout: khong tat duoc CSP: ' + (e && e.message));
    }
  }

  // Proxy có user:pass → xác thực ở tầng page (Chrome không nhận trong URL)
  if (proxyAuth) {
    try { await page.authenticate(proxyAuth); } catch (e) { log('proxy auth lỗi: ' + e.message); }
  }

  // ── Chặn tài nguyên thừa để trang mint tải nhanh (giống SuperVeo) ──
  if (cfg.blockResources !== false) {
    const BLOCK_TYPES = new Set(['font', 'image', 'media', 'stylesheet']);
    const BLOCK_PAT = ['fonts.googleapis.com', 'fonts.gstatic.com', '.woff', '.woff2',
      '.ttf', '.otf', '.eot', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
      '.ico', '.mp4', '.webm', '.mp3', '.wav', 'analytics', 'tracking', 'gtag',
      'facebook.com', 'twitter.com', 'doubleclick.net'];
    const ALLOW_PAT = ['recaptcha', 'grecaptcha', 'gstatic.com/recaptcha', 'google.com/recaptcha'];
    try {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        try {
          const u = (req.url() || '').toLowerCase();
          if (ALLOW_PAT.some(p => u.includes(p))) return req.continue();
          if (BLOCK_TYPES.has(req.resourceType())) return req.abort();
          if (BLOCK_PAT.some(p => u.includes(p))) return req.abort();
          return req.continue();
        } catch (e) { try { req.continue(); } catch (_) {} }
      });
    } catch (e) { log('không bật được chặn tài nguyên: ' + e.message); }
  }

  // ── Nạp cookie đăng nhập (chuỗi "k=v; k=v") cho .google.com + labs.google ──
  async function setCookies(cookieStr) {
    const cks = [];
    for (const part of (cookieStr || '').split(';')) {
      const i = part.indexOf('=');
      if (i < 1) continue;
      const name = part.slice(0, i).trim();
      const value = part.slice(i + 1).trim();
      if (!name || !value) continue;
      // 28/09: MỖI cookie chỉ vào ĐÚNG MỘT miền.
      //
      // Bản cũ nhồi mọi cookie vào CẢ `.google.com` LẪN `labs.google`, nên
      // Chrome giữ hai bản SID/__Secure-1PSID khác miền cho cùng một phiên →
      // mở flow.google.com là bị đá sang `accounts.google.com/CookieMismatch`
      // → trang Flow không tải → không có grecaptcha → phải lùi về
      // labs.google/fx, nơi chỉ đúc ra token 538 ký tự (token thật trên trang
      // Flow dài ~2.500 ký tự). Đó là gốc của 403 reCAPTCHA (đo 28/09).
      // 28/09 (sửa lần 2) — `__Host-` KHÔNG phải cứ là của labs.
      //
      // Bản vá sáng nay đẩy MỌI cookie `__Host-` sang labs.google, nhưng
      // `__Host-1PLSID`, `__Host-3PLSID`, `__Host-GAPS` là của
      // accounts.google.com. Nhồi chúng vào labs là Chrome ôm một mớ cookie
      // đăng nhập sai chỗ → mở Flow bị đá sang
      // `accounts.google.com/CookieMismatch` (ảnh người dùng 22:5x).
      //
      // Chỉ next-auth mới thuộc labs. Cookie riêng của accounts.google.com thì
      // BỎ HẲN: trình duyệt đúc token không cần đăng nhập lại từ đầu, nó chỉ
      // cần phiên Google sẵn có để mở được trang Flow.
      if (name.includes('next-auth')) {
        cks.push({ name, value, url: 'https://labs.google/', secure: true,
                   sameSite: 'Lax' });
        continue;
      }
      if (name.startsWith('__Host-') || name === 'LSID'
          || name === 'ACCOUNT_CHOOSER' || name === 'EMAIL') {
        continue;   // của accounts.google.com — nhồi vào là sinh CookieMismatch
      }
      // Cookie danh tính Google: một bản duy nhất trên `.google.com`
      // (đã phủ cả flow.google.com, labs.google được phục vụ riêng).
      cks.push({ name, value, domain: '.google.com', path: '/', secure: true,
                 sameSite: 'None' });
    }
    let n = 0;
    for (const c of cks) {
      try { await page.setCookie(c); n++; } catch (e) { /* Chrome từ chối vài cookie */ }
    }
    return n;
  }

  // ── Cookie inject: SuperVeo-style khi hồ sơ đã LOGIN=CO ──
  //
  // 28/09 CookieMismatch: nếu Cookie_10 đã có SID+SAPISID mà vẫn setCookie
  // chuỗi TK (có thể khác phiên / lệch __Secure-*) → Google đá
  // accounts.google.com/CookieMismatch. SuperVeo KHÔNG inject khi dùng
  // userDataDir đã login — chỉ dùng cookie native của hồ sơ.
  async function snapshotPhien() {
    const cs = await page.cookies(
      'https://flow.google.com/', 'https://www.google.com/',
      'https://accounts.google.com/');
    const names = cs.map(c => c.name);
    const hasSid = names.some(n => n === 'SID' || n === '__Secure-1PSID'
                                 || n === '__Secure-3PSID');
    const hasOsid = names.some(n => n === 'OSID' || n === '__Secure-OSID');
    const hasSap = names.some(n => n === 'SAPISID' || n === '__Secure-1PAPISID'
                                 || n === '__Secure-3PAPISID');
    return {
      cs, names, hasSid, hasOsid, hasSap,
      loginCo: !!(hasSid && hasSap),
    };
  }

  async function clearAuthOverlay() {
    // Xóa cookie auth trong jar (overlay inject) — không đụng next-auth labs.
    const urls = [
      'https://www.google.com/', 'https://flow.google.com/',
      'https://accounts.google.com/', 'https://labs.google/',
    ];
    let n = 0;
    for (const u of urls) {
      let cs = [];
      try { cs = await page.cookies(u); } catch (e) { continue; }
      for (const c of cs) {
        const nm = c.name || '';
        const auth = (
          nm === 'SID' || nm === 'HSID' || nm === 'SSID' || nm === 'APISID'
          || nm === 'SAPISID' || nm === 'OSID' || nm === 'SIDCC'
          || nm.startsWith('__Secure-1PSID') || nm.startsWith('__Secure-3PSID')
          || nm.startsWith('__Secure-1PAPISID') || nm.startsWith('__Secure-3PAPISID')
          || nm === '__Secure-OSID' || nm.startsWith('__Host-GAPS')
        );
        if (!auth) continue;
        try { await page.deleteCookie(c); n++; } catch (e) { /* ignore */ }
      }
    }
    return n;
  }

  let didInject = false;
  let nck = 0;
  let phien = { hasSid: false, hasOsid: false, hasSap: false, loginCo: false, cs: [] };
  try {
    phien = await snapshotPhien();
    log('kiem phien Cookie_10/profile=' + (hoSo || '(tam)')
        + ' cookie=' + (phien.cs || []).length
        + ' SID=' + phien.hasSid + ' OSID=' + phien.hasOsid
        + ' SAPISID=' + phien.hasSap
        + (phien.hasSid ? ' | LOGIN=CO session Google' : ' | LOGIN=CHUA (thieu SID)'));
  } catch (e) {
    log('kiem phien loi: ' + (e && e.message || e));
  }

  if (cfg.noCookie) {
    log('KHONG nap cookie vao trinh duyet mint (kieu SuperVeo / noCookie)');
  } else if (phien.loginCo || (phien.hasSid && phien.hasSap)) {
    // Profile đã login — CẤM inject (tránh CookieMismatch inject vs native).
    log('skip inject because profile logged in (LOGIN=CO SID+SAPISID) — dung cookie native ho so | profile='
        + (hoSo || '(tam)'));
  } else if (phien.hasSid && hoSo) {
    // Có SID trong hồ sơ bền → cũng skip (đủ LOGIN=CO theo log Cookie_10).
    log('skip inject because profile logged in (SID co san, SuperVeo style) | profile='
        + (hoSo || '(tam)'));
  } else {
    // Hồ sơ chưa login / hồ sơ tạm → inject cookie TK TRƯỚC goto.
    nck = await setCookies(cfg.cookies);
    didInject = nck > 0;
    log('da nap ' + nck + ' cookie TRUOC goto | profile=' + (hoSo || '(tam)'));
    try {
      phien = await snapshotPhien();
      log('kiem phien SAU inject Cookie_10/profile=' + (hoSo || '(tam)')
          + ' cookie=' + (phien.cs || []).length
          + ' SID=' + phien.hasSid + ' OSID=' + phien.hasOsid
          + ' SAPISID=' + phien.hasSap
          + (phien.hasSid ? ' | LOGIN=CO session Google' : ' | LOGIN=CHUA (thieu SID)'));
    } catch (e) { /* ignore */ }
    if (!phien.hasSid) {
      log('HARD-STOP mint: ho so CHUA login Google (thieu SID). '
          + 'Mo Chrome ho so Cookie_10, vao https://flow.google.com roi F5. '
          + 'KHONG mint labs.google/fx.');
    }
  }
  await new Promise(r => setTimeout(r, 1000));

  // ── Điều hướng tới trang project (điểm cao) rồi chờ grecaptcha ──
  let curProject = (cfg.projectId || '').trim();
  async function gotoMint(pid, forceUrl) {
    // 28/09+: mint trên flow.google.com (project / trang chủ).
    // KHÔNG lùi labs.google/fx — trang đó chỉ đúc token ~538 ký tự → 403.
    const url = forceUrl
      || cfg.mintUrl
      || (pid ? ('https://flow.google.com/project/' + pid)
              : 'https://flow.google.com/');
    try {
      log('goto mint: ' + url + ' | profile=' + (hoSo || '(tam)'));
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      const sc = resp ? (resp.status() || 0) : 0;
      if (sc >= 400) {
        log('goto HTTP ' + sc + ' — ' + url + (sc >= 500
          ? ' (Error ' + sc + ' — KHONG lui labs.google/fx)' : ''));
      }
      return { ok: sc > 0 && sc < 400, status: sc, url };
    } catch (e) {
      log('goto ' + url + ' lỗi: ' + e.message);
      return { ok: false, status: 0, url, error: String(e.message || e) };
    }
  }
  // 01/10 — TU NAP reCAPTCHA Enterprise (xem ghi chu dau ban va).
  // Trang /about khong tu nap, nen phai chen script vao roi moi cho.
  async function napRecaptchaEnterprise(key) {
    try {
      const kq = await page.evaluate(async (siteKey) => {
        if (window.grecaptcha && window.grecaptcha.enterprise) {
          return 'da co san';
        }
        // Da chen roi thi khong chen lan hai.
        const cu = document.querySelector(
          'script[data-pb-recaptcha="1"]');
        if (!cu) {
          await new Promise((res, rej) => {
            // Trusted Types: neu setBypassCSP chua an thi thu policy.
            let lamUrl = (u) => u;
            try {
              if (window.trustedTypes
                  && window.trustedTypes.createPolicy) {
                const pol = window.trustedTypes.createPolicy(
                  'pb-recaptcha-' + Date.now(),
                  { createScriptURL: (u) => u });
                lamUrl = (u) => pol.createScriptURL(u);
              }
            } catch (eTT) { /* cam dat policy -> dung chuoi thuong */ }
            const diaChi = 'https://www.google.com/recaptcha/enterprise.js'
              + '?render=' + encodeURIComponent(siteKey);
            const sc = document.createElement('script');
            sc.src = lamUrl(diaChi);
            sc.async = true;
            sc.defer = true;
            sc.setAttribute('data-pb-recaptcha', '1');
            sc.onload = () => res();
            sc.onerror = () => rej(new Error('tai script that bai'));
            (document.head || document.documentElement).appendChild(sc);
          });
        }
        // Doi grecaptcha.enterprise xuat hien (script tu khoi tao).
        const han = Date.now() + 15000;
        while (Date.now() < han) {
          if (window.grecaptcha && window.grecaptcha.enterprise
              && typeof window.grecaptcha.enterprise.execute
                 === 'function') {
            return 'nap xong';
          }
          await new Promise(r => setTimeout(r, 200));
        }
        return 'het gio cho enterprise';
      }, key);
      log('mintAbout: nap reCAPTCHA Enterprise -> ' + kq);
      return String(kq).indexOf('het gio') < 0;
    } catch (e) {
      log('mintAbout: nap reCAPTCHA loi: ' + (e && e.message));
      return false;
    }
  }

  async function grecaptchaReady(ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        const ok = await page.evaluate(() => {
          const g = window.grecaptcha;
          if (!g) return false;
          if (g.enterprise && typeof g.enterprise.execute === 'function') return true;
          if (typeof g.execute === 'function') return true;
          return false;
        });
        if (ok) return true;
      } catch (e) { /* trang đang chuyển */ }
      await new Promise(r => setTimeout(r, 400));
    }
    try {
      const info = await page.evaluate(() => ({
        href: location.href,
        title: document.title,
        hasG: !!window.grecaptcha,
        hasEnt: !!(window.grecaptcha && window.grecaptcha.enterprise),
      }));
      log('grecaptcha chưa sẵn — url=' + info.href + ' title=' + info.title
          + ' grecaptcha=' + info.hasG + ' enterprise=' + info.hasEnt);
    } catch (e) {}
    return false;
  }

  // Chuỗi thử — 24/09: MINT NGAY TRÊN flow.google.com TRƯỚC.
  //
  // Flow đã dọn sang flow.google.com (labs.google/fx/tools/flow giờ chỉ 308
  // sang đó). Token mint ở labs.google/fx vẫn đúng site key nhưng KHÁC trang
  // với nơi request thật xuất phát → backend chấm điểm thấp và trả
  // 403 PUBLIC_ERROR_UNUSUAL_ACTIVITY ngay từ token đầu (đo 24/09: hai tài
  // khoản, cả ảnh lẫn video, mint mới cũng hỏng). labs.google/fx giữ làm
  // đường lùi vì trang đó chắc chắn nhúng sẵn grecaptcha.
  // KHONG them labs.google/fx — token ~538 ky tu bi 403 100%.
  // Project 500 / khong grecaptcha → thu flow.google.com/ + alt project.
  const thuTu = [];
  if (mintAbout) {
    // Dung dung trang SuperVeo dang duc. Khong /project/, khong can login.
    thuTu.push([null, 'https://flow.google.com/about']);
  }
  if (cfg.mintUrl) thuTu.push([null, cfg.mintUrl]);
  if (curProject) thuTu.push([null, 'https://flow.google.com/project/' + curProject]);
  for (const ap of (cfg.altProjectIds || [])) {
    const p = String(ap || '').trim();
    if (p && p !== curProject) {
      thuTu.push([null, 'https://flow.google.com/project/' + p]);
    }
  }
  thuTu.push([null, 'https://flow.google.com/']);
  // Retry project 1 lan neu lan dau HTTP 5xx
  if (curProject) thuTu.push([null, 'https://flow.google.com/project/' + curProject]);

  log('mint URL chain (KHONG labs.google/fx) | profile=' + (hoSo || '(tam)'));
  let ready = false;
  let lastHttp = 0;
  for (const [pid, force] of thuTu) {
    const g = await gotoMint(pid, force);
    lastHttp = (g && g.status) || 0;
    let hrefNow = '';
    try { hrefNow = await page.evaluate(() => location.href); } catch (e) {}
    log('sau goto href=' + hrefNow + ' http=' + lastHttp);
    if (hrefNow.indexOf('CookieMismatch') >= 0
        || hrefNow.indexOf('cookiemismatch') >= 0) {
      log('CookieMismatch — Google reject inject vs profile cookies (hoac Cookie_10 lech/hong / dual Chrome).');
      if (didInject && !cfg._retriedMismatch) {
        cfg._retriedMismatch = true;
        log('CookieMismatch recovery: clear overlay inject + reopen goto flow.google.com 1 lan (native profile)');
        try {
          const nd = await clearAuthOverlay();
          log('da xoa ' + nd + ' cookie auth overlay');
        } catch (e) {
          log('clear overlay loi: ' + (e && e.message || e));
        }
        didInject = false;
        // Re-goto trang chủ Flow một lần, không inject lại.
        try {
          const g2 = await gotoMint(null, 'https://flow.google.com/');
          lastHttp = (g2 && g2.status) || 0;
          try { hrefNow = await page.evaluate(() => location.href); } catch (e2) {}
          log('sau CookieMismatch retry href=' + hrefNow + ' http=' + lastHttp);
        } catch (e) {
          log('CookieMismatch retry goto loi: ' + (e && e.message || e));
        }
        if (hrefNow.indexOf('CookieMismatch') >= 0
            || hrefNow.indexOf('cookiemismatch') >= 0) {
          log('CookieMismatch van con sau clear — emit cookie_mismatch (Python: temp jar / Cookie Flow).');
          out({ event: 'cookie_mismatch', message:
            'CookieMismatch sau clear overlay — profile lech hoac dual Chrome' });
          out({ event: 'error', message: 'CookieMismatch' });
          try { await browser.close(); } catch (e) {}
          process.exit(6);
        }
      } else if (!didInject && !cfg._retriedMismatchNative) {
        // skip-inject / native Cookie_10 vẫn CookieMismatch → hồ sơ hỏng
        // hoặc dual Chrome cùng user-data-dir. Không clear native (mất login).
        // Báo Python: thử temp profile + jar 1 lần, rồi fallback Cookie Flow.
        cfg._retriedMismatchNative = true;
        log('CookieMismatch voi cookie native (skip inject) — Cookie_10 lech/hong '
            + 'hoac dual Chrome. KHONG clear native; emit cookie_mismatch.');
        out({ event: 'cookie_mismatch', message:
          'native CookieMismatch — can temp jar / Cookie Flow ext auto' });
        out({ event: 'error', message: 'CookieMismatch' });
        try { await browser.close(); } catch (e) {}
        process.exit(6);
      } else {
        log('CookieMismatch (het retry) — emit cookie_mismatch + thoat');
        out({ event: 'cookie_mismatch', message: 'CookieMismatch het retry' });
        out({ event: 'error', message: 'CookieMismatch' });
        try { await browser.close(); } catch (e) {}
        process.exit(6);
      }
    }
    if (hrefNow.indexOf('labs.google') >= 0) {
      log('BO trang labs.google (token ~538) — KHONG execute recaptcha o day');
      continue;
    }
    if (hrefNow.indexOf('/about') >= 0 && mintAbout) {
      // Day la trang DICH, khong phai loi — SuperVeo duc ngay tai day.
      log('mintAbout: dang o /about — day la trang duc, khong phai loi.');
      // /about khong tu nap reCAPTCHA — phai tu chen script vao.
      await napRecaptchaEnterprise(cfg.siteKey || '');
      ready = await grecaptchaReady(20000);
      if (ready) {
        log('grecaptcha OK tai /about | ho so tam (khong dang nhap)');
        break;
      }
      log('/about chua co grecaptcha — thu URL ke');
      continue;
    }
    if (hrefNow.indexOf('/about') >= 0) {
      // HARD FAIL: /about = chua login. Temp jar recovery thuong roi vao day —
      // KHONG continue URL chain (spam), emit ve Python de dung rebuild + fallback Cookie Flow.
      log('Flow da /about (chua login) — HARD FAIL temp/native recovery. KHONG mint.');
      out({ event: 'about_not_logged_in', message:
        'flow.google.com/about sau goto/inject — chua login; dung sidecar rebuild, fallback Cookie Flow' });
      out({ event: 'error', message: 'about_not_logged_in' });
      try { await browser.close(); } catch (e) {}
      process.exit(7);
    }
    if (lastHttp >= 500) {
      log('project/page Error ' + lastHttp
          + ' → mint KHONG fell back labs.google/fx; thu flow.google.com / project khac');
      continue;
    }
    ready = await grecaptchaReady(20000);
    if (ready) {
      let o = '';
      try { o = await page.evaluate(() => location.href); } catch (e) {}
      log('grecaptcha OK tại ' + (o || force || '?') + ' | profile=' + (hoSo || '(tam)'));
      break;
    }
    log('trang này không có grecaptcha — thử URL kế (van o flow.google.com)');
  }
  if (!ready) {
    // Neu da inject (temp jar) ma van khong grecaptcha — coi la hard fail recovery
    // (thuong do redirect /about). Python se KHONG rebuild temp lan nua.
    if (didInject) {
      log('grecaptcha thieu SAU inject (temp/jar) — HARD FAIL recovery, fallback Cookie Flow.');
      out({ event: 'about_not_logged_in', message:
        'grecaptcha thieu sau inject — temp recovery fail' });
      out({ event: 'error', message: 'about_not_logged_in' });
      try { await browser.close(); } catch (e) {}
      process.exit(7);
    }
    out({ event: 'error', message: 'grecaptcha không sẵn sàng' });
    try { await browser.close(); } catch (e) {}
    process.exit(5);
  }

  // Hâm nóng trước khi nhận việc — tránh 403 ngay sau khi dựng mint.
  const HAM_NONG = Math.max(0, parseInt(cfg.warmupMs, 10) || 6000);
  if (HAM_NONG > 0) {
    log('hâm nóng trang mint ' + (HAM_NONG / 1000) + 's trước khi nhận việc');
    try { await giaNguoiDung(); } catch (e) {}
    await new Promise(r => setTimeout(r, Math.floor(HAM_NONG / 2)));
    try { await giaNguoiDung(); } catch (e) {}
    await new Promise(r => setTimeout(r, Math.floor(HAM_NONG / 2)));
  }

  // 01/10 — bao UA cua CHINH trinh duyet dang duc token. UA nop phai
  // khop trinh duyet duc, khong thi Google cham la bot (xem ghi chu
  // ban va + _chot_ua trong mint_tien_ich.py).
  let _uaMint = '';
  try {
    _uaMint = await page.evaluate(() => navigator.userAgent);
  } catch (e) { /* khong doc duoc thi thoi, giu nhu cu */ }
  out({ event: 'ready', ua: _uaMint || '' });

  // ── Làm mới ngữ cảnh trang định kỳ ──
  //
  // Bản trước chỉ `gotoMint()` khi ĐỔI project, ngoài ra `execute()` mãi trên
  // đúng MỘT page load, suốt cả buổi. Bản Playwright
  // (`flow_api.RecaptchaMinter`) thì `RELOAD_EVERY = 1` — tải lại trang trước
  // MỖI token — kèm ghi chú đã trả giá mới biết: "assessment của reCAPTCHA
  // Enterprise gắn với NGỮ CẢNH TRANG: page càng cũ, càng nhiều execute không
  // kèm tương tác người thì điểm càng rớt". Engine đang chạy là bản Puppeteer
  // nên chưa bao giờ có đoạn đó.
  //
  // Không tải lại mỗi token (mất ~1.5s/lần, phí khi đang trơn) mà cứ
  // RELOAD_EVERY lần `execute()` thì làm mới một lần — ngữ cảnh không bao giờ
  // quá cũ, mà vẫn giữ được cái lợi tốc độ của đệm token.
  // 0 = TẮT hẳn. `Math.max(1, ...)` của bản trước làm 0 thành 1 — đặt "tắt"
  // lại hoá ra tải lại MỖI execute, tệ hơn hẳn mặc định. Phải để lọt số 0.
  const _re = parseInt(cfg.reloadEvery, 10);
  const RELOAD_EVERY = Number.isFinite(_re) && _re >= 0 ? _re : 8;
  let daExec = 0;

  async function lamMoiNeuCu() {
    if (RELOAD_EVERY <= 0) return;          // tắt — SuperVeo không tải lại
    if (daExec < RELOAD_EVERY) return;
    daExec = 0;
    log('làm mới trang mint sau ' + RELOAD_EVERY + ' lần execute');
    await gotoMint(curProject);
    if (!(await grecaptchaReady(20000))) {
      // KHONG lui labs — thu flow.google.com/
      log('lam moi: khong grecaptcha tren project — thu flow.google.com/');
      await gotoMint(null, 'https://flow.google.com/');
      await grecaptchaReady(20000);
    }
  }

  // Khai "đang xem" + giả thao tác người. Cũng lấy từ bản Playwright
  // (`JS_VISIBLE` + `page.mouse`): cửa sổ ẩn / tab nền bị reCAPTCHA coi là
  // không có người thật ngồi trước, và execute không kèm tương tác nào thì
  // điểm thấp. Chạy trước mỗi lô mint, tốn vài trăm ms.
  async function giaNguoiDung() {
    try {
      await page.evaluate(() => {
        try {
          Object.defineProperty(document, 'visibilityState',
                                { value: 'visible', configurable: true });
          Object.defineProperty(document, 'hidden',
                                { value: false, configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('focus'));
        } catch (e) { /* trang chặn ghi đè — bỏ qua */ }
      });
    } catch (e) { /* trang đang chuyển */ }
    try {
      const r = () => Math.random();
      await page.mouse.move(120 + r() * 380, 140 + r() * 260);
      await new Promise(s => setTimeout(s, 120 + r() * 180));
      await page.mouse.move(380 + r() * 420, 260 + r() * 300);
      await new Promise(s => setTimeout(s, 100 + r() * 160));
      try { await page.mouse.wheel({ deltaY: 180 + r() * 220 }); } catch (e) {}
      await new Promise(s => setTimeout(s, 200 + r() * 250));
    } catch (e) { /* mouse không dùng được — không sao */ }
  }

  // ── Mint đúng một action, trong ngữ cảnh trang (page context) ──
  async function mint(siteKey, action, count) {
    return await page.evaluate(async (sk, act, n) => {
      const ps = [];
      for (let i = 0; i < n; i++) {
        ps.push(
          window.grecaptcha.enterprise.execute(sk, { action: act })
            .then(t => ({ ok: true, token: t }))
            .catch(e => ({ ok: false, error: String((e && e.message) || e) }))
        );
      }
      return Promise.all(ps);
    }, siteKey, action, count);
  }

  // ── Vòng nhận lệnh từ Python ──
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    line = (line || '').trim();
    if (!line) return;
    let cmd;
    try { cmd = JSON.parse(line); } catch (e) { return; }
    if (cmd.cmd === 'quit') {
      try { await browser.close(); } catch (e) {}
      process.exit(0);
    }
    // ── Lấy at/SNlM0e + cookie TƯƠI ngay trong trình duyệt (24/09) ──
    // Cào bằng HTTP hay bị Google trả trang đăng nhập vì cookie trong sổ đã
    // bị xoay (__Secure-1PSIDTS, SIDCC). Chrome này đang mở đúng trang Flow
    // và tự làm mới cookie, nên hỏi thẳng nó là chắc nhất.
    if (cmd.cmd === 'wiz') {
      const id2 = cmd.id;
      try {
        const wantPid = (cmd.projectId || '').trim();
        if (wantPid && wantPid !== curProject) {
          curProject = wantPid;
          await gotoMint(curProject);
        }
        const w = await page.evaluate(() => {
          const d = window.WIZ_global_data || {};
          return { at: d.SNlM0e || '', fsid: d.FdrFJe || '', bl: d.cfb2h || '',
                   href: location.href };
        });
        let ck = '';
        try {
          const cs = await page.cookies('https://flow.google.com/',
                                        'https://labs.google/');
          ck = cs.map(c => c.name + '=' + c.value).join('; ');
        } catch (e) {}
        let scripts = [];
        try {
          scripts = await page.evaluate(() => performance
            .getEntriesByType('resource')
            .map(r => r.name)
            .filter(u => u.indexOf('.js') >= 0));
        } catch (e) {}
        out({ id: id2, ok: !!w.at, at: w.at, fsid: w.fsid, bl: w.bl,
              href: w.href, cookies: ck, scripts });
      } catch (e) {
        out({ id: id2, ok: false, error: String(e.message || e) });
      }
      return;
    }
    // ── POST aisandbox trong CÙNG Chrome mint (page.evaluate fetch) ──
    // Token reCAPTCHA bám BotGuard/phiên trang mint. Gửi từ Node/curl_cffi
    // (TLS/IP/UA khác) hay ăn 403 UNUSUAL_ACTIVITY dù token vừa đúc OK.
    // SuperVeo-style: captcha-bound create đi fetch trong trang; Node = fallback.
    if (cmd.cmd === 'fetch') {
      const idF = cmd.id;
      try {
        const wantPid = (cmd.projectId || '').trim();
        if (wantPid && wantPid !== curProject) {
          curProject = wantPid;
          await gotoMint(curProject);
        }
        const url = String(cmd.url || '');
        const headers = cmd.headers && typeof cmd.headers === 'object' ? cmd.headers : {};
        const body = (cmd.body == null) ? '' : String(cmd.body);
        const timeoutMs = Math.max(5000, Math.min(180000, Number(cmd.timeoutMs) || 90000));
        const res = await page.evaluate(async (u, h, b, ms) => {
          const ctrl = new AbortController();
          const tmr = setTimeout(() => ctrl.abort(), ms);
          try {
            const r = await fetch(u, {
              method: 'POST',
              headers: h || {},
              body: b || undefined,
              // aisandbox SuperVeo capture: KHÔNG gửi Cookie — chỉ Bearer.
              credentials: 'omit',
              mode: 'cors',
              signal: ctrl.signal,
            });
            const text = await r.text();
            return { ok: true, status: r.status, body: text };
          } catch (e) {
            return { ok: false, status: 0, body: '',
                     error: String((e && e.message) || e) };
          } finally {
            clearTimeout(tmr);
          }
        }, url, headers, body, timeoutMs);
        out({ id: idF, kind: 'fetch', ok: !!res.ok && (res.status > 0),
              status: res.status || 0, body: res.body || '',
              error: res.error || '' });
      } catch (e) {
        out({ id: idF, kind: 'fetch', ok: false, status: 0, body: '',
              error: String(e.message || e) });
      }
      return;
    }
    if (cmd.cmd !== 'mint') return;
    const id = cmd.id;
    try {
      // Đổi project giữa chừng (điểm cao hơn khi mint trên trang đang chạy)
      const wantPid = (cmd.projectId || '').trim();
      if (wantPid && wantPid !== curProject) {
        curProject = wantPid;
        const g = await gotoMint(curProject);
        if ((g && g.status >= 500) || !(await grecaptchaReady(20000))) {
          log('doi project fail (HTTP ' + ((g && g.status) || '?')
              + ') — thu flow.google.com/, KHONG labs.google/fx');
          await gotoMint(null, 'https://flow.google.com/');
          await grecaptchaReady(20000);
        }
      }
      const soLuong = Math.max(1, cmd.count || 1);
      let hrefMint = '';
      try { hrefMint = await page.evaluate(() => location.href); } catch (e) {}
      log('mint execute action=' + (cmd.action || actionDefault)
          + ' href=' + hrefMint + ' profile=' + (hoSo || '(tam)'));
      if (hrefMint.indexOf('labs.google') >= 0) {
        log('HARD-STOP: dang o labs.google — KHONG execute (tranh token 538)');
        out({ id, ok: false, tokens: [],
              error: 'HARD-STOP labs.google mint page' });
        return;
      }
      await lamMoiNeuCu();
      await giaNguoiDung();
      daExec += soLuong;      // đếm theo SỐ EXECUTE, không phải số lệnh
      const results = await mint(cmd.siteKey || siteKeyDefault,
                                 cmd.action || actionDefault,
                                 soLuong);
      const rawTok = results.filter(r => r.ok && r.token).map(r => r.token);
      const lens = rawTok.map(t => (t || '').length);
      log('mint xong n=' + rawTok.length + ' len=[' + lens.join(',') + ']');
      const tokens = rawTok.filter(t => (t || '').length >= 1500);
      if (rawTok.length && !tokens.length) {
        log('HARD-STOP: token cut max=' + Math.max.apply(null, lens)
            + ' < 1500 — KHONG tra token (IMAGE/VIDEO se 403). '
            + 'Mint phai o flow.google.com + ho so Cookie_10 da login.');
      }
      const errs = results.filter(r => !r.ok).map(r => r.error);
      out({ id, ok: tokens.length > 0, tokens, errors: errs.slice(0, 2) });
    } catch (e) {
      out({ id, ok: false, error: String(e.message || e) });
    }
  });

  // Chrome tự đóng (crash) → báo Python để nó dựng lại
  browser.on('disconnected', () => {
    out({ event: 'error', message: 'Chrome mint đã đóng' });
    process.exit(6);
  });
}

main().catch((e) => {
  out({ event: 'error', message: 'sidecar hỏng: ' + (e && e.message || e) });
  process.exit(1);
});
