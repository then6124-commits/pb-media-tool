import { useCallback, useEffect, useRef, useState } from 'react'
import { grabCookiesFromBrowser } from './flowReal'
import { Ico, SvShell } from './SettingsPanes'

/**
 * Cài đặt → Cấu hình API — tài khoản THẬT.
 *
 * Đọc/ghi thẳng sổ tài khoản Flow của tool cũ (flow_api.AccountPool) qua cầu nối
 * Python — giao diện mới và tool cũ dùng CHUNG một sổ. Học theo SuperVeo:
 * mỗi tài khoản một hồ sơ Chrome riêng; «Đăng nhập» mở Chrome hồ sơ trống để
 * đăng nhập Google; «Lấy cookie mới» mở đúng hồ sơ của TK đó. Cookie/bearer
 * KHÔNG bao giờ được gửi lên giao diện — chỉ trạng thái.
 */

type TaiKhoan = {
  idx: number
  id: string
  email: string
  ten: string
  name: string
  bat: boolean
  cookie_ok: boolean
  so_cookie: number
  bearer_ok: boolean
  credits: number | null
  credits_luc: number
  tier: string
  tier_status: string
  captured: number
  profile_key: string
  chi_duc_token: boolean
}

type ViecNen = { id: string; loai: string; nguon: string; status: string; msg: string; t: number }

async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    path,
    body === undefined
      ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
  const j = (await r.json().catch(() => ({}))) as T & { ok?: boolean; error?: string }
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

function ngay(t: number) {
  if (!t) return '—'
  const d = new Date(t * 1000)
  return d.toLocaleString('vi-VN', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function SettingsTaiKhoan() {
  const [ds, setDs] = useState<TaiKhoan[]>([])
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null)
  const [flash, setFlash] = useState<{ msg: string; fail: boolean } | null>(null)
  const [dangLam, setDangLam] = useState<Record<string, string>>({})
  const [ketQua, setKetQua] = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [cookieDan, setCookieDan] = useState('')
  const [viec, setViec] = useState<ViecNen[]>([])
  const [nhatKy, setNhatKy] = useState<string[]>([])
  const [gemini, setGemini] = useState<{ n: number; keys: string[] }>({ n: 0, keys: [] })
  const [geminiMoi, setGeminiMoi] = useState('')
  const [tab, setTab] = useState<'cookie' | 'account'>(() =>
    (localStorage.getItem('pb.settings.api.tab') || 'account') === 'cookie' ? 'cookie' : 'account',
  )
  const [hienCk, setHienCk] = useState(false)
  const [acctText, setAcctText] = useState('')
  const [hienAcct, setHienAcct] = useState(false)
  const [browser, setBrowser] = useState(1)
  const [autoBusy, setAutoBusy] = useState(false)
  const logSince = useRef(0)

  useEffect(() => {
    try {
      localStorage.setItem('pb.settings.api.tab', tab)
    } catch {
      /* ignore */
    }
  }, [tab])

  const bao = (msg: string, fail = false) => {
    setFlash({ msg, fail })
    window.setTimeout(() => setFlash(null), 4200)
  }

  const taiLai = useCallback(async () => {
    try {
      const r = await api<{ accounts: TaiKhoan[] }>('/api/accounts')
      setDs(r.accounts)
      setBridgeOk(true)
    } catch {
      setBridgeOk(false)
    }
  }, [])

  useEffect(() => {
    void taiLai()
    api<{ n: number; keys: string[] }>('/api/config/gemini').then(setGemini).catch(() => {})
    let dead = false
    const tick = async () => {
      try {
        const [j, l] = await Promise.all([
          api<{ jobs: ViecNen[] }>('/api/util/jobs'),
          api<{ logs: { id: number; time: string; tag: string; msg: string }[] }>(`/api/logs?since=${logSince.current}`),
        ])
        if (dead) return
        const tk = j.jobs.filter((v) => v.loai === 'tk')
        setViec((truoc) => {
          // việc nền vừa xong → tải lại danh sách (cookie/hạng/credit mới)
          if (truoc.some((v) => v.status === 'dang_chay' && tk.find((x) => x.id === v.id && x.status !== 'dang_chay'))) {
            void taiLai()
          }
          return tk
        })
        if (l.logs.length) {
          logSince.current = l.logs[l.logs.length - 1].id
          const mine = l.logs.filter((x) => x.tag === 'tk')
          if (mine.length) setNhatKy((p) => [...mine.reverse().map((x) => `${x.time}  ${x.msg}`), ...p].slice(0, 60))
        }
      } catch {
        /* cầu nối tắt */
      }
    }
    const t = window.setInterval(tick, 2000)
    return () => {
      dead = true
      window.clearInterval(t)
    }
  }, [taiLai])

  const lam = async (a: TaiKhoan | null, viecTen: string, body: Record<string, unknown> = {}, nhan = '') => {
    const khoa = `${a?.id || 'moi'}:${viecTen}`
    setDangLam((p) => ({ ...p, [khoa]: nhan || '…' }))
    try {
      const r = await api<Record<string, unknown>>(`/api/accounts/${viecTen}`, {
        ...(a ? { id: a.id, idx: a.idx } : {}),
        ...body,
      })
      return r
    } finally {
      setDangLam((p) => {
        const n = { ...p }
        delete n[khoa]
        return n
      })
    }
  }

  const kiemTra = async (a: TaiKhoan) => {
    try {
      const r = (await lam(a, 'test', {}, 'Đang kiểm…')) as { song: boolean; ly_do: string; bearer: boolean; tier: string; credits: number }
      const msg = r.song
        ? `Phiên SỐNG · ${r.tier || 'chưa rõ hạng'}${r.credits != null ? ` · ${r.credits} credit` : ''}${r.bearer ? ' · bearer mới' : ' · bearer chưa xin được'}`
        : `Phiên CHẾT — ${r.ly_do || 'không rõ'}. Bấm 🔄 Lấy cookie mới.`
      setKetQua((p) => ({ ...p, [a.id]: { ok: r.song, msg } }))
      await taiLai()
    } catch (e) {
      setKetQua((p) => ({ ...p, [a.id]: { ok: false, msg: (e as Error).message } }))
    }
  }

  const chayNen = async (a: TaiKhoan | null, viecTen: 'login-new' | 'refresh-cookie' | 'open', nhan: string) => {
    try {
      await lam(a, viecTen, {}, nhan)
      bao(
        viecTen === 'login-new'
          ? 'Đã mở Chrome hồ sơ trống — đăng nhập Google trong cửa sổ đó, tool tự lấy cookie khi xong.'
          : viecTen === 'refresh-cookie'
            ? `Đang mở Chrome của ${a?.email} để lấy cookie mới…`
            : `Đã mở Chrome của ${a?.email}.`,
      )
    } catch (e) {
      bao((e as Error).message, true)
    }
  }

  const doiBat = async (a: TaiKhoan, on: boolean) => {
    try {
      await lam(a, 'toggle', { on })
      await taiLai()
    } catch (e) {
      bao((e as Error).message, true)
    }
  }

  const doiDuc = async (a: TaiKhoan, on: boolean) => {
    try {
      await lam(a, 'token-only', { on })
      await taiLai()
      bao(on ? `${a.email}: chỉ dùng để ĐÚC TOKEN (không gửi lệnh tạo).` : `${a.email}: dùng lại bình thường.`)
    } catch (e) {
      bao((e as Error).message, true)
    }
  }

  const xoa = async (a: TaiKhoan) => {
    if (!window.confirm(`Xoá tài khoản ${a.email || a.ten} khỏi sổ? (tool cũ cũng mất theo — dùng chung sổ)`)) return
    try {
      await lam(a, 'delete')
      await taiLai()
      bao(`Đã xoá ${a.email || a.ten}`)
    } catch (e) {
      bao((e as Error).message, true)
    }
  }

  const doiTen = async (a: TaiKhoan) => {
    const moi = window.prompt('Tên hiển thị', a.name || a.email)
    if (moi == null) return
    try {
      await lam(a, 'rename', { name: moi })
      await taiLai()
    } catch (e) {
      bao((e as Error).message, true)
    }
  }

  const themCookie = async () => {
    const ck = cookieDan.trim()
    if (!ck) {
      bao('Dán chuỗi cookie trước (Cookie-Editor → Export → Header String / JSON).', true)
      return
    }
    try {
      const r = (await lam(null, 'add-cookie', { cookie: ck }, 'Đang thêm…')) as { email: string }
      setCookieDan('')
      await taiLai()
      bao(`Đã thêm ${r.email || 'tài khoản'} từ cookie.`)
    } catch (e) {
      bao((e as Error).message, true)
    }
  }

  const luuGemini = async () => {
    try {
      const r = await api<{ n: number }>('/api/config/gemini', { keys: geminiMoi })
      setGeminiMoi('')
      setGemini(await api<{ n: number; keys: string[] }>('/api/config/gemini'))
      bao(r.n ? `Đã lưu ${r.n} khoá Gemini.` : 'Đã xoá hết khoá Gemini.')
    } catch (e) {
      bao((e as Error).message, true)
    }
  }

  /** Start Auto Login (kiểu SuperVeo): Chrome hồ sơ Browser N tự gõ email/mật khẩu → lấy cookie → thêm vào sổ. */
  const autoLogin = async () => {
    const dong = acctText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [mail = '', pass = ''] = l.split(/[|:]/).map((x) => x.trim())
        return { mail, pass }
      })
      .filter((x) => x.mail)
    if (!dong.length) return bao('Nhập ít nhất 1 account: email|password', true)
    setAutoBusy(true)
    let them = 0
    for (const a of dong) {
      bao(`Browser ${browser}: đang đăng nhập ${a.mail} — nếu Google hỏi 2FA/captcha, làm tiếp trong cửa sổ Chrome…`)
      try {
        const g = await grabCookiesFromBrowser({ browserId: browser, email: a.mail, password: a.pass, autoLogin: true, preferSidecar: true })
        if (!g.ok || !g.cookies || g.cookies.length < 20) {
          bao(`${a.mail}: ${g.detail || 'chưa lấy được cookie'}`, true)
          continue
        }
        await lam(null, 'add-cookie', { cookie: g.cookies, name: a.mail }, 'Đang thêm…')
        them += 1
      } catch (e) {
        bao(`${a.mail}: ${(e as Error).message}`, true)
      }
    }
    setAutoBusy(false)
    await taiLai()
    if (them) {
      setAcctText('')
      bao(`Đã thêm ${them}/${dong.length} tài khoản.`)
    }
  }

  const xoaTatCa = async () => {
    if (!ds.length || !window.confirm(`Xoá cả ${ds.length} tài khoản khỏi sổ? (tool cũ dùng chung sổ cũng mất)`)) return
    for (const a of [...ds].sort((x, y) => y.idx - x.idx)) {
      try {
        await lam(a, 'delete')
      } catch {
        /* bỏ qua */
      }
    }
    await taiLai()
    bao('Đã xoá tất cả tài khoản.')
  }

  const layCookieMoi = () => {
    const a = ds.find((x) => x.bat) || ds[0]
    if (a) void chayNen(a, 'refresh-cookie', 'Đang lấy…')
  }

  const soBat = ds.filter((a) => a.bat).length
  const tongCredit = ds.filter((a) => a.bat).reduce((n, a) => n + (a.credits || 0), 0)
  const viecChay = viec.filter((v) => v.status === 'dang_chay')

  const chay = ds.filter((a) => !a.chi_duc_token)
  const gateway = ds.filter((a) => a.chi_duc_token)

  const theTk = (a: TaiKhoan, laGateway: boolean) => {
    const kq = ketQua[a.id]
    const ban = Object.keys(dangLam).some((k) => k.startsWith(`${a.id}:`))
    const hang = (a.tier || 'FREE').replace(/^.*(ULTRA|PRO|FREE).*$/i, '$1').toUpperCase()
    return (
      <div key={a.id || a.idx} className={`sv2-acct ${a.bat && !laGateway ? 'using' : ''} ${laGateway ? 'gateway' : ''}`}>
        {laGateway && <span className="sv2-gw-tag">GATEWAY</span>}
        <div className="sv2-acct-top">
          <div className="sv2-acct-left">
            <div className="sv2-acct-name">
              <b title={a.profile_key}>{a.name && a.name !== a.email ? a.name : a.email || a.ten}</b>
              {a.bat && !laGateway ? (
                <span className="sv2-badge green">✓ Đang kích hoạt</span>
              ) : (
                <span className="sv2-badge blue">Sẵn sàng</span>
              )}
              <span className={`sv2-badge ${/PRO|ULTRA/.test(hang) ? 'gold' : 'gray'}`}>
                {/PRO|ULTRA/.test(hang) ? '★' : '▭'} {hang}
                {a.credits != null ? ` (${a.credits})` : ''}
              </span>
              {laGateway && (
                <span className="sv2-badge violet">
                  <Ico n="pin" size={11} /> Gateway
                </span>
              )}
            </div>
            <div className="sv2-acct-meta">
              {a.email && a.name && a.name !== a.email ? `${a.email} • ` : ''}Added: {ngay(a.captured)} • Last used: {ngay(a.credits_luc)}
            </div>
          </div>
          <div className="sv2-acct-actions">
            {!laGateway && (
              <button type="button" className={`sv2-btn sm ${a.bat ? 'using' : 'teal'}`} onClick={() => void doiBat(a, !a.bat)}>
                {a.bat ? 'Đang sử dụng' : 'Kích hoạt'}
              </button>
            )}
            <button type="button" className="sv2-icon-btn" title="Kiểm tra phiên + đọc hạng/credit" disabled={ban} onClick={() => void kiemTra(a)}>
              {dangLam[`${a.id}:test`] ? '…' : <Ico n="refresh" size={15} />}
            </button>
            <button
              type="button"
              className={`sv2-icon-btn ${laGateway ? 'on' : ''}`}
              title={laGateway ? 'Bỏ Gateway' : 'Đặt làm Gateway (chỉ đúc token)'}
              onClick={() => void doiDuc(a, !a.chi_duc_token)}
            >
              <Ico n="pin" size={15} />
            </button>
            <button type="button" className="sv2-icon-btn" title="Mở Chrome hồ sơ của TK này" onClick={() => void chayNen(a, 'open', 'Đang mở…')}>
              <Ico n="globe" size={15} />
            </button>
            <button type="button" className="sv2-icon-btn orange" title="Lấy cookie mới" onClick={() => void chayNen(a, 'refresh-cookie', 'Đang lấy…')}>
              🧹
            </button>
            <button type="button" className="sv2-icon-btn red" title="Xoá khỏi sổ" onClick={() => void xoa(a)}>
              <Ico n="trash" size={15} />
            </button>
          </div>
        </div>
        <div className="sv2-cookie-line">
          <span className="sv2-cookie-k">Cookie:</span>
          <code>
            {a.cookie_ok ? `✓ ${a.so_cookie} mục (SID/PSID đủ)` : '✕ thiếu SID/PSID — bấm 🧹 lấy cookie mới'} ·{' '}
            {a.bearer_ok ? 'bearer OK' : 'bearer cũ'} · {a.profile_key || 'không có hồ sơ Chrome'}
          </code>
          <button type="button" className="sv2-icon-btn teal" title="Đổi tên hiển thị" onClick={() => void doiTen(a)}>
            ✎
          </button>
        </div>
        {kq && <div className={`sv2-test ${kq.ok ? 'ok' : 'bad'}`}>{kq.msg}</div>}
      </div>
    )
  }

  return (
    <SvShell icon={<Ico n="gear" size={20} />} title="Cấu hình API" gateway>
      <div className="sv2-api-tabs">
        <button type="button" className={tab === 'cookie' ? 'on' : ''} onClick={() => setTab('cookie')}>
          🍪 Cookie {tab === 'cookie' && <span className="sv2-using-tag">đang dùng</span>}
        </button>
        <button type="button" className={tab === 'account' ? 'on' : ''} onClick={() => setTab('account')}>
          👤 Account {tab === 'account' && <span className="sv2-using-tag">đang dùng</span>}
        </button>
      </div>
      <div className="sv2-hr thin" />

      {flash && <div className={`sv2-flash ${flash.fail ? 'bad' : ''}`}>{flash.msg}</div>}
      {viecChay.length > 0 && <div className="sv2-flash">⏳ {viecChay.map((v) => v.nguon).join(' · ')} — làm theo cửa sổ Chrome vừa mở.</div>}
      {bridgeOk === false && <div className="sv2-flash bad">Cầu nối Python chưa chạy — chạy lại npm run dev.</div>}

      {tab === 'cookie' ? (
        <>
          <div className="sv2-line">
            <b>Cookies:</b>
            <span className="sv2-inline">
              <button type="button" className="sv2-btn ghost sm" onClick={() => void chayNen(null, 'login-new', 'Đang mở Chrome…')}>
                ☰ Quick Add
              </button>
              {ds.length ? (
                <span className="ok">✓ {ds.length} tài khoản · {soBat} đang bật · {tongCredit} credit</span>
              ) : (
                <span className="warn">⚠ Chưa có</span>
              )}
            </span>
          </div>
          <div className="sv2-inline">
            <div className="sv2-input-wrap">
              <input
                className="sv2-input"
                type={hienCk ? 'text' : 'password'}
                placeholder="Nhập cookie từ trình duyệt..."
                value={cookieDan}
                onChange={(e) => setCookieDan(e.target.value)}
                spellCheck={false}
              />
              <button type="button" className="sv2-eye" onClick={() => setHienCk((v) => !v)} aria-label="Hiện / ẩn">
                <Ico n="eye" size={15} />
              </button>
            </div>
            <button type="button" className="sv2-btn teal" disabled={!!dangLam['moi:add-cookie']} onClick={() => void themCookie()}>
              {dangLam['moi:add-cookie'] ? '…' : 'Add'}
            </button>
          </div>
          <p className="sv2-note">
            Cookie-Editor → Export → Header String / JSON, hoặc cookies.txt. Tool tự xin bearer, đọc email + hạng + credit.
            «Quick Add» mở Chrome hồ sơ trống để đăng nhập tay.
          </p>
          <div className="sv2-row">
            <div className="sv2-row-main">
              <div className="sv2-row-title">Gemini API key</div>
              <div className="sv2-row-sub">
                <i className="sv2-dot" />
                {gemini.n ? `${gemini.n} khoá: ${gemini.keys.join(', ')}` : 'Chưa có khoá — viết prompt, TTS, dịch… cần khoá này'}
              </div>
              <div className="sv2-inline" style={{ marginTop: 8 }}>
                <input
                  className="sv2-input"
                  type="password"
                  value={geminiMoi}
                  onChange={(e) => setGeminiMoi(e.target.value)}
                  placeholder="AIza… (nhiều khoá: cách nhau dấu phẩy — lưu sẽ THAY danh sách cũ)"
                />
                <button type="button" className="sv2-btn teal sm" disabled={!geminiMoi.trim()} onClick={() => void luuGemini()}>
                  Lưu
                </button>
                {gemini.n > 0 && (
                  <button
                    type="button"
                    className="sv2-btn red-ghost sm"
                    onClick={() => {
                      if (window.confirm('Xoá hết khoá Gemini?')) {
                        void api('/api/config/gemini', { keys: '' }).then(async () => {
                          setGemini(await api<{ n: number; keys: string[] }>('/api/config/gemini'))
                          bao('Đã xoá hết khoá Gemini.')
                        })
                      }
                    }}
                  >
                    Xoá hết
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="sv2-box">
            <div className="sv2-line">
              <b>Thêm Account Mới</b>
              <span className="sv2-browsers">
                Browsers:
                {[1, 2, 3, 4].map((n) => (
                  <button key={n} type="button" className={browser === n ? 'on' : ''} onClick={() => setBrowser(n)}>
                    {n}
                  </button>
                ))}
              </span>
            </div>
            <div className="sv2-input-wrap">
              <textarea
                className={`sv2-textarea mono ${hienAcct ? '' : 'masked'}`}
                rows={3}
                value={acctText}
                onChange={(e) => setAcctText(e.target.value)}
                placeholder="email@example.com|password123|2FA_SECRET hoặc email:password"
                spellCheck={false}
              />
              <button type="button" className="sv2-eye top" onClick={() => setHienAcct((v) => !v)} aria-label="Hiện / ẩn">
                <Ico n="eye" size={15} />
              </button>
            </div>
            <p className="sv2-note">
              💡 Format: <code className="sv2-code">email|password</code> hoặc <code className="sv2-code">email|password|2FA_SECRET</code>. Mỗi
              dòng 1 account.
            </p>
            <button type="button" className="sv2-btn teal full" disabled={autoBusy} onClick={() => void autoLogin()}>
              <Ico n="shield" size={15} /> {autoBusy ? 'Đang đăng nhập…' : 'Start Auto Login'}
            </button>
          </div>

          <div className="sv2-line">
            <span>{ds.length} tài khoản</span>
            <span className="sv2-inline">
              <button type="button" className="sv2-btn teal sm" disabled={!ds.length} onClick={layCookieMoi}>
                <Ico n="refresh" size={13} /> 🍪 Lấy Cookie Mới
              </button>
              <button type="button" className="sv2-btn red sm" disabled={!ds.length} onClick={() => void xoaTatCa()}>
                <Ico n="trash" size={13} /> Xoá tất cả
              </button>
              <button type="button" className="sv2-icon-btn" title="Tải lại từ sổ" onClick={() => void taiLai()}>
                <Ico n="refresh" size={14} />
              </button>
            </span>
          </div>

          {ds.length === 0 ? (
            <div className="sv2-empty">{bridgeOk === false ? 'Chưa nối được cầu nối Python.' : 'Sổ trống — nhập account ở trên rồi Start Auto Login.'}</div>
          ) : (
            <>
              <div className="sv2-group-title">
                <Ico n="shield" size={14} /> TÀI KHOẢN CHẠY TOOL ({chay.length})
              </div>
              {chay.map((a) => theTk(a, false))}
              {gateway.length > 0 && (
                <>
                  <div className="sv2-group-title violet">
                    <Ico n="pin" size={14} /> TÀI KHOẢN GATEWAY ({gateway.length})
                  </div>
                  {gateway.map((a) => theTk(a, true))}
                </>
              )}
            </>
          )}
        </>
      )}

      {nhatKy.length > 0 && (
        <>
          <div className="sv2-hr" />
          <div className="sv2-line">
            <b>📜 Nhật ký tài khoản</b>
            <button type="button" className="sv2-btn ghost sm" onClick={() => setNhatKy([])}>
              Xoá
            </button>
          </div>
          <pre className="sv2-log">{nhatKy.join('\n')}</pre>
        </>
      )}
    </SvShell>
  )
}
