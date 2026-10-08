import { useCallback, useEffect, useRef, useState } from 'react'

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

function hangCls(tier: string) {
  const t = (tier || '').toUpperCase()
  if (t.includes('ULTRA')) return 'ultra'
  if (t.includes('PRO')) return 'pro'
  return 'free'
}

export default function SettingsTaiKhoan() {
  const [ds, setDs] = useState<TaiKhoan[]>([])
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null)
  const [flash, setFlash] = useState<{ msg: string; fail: boolean } | null>(null)
  const [dangLam, setDangLam] = useState<Record<string, string>>({})
  const [ketQua, setKetQua] = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [cookieDan, setCookieDan] = useState('')
  const [hienDan, setHienDan] = useState(false)
  const [viec, setViec] = useState<ViecNen[]>([])
  const [nhatKy, setNhatKy] = useState<string[]>([])
  const [gemini, setGemini] = useState<{ n: number; keys: string[] }>({ n: 0, keys: [] })
  const [geminiMoi, setGeminiMoi] = useState('')
  const logSince = useRef(0)

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
      setHienDan(false)
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

  const soBat = ds.filter((a) => a.bat).length
  const tongCredit = ds.filter((a) => a.bat).reduce((n, a) => n + (a.credits || 0), 0)
  const viecChay = viec.filter((v) => v.status === 'dang_chay')

  return (
    <div className="settings-panel sv-api">
      <div className="panel-head">
        <h3>
          <span className="ico">⚙️</span> Cấu hình API
        </h3>
        <span className={`gateway-pill ${bridgeOk ? 'live' : ''}`}>
          <i className="dot" />{' '}
          {bridgeOk === false
            ? 'Cầu nối Python chưa chạy — chạy lại npm run dev'
            : `${soBat}/${ds.length} tài khoản đang bật · ${tongCredit} credit`}
        </span>
      </div>

      {flash && <div className={`sv-flash ${flash.fail ? 'fail' : 'ok'}`}>{flash.msg}</div>}

      <section className="sv-card">
        <div className="sv-card-head">
          <h4>🔐 Tài khoản Google Flow (dùng chung sổ với tool cũ)</h4>
          <div className="sv-card-actions">
            <button
              type="button"
              className="btn sm teal"
              disabled={!!dangLam['moi:login-new']}
              onClick={() => void chayNen(null, 'login-new', 'Đang mở Chrome…')}
              title="Mở Chrome hồ sơ trống → đăng nhập Google → tool tự lấy cookie, email, hạng, credit"
            >
              ＋ Đăng nhập tài khoản mới
            </button>
            <button type="button" className="btn sm" onClick={() => setHienDan((v) => !v)}>
              📋 Dán cookie
            </button>
            <button type="button" className="btn sm" onClick={() => void taiLai()} title="Tải lại từ sổ">
              ↻
            </button>
          </div>
        </div>

        {hienDan && (
          <div className="sv-paste">
            <p className="muted">
              Dán cookie của <b>labs.google / google.com</b> (Cookie-Editor → Export → Header String hoặc JSON, hoặc
              cookies.txt). Tool tự xin bearer, đọc email + hạng + credit.
            </p>
            <textarea
              className="sv-paste-area"
              rows={4}
              value={cookieDan}
              onChange={(e) => setCookieDan(e.target.value)}
              placeholder="SID=…; HSID=…; SSID=…; APISID=…; SAPISID=…; __Secure-1PSID=…"
              spellCheck={false}
            />
            <div className="sv-paste-foot">
              <button type="button" className="btn sm teal" disabled={!!dangLam['moi:add-cookie']} onClick={() => void themCookie()}>
                {dangLam['moi:add-cookie'] ? 'Đang thêm…' : 'Thêm tài khoản'}
              </button>
            </div>
          </div>
        )}

        {viecChay.length > 0 && (
          <div className="sv-flash ok">
            ⏳ {viecChay.map((v) => v.nguon).join(' · ')} — làm theo cửa sổ Chrome vừa mở.
          </div>
        )}

        {ds.length === 0 ? (
          <div className="sv-empty-dash">
            {bridgeOk === false ? 'Chưa nối được cầu nối Python.' : 'Sổ trống — bấm «Đăng nhập tài khoản mới» hoặc «Dán cookie».'}
          </div>
        ) : (
          <div className="sv-acct-list">
            {ds.map((a) => {
              const kq = ketQua[a.id]
              const ban = Object.keys(dangLam).some((k) => k.startsWith(`${a.id}:`))
              return (
                <div key={a.id || a.idx} className={`sv-acct-card ${a.bat ? 'active-acct' : ''}`}>
                  <div className="sv-acct-top">
                    <div className="sv-acct-left">
                      <div className="sv-acct-mail" title={a.profile_key}>
                        {a.email || a.ten}
                        {a.name && a.name !== a.email ? <span className="muted"> · {a.name}</span> : null}
                      </div>
                      <div className="sv-acct-badges">
                        <span className={`pill ${a.cookie_ok ? 'ok' : 'err'}`}>
                          {a.cookie_ok ? `✓ Cookie đủ (${a.so_cookie})` : '✕ Cookie thiếu SID/PSID'}
                        </span>
                        <span className={`pill ${hangCls(a.tier)}`}>
                          {/ULTRA|PRO/i.test(a.tier) ? '★ ' : ''}
                          {a.tier || 'Chưa đọc hạng'}
                        </span>
                        <span className="pill plan">{a.credits != null ? `${a.credits} credit` : 'credit ?'}</span>
                        <span className={`pill ${a.bearer_ok ? 'ok' : 'ready'}`}>{a.bearer_ok ? 'bearer OK' : 'bearer cũ'}</span>
                        {a.chi_duc_token && <span className="pill gateway">Chỉ đúc token</span>}
                      </div>
                      <div className="sv-acct-dates">
                        Lấy cookie: {ngay(a.captured)} · Credit đọc lúc: {ngay(a.credits_luc)}
                      </div>
                    </div>
                    <div className="sv-acct-right">
                      <button
                        type="button"
                        className={`btn sm ${a.bat ? 'sv-using' : 'teal'} sv-act-btn`}
                        onClick={() => void doiBat(a, !a.bat)}
                        title="Tick = tool được dùng TK này khi chạy (xoay nhiều TK)"
                      >
                        {a.bat ? '✓ Đang dùng' : 'Bật dùng'}
                      </button>
                      <div className="sv-icon-row">
                        <button type="button" className="sv-ico" title="Kiểm tra phiên + xin bearer + đọc hạng/credit" disabled={ban} onClick={() => void kiemTra(a)}>
                          {dangLam[`${a.id}:test`] ? '…' : '↻'}
                        </button>
                        <button type="button" className="sv-ico" title="Mở Chrome hồ sơ của TK này" onClick={() => void chayNen(a, 'open', 'Đang mở…')}>
                          🌐
                        </button>
                        <button
                          type="button"
                          className="sv-ico"
                          title="Lấy cookie mới — mở Chrome hồ sơ TK, đăng nhập lại nếu cần"
                          onClick={() => void chayNen(a, 'refresh-cookie', 'Đang lấy…')}
                        >
                          🔄
                        </button>
                        <button
                          type="button"
                          className="sv-ico"
                          title={a.chi_duc_token ? 'Bỏ «chỉ đúc token»' : 'Chỉ dùng TK này để đúc token reCAPTCHA'}
                          onClick={() => void doiDuc(a, !a.chi_duc_token)}
                        >
                          🔑
                        </button>
                        <button type="button" className="sv-ico" title="Đổi tên hiển thị" onClick={() => void doiTen(a)}>
                          ✎
                        </button>
                        <button type="button" className="sv-ico danger" title="Xoá khỏi sổ" onClick={() => void xoa(a)}>
                          🗑
                        </button>
                      </div>
                    </div>
                  </div>
                  {kq && <div className={`acct-test ${kq.ok ? 'ok' : 'fail'}`}>{kq.msg}</div>}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="sv-card">
        <div className="sv-card-head">
          <h4>✨ Gemini API key (viết prompt, TTS)</h4>
        </div>
        <p className="muted">
          Lưu chung cấu hình với tool cũ. Nhiều khoá thì mỗi dòng một khoá — tool tự xoay khi một khoá hết lượt.
          {gemini.n ? ` Đang có ${gemini.n} khoá: ${gemini.keys.join(', ')}` : ' Chưa có khoá nào.'}
        </p>
        <textarea
          className="sv-paste-area"
          rows={2}
          value={geminiMoi}
          onChange={(e) => setGeminiMoi(e.target.value)}
          placeholder="AIza… (mỗi dòng một khoá — lưu sẽ THAY toàn bộ danh sách cũ)"
          spellCheck={false}
        />
        <div className="sv-paste-foot">
          <button type="button" className="btn sm teal" disabled={!geminiMoi.trim()} onClick={() => void luuGemini()}>
            Lưu khoá
          </button>
          {gemini.n > 0 && (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                if (window.confirm('Xoá hết khoá Gemini?')) {
                  setGeminiMoi('')
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
      </section>

      {nhatKy.length > 0 && (
        <section className="sv-card">
          <div className="sv-card-head">
            <h4>📜 Nhật ký tài khoản</h4>
            <button type="button" className="btn sm" onClick={() => setNhatKy([])}>
              Xoá
            </button>
          </div>
          <pre className="sv-log">{nhatKy.join('\n')}</pre>
        </section>
      )}
    </div>
  )
}
