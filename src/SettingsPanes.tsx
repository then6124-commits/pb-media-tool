// Cài đặt — bố cục theo SuperVeo: thanh trái, tiêu đề + nhãn Gateway, một thẻ lớn chia mục.
// Mọi nút đều gọi cầu nối thật (scripts/pb_bridge.py).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, errText, openFolder, pickFolder, useJobs } from './bridge'
import './settings_sv.css'

export type SettingsPane = 'user' | 'api' | 'download' | 'image' | 'advanced' | 'chrome' | 'version'

/* ───────── icon nét mảnh (kiểu lucide) ───────── */

type IcoName =
  | 'user'
  | 'gear'
  | 'download'
  | 'scissors'
  | 'network'
  | 'puzzle'
  | 'box'
  | 'shield'
  | 'globe'
  | 'trash'
  | 'info'
  | 'alert'
  | 'chev'
  | 'eye'
  | 'refresh'
  | 'pin'
  | 'cookie'
  | 'folder'
  | 'clock'
  | 'logout'
  | 'video'
  | 'image'
  | 'wand'
  | 'copy'
  | 'pencil'
  | 'external'
  | 'play'
  | 'xcircle'
  | 'checkcircle'
  | 'file'
  | 'list'
  | 'grid'
  | 'upload'
  | 'search'
  | 'terminal'
  | 'arrowup'
  | 'arrowdown'
  | 'key'
  | 'x'
  | 'folderopen'
  | 'spin'
  | 'sliders'
  | 'grid6'
  | 'grid8'
  | 'extend'

const PATHS: Record<IcoName, string> = {
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M20 4L8.12 15.88 M14.47 14.48L20 20 M8.12 8.12L12 12',
  network: 'M9 2h6v6H9z M2 16h6v6H2z M16 16h6v6h-6z M5 16v-3h14v3 M12 8v5',
  puzzle: 'M19.44 12.93a1.5 1.5 0 0 0 0-2.12l-1.6-1.6a.98.98 0 0 1-.3-.7v-.01a.96.96 0 0 1 .29-.69 2.5 2.5 0 1 0-3.54-3.54.96.96 0 0 1-.69.29h-.01a.98.98 0 0 1-.7-.3l-1.6-1.6a1.5 1.5 0 0 0-2.12 0L7.57 4.26a.98.98 0 0 0-.28.68c0 .3.13.58.33.79a2.5 2.5 0 1 1-3.54 3.54.96.96 0 0 0-.79-.33.98.98 0 0 0-.68.28L1.06 10.8a1.5 1.5 0 0 0 0 2.12l1.6 1.6c.2.2.31.45.3.73a.96.96 0 0 1-.29.66 2.5 2.5 0 1 0 3.54 3.54.96.96 0 0 1 .66-.29c.28 0 .54.1.73.3l1.6 1.6a1.5 1.5 0 0 0 2.12 0l1.57-1.57a.98.98 0 0 0 .28-.68c0-.3-.13-.58-.33-.79a2.5 2.5 0 1 1 3.54-3.54c.21.2.49.33.79.33a.98.98 0 0 0 .68-.28z',
  box: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  trash: 'M3 6h18 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01',
  alert: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
  chev: 'M6 9l6 6 6-6',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  refresh: 'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  pin: 'M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
  cookie: 'M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5z M8.5 8.5h.01 M16 15.5h.01 M12 12h.01 M11 17h.01 M7 14h.01',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  video: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z',
  image: 'M3 3h18v18H3z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21',
  wand: 'M15 4V2 M15 16v-2 M8 9h2 M20 9h2 M17.8 11.8L19 13 M15 9h.01 M17.8 6.2L19 5 M3 21l9-9 M12.2 6.2L11 5',
  copy: 'M9 9h13v13H9z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  pencil: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3',
  play: 'M5 3l14 9-14 9V3z',
  xcircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M15 9l-6 6 M9 9l6 6',
  checkcircle: 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  grid6: 'M2.5 4.5h4.5v6H2.5z M9.75 4.5h4.5v6h-4.5z M17 4.5h4.5v6H17z M2.5 13.5h4.5v6H2.5z M9.75 13.5h4.5v6h-4.5z M17 13.5h4.5v6H17z',
  grid8: 'M1.5 5.5h3v5h-3z M7.5 5.5h3v5h-3z M13.5 5.5h3v5h-3z M19.5 5.5h3v5h-3z M1.5 13.5h3v5h-3z M7.5 13.5h3v5h-3z M13.5 13.5h3v5h-3z M19.5 13.5h3v5h-3z',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35',
  terminal: 'M4 17l6-6-6-6 M12 19h8',
  arrowup: 'M12 19V5 M5 12l7-7 7 7',
  arrowdown: 'M12 5v14 M19 12l-7 7-7-7',
  key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78z M15.5 7.5l3 3L22 7l-3-3',
  x: 'M18 6L6 18 M6 6l12 12',
  folderopen: 'M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2',
  spin: 'M21 12a9 9 0 1 1-6.22-8.56',
  sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  extend: 'M2 6h11v12H2z M13 10l4-2.5v9L13 14 M20 9v6 M17 12h6',
}

export function Ico({ n, size = 16, className = '' }: { n: IcoName; size?: number; className?: string }) {
  return (
    <svg
      className={`sv2-ico ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[n].split(' M').map((d, i) => (
        <path key={i} d={i ? 'M' + d : d} />
      ))}
    </svg>
  )
}

export const SETTINGS_NAV: { id: SettingsPane; label: string; icon: IcoName }[] = [
  { id: 'user', label: 'Thông tin user', icon: 'user' },
  { id: 'api', label: 'Cấu hình API', icon: 'gear' },
  { id: 'download', label: 'Tải xuống', icon: 'download' },
  { id: 'image', label: 'Xử lý ảnh', icon: 'scissors' },
  { id: 'advanced', label: 'Nâng cao', icon: 'network' },
  { id: 'chrome', label: 'Chrome Extension', icon: 'puzzle' },
  { id: 'version', label: 'Phiên bản', icon: 'box' },
]

/* ───────── khung chung ───────── */

type AccountLite = { email: string; ten: string; bat: boolean; chi_duc_token: boolean }

/** Nhãn «Gateway: email» góc phải — TK đúc token (gateway), không có thì TK đang bật đầu tiên. */
export function useGateway() {
  const [label, setLabel] = useState('')
  useEffect(() => {
    let dead = false
    const tai = () =>
      api<{ accounts: AccountLite[] }>('/api/accounts')
        .then((r) => {
          if (dead) return
          const gw = r.accounts.find((a) => a.chi_duc_token) || r.accounts.find((a) => a.bat)
          setLabel(gw ? gw.email || gw.ten : r.accounts.length ? 'chưa chọn' : '')
        })
        .catch(() => !dead && setLabel(''))
    void tai()
    const t = window.setInterval(tai, 8000)
    return () => {
      dead = true
      window.clearInterval(t)
    }
  }, [])
  return label
}

export function SvShell({
  icon,
  title,
  gateway,
  children,
}: {
  icon: ReactNode
  title: string
  gateway?: boolean
  children: ReactNode
}) {
  const gw = useGateway()
  return (
    <div className="sv2-page">
      <div className="sv2-head">
        <h2>
          <span className="sv2-head-ico">{icon}</span>
          {title}
        </h2>
        {gateway && gw && (
          <span className="sv2-gateway">
            <Ico n="shield" size={13} /> Gateway: {gw}
          </span>
        )}
      </div>
      <div className="sv2-card">{children}</div>
    </div>
  )
}

export function SvSection({ icon, title, danger, children }: { icon: IcoName; title: string; danger?: boolean; children: ReactNode }) {
  return (
    <section className="sv2-section">
      <h3 className={danger ? 'danger' : ''}>
        <Ico n={icon} size={18} />
        {title}
      </h3>
      {children}
    </section>
  )
}

export function SvToggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`sv2-toggle ${on ? 'on' : ''}`}
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  )
}

export function SvRow({ title, sub, dot, right, children }: { title: ReactNode; sub?: ReactNode; dot?: boolean; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="sv2-row">
      <div className="sv2-row-main">
        <div className="sv2-row-title">{title}</div>
        {sub && (
          <div className="sv2-row-sub">
            {dot && <i className="sv2-dot" />}
            {sub}
          </div>
        )}
        {children}
      </div>
      {right && <div className="sv2-row-right">{right}</div>}
    </div>
  )
}

function useFlash(): [string, (m: string) => void] {
  const [msg, setMsg] = useState('')
  const t = useRef(0)
  const show = (m: string) => {
    setMsg(m)
    window.clearTimeout(t.current)
    t.current = window.setTimeout(() => setMsg(''), 3000)
  }
  return [msg, show]
}

function usePref<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw == null ? initial : (JSON.parse(raw) as T)
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

/* ───────── Thông tin user ───────── */

type LicenseInfo = { available: boolean; ok?: boolean; msg?: string; days?: number | null; name?: string; machine_id?: string }

export function SettingsUser() {
  const [lic, setLic] = useState<LicenseInfo | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, showFlash] = useFlash()

  const load = async (online = false) => {
    try {
      setLic(await api<LicenseInfo>('/api/license', { online }))
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
      setLic(await api<LicenseInfo>('/api/license', { action: 'activate', key }))
      setKey('')
      showFlash('Đã kích hoạt')
    } catch (e) {
      showFlash(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const sapHet = !!lic?.ok && lic.days != null && lic.days <= 7

  return (
    <SvShell icon={<span className="sv2-emoji">👤</span>} title="Thông tin tài khoản">
      {!lic ? (
        <p className="sv2-muted">Đang đọc…</p>
      ) : !lic.available ? (
        <p className="sv2-muted">
          Không thấy license_manager của tool cũ (PB_TOOL_DIR). App không cần đăng nhập — khoá API nhập ở «Cấu hình API».
        </p>
      ) : (
        <>
          <div className="sv2-user-top">
            <Ico n="user" size={18} className="blue" />
            <div>
              <div className="sv2-label">Email:</div>
              <div className="sv2-strong">{lic.name || '—'}</div>
            </div>
            <div className="sv2-user-status">
              <div className="sv2-label">Trạng thái:</div>
              <div className={lic.ok ? 'ok' : 'bad'}>{lic.ok ? '✅ Đã xác thực' : `✕ ${lic.msg || 'Chưa kích hoạt'}`}</div>
            </div>
          </div>
          <div className="sv2-hr" />
          {lic.ok && (
            <div className="sv2-line">
              <span>⏰ Thời hạn sử dụng:</span>
              <span className={sapHet ? 'bad' : 'ok'}>{lic.days == null ? 'Không giới hạn' : `Còn ${lic.days} ngày`}</span>
            </div>
          )}
          {sapHet && (
            <div className="sv2-warn">
              <Ico n="alert" size={14} /> Tài khoản sắp hết hạn. Vui lòng gia hạn để tiếp tục sử dụng.
            </div>
          )}
          <div className="sv2-line">
            <span>Mã máy:</span>
            <span>
              <code className="sv2-code">{lic.machine_id}</code>{' '}
              <button
                type="button"
                className="sv2-btn ghost sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(lic.machine_id || '')
                  showFlash('Đã sao chép mã máy')
                }}
              >
                Copy
              </button>
            </span>
          </div>
          <div className="sv2-hr" />
          <div className="sv2-inline">
            <input
              className="sv2-input"
              placeholder={lic.ok ? 'Dán mã mới để gia hạn…' : 'Dán mã kích hoạt…'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button type="button" className="sv2-btn teal" disabled={busy} onClick={() => void activate()}>
              {busy ? 'Đang kích hoạt…' : 'Kích hoạt'}
            </button>
            <button type="button" className="sv2-btn ghost" onClick={() => void load(true)}>
              <Ico n="refresh" size={14} /> Kiểm tra
            </button>
          </div>
        </>
      )}
      {flash && <div className="sv2-flash">{flash}</div>}
    </SvShell>
  )
}

/* ───────── Tải xuống ───────── */

export function SettingsDownload() {
  const [autoDl, setAutoDl] = usePref('pb.settings.dl.auto', true)
  const [prefixOn, setPrefixOn] = usePref('pb.settings.dl.prefixOn', true)
  const [prefix, setPrefix] = usePref('pb.settings.dl.prefix', 'video')
  const [overwrite, setOverwrite] = usePref('pb.settings.dl.overwrite', false)
  const [outPath, setOutPath] = useState('')
  const [flash, showFlash] = useFlash()

  useEffect(() => {
    api<{ out_root: string }>('/api/version', {})
      .then((v) => setOutPath(v.out_root))
      .catch(() => {})
  }, [])

  const saveRoot = async (path: string) => {
    try {
      await api('/api/config/bridge', { set: { out_root: path.trim() } })
      setOutPath((await api<{ out_root: string }>('/api/version', {})).out_root)
      showFlash('Đã lưu — mọi tab lưu vào thư mục này')
    } catch (e) {
      showFlash(errText(e))
    }
  }

  const ten = prefixOn ? prefix || 'video' : 'video'

  return (
    <SvShell icon={<span className="sv2-emoji">📥</span>} title="Cài đặt tải xuống">
      <div className="sv2-block-label">Thư mục lưu</div>
      <div className="sv2-inline">
        <input
          className="sv2-input"
          value={outPath}
          onChange={(e) => setOutPath(e.target.value)}
          onBlur={() => void saveRoot(outPath)}
          placeholder="Đường dẫn thư mục…"
        />
        <button
          type="button"
          className="sv2-btn teal"
          onClick={() =>
            void pickFolder(outPath)
              .then((d) => {
                if (d) void saveRoot(d)
              })
              .catch((e) => showFlash(errText(e)))
          }
        >
          <Ico n="folder" size={14} /> Chọn
        </button>
        <button type="button" className="sv2-btn ghost" onClick={() => openFolder(outPath)}>
          Mở
        </button>
      </div>
      <p className="sv2-note">Thư mục gốc của mọi tab, mỗi tab một thư mục con. Tab đã chọn thư mục riêng thì giữ thư mục đó.</p>

      <div className="sv2-block-label">Tự động tải xuống</div>
      <label className="sv2-check-row">
        <input type="checkbox" checked={autoDl} onChange={(e) => setAutoDl(e.target.checked)} />
        Tự động tải xuống video khi hoàn thành
      </label>
      <p className="sv2-note">Khi bật, video sẽ tự động được tải xuống sau khi tạo xong</p>

      <div className="sv2-block-label">Tên file prefix</div>
      <label className="sv2-check-row">
        <input type="checkbox" checked={prefixOn} onChange={(e) => setPrefixOn(e.target.checked)} />
        Sử dụng prefix tùy chỉnh
      </label>
      <div className="sv2-prefix">
        <input className="sv2-input" disabled={!prefixOn} value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        <span>_1.mp4</span>
      </div>
      <p className="sv2-note">
        Ví dụ: &quot;{ten}&quot; → {ten}_1.mp4, {ten}_2.mp4...
      </p>

      <div className="sv2-block-label">Ghi đè file</div>
      <label className="sv2-check-row">
        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
        Ghi đè file khi trùng tên
      </label>
      <p className="sv2-note">
        Khi bật, nếu file đã tồn tại sẽ ghi đè lên file cũ thay vì tạo file mới với tên khác ({ten}_1(2).mp4,{' '}
        {ten}_1(3).mp4...)
      </p>
      {flash && <div className="sv2-flash">{flash}</div>}
    </SvShell>
  )
}

/* ───────── Xử lý ảnh ───────── */

type CropMode = 'pad' | 'crop'

export function SettingsImage() {
  const [cropMode, setCropMode] = usePref<CropMode>('pb.settings.img.mode', 'pad')
  const [, setCropOn] = usePref('pb.settings.img.cropOn', false)
  const [ratio, setRatio] = usePref<'16:9' | '9:16'>('pb.settings.img.ratio', '16:9')
  const chon = (m: CropMode) => {
    setCropMode(m)
    setCropOn(m === 'crop')
  }
  return (
    <SvShell icon={<Ico n="scissors" size={20} />} title="Xử lý Ảnh Tham Chiếu">
      <p className="sv2-muted">
        Cách xử lý ảnh tham chiếu / ảnh Image To Video khi bật &apos;Auto Crop&apos; trong form tạo Veo3 với tỉ lệ 16:9
        hoặc 9:16.
      </p>
      <SvRow
        title="Sử dụng chế độ cắt ảnh (Crop)"
        dot
        sub={cropMode === 'pad' ? 'Thêm viền đen để giữ nguyên toàn bộ ảnh' : 'Cắt ảnh để vừa khung — có thể mất nội dung'}
        right={<SvToggle on={cropMode === 'crop'} onChange={(v) => chon(v ? 'crop' : 'pad')} />}
      />
      <div className="sv2-tabs">
        {(['16:9', '9:16'] as const).map((r) => (
          <button key={r} type="button" className={ratio === r ? 'on' : ''} onClick={() => setRatio(r)}>
            Preview {r}
          </button>
        ))}
      </div>
      <div className="sv2-crop-grid">
        {(
          [
            ['pad', '▦ Chế độ Pad (Mặc định)', ['Giữ nguyên toàn bộ ảnh', 'Thêm viền đen để đủ tỉ lệ', 'Không mất nội dung'], []],
            ['crop', '✂ Chế độ Crop', ['Không có viền đen'], ['Cắt ảnh để vừa khung', 'Có thể mất phần ảnh']],
          ] as const
        ).map(([id, ten, tot, xau]) => (
          <button key={id} type="button" className={`sv2-crop-card ${cropMode === id ? 'on' : ''}`} onClick={() => chon(id)}>
            <strong>{ten}</strong>
            <ul>
              {xau.map((x) => (
                <li key={x} className="warn">
                  {x}
                </li>
              ))}
              {tot.map((x) => (
                <li key={x} className="ok">
                  {x}
                </li>
              ))}
            </ul>
            <div className={`sv2-crop-prev ${id} ${ratio === '16:9' ? 'land' : 'port'}`}>
              <span>Ảnh</span>
            </div>
          </button>
        ))}
      </div>
    </SvShell>
  )
}

/* ───────── Nâng cao ───────── */

export function SettingsAdvanced() {
  const [tokenSystem, setTokenSystem] = usePref('pb.settings.adv.tokenMode', false)
  const [proxyOn, setProxyOn] = usePref('pb.settings.adv.proxyOn', false)
  const [proxyTab, setProxyTab] = usePref<'list' | 'rotate'>('pb.settings.adv.proxyTab', 'list')
  const [proxies, setProxies] = usePref<string[]>('pb.settings.adv.proxies', [])
  const [rotateUrl, setRotateUrl] = usePref('pb.settings.adv.rotateUrl', '')
  const [rotateOn, setRotateOn] = usePref('pb.settings.adv.rotateOn', false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirmKill, setConfirmKill] = useState(false)
  const [killed, setKilled] = useState('')
  const first = useRef(true)

  // Đồng bộ sang cầu nối: proxy → biến môi trường tiến trình Python; System Mode → bộ mint dùng sidecar
  useEffect(() => {
    const t = window.setTimeout(
      () => {
        first.current = false
        void api('/api/config/bridge', {
          set: {
            proxy_on: proxyOn,
            proxies: proxies.join('\n'),
            proxy_rotate_on: proxyTab === 'rotate' && rotateOn,
            proxy_rotate_url: rotateUrl,
            token_system: tokenSystem,
          },
        }).catch(() => {})
      },
      first.current ? 0 : 600,
    )
    return () => window.clearTimeout(t)
  }, [proxyOn, proxies, proxyTab, rotateOn, rotateUrl, tokenSystem])

  const themProxy = () => {
    const ds = draft
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (!ds.length) return
    setProxies((p) => [...p, ...ds])
    setDraft('')
    setProxyOn(true)
  }

  const kill = async () => {
    setConfirmKill(false)
    setKilled('Đang dọn processes…')
    try {
      setKilled((await api<{ lines: string[] }>('/api/util/kill', {})).lines.join(' · '))
    } catch (e) {
      setKilled(errText(e))
    }
  }

  const proxySub = !proxyOn
    ? 'Tắt'
    : proxyTab === 'rotate'
      ? rotateOn
        ? 'Xoay theo URL API'
        : 'Bật · chưa bật xoay'
      : `Bật · ${proxies.length} proxy`

  return (
    <SvShell icon={<Ico n="gear" size={20} />} title="Cấu hình nâng cao" gateway>
      <SvSection icon="network" title="Cấu hình Bypass reCAPTCHA">
        <p className="sv2-muted">Chọn phương thức để bypass reCAPTCHA khi tạo video.</p>
        <SvRow
          title="Bypass qua Chrome Extension"
          dot
          sub={tokenSystem ? 'Đang sử dụng hệ thống để lấy token' : 'Đang sử dụng Chrome Extension để lấy token'}
          right={<SvToggle on={!tokenSystem} onChange={(v) => setTokenSystem(!v)} />}
        />
        <div className="sv2-info">
          <Ico n="info" size={16} />
          <div>
            <strong>{tokenSystem ? 'System Mode' : 'Chrome Extension'}</strong>
            <p>
              {tokenSystem
                ? 'Không cần Chrome Extension nhưng có thể chậm hơn.'
                : 'Nhanh hơn — cần cài extension và mở tab Flow (xem «Chrome Extension»).'}
            </p>
          </div>
        </div>
      </SvSection>

      <div className="sv2-hr" />

      <SvSection icon="network" title="Cấu hình Proxy">
        <div className="sv2-tabs">
          <button type="button" className={proxyTab === 'list' ? 'on' : ''} onClick={() => setProxyTab('list')}>
            📋 Proxy List
          </button>
          <button type="button" className={proxyTab === 'rotate' ? 'on' : ''} onClick={() => setProxyTab('rotate')}>
            <Ico n="refresh" size={13} /> Proxy Xoay
          </button>
        </div>
        <div className="sv2-hr thin" />
        <div className={`sv2-collapse ${open ? 'open' : ''}`}>
          <div className="sv2-collapse-head">
            <span className="sv2-round">
              <Ico n="globe" size={18} />
            </span>
            <div className="sv2-row-main">
              <div className="sv2-row-title">Proxy</div>
              <div className="sv2-row-sub">{proxySub}</div>
            </div>
            <SvToggle on={proxyOn} onChange={setProxyOn} />
            <button type="button" className="sv2-chev" onClick={() => setOpen((v) => !v)} aria-label="Mở rộng">
              <Ico n="chev" size={18} />
            </button>
          </div>
          {open && (
            <div className="sv2-collapse-body">
              {proxyTab === 'list' ? (
                <>
                  <textarea
                    className="sv2-textarea"
                    rows={3}
                    placeholder="host:port hoặc host:port:user:pass (mỗi dòng 1 proxy)"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <div className="sv2-inline">
                    <button type="button" className="sv2-btn teal sm" onClick={themProxy}>
                      + Thêm proxy
                    </button>
                    <button type="button" className="sv2-btn red-ghost sm" disabled={!proxies.length} onClick={() => setProxies([])}>
                      Xoá list
                    </button>
                    <span className="sv2-muted sm">Dùng proxy đầu list cho mọi request của cầu nối.</span>
                  </div>
                  {proxies.map((p, i) => (
                    <div key={`${p}-${i}`} className="sv2-proxy-item">
                      <code>{p.replace(/^([^:]+:[^:]+):.+$/, '$1:***')}</code>
                      <button type="button" className="sv2-icon-btn" onClick={() => setProxies((l) => l.filter((_, k) => k !== i))}>
                        <Ico n="trash" size={14} />
                      </button>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <SvRow
                    title="Bật xoay proxy"
                    sub="Lấy ip:port từ URL API mỗi lần lưu"
                    right={<SvToggle on={rotateOn} onChange={(v) => (setRotateOn(v), v && setProxyOn(true))} />}
                  />
                  <input
                    className="sv2-input"
                    placeholder="URL API trả về ip:port (hoặc ip:port:user:pass)"
                    value={rotateUrl}
                    onChange={(e) => setRotateUrl(e.target.value)}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </SvSection>

      <div className="sv2-hr" />

      <SvSection icon="trash" title="Dọn dẹp Processes" danger>
        <p className="sv2-muted">Kill tất cả processes dư thừa do app tạo ra khi generate token.</p>
        {!confirmKill ? (
          <button type="button" className="sv2-btn red full" onClick={() => setConfirmKill(true)}>
            <Ico n="trash" size={16} /> 🧹 Kill All Processes
          </button>
        ) : (
          <div className="sv2-confirm">
            <span>Xác nhận Kill All Processes? Mẻ Flow / Veo3 đang chạy sẽ bị dừng.</span>
            <button type="button" className="sv2-btn red sm" onClick={() => void kill()}>
              Xác nhận
            </button>
            <button type="button" className="sv2-btn ghost sm" onClick={() => setConfirmKill(false)}>
              Huỷ
            </button>
          </div>
        )}
        {killed && <p className="sv2-note">{killed}</p>}
      </SvSection>
    </SvShell>
  )
}

/* ───────── Chrome Extension ───────── */

export function SettingsChrome() {
  const [st, setSt] = useState<{ available: boolean; connected?: boolean; error?: string } | null>(null)

  const load = async (start = false) => {
    try {
      setSt(await api('/api/ext/status', { start }))
    } catch (e) {
      setSt({ available: false, error: errText(e) })
    }
  }

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 4000)
    return () => window.clearInterval(t)
  }, [])

  const steps: [string, ReactNode][] = [
    [
      'Có thư mục extension',
      <>
        Giải nén extension ra một thư mục cố định (đừng để trong Downloads rồi xoá — Chrome sẽ mất extension).
      </>,
    ],
    [
      'Mở trang quản lý extension',
      <>
        Mở Chrome, gõ <code className="sv2-code">chrome://extensions</code> vào thanh địa chỉ rồi Enter.
      </>,
    ],
    [
      'Bật Developer mode',
      <>
        Gạt công tắc <b>Developer mode</b> ở góc trên bên phải.
      </>,
    ],
    [
      'Load unpacked',
      <>
        Bấm <b>Load unpacked</b> và chọn <b>thư mục vừa giải nén</b>.
      </>,
    ],
    [
      'Mở tab Flow',
      <>
        Mở một tab <code className="sv2-code">labs.google/fx/tools/flow</code> và đăng nhập. Extension cần tab này đang mở mới lấy
        được.
      </>,
    ],
  ]

  return (
    <SvShell icon={<span className="sv2-emoji">🧩</span>} title="Chrome Extension">
      <SvSection icon="puzzle" title="Kết nối extension">
        <p className="sv2-muted">
          Extension lấy reCAPTCHA token trực tiếp từ Chrome của bạn qua <code className="sv2-code">ws://127.0.0.1:3458</code>.
          Cần cài đặt một lần, sau đó bật ở tab <b>Nâng cao</b>.
        </p>
        <div className="sv2-inline">
          <span className={`sv2-status ${st?.connected ? 'ok' : ''}`}>
            <i className="sv2-dot" />
            {!st ? 'Đang kiểm tra…' : !st.available ? 'Không có bộ mint' : st.connected ? 'Extension đã nối' : 'Extension chưa nối'}
          </span>
          <button type="button" className="sv2-btn teal" onClick={() => void load(true)}>
            <Ico n="download" size={15} /> Mở cổng 3458 ngay
          </button>
        </div>
        {st?.error && <p className="sv2-note">⚠ {st.error}</p>}
      </SvSection>

      <div className="sv2-hr" />

      <SvSection icon="info" title="Hướng dẫn cài đặt">
        <ol className="sv2-steps">
          {steps.map(([t, d], i) => (
            <li key={t}>
              <span className="sv2-step-no">{i + 1}</span>
              <div>
                <strong>{t}</strong>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="sv2-warn big">
          <Ico n="info" size={16} />
          <div>
            <p>
              <b>Chọn đúng thư mục.</b> Ở bước 4 phải chọn thư mục <b>chứa file manifest.json</b>, không chọn thư mục cha của nó.
            </p>
            <p>
              <b>Bỏ qua __MACOSX.</b> File zip có thể chứa thư mục rác <code className="sv2-code">__MACOSX</code> — không cần quan
              tâm.
            </p>
            <p>
              <b>Cập nhật extension.</b> Khi có bản mới, giải nén đè lên thư mục cũ, rồi bấm nút reload trên trang{' '}
              <code className="sv2-code">chrome://extensions</code>.
            </p>
          </div>
        </div>
      </SvSection>
    </SvShell>
  )
}

/* ───────── Phiên bản ───────── */

type VersionInfo = {
  python: string
  tool_dir: string
  tool_ok: boolean
  out_root: string
  ffmpeg: string
  ytdlp: string
  extension: boolean | null
}

export function SettingsVersion() {
  const [v, setV] = useState<VersionInfo | null>(null)
  const [err, setErr] = useState('')
  const [upId, setUpId] = useState('')
  const jobs = useJobs(['update-ytdlp'])
  const up = jobs.find((j) => j.id === upId)

  const load = () =>
    api<VersionInfo>('/api/version', {})
      .then(setV)
      .catch((e) => setErr(errText(e)))

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (up && up.status !== 'dang_chay') void load()
  }, [up?.status])

  const rows: [string, string, boolean][] = v
    ? [
        ['PB MEDIA', 'v0.1.0', true],
        ['Khung', 'Tauri + React + Vite · cầu nối Python', true],
        ['Python', v.python, true],
        ['Tool cũ', v.tool_ok ? v.tool_dir : `${v.tool_dir} (không thấy)`, v.tool_ok],
        ['Thư mục lưu', v.out_root, true],
        ['FFmpeg', v.ffmpeg || 'Chưa cài', !!v.ffmpeg],
        ['yt-dlp', v.ytdlp || 'Chưa cài', !!v.ytdlp],
        ['Chrome Extension', v.extension == null ? '—' : v.extension ? 'Đã nối' : 'Chưa nối', v.extension !== false],
      ]
    : []

  return (
    <SvShell icon={<Ico n="box" size={20} />} title="Phiên bản">
      {err && <p className="sv2-note">⚠ {err}</p>}
      {rows.map(([k, val, ok]) => (
        <div key={k} className="sv2-line">
          <span>{k}</span>
          <span className={ok ? '' : 'bad'}>{val}</span>
        </div>
      ))}
      <div className="sv2-inline" style={{ marginTop: 12 }}>
        <button type="button" className="sv2-btn ghost" onClick={() => void load()}>
          <Ico n="refresh" size={14} /> Kiểm tra lại
        </button>
        <button
          type="button"
          className="sv2-btn teal"
          disabled={!v?.ytdlp || up?.status === 'dang_chay'}
          onClick={() =>
            void api<{ id: string }>('/api/util/update-ytdlp', {})
              .then((r) => setUpId(r.id))
              .catch((e) => setErr(errText(e)))
          }
        >
          {up?.status === 'dang_chay' ? 'Đang cập nhật yt-dlp…' : '⬆ Cập nhật yt-dlp'}
        </button>
        {up && up.status !== 'dang_chay' && <span className="sv2-muted sm">{up.msg}</span>}
      </div>
    </SvShell>
  )
}
