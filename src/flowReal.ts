﻿/**
 * Google Flow (labs.google/fx) image create - verified from K:\MUSE TOOL\flow_api.py
 * (user-owned). Endpoints / body shape copied from that source, not invented.
 *
 * Create path needs: Cookie (labs session) → Bearer ya29 → reCAPTCHA token + projectId
 * → POST aisandbox-pa .../flowMedia:batchGenerateImages
 *
 * Cookies never logged in full - use maskCookie().
 *
 * Chrome profiles (Lấy Cookie): SuperVeo/CapCut cookie_capture_sidecar +
 *   DPAPI Cookies DB under %LOCALAPPDATA%\PBMedia\chrome_flow_accounts\browser_N
 * Tier/credits: aisandbox /v1/credits + serviceTier/sku/paygate (not hardcoded FREE 50).
 */

export const LS_GEN_MODE = 'pb.anh.genMode'
export const LS_RECAPTCHA = 'pb.settings.api.recaptcha'
export const LS_PROJECT_ID = 'pb.settings.api.projectId'
export const LS_ACCOUNTS = 'pb.settings.api.accounts'
export const LS_COOKIES = 'pb.settings.api.cookies'

export type GenMode = 'mock' | 'real'

export type FlowAccount = {
  id: string
  mail: string
  status: string
  plan: string
  kind: 'tool' | 'gateway'
  session: string
  cookie?: string
  browser: number
  active: boolean
  testOk?: boolean | null
  paygate?: string
  credits?: number | null
  tier?: string
}

export type FlowCookieSlot = {
  browser: number
  token: string
  label: string
  testOk?: boolean | null
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Source: flow_api.SERVICE_TIER_NAMES / SKU_NAMES / PAYGATE_TIER_NAMES */
const SERVICE_TIER_NAMES: Record<string, string> = {
  SERVICE_TIER_ENTRY: 'FREE',
  SERVICE_TIER_INTERMEDIATE: 'PRO',
  SERVICE_TIER_ADVANCED: 'ULTRA',
}
const SKU_NAMES: Record<string, string> = {
  G1_TIER1: 'PRO',
  G1_TIER2: 'ULTRA',
}
const PAYGATE_TIER_NAMES: Record<string, string> = {
  PAYGATE_TIER_ONE: 'PRO',
  PAYGATE_TIER_TWO: 'ULTRA',
}
const PAYGATE_TIER_CODES: Record<string, string> = {
  PRO: 'PAYGATE_TIER_ONE',
  ULTRA: 'PAYGATE_TIER_TWO',
  FREE: 'PAYGATE_TIER_ONE',
}

const IMG_RATIO_MAP: Record<string, string> = {
  '16:9': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
  '9:16': 'IMAGE_ASPECT_RATIO_PORTRAIT',
  '1:1': 'IMAGE_ASPECT_RATIO_SQUARE',
  '4:3': 'IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE',
  '3:4': 'IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR',
  '3:2': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
  '2:3': 'IMAGE_ASPECT_RATIO_PORTRAIT',
}

const IMAGE_MODELS: Record<string, string> = {
  'Banana 2': 'NARWHAL',
  'Banana 2 Lite': 'HARBOR_SEAL',
  'Banana Pro': 'GEM_PIX_2',
  'Banana Preview': 'NARWHAL',
  'Nano Banana 2': 'NARWHAL',
  'Nano Banana Pro': 'GEM_PIX_2',
  'Nano Banana 2 Lite': 'HARBOR_SEAL',
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const FLOW_LOGIN_URL = 'https://accounts.google.com/AddSession?hl=vi&continue=https%3A%2F%2Fflow.google.com%2F'

export function chromeProfileKey(browserId: number): string {
  const n = Math.min(4, Math.max(1, Math.floor(browserId) || 1))
  return `browser_${n}`
}

export function formatPlanLabel(tier: string, credits?: number | null): string {
  const t = (tier || '').trim().toUpperCase()
  const name = t.includes('ULTRA')
    ? 'ULTRA'
    : t.includes('PRO')
      ? 'PRO'
      : t.includes('FREE')
        ? 'FREE'
        : t || 'UNKNOWN'
  if (credits != null && Number.isFinite(Number(credits))) {
    return `${name} (${Math.trunc(Number(credits))})`
  }
  return name
}

export function paygateCodeFromTier(tier: string, paygateRaw?: string): string {
  const raw = (paygateRaw || '').trim().toUpperCase()
  if (raw.startsWith('PAYGATE_TIER_')) return raw
  const t = (tier || '').trim().toUpperCase()
  if (t.includes('ULTRA')) return 'PAYGATE_TIER_TWO'
  if (t.includes('PRO')) return 'PAYGATE_TIER_ONE'
  return PAYGATE_TIER_CODES.FREE || 'PAYGATE_TIER_ONE'
}

export function maskCookie(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return '(empty)'
  if (s.length <= 16) return s.slice(0, 4) + '…'
  return s.slice(0, 10) + '…' + s.slice(-6) + ` (${s.length} chars)`
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as T
  } catch {
    /* ignore */
  }
  return fallback
}

export function getGenMode(): GenMode {
  try {
    const v = localStorage.getItem(LS_GEN_MODE)
    if (v === 'real') return 'real'
  } catch {
    /* ignore */
  }
  return 'mock'
}

export function setGenMode(mode: GenMode) {
  try {
    localStorage.setItem(LS_GEN_MODE, mode)
  } catch {
    /* ignore */
  }
}

/** Normalize pasted blob into Cookie header value. Never logs full value. */
export function normalizeCookieBlob(raw: string): string {
  let s = (raw || '').trim()
  if (!s) return ''
  // JSON array from extension dumps: [{name,value},...]
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s) as Array<{ name?: string; value?: string }>
      if (Array.isArray(arr)) {
        return arr
          .filter((c) => c && c.name && c.value != null)
          .map((c) => `${c.name}=${c.value}`)
          .join('; ')
      }
    } catch {
      /* fall through */
    }
  }
  // Bare next-auth token without name
  if (!s.includes('=') && s.length > 20) {
    return `__Secure-next-auth.session-token=${s}`
  }
  return s.replace(/\r?\n/g, '; ').replace(/;\s*;/g, '; ')
}

export function looksLikeMockCookie(cookie: string): boolean {
  const s = (cookie || '').toLowerCase()
  return (
    s.includes('mock_') ||
    s.includes('demo_session') ||
    s.includes('pbmedia.local') ||
    /session-token=mock/i.test(cookie)
  )
}

export type ResolvedSession = {
  ok: boolean
  mail: string
  browser: number
  cookie: string
  reason: string
  masked: string
  paygate?: string
  tier?: string
}

export function resolveActiveSession(): ResolvedSession {
  const accounts = loadJson<FlowAccount[]>(LS_ACCOUNTS, [])
  const cookies = loadJson<FlowCookieSlot[]>(LS_COOKIES, [])
  const tools = accounts.filter((a) => a.kind === 'tool')
  const active =
    tools.find((a) => a.active) ||
    tools.find((a) => /kích hoạt|dang dung|đang dùng|dang dùng/i.test(a.status))
  if (!tools.length) {
    return {
      ok: false,
      mail: '',
      browser: 0,
      cookie: '',
      reason: 'Chưa có account - Cài đặt → Account → + Thêm mail',
      masked: '',
    }
  }
  if (!active) {
    return {
      ok: false,
      mail: '',
      browser: 0,
      cookie: '',
      reason: 'Chưa kích hoạt account - bấm Kích hoạt / Đang dùng',
      masked: '',
    }
  }
  const slot = cookies.find((c) => c.browser === active.browser)
  const token = normalizeCookieBlob(
    (slot?.token || active.cookie || active.session || '').trim(),
  )
  if (!token || token.length < 8) {
    return {
      ok: false,
      mail: active.mail,
      browser: active.browser,
      cookie: '',
      reason: `No valid cookie found (${active.mail} · Browser ${active.browser})`,
      masked: '',
    }
  }
  return {
    ok: true,
    mail: active.mail,
    browser: active.browser,
    cookie: token,
    reason: `OK · ${active.mail} · Browser ${active.browser} · ${active.plan}`,
    masked: maskCookie(token),
    paygate: active.paygate,
    tier: active.tier || active.plan,
  }
}

function findAccessToken(node: unknown): string {
  const ok = (s: string) => {
    let t = (s || '').trim()
    if (t.toLowerCase().startsWith('bearer ')) t = t.slice(7).trim()
    return t.startsWith('ya29.') ? t : ''
  }
  if (typeof node === 'string') return ok(node)
  if (Array.isArray(node)) {
    for (const v of node) {
      const t = findAccessToken(v)
      if (t) return t
    }
    return ''
  }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    for (const k of ['access_token', 'accessToken', 'token']) {
      const t = ok(String(o[k] || ''))
      if (t) return t
    }
    for (const v of Object.values(o)) {
      const t = findAccessToken(v)
      if (t) return t
    }
  }
  return ''
}

function digProjectIds(node: unknown, found: string[]) {
  if (found.length > 8) return
  if (typeof node === 'string' && UUID_RE.test(node.trim())) {
    found.push(node.trim())
    return
  }
  if (Array.isArray(node)) {
    for (const v of node) digProjectIds(v, found)
    return
  }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    for (const k of ['projectId', 'project_id', 'id']) {
      const v = o[k]
      if (typeof v === 'string' && UUID_RE.test(v.trim())) found.push(v.trim())
    }
    for (const v of Object.values(o)) digProjectIds(v, found)
  }
}

function pickCredits(node: unknown): number | null {
  const keys = new Set([
    'credits',
    'remainingcredits',
    'creditsremaining',
    'creditbalance',
    'remainingcredit',
  ])
  if (typeof node === 'number' && Number.isFinite(node)) return Math.trunc(node)
  if (Array.isArray(node)) {
    for (const v of node) {
      const n = pickCredits(v)
      if (n != null) return n
    }
    return null
  }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    for (const [k, v] of Object.entries(o)) {
      if (keys.has(k.toLowerCase())) {
        const n = Number(v)
        if (Number.isFinite(n)) return Math.trunc(n)
      }
    }
    for (const v of Object.values(o)) {
      const n = pickCredits(v)
      if (n != null) return n
    }
  }
  return null
}

function tierFromCreditsPayload(d: Record<string, unknown>): {
  tier: string
  paygate: string
  serviceTier: string
  sku: string
} {
  const st = String(d.serviceTier || '').trim()
  const sku = String(d.sku || '').trim()
  const pg = String(d.userPaygateTier || d.paygateTier || '').trim()
  const tier =
    SERVICE_TIER_NAMES[st] ||
    SKU_NAMES[sku] ||
    PAYGATE_TIER_NAMES[pg] ||
    ''
  return { tier, paygate: pg, serviceTier: st, sku }
}

async function labsFetch(
  path: string,
  cookie: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers || {})
  headers.set('Accept', 'application/json')
  headers.set('User-Agent', UA)
  headers.set('Referer', 'https://labs.google/fx/tools/flow')
  headers.set('X-PB-Cookie', cookie)
  // Do NOT set Cookie - browsers block it; vite proxy maps X-PB-Cookie → Cookie
  return fetch(`/flow-proxy/labs${path}`, { ...init, headers })
}

async function aisandboxFetch(
  path: string,
  bearer: string,
  body: unknown,
): Promise<Response> {
  const headers = new Headers()
  headers.set('Accept', '*/*')
  headers.set('Content-Type', 'application/json')
  headers.set('Authorization', `Bearer ${bearer}`)
  headers.set('Origin', 'https://labs.google')
  headers.set('Referer', 'https://labs.google/fx/tools/flow/')
  headers.set('User-Agent', UA)
  headers.set('sec-ch-ua', '"Chromium";v="131", "Not;A=Brand";v="24", "Google Chrome";v="131"')
  headers.set('sec-ch-ua-mobile', '?0')
  headers.set('sec-ch-ua-platform', '"Windows"')
  // No Cookie on aisandbox (MUSE TOOL / SuperVeo live: Bearer only)
  return fetch(`/flow-proxy/aisandbox${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function aisandboxGet(path: string, bearer: string, cookie = ''): Promise<Response> {
  const headers = new Headers()
  headers.set('Accept', 'application/json')
  headers.set('Authorization', `Bearer ${bearer}`)
  headers.set('Origin', 'https://labs.google')
  headers.set('Referer', 'https://labs.google/fx/tools/flow/')
  headers.set('User-Agent', UA)
  if (cookie) headers.set('X-PB-Cookie', cookie)
  return fetch(`/flow-proxy/aisandbox${path}`, { method: 'GET', headers })
}

export type SessionProbe = {
  alive: boolean
  email: string
  bearer: string
  sessionError: string
  httpStatus: number
  detail: string
}

/** GET labs.google/fx/api/auth/session - source: flow_api.cookie_con_song */
export async function probeLabsSession(cookie: string): Promise<SessionProbe> {
  const empty: SessionProbe = {
    alive: false,
    email: '',
    bearer: '',
    sessionError: '',
    httpStatus: 0,
    detail: '',
  }
  if (!cookie) return { ...empty, detail: 'empty cookie' }
  if (looksLikeMockCookie(cookie)) {
    return {
      ...empty,
      detail: 'Cookie đang là mock localStorage - dán cookie Flow thật từ Chrome',
    }
  }
  let res: Response
  try {
    res = await labsFetch('/fx/api/auth/session', cookie, { method: 'GET' })
  } catch (e) {
    return { ...empty, detail: `network: ${String(e).slice(0, 120)}` }
  }
  const httpStatus = res.status
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      ...empty,
      httpStatus,
      detail: `HTTP ${httpStatus} - cookie hết hạn / chưa login labs.google`,
    }
  }
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    return {
      ...empty,
      httpStatus,
      detail: `HTTP ${httpStatus} - body không phải JSON`,
    }
  }
  const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const sessionError = String(o.error || '').trim()
  const user = (o.user && typeof o.user === 'object' ? o.user : {}) as Record<
    string,
    unknown
  >
  const email = String(user.email || o.email || '').trim()
  const bearer = sessionError === 'ACCESS_TOKEN_REFRESH_NEEDED' ? '' : findAccessToken(data)
  if (sessionError === 'ACCESS_TOKEN_REFRESH_NEEDED') {
    return {
      alive: true,
      email,
      bearer: '',
      sessionError,
      httpStatus,
      detail:
        'Cookie NextAuth còn, nhưng cần Login Chrome để lấy bearer ya29 (ACCESS_TOKEN_REFRESH_NEEDED)',
    }
  }
  if (email || bearer || user) {
    return {
      alive: true,
      email,
      bearer,
      sessionError,
      httpStatus,
      detail: bearer
        ? `labs session OK · có ya29${email ? ` · ${email}` : ''}`
        : `labs session OK · chưa có ya29${email ? ` · ${email}` : ''}`,
    }
  }
  if (!data || (typeof data === 'object' && !Object.keys(o).length)) {
    return {
      ...empty,
      httpStatus,
      detail: 'Session rỗng - cookie không phải phiên labs.google',
    }
  }
  return {
    alive: Boolean(o.expires || o.accessToken || o.access_token),
    email,
    bearer,
    sessionError,
    httpStatus,
    detail: 'labs session partial',
  }
}

export type AccountInfo = {
  ok: boolean
  email: string
  tier: string
  paygate: string
  credits: number | null
  planLabel: string
  cookieAlive: boolean
  creditsHttp: number
  detail: string
  bearer: string
}

/**
 * Source: flow_api.fetch_account_info
 * Probe labs session → GET aisandbox /v1/credits with ya29.
 * Tier from serviceTier / sku / paygateTier — never invent FREE (50).
 */
export async function fetchAccountInfo(cookieRaw: string): Promise<AccountInfo> {
  const empty: AccountInfo = {
    ok: false,
    email: '',
    tier: '',
    paygate: '',
    credits: null,
    planLabel: '',
    cookieAlive: false,
    creditsHttp: 0,
    detail: '',
    bearer: '',
  }
  const cookie = normalizeCookieBlob(cookieRaw)
  if (!cookie) return { ...empty, detail: 'empty cookie' }
  if (looksLikeMockCookie(cookie)) {
    return {
      ...empty,
      detail:
        'Cookie mock — không đọc được Ultra/Pro/Free thật. Mở Chrome profile TK → login → dán cookie Flow.',
    }
  }

  const probe = await probeLabsSession(cookie)
  let tier = ''
  let paygate = ''
  let credits: number | null = null
  let creditsHttp = 0
  let bearer = probe.bearer

  if (bearer.startsWith('ya29.')) {
    try {
      const res = await aisandboxGet('/v1/credits', bearer, cookie)
      creditsHttp = res.status
      if (res.status === 200) {
        const d = (await res.json()) as Record<string, unknown>
        const parsed = tierFromCreditsPayload(d)
        tier = parsed.tier || tier
        paygate = parsed.paygate || paygate
        credits = pickCredits(d)
      }
    } catch (e) {
      return {
        ...empty,
        email: probe.email,
        cookieAlive: probe.alive,
        bearer,
        detail: `credits network: ${String(e).slice(0, 100)}`,
      }
    }
  }

  if (!tier && !probe.alive) {
    return {
      ...empty,
      email: probe.email,
      cookieAlive: false,
      creditsHttp,
      bearer,
      detail: probe.detail || 'Cookie hết hạn',
    }
  }

  if (!tier && probe.alive) {
    // Cookie sống nhưng chưa đọc được hạng từ /v1/credits
    tier = ''
  }

  const planLabel = tier
    ? formatPlanLabel(tier, credits)
    : probe.alive
      ? credits != null
        ? `UNKNOWN (${credits})`
        : 'UNKNOWN (chưa đọc hạng)'
      : ''

  const ok = probe.alive || Boolean(tier)
  return {
    ok,
    email: probe.email,
    tier: tier || '',
    paygate: paygate || (tier ? paygateCodeFromTier(tier) : ''),
    credits,
    planLabel,
    cookieAlive: probe.alive,
    creditsHttp,
    bearer,
    detail: tier
      ? `Hạng ${planLabel}${probe.email ? ` · ${probe.email}` : ''} · /v1/credits HTTP ${creditsHttp || '—'}`
      : probe.alive
        ? `Cookie sống${probe.email ? ` · ${probe.email}` : ''} — hạng chưa đọc được (credits HTTP ${creditsHttp || 'n/a'}; cần ya29)`
        : probe.detail || 'Không đọc được account',
  }
}

export type LaunchChromeResult = {
  ok: boolean
  browserId: number
  profileDir: string
  chromePath: string
  url: string
  detail: string
  via: 'vite-local' | 'tauri' | 'none'
}

/** Open Chrome with --user-data-dir for browser slot 1–4 (MUSE-style profile). */

export type GrabCookiesResult = {
  ok: boolean
  browserId: number
  profileDir: string
  cookies: string
  hasNextAuth?: boolean
  hasPsid?: boolean
  cookieCount?: number
  via?: string
  detail: string
}

/**
 * SuperVeo/CapCut «Lấy Cookie»: close Chrome profile → DPAPI Cookies DB
 * (and/or cookie_capture_sidecar.js CDP poll) → cookie header string.
 * Only reads %LOCALAPPDATA%\\PBMedia\\chrome_flow_accounts\\browser_N.
 */
export async function grabCookiesFromBrowser(opts: {
  browserId: number
  email?: string
  password?: string
  preferSidecar?: boolean
  autoLogin?: boolean
}): Promise<GrabCookiesResult> {
  const browserId = Math.min(4, Math.max(1, Math.floor(opts.browserId) || 1))
  const body = {
    browserId,
    email: (opts.email || '').trim(),
    password: opts.password || '',
    autoLogin: opts.autoLogin === true,
    preferSidecar: opts.preferSidecar !== false,
  }
  try {
    const res = await fetch('/local/chrome/grab-cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = (await res.json()) as GrabCookiesResult & { error?: string }
    const cookies = normalizeCookieBlob(String(j.cookies || ''))
    return {
      ok: !!(j.ok && cookies.length >= 20),
      browserId,
      profileDir: j.profileDir || '',
      cookies,
      hasNextAuth: !!j.hasNextAuth,
      hasPsid: !!j.hasPsid,
      cookieCount: j.cookieCount,
      via: j.via,
      detail: j.detail || j.error || (cookies ? 'OK' : 'Khong lay duoc cookie'),
    }
  } catch (e) {
    return {
      ok: false,
      browserId,
      profileDir: '',
      cookies: '',
      detail: `Grab cookie loi: ${String(e).slice(0, 140)}`,
    }
  }
}

export async function launchChromeForBrowser(opts: {
  browserId: number
  url?: string
  email?: string
}): Promise<LaunchChromeResult> {
  const browserId = Math.min(4, Math.max(1, Math.floor(opts.browserId) || 1))
  const url = (opts.url || FLOW_LOGIN_URL).trim() || FLOW_LOGIN_URL
  const email = (opts.email || '').trim()
  const body = { browserId, url, email }

  // Prefer local vite middleware (npm run dev) — works without tauri:dev
  try {
    const res = await fetch('/local/chrome/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = (await res.json()) as LaunchChromeResult & { error?: string }
    if (res.ok && j.ok) {
      return { ...j, via: 'vite-local' }
    }
    if (res.ok || res.status === 400 || res.status === 500) {
      // fall through to tauri if middleware missing/failed
      if (j.detail || j.error) {
        // keep trying tauri
      }
    }
  } catch {
    /* vite middleware may be absent */
  }

  // Tauri invoke (when running inside tauri:dev / packaged)
  try {
    const g = globalThis as unknown as { __TAURI_INTERNALS__?: unknown }
    if (g.__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core')
      const j = (await invoke('launch_chrome_for_browser', {
        browserId,
        url,
        email,
      })) as LaunchChromeResult
      return { ...j, via: 'tauri' }
    }
  } catch (e) {
    return {
      ok: false,
      browserId,
      profileDir: '',
      chromePath: '',
      url,
      via: 'none',
      detail: `Tauri launch lỗi: ${String(e).slice(0, 140)}`,
    }
  }

  return {
    ok: false,
    browserId,
    profileDir: '',
    chromePath: '',
    url,
    via: 'none',
    detail:
      'Không mở được Chrome profile. Chạy npm run dev (có middleware /local/chrome/launch) hoặc tauri:dev. Kiểm tra chrome.exe.',
  }
}

/** trpc project.searchUserProjects - source: flow_api (PINHOLE) */
export async function searchProjectId(cookie: string): Promise<string> {
  const saved = (localStorage.getItem(LS_PROJECT_ID) || '').trim()
  if (UUID_RE.test(saved)) return saved
  const input = encodeURIComponent(
    JSON.stringify({
      json: { pageSize: 10, toolName: 'PINHOLE', cursor: null },
      meta: { values: { cursor: ['undefined'] } },
    }),
  )
  let res: Response
  try {
    res = await labsFetch(
      `/fx/api/trpc/project.searchUserProjects?input=${input}`,
      cookie,
      { method: 'GET' },
    )
  } catch {
    return ''
  }
  if (res.status !== 200) return ''
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return ''
  }
  const found: string[] = []
  digProjectIds(data, found)
  const pid = found[0] || ''
  if (pid) {
    try {
      localStorage.setItem(LS_PROJECT_ID, pid)
    } catch {
      /* ignore */
    }
  }
  return pid
}

export type GenImageOk = {
  ok: true
  name: string
  projectId?: string
  fifeUrl?: string
  localPath?: string
  dataUrl?: string
  remainingCredits?: number
}

export type GenImageErr = {
  ok: false
  code: string
  detail: string
  httpStatus?: number
}

export type GenImageResult = GenImageOk | GenImageErr

export type RealGenOptions = {
  prompt: string
  ratio: string
  modelLabel: string
  cookie: string
  bearer?: string
  projectId?: string
  recaptcha?: string
  paygateTier?: string
  browser?: number
  outDir?: string
  onStatus?: (msg: string) => void
}

/** Mint reCAPTCHA Enterprise token tu ho so Chrome DA LOGIN (vite middleware). */
export async function mintRecaptchaToken(
  browserId: number,
  action = 'IMAGE_GENERATION',
): Promise<{ ok: boolean; token: string; detail: string }> {
  const b = Math.min(4, Math.max(1, Math.floor(browserId) || 1))
  try {
    const res = await fetch('/local/recaptcha/mint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserId: b, action }),
    })
    const j = (await res.json()) as { ok?: boolean; token?: string; detail?: string }
    const token = String(j.token || '')
    return { ok: !!(j.ok && token.length > 20), token, detail: j.detail || (token ? 'OK' : 'mint rong') }
  } catch (e) {
    return { ok: false, token: '', detail: `Mint loi: ${String(e).slice(0, 140)}` }
  }
}

/** Tai anh fifeUrl ve + luu vao outDir (vite middleware doc duoc disk). */
export async function saveImageToDisk(opts: {
  url: string
  cookie?: string
  dir?: string
  name?: string
}): Promise<{ ok: boolean; path?: string; dataUrl?: string; detail?: string }> {
  try {
    const res = await fetch('/local/image/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: opts.url,
        cookie: opts.cookie || '',
        dir: opts.dir || '',
        name: opts.name || '',
      }),
    })
    const j = (await res.json()) as { ok?: boolean; path?: string; dataUrl?: string; detail?: string }
    return { ok: !!j.ok, path: j.path, dataUrl: j.dataUrl, detail: j.detail }
  } catch (e) {
    return { ok: false, detail: `Save loi: ${String(e).slice(0, 140)}` }
  }
}

/**
 * Full real create - source: FlowAPI.generate_image in flow_api.py
 * HARD-STOP if reCAPTCHA token < 1500 (same as MUSE TOOL).
 */
export async function generateImageReal(opts: RealGenOptions): Promise<GenImageResult> {
  const say = opts.onStatus || (() => {})
  const cookie = normalizeCookieBlob(opts.cookie)
  if (!cookie) return { ok: false, code: 'no_cookie', detail: 'No valid cookie found' }
  if (looksLikeMockCookie(cookie)) {
    return {
      ok: false,
      code: 'mock_cookie',
      detail: 'Cookie mock - dán cookie Flow thật (Cài đặt → Cookie/Account)',
    }
  }

  say('Đang kiểm tra labs.google /fx/api/auth/session…')
  const probe = await probeLabsSession(cookie)
  say(probe.detail)
  if (!probe.alive && !probe.bearer) {
    return {
      ok: false,
      code: 'session_dead',
      detail: probe.detail || 'Cookie hết hạn (401)',
      httpStatus: probe.httpStatus,
    }
  }

  let bearer = (opts.bearer || probe.bearer || '').trim()
  if (bearer.toLowerCase().startsWith('bearer ')) bearer = bearer.slice(7).trim()
  if (!bearer.startsWith('ya29.')) {
    return {
      ok: false,
      code: 'no_bearer',
      detail:
        'Thiếu bearer ya29 - cookie NextAuth chưa đủ để gọi aisandbox. Mở đúng Chrome profile TK → login labs.google → lấy lại cookie + session.',
      httpStatus: probe.httpStatus,
    }
  }

  say('Đang lấy Project ID (searchUserProjects)…')
  let pid = (opts.projectId || '').trim()
  if (!UUID_RE.test(pid)) pid = await searchProjectId(cookie)
  if (!UUID_RE.test(pid)) {
    pid = crypto.randomUUID()
    say(`Không lấy được project từ API - dùng UUID local ${pid.slice(0, 8)}…`)
  } else {
    say(`Project ${pid.slice(0, 8)}…`)
  }

  let tok = (
    opts.recaptcha ||
    localStorage.getItem(LS_RECAPTCHA) ||
    ''
  ).trim()
  if (tok.length < 1500 && opts.browser) {
    say('Dang mint reCAPTCHA (mo Chrome profile da login, grecaptcha.enterprise)...')
    const mint = await mintRecaptchaToken(opts.browser, 'IMAGE_GENERATION')
    say(mint.detail)
    if (mint.ok && mint.token.length >= 1500) {
      tok = mint.token
      try { localStorage.setItem(LS_RECAPTCHA, tok) } catch { /* ignore */ }
    }
  }
  if (tok.length < 1500) {
    return {
      ok: false,
      code: 'need_recaptcha',
      detail:
        `Chua lay duoc reCAPTCHA token (hien ${tok.length}/1500). ` +
        'Can dang nhap Flow that trong Chrome profile cua account (Start Auto Login / Lay Cookie) roi thu lai - ' +
        'tool se tu mint tren flow.google.com giong MUSE TOOL/SuperVeo. Hoac dan token thu cong vao Cai dat > reCAPTCHA.',
    }
  }

  const sess = resolveActiveSession()
  const paygate =
    (opts.paygateTier || '').trim() ||
    paygateCodeFromTier(sess.tier || '', sess.paygate)

  const aspect = IMG_RATIO_MAP[opts.ratio] || 'IMAGE_ASPECT_RATIO_LANDSCAPE'
  const model = IMAGE_MODELS[opts.modelLabel] || 'NARWHAL'
  const sessionId = `;${Date.now()}`
  const cc: Record<string, unknown> = {
    recaptchaContext: {
      applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
      token: tok,
    },
    sessionId,
    projectId: pid,
    tool: 'PINHOLE',
    userPaygateTier: paygate,
  }
  const req = {
    clientContext: cc,
    imageModelName: model,
    imageAspectRatio: aspect,
    structuredPrompt: { parts: [{ text: opts.prompt }] },
    seed: Math.floor(Math.random() * 999999) + 1,
    imageInputs: [] as unknown[],
  }
  const payload = {
    clientContext: cc,
    mediaGenerationContext: { batchId: crypto.randomUUID() },
    useNewMedia: true,
    requests: [req],
  }

  say(`POST batchGenerateImages · model=${model} · aspect=${aspect} · ${paygate}`)
  const path = `/v1/projects/${pid}/flowMedia:batchGenerateImages`
  let res: Response
  try {
    res = await aisandboxFetch(path, bearer, payload)
  } catch (e) {
    return { ok: false, code: 'network', detail: `network: ${String(e).slice(0, 160)}` }
  }

  const httpStatus = res.status
  const text = await res.text()
  if (httpStatus === 401) {
    return {
      ok: false,
      code: 'auth',
      detail: 'HTTP 401 - bearer hết hạn / CREDENTIALS_MISSING',
      httpStatus,
    }
  }
  if (httpStatus === 403) {
    const snip = text.slice(0, 180).replace(/\s+/g, ' ')
    return {
      ok: false,
      code: /UNUSUAL_ACTIVITY|reCAPTCHA/i.test(text) ? 'blocked' : 'forbidden',
      detail: `HTTP 403 - ${snip || 'forbidden'}`,
      httpStatus,
    }
  }
  if (httpStatus === 429) {
    return {
      ok: false,
      code: /QUOTA|CREDIT/i.test(text) ? 'quota' : 'rate',
      detail: text.slice(0, 200).replace(/\s+/g, ' ') || 'rate/quota',
      httpStatus,
    }
  }
  if (httpStatus !== 200) {
    return {
      ok: false,
      code: `http_${httpStatus}`,
      detail: text.slice(0, 220).replace(/\s+/g, ' ') || `HTTP ${httpStatus}`,
      httpStatus,
    }
  }

  let j: Record<string, unknown>
  try {
    j = JSON.parse(text) as Record<string, unknown>
  } catch {
    return { ok: false, code: 'bad_json', detail: '200 nhưng body không phải JSON', httpStatus }
  }

  const media = Array.isArray(j.media) ? j.media : []
  for (const mm of media) {
    if (!mm || typeof mm !== 'object') continue
    const m = mm as Record<string, unknown>
    const name = String(m.name || '')
    if (!name) continue
    let fifeUrl = ''
    try {
      for (const [a, b] of [
        ['image', 'generatedImage'],
        ['video', 'generatedVideo'],
      ] as const) {
        const g = ((m[a] as Record<string, unknown>) || {})[b] as
          | Record<string, unknown>
          | undefined
        fifeUrl = String((g && (g.fifeUrl || g.fileUrl)) || '').trim()
        if (fifeUrl.startsWith('http')) break
      }
    } catch {
      fifeUrl = ''
    }
    let localPath = ''
    let dataUrl = ''
    if (fifeUrl.startsWith('http')) {
      say('Đang tải ảnh về + lưu vào thư mục output...')
      const saved = await saveImageToDisk({
        url: fifeUrl,
        cookie,
        dir: opts.outDir,
        name: (name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-40)) || `img_${Date.now()}`,
      })
      if (saved.ok) {
        localPath = saved.path || ''
        dataUrl = saved.dataUrl || ''
        say(localPath ? `Đã lưu: ${localPath}` : 'Đã tải ảnh (preview)')
      } else {
        say(`Tải/lưu ảnh lỗi: ${saved.detail || '?'} (vẫn có fifeUrl)`)
      }
    }
    return {
      ok: true,
      name,
      projectId: typeof m.projectId === 'string' ? m.projectId : pid,
      fifeUrl: fifeUrl.startsWith('http') ? fifeUrl : undefined,
      localPath: localPath || undefined,
      dataUrl: dataUrl || undefined,
      remainingCredits:
        typeof j.remainingCredits === 'number' ? j.remainingCredits : undefined,
    }
  }

  return {
    ok: false,
    code: 'empty_media',
    detail: `200 nhưng không có media[] - ${text.slice(0, 180).replace(/\s+/g, ' ')}`,
    httpStatus,
  }
}
