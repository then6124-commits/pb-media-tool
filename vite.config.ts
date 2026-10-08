import crypto from 'node:crypto'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage } from 'http'
import { spawn, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const host = process.env.TAURI_DEV_HOST
const __viteDir = path.dirname(fileURLToPath(import.meta.url))

/** Browser cannot set Cookie header - map X-PB-Cookie → Cookie on the proxy. */
function attachPbCookie(
  proxyReq: { setHeader: (k: string, v: string) => void; removeHeader: (k: string) => void },
  req: IncomingMessage,
) {
  const raw = req.headers['x-pb-cookie']
  const val = Array.isArray(raw) ? raw[0] : raw
  if (val) {
    proxyReq.setHeader('Cookie', val)
    proxyReq.removeHeader('x-pb-cookie')
  }
}

/** Mirror SuperVeo/CapCut: %LOCALAPPDATA%\PBMedia\chrome_flow_accounts\browser_N */
function chromeProfileDir(browserId: number): string {
  const n = Math.min(4, Math.max(1, Math.floor(browserId) || 1))
  const local =
    process.env.LOCALAPPDATA ||
    path.join(os.homedir(), 'AppData', 'Local')
  const dir = path.join(local, 'PBMedia', 'chrome_flow_accounts', `browser_${n}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function findChromeExe(): string {
  const candidates = [
    process.env.CHROME_PATH || '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    ),
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return ''
}

function findPython(): string {
  for (const c of ['py', 'python', 'python3']) {
    try {
      const r = spawnSync(c, ['-c', 'import sys; print(sys.executable)'], {
        encoding: 'utf8',
        windowsHide: true,
      })
      if (r.status === 0 && r.stdout?.trim()) return r.stdout.trim().split(/\r?\n/)[0]
    } catch {
      /* continue */
    }
  }
  return ''
}

function scriptsDir(): string {
  return path.join(__viteDir, 'scripts')
}

function runPyJson(scriptName: string, args: string[], timeoutMs = 60000): Record<string, unknown> {
  const py = findPython()
  const script = path.join(scriptsDir(), scriptName)
  if (!py) return { ok: false, detail: 'Khong tim thay python' }
  if (!fs.existsSync(script)) return { ok: false, detail: `Thieu ${scriptName}` }
  const r = spawnSync(py, [script, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    env: process.env,
  })
  const text = ((r.stdout || '') + '\n' + (r.stderr || '')).trim()
  const lines = text.split(/\r?\n/).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]) as Record<string, unknown>
    } catch {
      /* try previous */
    }
  }
  return {
    ok: false,
    detail: `Script ${scriptName} khong tra JSON (status=${r.status}): ${text.slice(0, 200)}`,
  }
}

/** Đăng nhập Grok (x.ai) bằng email + mật khẩu trong Chrome hồ sơ riêng → cookie grok.com. */
function runGrokLoginSidecar(email: string, password: string, key = ''): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const script = path.join(scriptsDir(), 'grok_login_sidecar.js')
    if (!fs.existsSync(script)) {
      resolve({ ok: false, detail: 'Thieu scripts/grok_login_sidecar.js' })
      return
    }
    const moduleDirs = [
      path.join(__viteDir, 'node_modules'),
      'Y:\\SUPER VEO\\resources\\scripts\\node_modules',
      'K:\\capcut 102026\\node_modules',
    ].filter((d) => fs.existsSync(d))
    if (!moduleDirs.length) {
      resolve({ ok: false, detail: 'Khong thay puppeteer-real-browser — chay «npm install puppeteer-real-browser» trong thu muc app' })
      return
    }
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    // Mỗi tài khoản một hồ sơ Chrome: theo khoá đã lưu, không thì theo email, không thì khoá mới
    const slug = (key || email || `grok_${Date.now()}`).toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 60)
    const profileDir = path.join(local, 'PBMedia', 'chrome_grok', slug)
    const timeoutMs = email && password ? 300000 : 600000 // tự đăng nhập tay: chờ 10 phút
    const cfgPath = path.join(os.tmpdir(), `pb_grok_${Date.now()}.json`)
    fs.writeFileSync(cfgPath, JSON.stringify({ email, password, profileDir, moduleDirs, chromePath: findChromeExe(), timeoutMs }), 'utf8')
    const child = spawn('node', [script, cfgPath], { cwd: scriptsDir(), windowsHide: false, env: process.env })
    let buf = ''
    let settled = false
    const finish = (obj: Record<string, unknown>) => {
      if (settled) return
      settled = true
      try {
        fs.unlinkSync(cfgPath) // có mật khẩu — xoá ngay
      } catch {
        /* ignore */
      }
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      resolve(obj)
    }
    const timer = setTimeout(() => finish({ ok: false, detail: 'Het gio cho dang nhap Grok' }), timeoutMs + 20000)
    child.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      const parts = buf.split(/\r?\n/)
      buf = parts.pop() || ''
      for (const line of parts) {
        try {
          const ev = JSON.parse(line) as Record<string, unknown>
          if (ev.event === 'done' && ev.ok && ev.cookies) {
            clearTimeout(timer)
            finish({ ok: true, cookies: ev.cookies, cookieCount: ev.cookieCount || 0, profileDir, key: slug })
          } else if (ev.event === 'error') {
            clearTimeout(timer)
            finish({ ok: false, detail: String(ev.message || 'loi sidecar') })
          }
        } catch {
          /* dòng không phải JSON */
        }
      }
    })
    child.on('close', () => {
      clearTimeout(timer)
      finish({ ok: false, detail: 'Chrome dong truoc khi dang nhap xong' })
    })
  })
}

/** CapCut/SuperVeo cookie_capture_sidecar.js via puppeteer-real-browser. */
function runCookieSidecar(opts: {
  profileDir: string
  email?: string
  password?: string
  timeoutMs?: number
  newAccount?: boolean
  startUrl?: string
}): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const script = path.join(scriptsDir(), 'cookie_capture_sidecar.js')
    if (!fs.existsSync(script)) {
      resolve({ ok: false, detail: 'Thieu scripts/cookie_capture_sidecar.js' })
      return
    }
    const moduleDirs = [
      // Uu tien node_modules cua chinh project (da npm install puppeteer-real-browser)
      path.join(__viteDir, 'node_modules'),
      // Fallback: SuperVeo / capcut bundle (neu project chua cai)
      'Y:\\SUPER VEO\\resources\\scripts\\node_modules',
      'K:\\capcut 102026\\node_modules',
    ].filter((d) => fs.existsSync(d))
    if (!moduleDirs.length) {
      resolve({ ok: false, detail: 'Khong thay puppeteer-real-browser (can K:\\capcut 102026\\node_modules)' })
      return
    }
    const chromePath = findChromeExe()
    const cfg: Record<string, unknown> = {
      profileDir: opts.profileDir,
      chromePath,
      moduleDirs,
      timeoutMs: opts.timeoutMs || 180000,
      pollMs: 2500,
      flowUrl: 'https://labs.google/fx',
      preferNextAuth: true,
      needPsid: true,
      targetEmail: (opts.email || '').trim().toLowerCase(),
      newAccount: !!opts.newAccount,
      xoaNextAuth: false,
      xacThucTrongTrang: true,
      screen: { width: 1280, height: 900 },
    }
    // Auto-login: password + mo thang trang nhap TK Google de tu go email/pass.
    if (opts.password) cfg.password = opts.password
    if (opts.startUrl) cfg.startUrl = opts.startUrl
    const cfgPath = path.join(os.tmpdir(), `pb_ckcap_${Date.now()}.json`)
    try {
      fs.writeFileSync(cfgPath, JSON.stringify(cfg), 'utf8')
    } catch (e) {
      resolve({ ok: false, detail: `Ghi config sidecar loi: ${String(e).slice(0, 100)}` })
      return
    }
    const child = spawn('node', [script, cfgPath], {
      cwd: scriptsDir(),
      windowsHide: false,
      env: process.env,
    })
    let buf = ''
    let settled = false
    const finish = (obj: Record<string, unknown>) => {
      if (settled) return
      settled = true
      try {
        fs.unlinkSync(cfgPath)
      } catch {
        /* ignore */
      }
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      resolve(obj)
    }
    const timer = setTimeout(() => {
      finish({ ok: false, detail: 'Sidecar timeout — login trong Chrome roi bam lai' })
    }, (opts.timeoutMs || 180000) + 15000)
    child.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      const parts = buf.split(/\r?\n/)
      buf = parts.pop() || ''
      for (const line of parts) {
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line) as Record<string, unknown>
          if (ev.event === 'done' && ev.ok && ev.cookies) {
            clearTimeout(timer)
            finish({
              ok: true,
              cookies: ev.cookies,
              hasNextAuth: !!ev.hasNextAuth,
              hasPsid: !!ev.hasPsid,
              cookieCount: ev.cookieCount || 0,
              via: 'sidecar',
              detail: `Sidecar lay ${ev.cookieCount || '?'} cookie (next-auth=${ev.hasNextAuth ? 'YES' : 'no'})`,
            })
          } else if (ev.event === 'error') {
            clearTimeout(timer)
            finish({ ok: false, detail: String(ev.message || 'sidecar error'), via: 'sidecar' })
          }
        } catch {
          /* ignore non-json */
        }
      }
    })
    child.stderr?.on('data', () => {
      /* swallow */
    })
    child.on('close', () => {
      if (!settled) {
        clearTimeout(timer)
        finish({ ok: false, detail: 'Sidecar thoat som — khong lay duoc cookie', via: 'sidecar' })
      }
    })
  })
}

/** Module dirs co puppeteer-real-browser (uu tien SuperVeo bundle day du). */
function pbMintModuleDirs(): string[] {
  return [
    // Uu tien node_modules cua chinh project
    path.join(__viteDir, 'node_modules'),
    // Fallback: SuperVeo / capcut bundle
    'Y:\\SUPER VEO\\resources\\scripts\\node_modules',
    'K:\\capcut 102026\\node_modules',
  ].filter((d) => fs.existsSync(d))
}

/** Mint reCAPTCHA Enterprise token tu ho so Chrome DA LOGIN (giong MUSE/SuperVeo). */
function runMintSidecar(opts: {
  profileDir: string
  action?: string
  timeoutMs?: number
}): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const script = path.join(scriptsDir(), 'recaptcha_mint_sidecar.js')
    if (!fs.existsSync(script)) {
      resolve({ ok: false, detail: 'Thieu scripts/recaptcha_mint_sidecar.js' })
      return
    }
    const moduleDirs = pbMintModuleDirs()
    if (!moduleDirs.length) {
      resolve({ ok: false, detail: 'Khong thay puppeteer-real-browser (can SuperVeo/capcut node_modules)' })
      return
    }
    const cfg = {
      profileDir: opts.profileDir,
      chromePath: findChromeExe(),
      moduleDirs,
      action: opts.action || 'IMAGE_GENERATION',
      timeoutMs: opts.timeoutMs || 90000,
    }
    const cfgPath = path.join(os.tmpdir(), `pb_mint_${Date.now()}.json`)
    try {
      fs.writeFileSync(cfgPath, JSON.stringify(cfg), 'utf8')
    } catch (e) {
      resolve({ ok: false, detail: `Ghi config mint loi: ${String(e).slice(0, 100)}` })
      return
    }
    const child = spawn('node', [script, cfgPath], {
      cwd: scriptsDir(),
      windowsHide: false,
      env: process.env,
    })
    let buf = ''
    let settled = false
    const finish = (obj: Record<string, unknown>) => {
      if (settled) return
      settled = true
      try { fs.unlinkSync(cfgPath) } catch { /* ignore */ }
      try { child.kill() } catch { /* ignore */ }
      resolve(obj)
    }
    const timer = setTimeout(() => {
      finish({ ok: false, detail: 'Mint reCAPTCHA timeout' })
    }, (opts.timeoutMs || 90000) + 20000)
    child.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      const parts = buf.split(/\r?\n/)
      buf = parts.pop() || ''
      for (const line of parts) {
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line) as Record<string, unknown>
          if (ev.event === 'done' && ev.ok && ev.token) {
            clearTimeout(timer)
            finish({ ok: true, token: ev.token, len: ev.len || 0, mode: ev.mode || '', detail: `Mint OK (${ev.len} ky tu, ${ev.mode})` })
          } else if (ev.event === 'error') {
            clearTimeout(timer)
            finish({ ok: false, detail: String(ev.message || 'mint error') })
          }
        } catch { /* ignore non-json */ }
      }
    })
    child.stderr?.on('data', () => { /* swallow */ })
    child.on('close', () => {
      if (!settled) {
        clearTimeout(timer)
        finish({ ok: false, detail: 'Mint sidecar thoat som' })
      }
    })
  })
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

function jsonRes(res: { statusCode: number; setHeader: Function; end: Function }, code: number, obj: unknown) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(obj))
}

const ALLOWED_URL_PREFIXES = [
  'https://labs.google/',
  'https://flow.google.com/',
  'https://accounts.google.com/',
]

function chromeLaunchPlugin(): Plugin {
  return {
    name: 'pb-chrome-launch',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ''

        // --- MINT reCAPTCHA (text-to-image) ---
        if (url.startsWith('/local/recaptcha/mint')) {
          if (req.method !== 'POST') { jsonRes(res, 405, { ok: false, detail: 'POST only' }); return }
          const body = await readBody(req)
          const browserId = Math.min(4, Math.max(1, Math.floor(Number(body.browserId) || 1)))
          const action = String(body.action || 'IMAGE_GENERATION')
          const profileDir = chromeProfileDir(browserId)
          // Dong Chrome dang giu ho so (Chrome khoa user-data-dir)
          const closed = runPyJson('close_chrome_profile.py', [String(browserId)], 30000)
          const mint = await runMintSidecar({ profileDir, action, timeoutMs: 90000 })
          jsonRes(res, 200, { ...mint, browserId, closed })
          return
        }

        // --- SAVE IMAGE to output folder (text-to-image ket qua) ---
        if (url.startsWith('/local/image/save')) {
          if (req.method !== 'POST') { jsonRes(res, 405, { ok: false, detail: 'POST only' }); return }
          const body = await readBody(req)
          const imgUrl = String(body.url || '').trim()
          const dir = String(body.dir || '').trim()
          const nameRaw = String(body.name || '').trim() || `img_${Date.now()}`
          const cookie = String(body.cookie || '')
          if (!/^https?:\/\//.test(imgUrl)) { jsonRes(res, 400, { ok: false, detail: 'URL anh khong hop le' }); return }
          try {
            const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0' }
            let r = await fetch(imgUrl, { headers })
            if (!r.ok && cookie) r = await fetch(imgUrl, { headers: { ...headers, Cookie: cookie } })
            if (!r.ok) { jsonRes(res, 200, { ok: false, detail: `Tai anh loi HTTP ${r.status}` }); return }
            const ab = await r.arrayBuffer()
            const bufImg = Buffer.from(ab)
            const ct = String(r.headers.get('content-type') || 'image/png')
            const ext = ct.includes('jpeg') || ct.includes('jpg') ? '.jpg' : ct.includes('webp') ? '.webp' : '.png'
            const safeName = nameRaw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 60) + ext
            let savedPath = ''
            try {
              if (dir) {
                fs.mkdirSync(dir, { recursive: true })
                savedPath = path.join(dir, safeName)
                fs.writeFileSync(savedPath, bufImg)
              }
            } catch (e) {
              jsonRes(res, 200, { ok: false, detail: `Ghi file loi: ${String(e).slice(0, 120)}`, bytes: bufImg.length })
              return
            }
            const dataUrl = `data:${ct};base64,${bufImg.toString('base64')}`
            jsonRes(res, 200, { ok: true, path: savedPath, bytes: bufImg.length, dataUrl })
          } catch (e) {
            jsonRes(res, 200, { ok: false, detail: `Save anh loi: ${String(e).slice(0, 140)}` })
          }
          return
        }

        // --- ĐĂNG NHẬP GROK (email + mật khẩu) → cookie grok.com ---
        if (url.startsWith('/local/grok/login')) {
          if (req.method !== 'POST') {
            jsonRes(res, 405, { ok: false, detail: 'POST only' })
            return
          }
          const body = await readBody(req)
          jsonRes(res, 200, await runGrokLoginSidecar(String(body.email || '').trim(), String(body.password || ''), String(body.key || '')))
          return
        }

        // --- GRAB COOKIES (SuperVeo/CapCut style) ---
        if (url.startsWith('/local/chrome/grab-cookies')) {
          if (req.method !== 'POST') {
            jsonRes(res, 405, { ok: false, detail: 'POST only' })
            return
          }
          const body = await readBody(req)
          const browserId = Math.min(4, Math.max(1, Math.floor(Number(body.browserId) || 1)))
          const email = String(body.email || '').trim()
          const password = String(body.password || '')
          const autoLogin = body.autoLogin === true
          const preferSidecar = body.preferSidecar !== false
          const profileDir = chromeProfileDir(browserId)

          // --- AUTO-LOGIN (Start Auto Login): mo Chrome tu dong go email+pass ---
          if (autoLogin) {
            // Dong Chrome dang giu profile (neu co) de khong ket "profile in use"
            const closed0 = runPyJson('close_chrome_profile.py', [String(browserId)], 30000)
            const startUrl =
              'https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn&flowEntry=ServiceLogin&continue=https%3A%2F%2Flabs.google%2Ffx'
            const side = await runCookieSidecar({
              profileDir,
              email,
              password,
              newAccount: false,
              startUrl,
              timeoutMs: 240000,
            })
            if (side.ok && side.cookies) {
              jsonRes(res, 200, { ...side, browserId, profileDir, closed: closed0, via: 'autologin-sidecar' })
              return
            }
            // Sidecar het gio / 2FA: thu doc DPAPI (neu user da login tay trong cua so)
            const grab2 = runPyJson('grab_chrome_cookies.py', [String(browserId)], 30000)
            if (grab2.ok && String(grab2.cookies || '').length > 40) {
              jsonRes(res, 200, { ...grab2, browserId, profileDir, closed: closed0, via: 'autologin-dpapi' })
              return
            }
            jsonRes(res, 200, {
              ok: false,
              browserId,
              profileDir,
              closed: closed0,
              sidecar: side,
              detail:
                String(side.detail || '') ||
                'Auto-login chua xong — neu Google hoi 2FA/captcha, hoan tat trong cua so Chrome roi bam Xac nhan.',
            })
            return
          }

          // 1) Close Chrome holding this profile (SuperVeo: dong_chrome_ho_so)
          const closed = runPyJson('close_chrome_profile.py', [String(browserId)], 30000)

          // 2) DPAPI grab from Cookies SQLite (fast path)
          let grab = runPyJson('grab_chrome_cookies.py', [String(browserId)], 30000)
          const cookies1 = String(grab.cookies || '')
          const hasNa = !!grab.hasNextAuth
          if (grab.ok && hasNa && cookies1.length > 40) {
            jsonRes(res, 200, {
              ...grab,
              browserId,
              profileDir,
              closed,
              via: 'dpapi',
            })
            return
          }

          // 3) Sidecar (SuperVeo cookie-capture-sidecar) — poll until next-auth
          if (preferSidecar) {
            const side = await runCookieSidecar({
              profileDir,
              email,
              timeoutMs: hasNa || grab.hasPsid ? 60000 : 180000,
            })
            if (side.ok && side.cookies) {
              jsonRes(res, 200, {
                ...side,
                browserId,
                profileDir,
                closed,
              })
              return
            }
            // after sidecar, try DPAPI once more
            grab = runPyJson('grab_chrome_cookies.py', [String(browserId)], 30000)
            if (grab.ok && String(grab.cookies || '').length > 40) {
              jsonRes(res, 200, {
                ...grab,
                browserId,
                profileDir,
                closed,
                via: 'dpapi-after-sidecar',
                sidecarDetail: side.detail,
              })
              return
            }
            jsonRes(res, 200, {
              ok: false,
              browserId,
              profileDir,
              closed,
              grab,
              sidecar: side,
              detail:
                String(side.detail || grab.detail || '') ||
                'Chua lay duoc cookie — login labs.google/fx trong dung Browser roi bam Xac nhan',
            })
            return
          }

          // DPAPI-only path (PSID without next-auth still useful for Lite)
          jsonRes(res, 200, {
            ...grab,
            browserId,
            profileDir,
            closed,
            via: 'dpapi',
            detail:
              grab.detail ||
              'Chua co next-auth — mo Chrome login Flow xong bam Xac nhan (tool tu dong Chrome roi lay cookie)',
          })
          return
        }

        // --- LAUNCH CHROME ---
        if (!url.startsWith('/local/chrome/launch')) return next()
        if (req.method !== 'POST') {
          jsonRes(res, 405, { ok: false, detail: 'POST only' })
          return
        }

        const body = await readBody(req)
        const browserId = Math.min(4, Math.max(1, Math.floor(Number(body.browserId) || 1)))
        let launchUrl = String(body.url || 'https://accounts.google.com/AddSession?hl=vi&continue=https%3A%2F%2Fflow.google.com%2F').trim()
        if (!ALLOWED_URL_PREFIXES.some((p) => launchUrl.startsWith(p))) {
          launchUrl = 'https://accounts.google.com/AddSession?hl=vi&continue=https%3A%2F%2Fflow.google.com%2F'
        }
        const email = String(body.email || '').trim()
        const profileDir = chromeProfileDir(browserId)
        if (email && email.includes('@')) {
          try {
            fs.writeFileSync(path.join(profileDir, 'pbmedia_email.txt'), email + '\n', 'utf8')
          } catch {
            /* ignore */
          }
        }

        const chromePath = findChromeExe()
        if (!chromePath) {
          jsonRes(res, 500, {
            ok: false,
            browserId,
            profileDir,
            chromePath: '',
            url: launchUrl,
            detail: 'Không tìm thấy chrome.exe',
          })
          return
        }

        // Normal Chrome login profile. NO automation / CDP flags (no yellow banner).
        try {
          const child = spawn(
            chromePath,
            [
              `--user-data-dir=${profileDir}`,
              '--disable-dev-shm-usage',
              '--no-first-run',
              '--no-default-browser-check',
              '--disable-infobars',
              '--disable-popup-blocking',
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding',
              '--lang=vi-VN',
              '--window-size=1400,900',
              '--hide-crash-restore-bubble',
              '--disable-session-crashed-bubble',
              '--disable-default-apps',
              '--new-window',
              launchUrl,
            ],
            {
              detached: true,
              stdio: 'ignore',
              windowsHide: false,
            },
          )
          child.unref()
        } catch (e) {
          jsonRes(res, 500, {
            ok: false,
            browserId,
            profileDir,
            chromePath,
            url: launchUrl,
            detail: `Spawn Chrome lỗi: ${String(e).slice(0, 160)}`,
          })
          return
        }

        jsonRes(res, 200, {
          ok: true,
          browserId,
          profileDir,
          chromePath,
          url: launchUrl,
          detail: `Browser ${browserId} da mo (Chrome thuong, profile ${profileDir})`,
        })
      })
    },
  }
}


/** Cầu nối Python (scripts/pb_bridge.py) — gọi code thật của tool cũ.
 *  Vite tự bật nó khi `npm run dev`, và chuyển /api/* sang 127.0.0.1:1431. */
const BRIDGE_PORT = Number(process.env.PB_BRIDGE_PORT || 1431)

function bridgePlugin(): Plugin {
  let child: ReturnType<typeof spawn> | null = null
  const alive = () =>
    new Promise<boolean>((resolve) => {
      fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/health`)
        .then((r) => resolve(r.ok))
        .catch(() => resolve(false))
    })
  return {
    name: 'pb-python-bridge',
    async configureServer(server) {
      // Cầu nối cũ còn sót lại (đóng app trên Windows hay để lại tiến trình python) mà khác
      // phiên bản với scripts/pb_bridge.py hiện tại → tắt nó rồi bật bản mới; trước đây dùng
      // luôn bản cũ nên pull code mới mà phần Python vẫn chạy code cũ.
      const verMoi = crypto
        .createHash('sha1')
        .update(fs.readFileSync(path.join(scriptsDir(), 'pb_bridge.py')))
        .digest('hex')
        .slice(0, 12)
      try {
        const h = (await (await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/health`)).json()) as { pid?: number; ver?: string }
        if (h.ver === verMoi) {
          console.log(`[bridge] đã chạy sẵn ở cổng ${BRIDGE_PORT} (đúng phiên bản)`)
          return
        }
        console.log(`[bridge] cầu nối đang chạy là bản cũ (${h.ver || '?'} ≠ ${verMoi}) — tắt pid ${h.pid} rồi bật bản mới`)
        if (h.pid) {
          try {
            process.kill(h.pid)
          } catch {
            /* đã tắt */
          }
        }
        for (let i = 0; i < 20 && (await alive()); i++) await new Promise((r) => setTimeout(r, 250))
      } catch {
        /* chưa có cầu nối nào chạy */
      }
      const py = findPython()
      if (!py) {
        console.log('[bridge] KHÔNG tìm thấy python — các tab thật sẽ không chạy')
        return
      }
      child = spawn(py, [path.join(scriptsDir(), 'pb_bridge.py')], {
        cwd: __viteDir,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PB_BRIDGE_PORT: String(BRIDGE_PORT) },
        windowsHide: true,
      })
      child.stdout?.on('data', (b) => process.stdout.write(`[bridge] ${b}`))
      child.stderr?.on('data', (b) => process.stdout.write(`[bridge!] ${b}`))
      child.on('exit', (c) => {
        console.log(`[bridge] thoát (mã ${c})`)
        child = null
      })
      const stop = () => {
        try {
          child?.kill()
        } catch {
          /* ignore */
        }
      }
      server.httpServer?.on('close', stop)
      process.on('exit', stop)
    },
  }
}

export default defineConfig({
  plugins: [react(), chromeLaunchPlugin(), bridgePlugin()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${BRIDGE_PORT}`,
        changeOrigin: true,
      },
      '/flow-proxy/labs': {
        target: 'https://labs.google',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/flow-proxy\/labs/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            attachPbCookie(proxyReq, req)
          })
        },
      },
      '/flow-proxy/aisandbox': {
        target: 'https://aisandbox-pa.googleapis.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/flow-proxy\/aisandbox/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            attachPbCookie(proxyReq, req)
          })
        },
      },
    },
  },
})
