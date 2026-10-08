import { useEffect, useRef, useState } from 'react'
import {
  fetchAccountInfo,
  grabCookiesFromBrowser,
  launchChromeForBrowser,
  looksLikeMockCookie,
  normalizeCookieBlob,
  FLOW_LOGIN_URL,
} from './flowReal'
import './App.css'
import Veo3Workspace from './Veo3Workspace'
import GrokWorkspace from './GrokWorkspace'
import VidsWorkspace from './VidsWorkspace'
import MuseWorkspace from './MuseWorkspace'
import FlowWorkspace from './FlowWorkspace'
import TaoAnhWorkspace from './TaoAnhWorkspace'
import InVideoWorkspace from './InVideoWorkspace'
import CreatorWorkspace from './CreatorWorkspace'
import VoiceWorkspace from './VoiceWorkspace'
import TubeHunterWorkspace from './TubeHunterWorkspace'
import MiniAppWorkspace from './MiniAppWorkspace'
import SeedanceWorkspace from './SeedanceWorkspace'
import { api as bridgeApi, errText, openFolder, pickFolder, useJobs } from './bridge'
import GhepVideoWorkspace from './GhepVideoWorkspace'
import SettingsTaiKhoan from './SettingsTaiKhoan'

type TopTab = 'veo3' | 'grok' | 'seedance' | 'vids' | 'muse' | 'flow' | 'invideo' | 'anh' | 'creator' | 'voice' | 'ghep' | 'tube' | 'mini' | 'settings'
type SettingsPane =
  | 'user'
  | 'api'
  | 'download'
  | 'image'
  | 'advanced'
  | 'chrome'
  | 'version'
type CropMode = 'pad' | 'crop'




const TOP_TABS: { id: TopTab; label: string; badge?: string; badgeCls?: string }[] = [
  { id: 'veo3', label: 'Veo3' },
  { id: 'grok', label: 'Grok' },
  { id: 'seedance', label: 'Seedance', badge: 'BETA', badgeCls: 'beta' },
  { id: 'vids', label: 'Vids', badge: 'NEW', badgeCls: 'new' },
  { id: 'muse', label: 'Muse', badge: 'NEW', badgeCls: 'new' },
  { id: 'flow', label: 'Flow', badge: 'NEW', badgeCls: 'new' },
  { id: 'invideo', label: 'InVideo', badge: 'V2', badgeCls: 'v2' },
  { id: 'anh', label: 'Tạo Ảnh', badge: 'VIP', badgeCls: 'vip' },
  { id: 'creator', label: 'Creator' },
  { id: 'voice', label: 'Voice', badge: 'NEW', badgeCls: 'new' },
  { id: 'ghep', label: 'Ghép Video' },
  { id: 'tube', label: 'Tube Hunter', badge: 'BETA', badgeCls: 'beta' },
  { id: 'mini', label: 'MiniApp' },
  { id: 'settings', label: 'Cài đặt' },
]

const SETTINGS_NAV: { id: SettingsPane; label: string; icon: string }[] = [
  { id: 'user', label: 'Thông tin user', icon: '👤' },
  { id: 'api', label: 'Cấu hình API', icon: '⚙️' },
  { id: 'download', label: 'Tải xuống', icon: '⬇️' },
  { id: 'image', label: 'Xử lý ảnh', icon: '✂️' },
  { id: 'advanced', label: 'Nâng cao', icon: '🧪' },
  { id: 'chrome', label: 'Chrome Extension', icon: '🧩' },
  { id: 'version', label: 'Phiên bản', icon: '◎' },
]


function Toggle({
  on,
  onChange,
}: {
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      className={`toggle ${on ? 'on' : ''}`}
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      <span className="toggle-knob" />
    </button>
  )
}


type MockField = { label: string; value: string; kind?: 'select' | 'text' | 'check' }
type MockRow = { id: number; name: string; meta: string; status: string; statusCls: string }

function ModuleWorkspace({
  title,
  crumb,
  note,
  fields,
  rows,
  primaryLabel = 'Bắt đầu',
  secondaryLabel = 'Làm mới',
}: {
  title: string
  crumb: string
  note: string
  fields: MockField[]
  rows: MockRow[]
  primaryLabel?: string
  secondaryLabel?: string
}) {
  const [running, setRunning] = useState(false)

  return (
    <div className="muse-wrap module-wrap">
      <header className="muse-top">
        <div className="top-left">
          <h1>{title}</h1>
          <span className="crumb">{crumb}</span>
        </div>
        <div className="top-right">
          <span className="pill status online">
            <i className="dot" />
            Mock sẵn sàng
          </span>
        </div>
      </header>

      <main className="muse-content">
        <section className="card controls">
          <div className="module-note">{note}</div>
          <div className="toolbar module-fields">
            {fields.map((f) =>
              f.kind === 'check' ? (
                <label key={f.label} className="check">
                  <input type="checkbox" defaultChecked={f.value === '1'} readOnly />
                  {f.label}
                </label>
              ) : (
                <div key={f.label} className="tool-group">
                  <label>{f.label}</label>
                  {f.kind === 'select' ? (
                    <select className="select" defaultValue={f.value}>
                      <option>{f.value}</option>
                    </select>
                  ) : (
                    <input className="input" defaultValue={f.value} readOnly />
                  )}
                </div>
              ),
            )}
          </div>
          <textarea
            className="prompt"
            placeholder="Khu vực nhập liệu mock — sẽ nối backend sau…"
            defaultValue=""
            readOnly
          />
        </section>

        <section className="card table-card">
          <div className="table-head">
            <h2>Danh sách mock</h2>
            <div className="table-meta">
              <span>{rows.length} mục</span>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>Tên</th>
                  <th>Chi tiết</th>
                  <th style={{ width: 120 }}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.name}</td>
                    <td className="clip">{r.meta}</td>
                    <td>
                      <span className={`tag ${r.statusCls}`}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="bottombar">
        <p className="hint">Placeholder · chưa nối API thật</p>
        <div className="bottom-actions">
          <button type="button" className="btn">
            {secondaryLabel}
          </button>
          {!running ? (
            <button type="button" className="btn primary" onClick={() => setRunning(true)}>
              {primaryLabel}
            </button>
          ) : (
            <button type="button" className="btn danger" onClick={() => setRunning(false)}>
              Dừng
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}





function usePref<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw == null) return initial
      return JSON.parse(raw) as T
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(val))
    } catch {
      /* ignore */
    }
  }, [key, val])
  return [val, setVal]
}

function Flash({ text }: { text: string }) {
  if (!text) return null
  return <p className="muted sm ok-flash">{text}</p>
}

type MockAccount = {
  id: string
  mail: string
  status: string
  plan: string
  kind: 'tool' | 'gateway'
  session: string
  cookie: string
  browser: number
  active: boolean
  added: string
  lastUsed: string
  lastTest?: string
  testOk?: boolean | null
  paygate?: string
  credits?: number | null
  tier?: string
}

type CookieSlot = { browser: number; token: string; label: string; lastTest?: string; testOk?: boolean | null }

function mockCookieToken(seed: string) {
  const base = seed.replace(/[^a-zA-Z0-9]/g, '').slice(0, 18) || 'mock'
  return `__Secure-next-auth.session-token=mock_${base}_${Math.random().toString(36).slice(2, 18)}`
}

function todayLabel() {
  const d = new Date()
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

const DEFAULT_ACCOUNTS: MockAccount[] = [
  {
    id: 'a1',
    mail: 'kimnga71@gmail.com',
    status: 'Đang kích hoạt',
    plan: 'PRO (60)',
    kind: 'tool',
    session: 'mock_sess_kimnga71_active01',
    cookie: '__Secure-next-auth.session-token=mock_kimnga71_pro60_demo_session_token_xxxx',
    browser: 1,
    active: true,
    added: '10/3/2026',
    lastUsed: '10/7/2026',
    lastTest: 'PASS — phiên mock OK',
    testOk: true,
  },
  {
    id: 'a2',
    mail: 'buithiich1234@gmail.com',
    status: 'Sẵn sàng',
    plan: 'Chua doc (mock)',
    kind: 'tool',
    session: 'mock_sess_buithiich_ready02',
    cookie: '__Secure-next-auth.session-token=mock_buithiich_free50_demo_session_token_yyyy',
    browser: 1,
    active: false,
    added: '10/3/2026',
    lastUsed: '10/7/2026',
    lastTest: 'Chưa kiểm tra',
    testOk: null,
  },
  {
    id: 'a3',
    mail: 'pnb9279291@gmail.com',
    status: 'Sẵn sàng',
    plan: 'Chua doc (mock)',
    kind: 'tool',
    session: 'mock_sess_pnb9279291_ready03',
    cookie: '__Secure-next-auth.session-token=mock_pnb9279291_free50_demo_session_token_zzzz',
    browser: 1,
    active: false,
    added: '10/3/2026',
    lastUsed: '10/3/2026',
    lastTest: 'Chưa kiểm tra',
    testOk: null,
  },
  {
    id: 'g1',
    mail: 'vvv',
    status: 'Sẵn sàng',
    plan: 'PRO (181)',
    kind: 'gateway',
    session: 'mock_gw_vvv_session_181',
    cookie: '__Secure-next-auth.session-token=mock_gateway_vvv_pro181_demo_session_token',
    browser: 1,
    active: true,
    added: '10/3/2026',
    lastUsed: '10/4/2026',
    lastTest: 'PASS — gateway mock OK',
    testOk: true,
  },
]

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

type LicenseInfo = {
  available: boolean
  ok?: boolean
  msg?: string
  days?: number | null
  name?: string
  machine_id?: string
}

function SettingsUser() {
  const [lic, setLic] = useState<LicenseInfo | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')

  const showFlash = (m: string) => {
    setFlash(m)
    window.setTimeout(() => setFlash(''), 2400)
  }

  const load = async (online = false) => {
    try {
      setLic(await bridgeApi<LicenseInfo>('/api/license', { online }))
    } catch (e) {
      showFlash(errText(e))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const activate = async () => {
    if (!key.trim()) return showFlash('Chưa dán mã kích hoạt')
    setBusy(true)
    try {
      setLic(await bridgeApi<LicenseInfo>('/api/license', { action: 'activate', key }))
      setKey('')
      showFlash('Đã kích hoạt')
    } catch (e) {
      showFlash(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-panel">
      <div className="panel-card user-card">
        <h3>
          <span className="ico">👤</span> Bản quyền
        </h3>
        {!lic ? (
          <p className="muted sm">Đang đọc…</p>
        ) : !lic.available ? (
          <p className="muted sm">
            Không thấy license_manager của tool cũ (PB_TOOL_DIR). App mới không cần đăng nhập — các tab dùng khoá API
            nhập ở «Tài khoản».
          </p>
        ) : (
          <>
            <div className="user-top">
              <div className="user-email">
                <span className="user-avatar">👤</span>
                <strong>{lic.name || 'PB MEDIA'}</strong>
              </div>
              <span className="user-verified">
                <span className="check-box">{lic.ok ? '✓' : '✕'}</span> {lic.ok ? 'Đã kích hoạt' : lic.msg}
              </span>
            </div>
            {lic.ok && (
              <div className="info-row">
                <span className="label">
                  <span className="row-ico">⏱</span> Thời hạn sử dụng
                </span>
                <span className={`value ${(lic.days ?? 999) <= 7 ? 'warn-text' : 'accent'}`}>
                  {lic.days == null ? 'Không giới hạn' : `Còn ${lic.days} ngày`}
                </span>
              </div>
            )}
            {lic.ok && (lic.days ?? 999) <= 7 && (
              <div className="warn-banner">Sắp hết hạn — liên hệ người bán để gia hạn (gửi mã máy bên dưới).</div>
            )}
            <div className="info-row">
              <span className="label">Mã máy</span>
              <span className="value">
                <code>{lic.machine_id}</code>{' '}
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(lic.machine_id || '')
                    showFlash('Đã sao chép mã máy')
                  }}
                >
                  Copy
                </button>
              </span>
            </div>
            <div className="login-form">
              <input
                className="input full"
                placeholder={lic.ok ? 'Dán mã mới để gia hạn…' : 'Dán mã kích hoạt…'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button type="button" className="btn primary" disabled={busy} onClick={() => void activate()}>
                {busy ? 'Đang kích hoạt…' : 'Kích hoạt'}
              </button>
            </div>
            <div className="user-actions">
              <button type="button" className="btn teal sm" onClick={() => void load(true)}>
                ↻ Kiểm tra với máy chủ
              </button>
            </div>
          </>
        )}
        <Flash text={flash} />
      </div>
    </div>
  )
}

function SettingsApi() {
  const [apiTab, setApiTab] = usePref<'cookie' | 'account'>('pb.settings.api.tab', 'account')
  const [browsers] = usePref<number[]>('pb.settings.api.browsers', [1, 2, 3, 4])
  const [browser, setBrowser] = usePref<number>('pb.settings.api.browser', 1)
  const [useOnlyLabs, setUseOnlyLabs] = usePref('pb.settings.api.useOnlyLabs', false)
  const [cookies, setCookies] = usePref<CookieSlot[]>('pb.settings.api.cookies', [])
  const [draftToken, setDraftToken] = useState('')
  const [showToken, setShowToken] = usePref('pb.settings.api.showToken', false)
  const [showIds, setShowIds] = useState<Record<number, boolean>>({})
  const [showPaste, setShowPaste] = useState(false)
  const [accounts, setAccounts] = usePref<MockAccount[]>('pb.settings.api.accounts', DEFAULT_ACCOUNTS)
  const [accountPaste, setAccountPaste] = usePref('pb.settings.api.accountPaste', '')
  const [geminiKey, setGeminiKey] = usePref('pb.settings.api.geminiKey', '')
  const [showGemini, setShowGemini] = useState(false)
  const [flash, setFlash] = useState('')
  const [flashFail, setFlashFail] = useState(false)
  const [toast, setToast] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [awaitConfirm, setAwaitConfirm] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [cookieReveal, setCookieReveal] = useState<Record<string, boolean>>({})

  // migrate older mock accounts missing cookie/dates
  useEffect(() => {
    setAccounts((prev) => {
      let changed = false
      const next = prev.map((a) => {
        const patch: Partial<MockAccount> = {}
        if (!a.cookie) {
          patch.cookie = a.session && a.session.length >= 8 ? a.session : mockCookieToken(a.mail || a.id)
          changed = true
        }
        if (!a.added) {
          patch.added = todayLabel()
          changed = true
        }
        if (!a.lastUsed) {
          patch.lastUsed = todayLabel()
          changed = true
        }
        return Object.keys(patch).length ? { ...a, ...patch } : a
      })
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showFlash = (m: string, fail = false) => {
    setFlash(m)
    setFlashFail(fail)
    window.setTimeout(() => {
      setFlash('')
      setFlashFail(false)
    }, 2600)
  }

  const showToast = (m: string) => {
    setToast(m)
    window.setTimeout(() => setToast(''), 4200)
  }

  const activeCookie = cookies.find((c) => c.browser === browser)
  const gateway = accounts.find((a) => a.kind === 'gateway' && a.active) || accounts.find((a) => a.kind === 'gateway')
  const toolAccounts = accounts.filter((a) => a.kind === 'tool')
  const gatewayAccounts = accounts.filter((a) => a.kind === 'gateway')

  const mockPlan = (_token: string) => {
    // Do NOT invent Ultra/Pro/Free from token length — real tier from /v1/credits.
    return 'Chua doc'
  }

  const planBadgeCls = (plan: string) => {
    const p = plan.toUpperCase()
    if (p.includes('ULTRA')) return 'plan-pro'
    if (p.includes('PRO')) return 'plan-pro'
    if (p.includes('FREE')) return 'plan-free'
    if (p.includes('GATEWAY')) return 'gateway'
    return 'plan'
  }

  const saveCookie = () => {
    const token = draftToken.trim()
    if (!token) {
      showFlash('Dán cookie/token mock vào ô trước khi Add', true)
      return
    }
    if (token.length < 8) {
      showFlash('Cookie quá ngắn — cần ≥ 8 ký tự (mock)', true)
      return
    }
    setCookies((prev) => {
      const rest = prev.filter((c) => c.browser !== browser)
      return [...rest, { browser, token, label: `Browser ${browser}`, lastTest: undefined, testOk: null }]
    })
    setDraftToken('')
    showFlash(`Đã thêm cookie mock (${mockPlan(token)}) · Browser ${browser}`)
  }

  const quickAddCookie = () => {
    const sample = `mock_psid_${browser}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`
    setDraftToken(sample)
    setCookies((prev) => {
      const rest = prev.filter((c) => c.browser !== browser)
      return [...rest, { browser, token: sample, label: `Browser ${browser}`, lastTest: undefined, testOk: null }]
    })
    showFlash(`Quick Add mock cookie · Browser ${browser}`)
  }

  const clearCookie = (n?: number) => {
    const target = n ?? browser
    setCookies((prev) => prev.filter((c) => c.browser !== target))
    if (target === browser) setDraftToken('')
    showFlash(`Đã xoá cookie Browser ${target}`)
  }

  const clearAllCookies = () => {
    if (!cookies.length) {
      showFlash('Chưa có cookie nào', true)
      return
    }
    if (!window.confirm(`Xoá toàn bộ ${cookies.length} cookie mock?`)) return
    setCookies([])
    setDraftToken('')
    showFlash('Đã xoá tất cả cookies')
  }

  const mockJudgeToken = (token: string, mailHint = '') => {
    const raw = (token || '').trim()
    const hint = (mailHint || '').toLowerCase()
    if (!raw) return { ok: false, msg: 'FAIL — chưa có cookie/token mock' }
    if (raw.length < 8) return { ok: false, msg: 'FAIL — token quá ngắn (<8)' }
    if (/fail|expired|invalid|401|hết hạn/i.test(raw) || /fail|expired|invalid/.test(hint)) {
      return { ok: false, msg: 'FAIL — cookie/mock bị từ chối (HTTP 401 giả lập)' }
    }
    return { ok: true, msg: `PASS — phiên mock OK (${raw.length} ký tự · ${mockPlan(raw)})` }
  }

  const testCookie = (n?: number) => {
    const target = n ?? browser
    const slot = cookies.find((c) => c.browser === target)
    const token = (target === browser ? draftToken.trim() : '') || slot?.token || ''
    setTestingId(`cookie-${target}`)
    window.setTimeout(() => {
      const r = mockJudgeToken(token)
      setCookies((prev) => {
        const rest = prev.filter((c) => c.browser !== target)
        if (!token && !slot) return prev
        const base = slot || { browser: target, token, label: `Browser ${target}` }
        return [...rest, { ...base, token: token || base.token, lastTest: r.msg, testOk: r.ok }]
      })
      setTestingId(null)
      showFlash(r.msg, !r.ok)
    }, 550)
  }

  const parseAccountLines = (raw: string) => {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const out: { mail: string; pass: string; secret: string }[] = []
    for (const line of lines) {
      const parts = line.split(/[|:]/).map((s) => s.trim())
      const mail = parts[0] || ''
      if (!mail) continue
      out.push({ mail, pass: parts[1] || '', secret: parts[2] || '' })
    }
    return out
  }

  const chromeProfileHint = (browserId: number) =>
    `%LOCALAPPDATA%\\PBMedia\\chrome_flow_accounts\\browser_${Math.min(4, Math.max(1, browserId || 1))}`

  const openChromeForSlot = async (browserId: number, email = '') => {
    const n = Math.min(4, Math.max(1, Math.floor(browserId) || 1))
    showToast(`Dang mo Chrome Browser ${n} - trang nhap TK moi (AddSession)...`)
    const r = await launchChromeForBrowser({
      browserId: n,
      url: FLOW_LOGIN_URL,
      email: email || undefined,
    })
    if (r.ok) {
      showToast('Chrome da mo trang Google Sign-in MOI - nhap email/pass, xong bam Xac nhan')
      showFlash(`Chrome Browser ${n} · ${r.profileDir || chromeProfileHint(n)}`)
    } else {
      showToast(`Không mở được Chrome Browser ${n}`)
      showFlash(r.detail || 'Launch Chrome that bai', true)
    }
    return r
  }

  const applyAccountInfo = (
    id: string,
    info: Awaited<ReturnType<typeof fetchAccountInfo>>,
    cookieUsed: string,
  ) => {
    const day = todayLabel()
    setAccounts((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a
        const mail = info.email && info.email.includes('@') ? info.email : a.mail
        const plan = info.planLabel || a.plan
        return {
          ...a,
          mail,
          plan: plan || a.plan,
          tier: info.tier || a.tier,
          paygate: info.paygate || a.paygate,
          credits: info.credits,
          cookie: cookieUsed || a.cookie,
          session: cookieUsed || a.session,
          lastUsed: day,
          lastTest: info.detail,
          testOk: info.ok,
          status: info.ok
            ? a.active && a.kind === 'tool'
              ? 'Dang kich hoat'
              : 'San sang'
            : 'Loi phien',
        }
      }),
    )
    if (info.ok && cookieUsed) {
      const acc = accounts.find((x) => x.id === id)
      const b = acc?.browser || browser
      setCookies((prev) => {
        const rest = prev.filter((c) => c.browser !== b)
        return [
          ...rest,
          {
            browser: b,
            token: cookieUsed,
            label: `Browser ${b}`,
            lastTest: info.detail,
            testOk: info.ok,
          },
        ]
      })
    }
  }

  // Them account vao pool tu ket qua grab cookie (dung chung cho Auto Login + Xac nhan)
  const addAccountFromGrab = async (
    grab: Awaited<ReturnType<typeof grabCookiesFromBrowser>>,
    mailHint: string,
  ) => {
    const day = todayLabel()
    const info = await fetchAccountInfo(grab.cookies)
    const mail =
      (info.email && info.email.includes('@') && info.email) ||
      mailHint ||
      `browser${browser}@local`
    const isGw = /gateway|^vvv$/i.test(mail)
    const id = uid('acc')
    const acc: MockAccount = {
      id,
      mail,
      status: info.ok ? 'San sang' : 'Loi phien',
      plan: info.planLabel || (grab.hasNextAuth ? 'Da lay cookie' : 'PSID only - can next-auth'),
      kind: isGw ? 'gateway' : 'tool',
      session: grab.cookies,
      cookie: grab.cookies,
      browser,
      active: false,
      added: day,
      lastUsed: day,
      lastTest: info.detail,
      testOk: info.ok,
      tier: info.tier,
      paygate: info.paygate,
      credits: info.credits,
    }
    setAccounts((prev) => {
      const rest = prev.filter((a) => a.mail.toLowerCase() !== mail.toLowerCase())
      return [...rest, acc]
    })
    setCookies((prev) => {
      const rest = prev.filter((c) => c.browser !== browser)
      return [
        ...rest,
        { browser, token: grab.cookies, label: `Browser ${browser}`, lastTest: info.detail, testOk: info.ok },
      ]
    })
    setAccountPaste('')
    setAwaitConfirm(false)
    showFlash(`Da tu lay cookie (${grab.via || 'auto'}) | ${grab.detail} | ${info.detail}`, !info.ok)
    showToast(info.ok ? `OK ${mail} | ${info.planLabel || 'OK'}` : `Cookie OK nhung credits: ${info.detail}`)
  }

  // Start Auto Login kieu SuperVeo: mo Chrome (puppeteer-real-browser) va tu go
  // email + mat khau vao trang dang nhap Google, cho toi khi co cookie flow.
  const startAutoLogin = () => {
    const parsed = parseAccountLines(accountPaste)
    if (!parsed.length) {
      showFlash('Nhap it nhat 1 account (email|password)', true)
      return
    }
    const first = parsed[0]
    setLoginBusy(true)
    // Cho phep user bam Xac nhan neu Google hoi 2FA/captcha.
    setAwaitConfirm(true)
    showToast(`Dang mo Chrome Browser ${browser} + tu dang nhap ${first.mail}...`)
    showFlash(
      `Auto login ${first.mail} - Chrome dang mo & tu go email/mat khau. Neu Google hoi 2FA/captcha, hoan tat trong cua so roi bam Xac nhan.`,
    )
    void (async () => {
      try {
        const grab = await grabCookiesFromBrowser({
          browserId: browser,
          email: first.mail,
          password: first.pass,
          autoLogin: true,
          preferSidecar: true,
        })
        if (!grab.ok || !grab.cookies || grab.cookies.length < 20) {
          showFlash(
            grab.detail ||
              'Auto login chua xong - neu da login tay trong cua so Chrome, bam Xac nhan de lay cookie.',
            true,
          )
          showToast('Auto login chua xong - cho 2FA/Xac nhan')
          return
        }
        await addAccountFromGrab(grab, first.mail)
      } finally {
        setLoginBusy(false)
      }
    })()
  }

  const confirmLoggedIn = () => {
    const parsed = parseAccountLines(accountPaste)
    setLoginBusy(true)
    showToast('Dang dong Chrome + tu lay cookie (kieu SuperVeo)...')
    void (async () => {
      try {
        const grab = await grabCookiesFromBrowser({
          browserId: browser,
          email: parsed[0]?.mail || '',
          preferSidecar: true,
        })
        if (!grab.ok || !grab.cookies || grab.cookies.length < 20) {
          showFlash(grab.detail || 'Chua lay duoc cookie - login Flow xong bam lai Xac nhan', true)
          showToast(grab.detail || 'Lay cookie that bai')
          return
        }
        await addAccountFromGrab(grab, parsed[0]?.mail || '')
      } finally {
        setLoginBusy(false)
      }
    })()
  }

  const cancelLoginFlow = () => {
    setAwaitConfirm(false)
    setLoginBusy(false)
    showFlash('Đã huỷ luồng login mock')
  }

  const testAccount = (id: string) => {
    const acc = accounts.find((a) => a.id === id)
    if (!acc) return
    setTestingId(id)
    const slot = cookies.find((c) => c.browser === acc.browser)
    const token = normalizeCookieBlob(slot?.token || acc.cookie || acc.session || '')
    void (async () => {
      try {
        if (!token || token.length < 8) {
          showFlash(`${acc.mail}: FAIL - chua co cookie`, true)
          setAccounts((prev) =>
            prev.map((a) =>
              a.id === id
                ? { ...a, lastTest: 'FAIL - chua co cookie', testOk: false, status: 'Loi phien' }
                : a,
            ),
          )
          return
        }
        if (looksLikeMockCookie(token)) {
          showFlash(
            `${acc.mail}: Cookie mock — mo Chrome Browser ${acc.browser} → login → dan cookie that roi Test`,
            true,
          )
          setAccounts((prev) =>
            prev.map((a) =>
              a.id === id
                ? {
                    ...a,
                    lastTest: 'Cookie mock — chua doc Ultra/Pro/Free',
                    testOk: false,
                    plan:
                      a.plan.includes('mock') || a.plan.includes('Chua')
                        ? a.plan
                        : 'Chua doc (mock)',
                    status: 'San sang',
                  }
                : a,
            ),
          )
          return
        }
        const info = await fetchAccountInfo(token)
        applyAccountInfo(id, info, token)
        showFlash(`${acc.mail}: ${info.detail}`, !info.ok)
      } finally {
        setTestingId(null)
      }
    })()
  }

  const activateAccount = (id: string) => {
    const target = accounts.find((a) => a.id === id)
    if (!target) return
    const day = todayLabel()
    setAccounts((prev) =>
      prev.map((a) => {
        if (a.id === id) {
          return {
            ...a,
            active: true,
            status: a.kind === 'gateway' ? 'Sẵn sàng' : 'Đang kích hoạt',
            browser,
            lastUsed: day,
          }
        }
        if (a.kind === target.kind) {
          return {
            ...a,
            active: false,
            status: a.kind === 'tool' && a.status === 'Đang kích hoạt' ? 'Sẵn sàng' : a.status,
          }
        }
        return a
      }),
    )
    // ensure cookie slot for Tạo Ảnh
    const token = target.cookie || target.session
    if (token && token.length >= 8) {
      setCookies((prev) => {
        const rest = prev.filter((c) => c.browser !== browser)
        return [...rest, { browser, token, label: `Browser ${browser}`, lastTest: undefined, testOk: null }]
      })
    }
    showFlash(target.kind === 'tool' ? 'Đang sử dụng account (mock)' : 'Đã chọn gateway (mock)')
  }

  const deleteAccount = (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id))
    showFlash('Đã xoá account')
  }

  const clearAllAccounts = () => {
    if (!window.confirm('Xoá tất cả tài khoản mock?')) return
    setAccounts([])
    showFlash('Đã xoá tất cả account')
  }

  const refreshCookiesNew = () => {
    const targets = accounts.filter((a) => a.kind === 'tool')
    if (!targets.length) {
      showFlash('Chua co account tool', true)
      return
    }
    const active = targets.find((a) => a.active)
    const list = active ? [active] : targets.slice(0, 1)
    setLoginBusy(true)
    showToast('Dang tu lay cookie (dong Chrome profile -> doc cookie)...')
    void (async () => {
      try {
        for (const a of list) {
          const b = Math.min(4, Math.max(1, a.browser || browser || 1))
          const grab = await grabCookiesFromBrowser({
            browserId: b,
            email: a.mail,
            preferSidecar: true,
          })
          if (!grab.ok || !grab.cookies) {
            showFlash(`${a.mail}: ${grab.detail}`, true)
            continue
          }
          const info = await fetchAccountInfo(grab.cookies)
          applyAccountInfo(a.id, info, grab.cookies)
          showFlash(`${a.mail}: ${grab.detail} | ${info.detail}`, !info.ok)
        }
      } finally {
        setLoginBusy(false)
        setAwaitConfirm(false)
      }
    })()
  }

  const copyText =  async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      showFlash('Đã copy (mock token)')
    } catch {
      showFlash('Không copy được — chọn thủ công', true)
    }
  }

  const browserBar = (
    <div className="browser-row sv-browsers">
      <span className="muted sm">Browsers:</span>
      {browsers.map((n) => (
        <button
          key={n}
          type="button"
          className={`browser-btn ${browser === n ? 'on' : ''}`}
          onClick={() => {
            setBrowser(n)
            setDraftToken('')
          }}
          title={`Chọn Browser ${n}`}
        >
          {n}
        </button>
      ))}
    </div>
  )

  const renderAccountCard = (a: MockAccount) => {
    const revealed = !!cookieReveal[a.id]
    const cookieVal = a.cookie || a.session
    const masked =
      cookieVal.length > 42
        ? `${cookieVal.slice(0, 28)}${'•'.repeat(18)}${cookieVal.slice(-8)}`
        : `${'•'.repeat(Math.min(28, cookieVal.length))}`
    const isPro = /PRO|ULTRA/i.test(a.plan)
    return (
      <div key={a.id} className={`sv-acct-card ${a.kind === 'gateway' ? 'gateway' : ''} ${a.active ? 'active-acct' : ''}`}>
        {a.kind === 'gateway' ? <span className="sv-gw-ribbon">GATEWAY</span> : null}
        <div className="sv-acct-top">
          <div className="sv-acct-left">
            <div className="sv-acct-mail">{a.mail}</div>
            <div className="sv-acct-badges">
              <span className={`pill ${a.active && a.kind === 'tool' ? 'ok' : a.testOk === false ? 'err' : 'ready'}`}>
                {a.active && a.kind === 'tool' ? '✓ Đang kích hoạt' : a.status}
              </span>
              <span className={`pill ${planBadgeCls(a.plan)}`}>
                {isPro ? '★ ' : ''}
                {a.plan}
              </span>
              {a.kind === 'gateway' ? <span className="pill gateway">Gateway</span> : null}
              <span className="pill plan" title="Chrome profile slot">Browser {a.browser || 1}</span>
            </div>
            <div className="sv-acct-dates">
              Added: {a.added || '—'} · Last used: {a.lastUsed || '—'}
            </div>
          </div>
          <div className="sv-acct-right">
            {a.kind === 'tool' ? (
              <button
                type="button"
                className={`btn sm ${a.active ? 'sv-using' : 'teal'} sv-act-btn`}
                onClick={() => activateAccount(a.id)}
              >
                {a.active ? 'Đang sử dụng' : 'Kích hoạt'}
              </button>
            ) : null}
            <div className="sv-icon-row">
              <button type="button" className="sv-ico" title="Test phien + doc Ultra/Pro/Free" onClick={() => testAccount(a.id)}>
                ↻
              </button>
              <button type="button" className="sv-ico" title="Ghim (mock)" onClick={() => showFlash('Ghim mock')}>
                📌
              </button>
              <button
                type="button"
                className="sv-ico"
                title="Mo dung Chrome profile Browser cua TK"
                onClick={() => {
                  void openChromeForSlot(a.browser || browser, a.mail)
                }}
              >
                🌐
              </button>
              <button
                type="button"
                className="sv-ico"
                title="Lay cookie moi - SuperVeo auto (dong Chrome + doc cookie)"
                onClick={() => {
                  setLoginBusy(true)
                  showToast(`Dang lay cookie Browser ${a.browser || browser}...`)
                  void grabCookiesFromBrowser({
                    browserId: a.browser || browser,
                    email: a.mail,
                    preferSidecar: true,
                  })
                    .then(async (grab) => {
                      if (!grab.ok || !grab.cookies) {
                        await openChromeForSlot(a.browser || browser, a.mail)
                        setAwaitConfirm(true)
                        showFlash(grab.detail || 'Chua co cookie - login xong bam Xac nhan', true)
                        return
                      }
                      const info = await fetchAccountInfo(grab.cookies)
                      applyAccountInfo(a.id, info, grab.cookies)
                      showFlash(`${a.mail}: ${grab.detail} | ${info.detail}`, !info.ok)
                    })
                    .finally(() => setLoginBusy(false))
                }}
              >
                🔄
              </button>
              <button type="button" className="sv-ico danger" title="Xoá" onClick={() => deleteAccount(a.id)}>
                🗑
              </button>
            </div>
          </div>
        </div>
        <div className="sv-cookie-field">
          <span className="sv-cookie-label">Cookie:</span>
          <code className="sv-cookie-val" title={cookieVal}>
            {revealed ? cookieVal : masked}
          </code>
          <button type="button" className="sv-ico" title="Hiện/ẩn" onClick={() => setCookieReveal((p) => ({ ...p, [a.id]: !p[a.id] }))}>
            {revealed ? '🙈' : '👁'}
          </button>
          <button type="button" className="sv-ico" title="Copy" onClick={() => copyText(cookieVal)}>
            ⎘
          </button>
          <button
            type="button"
            className="sv-ico"
            title="Sửa cookie mock"
            onClick={() => {
              const next = window.prompt('Dan cookie Flow that (tu Chrome profile TK nay)', cookieVal)
              if (next == null) return
              const trimmed = normalizeCookieBlob(next)
              if (trimmed.length < 8) {
                showFlash('Cookie mock cần ≥ 8 ký tự', true)
                return
              }
              setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, cookie: trimmed, session: trimmed } : x)))
              setCookies((prev) => {
                const b = a.browser || browser
                const rest = prev.filter((c) => c.browser !== b)
                return [...rest, { browser: b, token: trimmed, label: `Browser ${b}` }]
              })
              if (looksLikeMockCookie(trimmed)) {
                showFlash('Van la cookie mock — mo Chrome Browser dung TK', true)
              } else {
                showFlash('Da luu cookie — dang doc Ultra/Pro/Free...')
                void fetchAccountInfo(trimmed).then((info) => {
                  applyAccountInfo(a.id, info, trimmed)
                  showFlash(`${a.mail}: ${info.detail}`, !info.ok)
                })
              }
            }}
          >
            ✎
          </button>
        </div>
        {a.lastTest ? <div className={`acct-test ${a.testOk ? 'ok' : a.testOk === false ? 'fail' : ''}`}>{a.lastTest}</div> : null}
      </div>
    )
  }

  return (
    <div className="settings-panel sv-api">
      <div className="panel-head">
        <h3>
          <span className="ico">⚙️</span> Cấu hình API
        </h3>
        <span className="gateway-pill live">
          <i className="dot" /> Gateway: {gateway?.mail || '— chưa chọn —'}
        </span>
      </div>

      <div className="panel-card">
        <div className="api-tabs-row">
          <div className="seg api-seg">
            <button
              type="button"
              className={`seg-btn ${apiTab === 'cookie' ? 'on' : ''}`}
              onClick={() => setApiTab('cookie')}
            >
              Cookie
              {apiTab === 'cookie' ? <span className="tab-using">đang dùng</span> : null}
            </button>
            <button
              type="button"
              className={`seg-btn ${apiTab === 'account' ? 'on' : ''}`}
              onClick={() => setApiTab('account')}
            >
              Account
              {apiTab === 'account' ? <span className="tab-using">đang dùng</span> : null}
            </button>
          </div>
        </div>

        {apiTab === 'cookie' ? (
          <>
            <div className="api-tabs-row" style={{ marginTop: 8 }}>
              {browserBar}
            </div>
            <div className="cookie-toolbar">
              <strong className="cookie-title">Cookies:</strong>
              <div className="cookie-toolbar-actions">
                <button type="button" className="btn sm" onClick={quickAddCookie}>
                  ⚡ Quick Add
                </button>
                <button type="button" className="btn logout sm" onClick={clearAllCookies}>
                  🗑 Clear All
                </button>
                <span className="muted sm cookie-count">
                  {cookies.length ? `${cookies.length} cookies` : '0 cookies'}
                </span>
              </div>
            </div>

            {cookies.length === 0 ? (
              <div className="sv-empty-dash">Chưa có cookie mock — Quick Add hoặc dán token rồi bấm Add</div>
            ) : (
              <div className="sv-cookie-list">
                {cookies
                  .slice()
                  .sort((a, b) => a.browser - b.browser)
                  .map((c) => {
                    const shown = !!showIds[c.browser]
                    const plan = mockPlan(c.token)
                    return (
                      <div key={c.browser} className={`sv-cookie-row ${c.browser === browser ? 'on' : ''}`}>
                        <button
                          type="button"
                          className="sv-cookie-pick"
                          onClick={() => {
                            setBrowser(c.browser)
                            setDraftToken('')
                          }}
                        >
                          <span className="muted sm">#{c.browser}</span>
                          <span className="sv-cookie-mask">
                            {shown ? c.token : `${'•'.repeat(Math.min(18, Math.max(8, c.token.length / 4)))}`}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="btn sm icon-only"
                          onClick={() => setShowIds((p) => ({ ...p, [c.browser]: !p[c.browser] }))}
                          title={shown ? 'Ẩn' : 'Hiện'}
                        >
                          {shown ? '🙈' : '👁'}
                        </button>
                        <span className={`pill plan plan-${plan.toLowerCase()}`}>{plan}</span>
                        <button
                          type="button"
                          className="btn sm teal"
                          disabled={testingId === `cookie-${c.browser}`}
                          onClick={() => testCookie(c.browser)}
                        >
                          {testingId === `cookie-${c.browser}` ? '…' : 'Test'}
                        </button>
                        <button type="button" className="btn sm danger-ghost" onClick={() => clearCookie(c.browser)}>
                          🗑
                        </button>
                        {c.lastTest ? (
                          <div className={`acct-test full ${c.testOk ? 'ok' : c.testOk === false ? 'fail' : ''}`}>
                            {c.lastTest}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
              </div>
            )}

            <p className="muted sm cookie-tip">
              Mock only: dán token/session giả lập (lưu localStorage). Không đọc cookie trình duyệt thật.
            </p>

            <div className="cookie-input-row sv-add-cookie">
              <input
                className="input full"
                type={showToken ? 'text' : 'password'}
                placeholder="Dán cookie/token mock vào đây…"
                value={draftToken}
                onChange={(e) => setDraftToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCookie()
                }}
              />
              <button type="button" className="btn sm" onClick={() => setShowToken(!showToken)}>
                {showToken ? 'Ẩn' : '👁'}
              </button>
              <button type="button" className="btn teal sm" onClick={saveCookie}>
                Add
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={testingId === `cookie-${browser}`}
                onClick={() => testCookie()}
              >
                {testingId === `cookie-${browser}` ? '…' : 'Test'}
              </button>
            </div>

            <div className="adv-row">
              <div>
                <strong>useOnlyLabs</strong>
                <p className="muted sm">
                  <span className="blue-dot">🔵</span>
                  {useOnlyLabs ? 'Chỉ dùng luồng Labs (mock).' : 'Luồng thường: cần session đầy đủ (mock).'}
                </p>
              </div>
              <Toggle on={useOnlyLabs} onChange={setUseOnlyLabs} />
            </div>

            <div className="gemini-box">
              <div className="gemini-head">
                <strong>
                  Gemini Key <span className="muted sm">(tuỳ chọn)</span>
                </strong>
                {geminiKey ? (
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => {
                      setGeminiKey('')
                      showFlash('Đã xoá key — dùng key hệ thống (mock)')
                    }}
                  >
                    Xoá key
                  </button>
                ) : null}
              </div>
              <div className="cookie-input-row">
                <input
                  className="input full"
                  type={showGemini ? 'text' : 'password'}
                  placeholder="Nhập Gemini API key (không bắt buộc)…"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                />
                <button type="button" className="btn sm" onClick={() => setShowGemini((v) => !v)}>
                  {showGemini ? 'Ẩn' : '👁'}
                </button>
                <button
                  type="button"
                  className="btn teal sm"
                  onClick={() => showFlash(geminiKey.trim() ? 'Đã lưu Gemini API key (localStorage)' : 'Chưa nhập key', !geminiKey.trim())}
                >
                  Lưu
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="sv-add-box">
              <div className="acct-add-head">
                <strong>Thêm Account Mới</strong>
                {browserBar}
              </div>
              <div className="sv-paste-wrap">
                <textarea
                  className="prompt short sv-account-ta"
                  placeholder="email|password hoặc email|password|2FA_SECRET"
                  rows={3}
                  value={showPaste || !accountPaste ? accountPaste : '•'.repeat(Math.min(48, Math.max(12, accountPaste.length)))}
                  onChange={(e) => {
                    setShowPaste(true)
                    setAccountPaste(e.target.value)
                  }}
                  onFocus={() => setShowPaste(true)}
                />
                <button
                  type="button"
                  className="sv-eye"
                  title={showPaste ? 'Ẩn' : 'Hiện'}
                  onClick={() => setShowPaste((v) => !v)}
                >
                  {showPaste ? '🙈' : '👁'}
                </button>
              </div>
              <p className="muted sm format-hint">
                💡 Format: <code>email|password</code> hoặc <code>email|password|2FA_SECRET</code>. Mỗi dòng 1 account.
              </p>
              {awaitConfirm ? (
                <div className="sv-confirm-row">
                  <button type="button" className="btn sv-confirm-ok" onClick={confirmLoggedIn}>
                    ✓ Xác nhận (Đã login xong)
                  </button>
                  <button type="button" className="btn" onClick={cancelLoginFlow}>
                    Hủy
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn teal full sv-auto-login"
                  disabled={loginBusy}
                  onClick={startAutoLogin}
                >
                  {loginBusy ? 'Đang mở browser…' : '↻ Start Auto Login'}
                </button>
              )}
            </div>
          </>
        )}

        {flash ? <p className={`muted sm ok-flash ${flashFail ? 'fail-flash' : ''}`}>{flash}</p> : null}
      </div>

      {apiTab === 'account' ? (
        <div className="panel-card">
          <div className="acct-list-head">
            <h4>{accounts.length ? `${accounts.length} tài khoản` : 'Chưa có account nào'}</h4>
            <div className="acct-actions">
              <button type="button" className="btn teal sm" onClick={refreshCookiesNew}>
                ↻ Lấy Cookie Mới
              </button>
              <button type="button" className="btn logout sm" onClick={clearAllAccounts}>
                🗑 Xoá tất cả
              </button>
            </div>
          </div>

          {!accounts.length ? (
            <div className="sv-empty-dash tall">Chưa có account — dán email|password rồi Start Auto Login</div>
          ) : (
            <>
              <p className="section-tag">TÀI KHOẢN CHẠY TOOL ({toolAccounts.length})</p>
              {toolAccounts.length === 0 ? (
                <p className="muted sm">Chưa có account tool.</p>
              ) : (
                <div className="sv-acct-list">{toolAccounts.map(renderAccountCard)}</div>
              )}

              <p className="section-tag">TÀI KHOẢN GATEWAY ({gatewayAccounts.length})</p>
              {gatewayAccounts.length === 0 ? (
                <p className="muted sm">Chưa có gateway — mail chứa vvv hoặc chứagateway.</p>
              ) : (
                <div className="sv-acct-list">{gatewayAccounts.map(renderAccountCard)}</div>
              )}
            </>
          )}
        </div>
      ) : null}

      {toast ? (
        <div className="sv-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  )
}


function mockDownloadName(prefixOn: boolean, prefix: string, overwrite: boolean, index: number) {
  const base = prefixOn && prefix.trim() ? prefix.trim() : 'video'
  if (overwrite) return `${base}_${index}.mp4`
  // collide simulation: index 1 already exists → (2)
  if (index === 1) return `${base}_1(2).mp4`
  return `${base}_${index}.mp4`
}

function SettingsDownload() {
  const [autoDl, setAutoDl] = usePref('pb.settings.dl.auto', true)
  const [prefixOn, setPrefixOn] = usePref('pb.settings.dl.prefixOn', true)
  const [prefix, setPrefix] = usePref('pb.settings.dl.prefix', 'video')
  const [overwrite, setOverwrite] = usePref('pb.settings.dl.overwrite', false)
  const [outPath, setOutPath] = useState('')
  const [flash, setFlash] = useState('')

  useEffect(() => {
    bridgeApi<{ out_root: string }>('/api/version', {})
      .then((v) => setOutPath(v.out_root))
      .catch(() => {})
  }, [])

  const saveRoot = async (path: string) => {
    try {
      await bridgeApi('/api/config/bridge', { set: { out_root: path.trim() } })
      const v = await bridgeApi<{ out_root: string }>('/api/version', {})
      setOutPath(v.out_root)
      showFlash('Đã lưu — mọi tab lưu vào thư mục này')
    } catch (e) {
      showFlash(errText(e))
    }
  }

  const showFlash = (m: string) => {
    setFlash(m)
    window.setTimeout(() => setFlash(''), 1800)
  }

  const pickRoot = async () => {
    try {
      const d = await pickFolder(outPath)
      if (d) void saveRoot(d)
    } catch (e) {
      showFlash(errText(e))
    }
  }

  return (
    <div className="settings-panel">
      <div className="panel-card">
        <h3>
          <span className="ico">⬇️</span> Cài đặt tải xuống
        </h3>

        <div className="setting-block">
          <p className="block-label">Thư mục lưu</p>
          <div className="path-row">
            <input
              className="input full path-input"
              value={outPath}
              onChange={(e) => setOutPath(e.target.value)}
              onBlur={() => void saveRoot(outPath)}
              placeholder="Đường dẫn thư mục…"
            />
            <button type="button" className="btn teal" onClick={() => void pickRoot()}>
              Chọn
            </button>
            <button type="button" className="btn" onClick={() => openFolder(outPath)}>
              Mở
            </button>
          </div>
          <p className="muted sm">
            Thư mục gốc của mọi tab (Veo3, Tạo ảnh, InVideo, Grok, Seedance, MiniApp…), mỗi tab một thư mục con. Tab
            nào đã chọn thư mục riêng thì giữ thư mục đó.
          </p>
          <Flash text={flash} />
        </div>

        <div className="setting-block">
          <p className="block-label">Tự động tải xuống</p>
          <label className="check">
            <input type="checkbox" checked={autoDl} onChange={(e) => setAutoDl(e.target.checked)} />
            Tự động tải xuống video khi hoàn thành
          </label>
          <p className="muted sm">Khi bật, video sẽ tự động được tải xuống sau khi tạo xong</p>
        </div>

        <div className="setting-block">
          <p className="block-label">Tên file prefix</p>
          <label className="check">
            <input
              type="checkbox"
              checked={prefixOn}
              onChange={(e) => setPrefixOn(e.target.checked)}
            />
            Sử dụng prefix tùy chỉnh
          </label>
          <div className="prefix-row">
            <input
              className="input"
              disabled={!prefixOn}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
            <span className="muted">_1.mp4</span>
          </div>
          <p className="muted sm">
            Ví dụ: &apos;{prefixOn ? prefix || 'video' : 'video'}&apos; →{' '}
            {mockDownloadName(prefixOn, prefix, overwrite, 1)}
          </p>
        </div>

        <div className="setting-block">
          <p className="block-label">Ghi đè file</p>
          <label className="check">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Ghi đè file khi trùng tên
          </label>
          <p className="muted sm">
            {overwrite
              ? 'Trùng tên → ghi đè file cũ (video_1.mp4).'
              : 'Trùng tên → tạo tên mới (video_1(2).mp4, video_1(3).mp4…).'}
          </p>
        </div>

        <p className="muted sm">
          Tự động tải / prefix / ghi đè: lưu cho máy này. Tool Flow luôn tự tải video về khi xong và đặt tên theo số
          cảnh (001.mp4…), không ghi đè file cũ.
        </p>
      </div>
    </div>
  )
}

function SettingsImage() {
  const [cropOn, setCropOn] = usePref('pb.settings.img.cropOn', false)
  const [cropMode, setCropMode] = usePref<CropMode>('pb.settings.img.mode', 'pad')
  const [ratio, setRatio] = usePref<'16:9' | '9:16'>('pb.settings.img.ratio', '16:9')

  const applyMode = (mode: CropMode) => {
    setCropMode(mode)
    setCropOn(mode === 'crop')
  }

  return (
    <div className="settings-panel">
      <div className="panel-card">
        <h3>
          <span className="ico">✂️</span> Xử lý Ảnh Tham Chiếu
        </h3>
        <p className="muted sm">
          Cấu hình cách xử lý ảnh tham chiếu khi sử dụng tính năng Auto Crop với tỉ lệ khung hình
          16:9 hoặc 9:16.
        </p>

        <div className="crop-head">
          <div>
            <strong>Sử dụng chế độ cắt ảnh (Crop)</strong>
            <p className="muted sm">
              <span className="ok-dot">●</span>{' '}
              {cropMode === 'pad'
                ? 'Thêm viền đen để giữ nguyên toàn bộ ảnh'
                : 'Cắt ảnh để vừa khung — có thể mất nội dung'}
            </p>
          </div>
          <Toggle
            on={cropOn}
            onChange={(v) => {
              setCropOn(v)
              setCropMode(v ? 'crop' : 'pad')
            }}
          />
        </div>

        <div className="seg" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`seg-btn ${ratio === '16:9' ? 'on' : ''}`}
            onClick={() => setRatio('16:9')}
          >
            Preview 16:9
          </button>
          <button
            type="button"
            className={`seg-btn ${ratio === '9:16' ? 'on' : ''}`}
            onClick={() => setRatio('9:16')}
          >
            Preview 9:16
          </button>
        </div>

        <div className="crop-grid">
          <button
            type="button"
            className={`crop-card ${cropMode === 'pad' ? 'selected' : ''}`}
            onClick={() => applyMode('pad')}
          >
            <strong className={cropMode === 'pad' ? 'accent-title' : ''}>
              ▦ Chế độ Pad (Mặc định)
            </strong>
            <ul>
              <li className="ok">Giữ nguyên toàn bộ ảnh</li>
              <li className="ok">Thêm viền đen để đủ tỉ lệ</li>
              <li className="ok">Không mất nội dung</li>
            </ul>
            <div className={`crop-preview pad ratio-${ratio === '16:9' ? 'land' : 'port'}`}>
              <span className="img-box">Ảnh</span>
            </div>
          </button>
          <button
            type="button"
            className={`crop-card ${cropMode === 'crop' ? 'selected' : ''}`}
            onClick={() => applyMode('crop')}
          >
            <strong className={cropMode === 'crop' ? 'accent-title' : ''}>✂️ Chế độ Crop</strong>
            <ul>
              <li className="warn">Cắt ảnh để vừa khung</li>
              <li className="warn">Có thể mất phần ảnh</li>
              <li className="ok">Không có viền đen</li>
            </ul>
            <div className={`crop-preview crop ratio-${ratio === '16:9' ? 'land' : 'port'}`}>
              <span className="img-box fill">Ảnh</span>
            </div>
          </button>
        </div>

        <div className="note-banner">
          💡 Đang chọn: <strong>{cropMode === 'pad' ? 'Pad' : 'Crop'}</strong> · tỉ lệ preview{' '}
          {ratio}. Áp dụng cho ảnh tham chiếu / ảnh Image To Video của Veo3 khi bật &apos;Auto Crop&apos; trong
          form tạo — cầu nối pad/crop đúng tỉ lệ khung trước khi gửi Flow.
        </div>
      </div>
    </div>
  )
}

function SettingsAdvanced() {
  const [tokenMode, setTokenMode] = usePref('pb.settings.adv.tokenMode', false)
  const [proxyOn, setProxyOn] = usePref('pb.settings.adv.proxyOn', false)
  const [proxyTab, setProxyTab] = usePref<'list' | 'rotate'>('pb.settings.adv.proxyTab', 'list')
  const [proxies, setProxies] = usePref<string[]>('pb.settings.adv.proxies', [])
  const [proxyDraft, setProxyDraft] = useState('')
  const [rotateUrl, setRotateUrl] = usePref('pb.settings.adv.rotateUrl', '')
  const [rotateOn, setRotateOn] = usePref('pb.settings.adv.rotateOn', false)
  const [confirmKill, setConfirmKill] = useState(false)
  const [killed, setKilled] = useState('')
  const [flash, setFlash] = useState('')
  const firstSync = useRef(true)

  // Đồng bộ sang cầu nối (proxy áp vào biến môi trường của tiến trình Python, System Mode đổi bộ mint)
  useEffect(() => {
    const t = window.setTimeout(
      () => {
        firstSync.current = false
        void bridgeApi('/api/config/bridge', {
          set: {
            proxy_on: proxyOn,
            proxies: proxies.join('\n'),
            proxy_rotate_on: rotateOn,
            proxy_rotate_url: rotateUrl,
            token_system: tokenMode,
          },
        }).catch(() => {})
      },
      firstSync.current ? 0 : 600,
    )
    return () => window.clearTimeout(t)
  }, [proxyOn, proxies, rotateOn, rotateUrl, tokenMode])

  const showFlash = (m: string) => {
    setFlash(m)
    window.setTimeout(() => setFlash(''), 1800)
  }

  const addProxy = () => {
    const lines = proxyDraft
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (!lines.length) {
      showFlash('Nhập proxy host:port…')
      return
    }
    setProxies((prev) => [...prev, ...lines])
    setProxyDraft('')
    setProxyOn(true)
    showFlash(`Đã thêm ${lines.length} proxy`)
  }

  const removeProxy = (idx: number) => {
    setProxies((prev) => prev.filter((_, i) => i !== idx))
  }

  const doKill = async () => {
    setConfirmKill(false)
    setKilled('Đang dọn processes…')
    try {
      const r = await bridgeApi<{ lines: string[] }>('/api/util/kill', {})
      setKilled(r.lines.join(' · '))
    } catch (e) {
      setKilled(errText(e))
    }
  }

  return (
    <div className="settings-panel">
      <div className="panel-head">
        <h3>
          <span className="ico">🧪</span> Cấu hình nâng cao
        </h3>
        <span className="gateway-pill live">
          <i className="dot" /> {proxyOn ? `Proxy ON · ${proxies.length} mục` : 'Proxy OFF'}
        </span>
      </div>

      <div className="panel-card">
        <h4>Chế độ lấy token</h4>
        <p className="muted sm">Cách đúc token reCAPTCHA cho Flow / Veo3.</p>
        <div className="adv-row">
          <div>
            <strong>Ưu tiên System Mode</strong>
            <p className="muted sm">
              <span className="blue-dot">🔵</span>
              {tokenMode ? 'System Mode — sidecar Chrome riêng' : 'Mặc định — tiện ích Chrome (sidecar dự phòng)'}
            </p>
          </div>
          <Toggle on={tokenMode} onChange={setTokenMode} />
        </div>
        <div className="info-callout">
          <strong>ℹ System Mode</strong>
          <p>Không cần Chrome Extension nhưng có thể chậm hơn (CAPCUT_MINT_PRIMARY=sidecar).</p>
        </div>
      </div>

      <div className="panel-card">
        <h4>Cấu hình Proxy</h4>
        <div className="seg">
          <button
            type="button"
            className={`seg-btn ${proxyTab === 'list' ? 'on' : ''}`}
            onClick={() => setProxyTab('list')}
          >
            📋 Proxy List
          </button>
          <button
            type="button"
            className={`seg-btn ${proxyTab === 'rotate' ? 'on' : ''}`}
            onClick={() => setProxyTab('rotate')}
          >
            ↻ Proxy Xoay
          </button>
        </div>
        <div className="adv-row">
          <div>
            <strong>🌐 Proxy</strong>
            <p className="muted sm">{proxyOn ? 'Bật' : 'Tắt'}</p>
          </div>
          <Toggle on={proxyOn} onChange={setProxyOn} />
        </div>

        {proxyTab === 'list' ? (
          <>
            <textarea
              className="prompt short"
              placeholder="host:port hoặc host:port:user:pass (mỗi dòng 1 proxy)"
              value={proxyDraft}
              onChange={(e) => setProxyDraft(e.target.value)}
              rows={3}
              disabled={!proxyOn}
            />
            <div className="acct-actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn teal sm" disabled={!proxyOn} onClick={addProxy}>
                + Thêm proxy
              </button>
              <button
                type="button"
                className="btn sm danger-ghost"
                disabled={!proxyOn || !proxies.length}
                onClick={() => {
                  setProxies([])
                  showFlash('Đã xoá list proxy')
                }}
              >
                Xoá list
              </button>
            </div>
            {proxies.length > 0 && (
              <div className="proxy-list">
                {proxies.map((p, i) => (
                  <div key={`${p}-${i}`} className="proxy-item">
                    <code>{p}</code>
                    <button
                      type="button"
                      className="btn sm danger-ghost"
                      onClick={() => removeProxy(i)}
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="adv-row">
              <div>
                <strong>Bật xoay proxy</strong>
                <p className="muted sm">
                  {rotateOn ? 'Lấy ip:port từ URL mỗi lần lưu' : 'Tắt xoay — dùng proxy đầu list'}
                </p>
              </div>
              <Toggle
                on={rotateOn}
                onChange={(v) => {
                  setRotateOn(v)
                  if (v) setProxyOn(true)
                }}
              />
            </div>
            <input
              className="input full"
              placeholder="URL API trả về ip:port (hoặc ip:port:user:pass)"
              value={rotateUrl}
              onChange={(e) => setRotateUrl(e.target.value)}
              disabled={!proxyOn}
            />
          </>
        )}
        <Flash text={flash} />
      </div>

      <div className="panel-card">
        <h4>Dọn dẹp Processes</h4>
        <p className="muted sm">
          Kill Chrome hồ sơ PBMedia (browser_1..4), Chrome/Node của bộ mint token và realesrgan còn treo. Không đụng
          Chrome thường của bạn.
        </p>
        {!confirmKill ? (
          <button type="button" className="btn logout full" onClick={() => setConfirmKill(true)}>
            🗑⚡ Kill All Processes
          </button>
        ) : (
          <div className="confirm-box">
            <p>
              Xác nhận Kill All Processes? Mẻ Flow / Veo3 đang chạy sẽ bị dừng.
            </p>
            <div className="acct-actions">
              <button type="button" className="btn logout" onClick={() => void doKill()}>
                Xác nhận Kill
              </button>
              <button type="button" className="btn sm" onClick={() => setConfirmKill(false)}>
                Huỷ
              </button>
            </div>
          </div>
        )}
        {killed && <p className="muted sm ok-flash">{killed}</p>}
      </div>
    </div>
  )
}

function SettingsChrome() {
  const [st, setSt] = useState<{ available: boolean; connected?: boolean; error?: string } | null>(null)

  const load = async (start = false) => {
    try {
      setSt(await bridgeApi('/api/ext/status', { start }))
    } catch (e) {
      setSt({ available: false, error: errText(e) })
    }
  }

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 4000)
    return () => window.clearInterval(t)
  }, [])

  return (
    <div className="settings-panel sv-chrome">
      <div className="panel-head">
        <h3>
          <span className="ico">🧩</span> Chrome Extension
        </h3>
        <span className="gateway-pill live">
          <i className="dot" />{' '}
          {!st ? '…' : !st.available ? 'Không có bộ mint' : st.connected ? 'Tiện ích đã nối' : 'Chưa nối'}
        </span>
      </div>

      <div className="panel-card">
        <h4>Kết nối</h4>
        <p className="muted sm">
          Tiện ích chạy trong Chrome thật của bạn, đúc token reCAPTCHA ngay trong tab Flow rồi đẩy về app qua{' '}
          <code>ws://127.0.0.1:3458/ws</code>. App dùng đúng giao thức của tiện ích «Cookie-Editor + Recaptcha
          Pusher» (SuperVeo) — cài tiện ích đó là dùng được.
        </p>
        {st?.error && <p className="muted sm">⚠ {st.error}</p>}
        <button type="button" className="btn teal full" onClick={() => void load(true)}>
          ⚡ Mở cổng 3458 ngay (để tiện ích nối trước mẻ đầu)
        </button>
      </div>

      <div className="panel-card">
        <h4>Hướng dẫn cài đặt</h4>
        <ol className="sv-ext-steps">
          <li>
            <strong>Có thư mục tiện ích</strong>
            <p className="muted sm">Thư mục chứa manifest.json của tiện ích (giải nén vào chỗ cố định).</p>
          </li>
          <li>
            <strong>Mở trang quản lý extension</strong>
            <p className="muted sm">
              Trong Chrome mở <code>chrome://extensions</code>, bật Developer mode.
            </p>
          </li>
          <li>
            <strong>Load unpacked</strong>
            <p className="muted sm">Bấm &quot;Load unpacked&quot; và chọn thư mục chứa manifest.json.</p>
          </li>
          <li>
            <strong>Mở tab Flow</strong>
            <p className="muted sm">
              Mở và đăng nhập <code>flow.google.com</code> — tiện ích cần tab này để đúc token. Trạng thái ở góc trên
              chuyển «Tiện ích đã nối».
            </p>
          </li>
        </ol>
      </div>

      <div className="sv-ext-warn">
        <strong>⚠ Lưu ý</strong>
        <ul>
          <li>Không muốn cài tiện ích: bật System Mode ở «Nâng cao» (chậm hơn).</li>
          <li>Service worker của Chrome ngủ khi rảnh — nối có thể chậm vài giây sau khi mở tab Flow.</li>
        </ul>
      </div>
    </div>
  )
}


type VersionInfo = {
  python: string
  tool_dir: string
  tool_ok: boolean
  out_root: string
  ffmpeg: string
  ytdlp: string
  extension: boolean | null
}

function SettingsVersion() {
  const [v, setV] = useState<VersionInfo | null>(null)
  const [err, setErr] = useState('')
  const [upId, setUpId] = useState('')
  const jobs = useJobs(['update-ytdlp'])
  const up = jobs.find((j) => j.id === upId)

  const load = () =>
    bridgeApi<VersionInfo>('/api/version', {})
      .then(setV)
      .catch((e) => setErr(errText(e)))

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (up && up.status !== 'dang_chay') void load()
  }, [up?.status])

  return (
    <div className="settings-panel">
      <div className="panel-card">
        <h3>
          <span className="ico">◎</span> Phiên bản
        </h3>
        <div className="info-row">
          <span className="label">PB MEDIA</span>
          <span className="value accent">v0.1.0</span>
        </div>
        <div className="info-row">
          <span className="label">Khung</span>
          <span className="value">Tauri + React + Vite · cầu nối Python</span>
        </div>
        {err && <p className="muted sm">⚠ {err}</p>}
        {v && (
          <>
            <div className="info-row">
              <span className="label">Python</span>
              <span className="value">{v.python}</span>
            </div>
            <div className="info-row">
              <span className="label">Tool cũ</span>
              <span className={`value ${v.tool_ok ? '' : 'warn-text'}`}>
                {v.tool_dir} {v.tool_ok ? '' : '(không thấy)'}
              </span>
            </div>
            <div className="info-row">
              <span className="label">Thư mục lưu</span>
              <span className="value">{v.out_root}</span>
            </div>
            <div className="info-row">
              <span className="label">FFmpeg</span>
              <span className={`value ${v.ffmpeg ? '' : 'warn-text'}`}>{v.ffmpeg || 'Chưa cài'}</span>
            </div>
            <div className="info-row">
              <span className="label">yt-dlp</span>
              <span className={`value ${v.ytdlp ? '' : 'warn-text'}`}>{v.ytdlp || 'Chưa cài'}</span>
            </div>
            <div className="info-row">
              <span className="label">Tiện ích Chrome</span>
              <span className="value">{v.extension == null ? '—' : v.extension ? 'Đã nối' : 'Chưa nối'}</span>
            </div>
          </>
        )}
        <div className="acct-actions">
          <button type="button" className="btn" onClick={() => void load()}>
            ↻ Kiểm tra lại
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!v?.ytdlp || up?.status === 'dang_chay'}
            onClick={() =>
              void bridgeApi<{ id: string }>('/api/util/update-ytdlp', {})
                .then((r) => setUpId(r.id))
                .catch((e) => setErr(errText(e)))
            }
          >
            {up?.status === 'dang_chay' ? 'Đang cập nhật yt-dlp…' : '⬆ Cập nhật yt-dlp'}
          </button>
        </div>
        {up && up.status !== 'dang_chay' && <p className="muted sm">{up.msg}</p>}
      </div>
    </div>
  )
}

function SettingsView({ pane }: { pane: SettingsPane }) {
  switch (pane) {
    case 'user':
      return <SettingsUser />
    case 'api':
      // 08/10: bản THẬT (sổ tài khoản tool cũ qua cầu nối). Bản giả lập cũ: SettingsApi.
      return <SettingsTaiKhoan />
    case 'download':
      return <SettingsDownload />
    case 'image':
      return <SettingsImage />
    case 'advanced':
      return <SettingsAdvanced />
    case 'chrome':
      return <SettingsChrome />
    case 'version':
      return <SettingsVersion />
  }
}


function PlaceholderWorkspace({ title }: { title: string }) {
  return (
    <div className="placeholder-wrap">
      <div className="placeholder-card">
        <div className="placeholder-ico">◇</div>
        <h2>{title}</h2>
        <p>Mock tab — UI học layout SuperVeo, chưa nối backend.</p>
      </div>
    </div>
  )
}

export default function App() {
  const [top, setTop] = useState<TopTab>('veo3')
  const [settingsPane, setSettingsPane] = useState<SettingsPane>('api')

  return (
    <div className="shell">
      <header className="top-nav">
        <div className="top-nav-left">
          <button
            type="button"
            className="brand-mark"
            title="Veo3"
            onClick={() => setTop('veo3')}
          >
            <span className="brand-play" aria-hidden />
          </button>
          {TOP_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`top-tab ${top === t.id ? 'active' : ''} ${t.id === 'veo3' ? 'tab-veo' : ''} ${t.id === 'grok' ? 'tab-grok' : ''} ${t.id === 'muse' ? 'tab-muse' : ''} ${t.id === 'flow' ? 'tab-flow' : ''} ${t.id === 'invideo' ? 'tab-invideo' : ''} ${t.id === 'creator' ? 'tab-creator' : ''} ${t.id === 'voice' ? 'tab-voice' : ''} ${t.id === 'tube' ? 'tab-tube' : ''} ${t.id === 'ghep' ? 'tab-ghep' : ''} ${t.id === 'mini' ? 'tab-mini' : ''}`}
              onClick={() => setTop(t.id)}
            >
              <span>{t.label}</span>
              {t.badge && <span className={`badge ${t.badgeCls || ''}`}>{t.badge}</span>}
            </button>
          ))}
        </div>
        <div className="top-nav-right">
          <span className="ver">v0.1.0</span>
        </div>
      </header>

      <div className="body">
        {top === 'settings' ? (
          <>
            <aside className="settings-side">
              {SETTINGS_NAV.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`side-item ${settingsPane === s.id ? 'active' : ''}`}
                  onClick={() => setSettingsPane(s.id)}
                >
                  <span className="side-ico">{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </aside>
            <div className="settings-main">
              <div className="settings-subnav">
                {SETTINGS_NAV.map((s) => (
                  <button
                    key={`sub-${s.id}`}
                    type="button"
                    className={`settings-subnav-btn ${settingsPane === s.id ? 'on' : ''}`}
                    onClick={() => setSettingsPane(s.id)}
                  >
                    <span>{s.icon}</span> {s.label}
                  </button>
                ))}
              </div>
              <SettingsView pane={settingsPane} />
            </div>
          </>
        ) : top === 'veo3' ? (
          <Veo3Workspace />
        ) : top === 'grok' ? (
          <GrokWorkspace />
        ) : top === 'vids' ? (
          <VidsWorkspace onOpenSettings={() => { setTop('settings'); setSettingsPane('api') }} />
        ) : top === 'muse' ? (
          <MuseWorkspace />
        ) : top === 'flow' ? (
          <FlowWorkspace />
        ) : top === 'invideo' ? (
          <InVideoWorkspace />
        ) : top === 'voice' ? (
          <VoiceWorkspace onOpenSettings={() => { setTop('settings'); setSettingsPane('advanced') }} />
        ) : top === 'ghep' ? (
          <GhepVideoWorkspace onOpenSettings={() => { setTop('settings'); setSettingsPane('download') }} />
        ) : top === 'anh' ? (
          <TaoAnhWorkspace />
        ) : top === 'creator' ? (
          <CreatorWorkspace />
        ) : top === 'tube' ? (
          <TubeHunterWorkspace />
        ) : top === 'mini' ? (
          <MiniAppWorkspace />
        ) : top === 'seedance' ? (
          <SeedanceWorkspace />
        ) : (
          <PlaceholderWorkspace
            title={TOP_TABS.find((t) => t.id === top)?.label || top}
          />
        )}
      </div>
    </div>
  )
}
