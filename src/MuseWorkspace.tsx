import { ClearPromptBtn, PastePromptBtn, OnePromptCheck, cleanPromptFile, splitPrompts, useOnePrompt } from './OnePrompt'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Ico } from './SettingsPanes'
import './studio_sv.css'

/**
 * Muse — chạy THẬT qua cầu nối Python (scripts/pb_bridge.py → K:\MUSE TOOL\muse_video.py).
 *
 * Không dán cookie: tool Muse dùng Chrome hồ sơ riêng `_ho_so_muse` đã đăng nhập
 * muse.ai, mượn chính hàm gửi tin của trang. Cookie không rời khỏi máy.
 */

type MuseMode = 't2v' | 'i2v' | 't2i'
type Aspect = '16:9' | '9:16'
type RowStatus = 'cho' | 'dang_chay' | 'xong' | 'loi'
type QueueTab = 'all' | 'done' | 'error'
type LogLevel = 'INFO' | 'DEBUG' | 'LỖI' | 'OK' | 'WARN'

type Project = {
  id: number
  name: string
  savePath: string
  parallel: number
}

type RefImage = { id: number; name: string; tag: string; path: string }

type QueueRow = {
  id: string
  so: string
  prompt: string
  mode: MuseMode
  aspect: Aspect
  time: string
  duration: string
  status: RowStatus
  buoc: string
  error?: string
  outPath?: string
  soAnh: number
}

type BridgeJob = {
  id: string
  so: string
  prompt: string
  loai: 'anh' | 'video'
  ti_le: Aspect
  status: RowStatus
  buoc: string
  error: string
  out_path: string
  so_anh: number
  bat_dau: number
  ket_thuc: number
}

type LogLine = {
  id: number
  time: string
  level: LogLevel
  tag: string
  msg: string
}

const LS_PROJECTS = 'pb.muse.projects'
const LS_ACTIVE = 'pb.muse.active'
const LS_PROMPT = 'pb.muse.prompt'
const LS_ASPECT = 'pb.muse.aspect'
const LS_PARALLEL = 'pb.muse.parallel.v2'
const LS_PATH = 'pb.muse.path.v2'
const LS_MODE = 'pb.muse.mode'
const LS_COLLAPSED = 'pb.muse.promptCollapsed'
const LS_REFS = 'pb.muse.refs.v2'
const LS_HIDE = 'pb.muse.hideChrome'

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

const fileUrl = (p: string) => `/api/file?path=${encodeURIComponent(p)}`

function modeLabel(m: MuseMode, aspect: Aspect) {
  const base = m === 't2v' ? 'Text → Video' : m === 'i2v' ? 'Ảnh → Video' : 'Text → Ảnh'
  return `${base} ${aspect}`
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

function defaultProjects(): Project[] {
  return [{ id: 1, name: 'aa', savePath: '', parallel: 1 }]
}

function hms(t: number) {
  return t ? new Date(t * 1000).toLocaleTimeString('vi-VN', { hour12: false }) : '—'
}

function thoiLuong(a: number, b: number) {
  if (!a) return '—'
  const s = Math.max(0, Math.round((b || Date.now() / 1000) - a))
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

const BUOC: Record<string, string> = {
  gui: 'Đang gửi',
  dung: 'Đang dựng',
  tai: 'Đang tải',
  'chờ': 'Chờ',
}

const PROMPT_PLACEHOLDER =
  'Mỗi dòng là một prompt riêng. Gõ @tên để gắn ảnh tham chiếu (vd @CHAR_01). Ví dụ: Một con rồng bay qua thành phố lúc hoàng hôn, góc rộng.'

export default function MuseWorkspace() {
  const [projects, setProjects] = useState<Project[]>(() => loadJson(LS_PROJECTS, defaultProjects()))
  const [activeId, setActiveId] = useState<number>(() => {
    const v = loadJson<number | null>(LS_ACTIVE, null)
    return v ?? defaultProjects()[0].id
  })
  const [rows, setRows] = useState<QueueRow[]>([])
  const [promptText, setPromptText] = useState(() => {
    try {
      return localStorage.getItem(LS_PROMPT) || ''
    } catch {
      return ''
    }
  })
  const [aspect, setAspect] = useState<Aspect>(() => loadJson(LS_ASPECT, '16:9'))
  const [parallel, setParallel] = useState(() => loadJson(LS_PARALLEL, 1))
  const [mode, setMode] = useState<MuseMode>(() => loadJson(LS_MODE, 't2v'))
  const [savePath, setSavePath] = useState(() => {
    try {
      return localStorage.getItem(LS_PATH) || ''
    } catch {
      return ''
    }
  })
  const [hideChrome, setHideChrome] = useState(() => loadJson(LS_HIDE, false))
  const [refs, setRefs] = useState<RefImage[]>(() => loadJson(LS_REFS, [] as RefImage[]))
  const [queueTab, setQueueTab] = useState<QueueTab>('all')
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(() => loadJson(LS_COLLAPSED, false))
  const [sideCollapsed, setSideCollapsed] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null)
  const [running, setRunning] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLInputElement>(null)
  const logSince = useRef(0)

  const active = projects.find((p) => p.id === activeId) || projects[0]

  useEffect(() => {
    try {
      localStorage.setItem(LS_PROJECTS, JSON.stringify(projects))
      localStorage.setItem(LS_ACTIVE, JSON.stringify(activeId))
      localStorage.setItem(LS_PROMPT, promptText)
      localStorage.setItem(LS_ASPECT, JSON.stringify(aspect))
      localStorage.setItem(LS_PARALLEL, JSON.stringify(parallel))
      localStorage.setItem(LS_PATH, savePath)
      localStorage.setItem(LS_MODE, JSON.stringify(mode))
      localStorage.setItem(LS_COLLAPSED, JSON.stringify(collapsed))
      localStorage.setItem(LS_REFS, JSON.stringify(refs))
      localStorage.setItem(LS_HIDE, JSON.stringify(hideChrome))
    } catch {
      /* ignore */
    }
  }, [projects, activeId, promptText, aspect, parallel, savePath, mode, collapsed, refs, hideChrome])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  // ── Đồng bộ với cầu nối: hàng đợi + nhật ký thật (tag «muse»), 1,5 giây một lần ──
  useEffect(() => {
    let dead = false
    const tick = async () => {
      try {
        const [j, l] = await Promise.all([
          api<{ jobs: BridgeJob[]; running: boolean }>('/api/muse/jobs'),
          api<{ logs: LogLine[] }>(`/api/logs?since=${logSince.current}`),
        ])
        if (dead) return
        setBridgeOk(true)
        setRunning(j.running)
        setRows(
          j.jobs.map((x) => ({
            id: x.id,
            so: x.so,
            prompt: x.prompt,
            mode: (x.loai === 'anh' ? 't2i' : x.so_anh ? 'i2v' : 't2v') as MuseMode,
            aspect: x.ti_le,
            time: hms(x.bat_dau),
            duration: thoiLuong(x.bat_dau, x.ket_thuc),
            status: x.status,
            buoc: x.buoc,
            error: x.error,
            outPath: x.out_path,
            soAnh: x.so_anh,
          })),
        )
        if (l.logs.length) {
          logSince.current = l.logs[l.logs.length - 1].id
          const mine = l.logs.filter((x) => x.tag === 'muse')
          if (mine.length) setLogs((prev) => [...mine.slice().reverse(), ...prev].slice(0, 800))
        }
      } catch {
        if (!dead) setBridgeOk(false)
      }
    }
    tick()
    const t = setInterval(tick, 1500)
    return () => {
      dead = true
      clearInterval(t)
    }
  }, [])

  const flash = (msg: string) => setToast(msg)

  const counts = useMemo(() => {
    const done = rows.filter((r) => r.status === 'xong').length
    const err = rows.filter((r) => r.status === 'loi').length
    return { all: rows.length, done, err }
  }, [rows])

  const logErrCount = useMemo(() => logs.filter((l) => l.level === 'LỖI').length, [logs])

  const [sortDesc, setSortDesc] = useState(false)
  const [onePrompt, setOnePrompt] = useOnePrompt('muse')
  const [gridView, setGridView] = useState(false)
  const filteredRows = useMemo(() => {
    let list = sortDesc ? [...rows].reverse() : rows
    if (queueTab === 'done') list = list.filter((r) => r.status === 'xong')
    if (queueTab === 'error') list = list.filter((r) => r.status === 'loi')
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((r) => r.prompt.toLowerCase().includes(q))
    return list
  }, [rows, queueTab, search, sortDesc])

  const promptLines = useMemo(
    () => splitPrompts(promptText, onePrompt),
    [promptText, onePrompt],
  )
  const promptCount = promptLines.length
  const needRefWarn = mode === 'i2v' && refs.length === 0

  const createProject = () => {
    const name = newName.trim() || `dự án ${projects.length + 1}`
    const id = Date.now()
    setProjects((prev) => [...prev, { id, name, savePath, parallel }])
    setActiveId(id)
    setShowCreate(false)
    setNewName('')
    flash(`Đã tạo dự án ${name}`)
  }

  const pickPath = async () => {
    try {
      flash('Đang mở hộp chọn thư mục…')
      const r = await api<{ path: string }>('/api/pick-folder', { start: savePath })
      if (r.path) {
        setSavePath(r.path)
        flash('Đã chọn thư mục')
      }
    } catch (e) {
      flash(`Không mở được hộp chọn thư mục: ${(e as Error).message}`)
    }
  }

  const openChrome = () => {
    api('/api/muse/chrome', {})
      .then(() => flash('Đang mở Chrome muse.ai — đăng nhập nếu được hỏi'))
      .catch((e) => flash(`Không mở được Chrome: ${(e as Error).message}`))
  }

  const loadTxt = (f: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = cleanPromptFile(String(reader.result || ''))
      setPromptText(text)
      setCollapsed(false)
      flash(`Đã nạp ${f.name} · ${splitPrompts(text, false).length} prompt`)
    }
    reader.readAsText(f)
  }

  const addRef = async (f: File) => {
    if (refs.length >= 8) {
      flash('Tối đa 8 ảnh tham chiếu')
      return
    }
    try {
      const r = await fetch(`/api/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f })
      const j = (await r.json()) as { ok: boolean; path: string; tag: string; error?: string }
      if (!j.ok) throw new Error(j.error || 'lỗi')
      setRefs((prev) => [
        ...prev.filter((x) => x.tag !== j.tag),
        { id: Date.now() + Math.random(), name: f.name, tag: j.tag, path: j.path },
      ])
      flash(`Đã thêm ${j.tag}`)
    } catch (e) {
      flash(`Không gửi được ${f.name}: ${(e as Error).message}`)
    }
  }

  const runPrompts = async () => {
    if (!promptLines.length) {
      flash('Chưa có prompt')
      return
    }
    if (needRefWarn) {
      flash('Ảnh → Video cần ít nhất 1 ảnh tham chiếu')
      return
    }
    if (bridgeOk === false) {
      flash('Cầu nối Python chưa chạy — tắt và chạy lại npm run dev')
      return
    }
    try {
      await api('/api/muse/start', {
        prompts: promptLines,
        mode,
        aspect,
        parallel,
        out_dir: savePath,
        project: active?.name || 'du_an',
        refs: mode === 't2i' && !refs.length ? [] : refs.map((r) => ({ tag: r.tag, path: r.path })),
        an_chrome: hideChrome,
      })
      setQueueTab('all')
      flash(`Đã gửi ${promptLines.length} prompt`)
    } catch (e) {
      flash(`Không gửi được: ${(e as Error).message}`)
    }
  }

  const retryIds = async (ids: string[], label: string) => {
    if (!ids.length) {
      flash('Không có mục nào để chạy lại')
      return
    }
    try {
      const r = await api<{ n: number }>('/api/muse/retry', { ids })
      flash(`${label}: ${r.n} job`)
    } catch (e) {
      flash(`Lỗi: ${(e as Error).message}`)
    }
  }

  const retryErrors = () => retryIds(rows.filter((r) => r.status === 'loi').map((r) => r.id), 'Tạo lại lỗi')
  const retryPending = () =>
    retryIds(rows.filter((r) => r.status === 'loi' || r.status === 'cho').map((r) => r.id), 'Tạo lại chưa xong')

  const stopAll = () => {
    api('/api/muse/stop', {}).then(() => flash('Đã dừng')).catch(() => {})
  }

  const openFolder = (p?: string) => {
    const body = p ? { path: p } : { path: savePath, tab: 'Muse', project: active?.name || '' }
    api('/api/open-folder', body).catch((e) => flash(`Không mở được thư mục: ${(e as Error).message}`))
  }

  const deleteRows = (ids: string[] | null) => {
    api('/api/muse/delete', { ids }).catch(() => {})
    setSelected([])
  }

  const clearDone = () => deleteRows(rows.filter((r) => r.status === 'xong').map((r) => r.id))

  const clearAll = () => {
    if (!window.confirm('Xoá toàn bộ hàng đợi? (file đã tải vẫn giữ)')) return
    deleteRows(null)
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const selectAllFiltered = () => {
    const ids = filteredRows.map((r) => r.id)
    const allOn = ids.length > 0 && ids.every((id) => selected.includes(id))
    setSelected(allOn ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])])
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        void runPrompts()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="muse-root">
      {!sideCollapsed && (
        <aside className="muse-side">
          <div className="muse-brand">
            <span className="st-brand-ico"><Ico n="wand" size={16} /></span>
            <div>
              <div className="muse-brand-title">Muse</div>
              <div className="muse-brand-sub">muse.ai Studio</div>
            </div>
            <button type="button" className="muse-icon-btn" title="Thu gọn" onClick={() => setSideCollapsed(true)}>
              ‹
            </button>
          </div>
          <div className="muse-proj-head">
            <span>DỰ ÁN ({projects.length})</span>
            <button type="button" className="muse-plus" title="Tạo dự án" onClick={() => setShowCreate(true)}>
              +
            </button>
          </div>
          <div className="muse-proj-list">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`muse-proj ${p.id === activeId ? 'on' : ''}`}
                onClick={() => setActiveId(p.id)}
              >
                <span className="muse-proj-ico"><Ico n="wand" size={15} /></span>
                <span className="muse-proj-name">{p.name}</span>
              </button>
            ))}
          </div>
        </aside>
      )}

      <div className="muse-main">
        <div className="muse-topbar">
          {sideCollapsed && (
            <button type="button" className="muse-icon-btn" onClick={() => setSideCollapsed(false)} title="Mở sidebar">
              ›
            </button>
          )}
          <div className="muse-proj-title">
            <span className="st-title-ico"><Ico n="wand" size={17} /></span>
            <strong>{active?.name || '—'}</strong>
          </div>
          <div className="st-save" title={savePath || 'Mặc định: Videos\\PB_MEDIA\\Muse\\<dự án>'}>
            <button type="button" className="st-save-main" onClick={() => void pickPath()}>
              <Ico n="folder" size={14} />
              <span className="st-dim">Lưu vào</span>
              <b>{savePath ? savePath.split(/[\\/]/).filter(Boolean).slice(-2).join('/') : 'Mặc định'}</b>
            </button>
            <button type="button" className="st-save-ico" title="Mở thư mục lưu" onClick={() => openFolder()}>
              <Ico n="folderopen" size={14} />
            </button>
            <button type="button" className="st-save-ico" title="Dùng thư mục mặc định" onClick={() => setSavePath('')}>
              <Ico n="x" size={14} />
            </button>
          </div>
          <button
            type="button"
            className="muse-cookie-btn"
            onClick={openChrome}
            title="Mở cửa sổ Chrome muse.ai của tool (đăng nhập lần đầu ở đây)"
          >
            <span className={`muse-plug ${bridgeOk ? 'on' : ''}`}><Ico n="key" size={13} /></span>
            Cookie muse.ai
          </button>
          <label className="muse-muted st-hide-chrome" title="Chạy Chrome muse.ai ẩn">
            <input type="checkbox" checked={hideChrome} onChange={(e) => setHideChrome(e.target.checked)} />
            Ẩn Chrome
          </label>
          <div className="muse-progress">
            <span className="muse-progress-ring" />
            {bridgeOk === false ? 'Cầu nối Python chưa chạy' : `${counts.done}/${counts.all} hoàn thành`}
          </div>
          <button type="button" className="muse-bell" title="Nhật ký hoạt động" onClick={() => setShowLog((v) => !v)}>
            <Ico n="terminal" size={16} />
            {logErrCount > 0 && <span className="muse-bell-badge">{logErrCount}</span>}
          </button>
        </div>

        {!collapsed && (
          <section className="muse-prompt-card">
            <div className="muse-prompt-head">
              <div className="muse-modes">
                <button type="button" className={mode === 't2v' ? 'on' : ''} onClick={() => setMode('t2v')}>
                  <Ico n="video" size={14} /> Text → Video
                </button>
                <button type="button" className={mode === 'i2v' ? 'on' : ''} onClick={() => setMode('i2v')}>
                  <Ico n="image" size={14} /> Ảnh → Video
                </button>
                <button type="button" className={mode === 't2i' ? 'on' : ''} onClick={() => setMode('t2i')}>
                  <Ico n="wand" size={14} /> Text → Ảnh
                </button>
              </div>
              <div className="muse-prompt-actions">
                <button type="button" className="muse-ghost" onClick={() => fileRef.current?.click()}>
                  <Ico n="file" size={13} /> Nạp TXT
                </button>
                <PastePromptBtn value={promptText} setValue={setPromptText} />
                <ClearPromptBtn value={promptText} setValue={setPromptText} />
                <OnePromptCheck on={onePrompt} setOn={setOnePrompt} />
                <span className="muse-ghost muted st-count">{promptCount} job</span>
                <button type="button" className="muse-ghost" onClick={() => setCollapsed(true)}>
                  <Ico n="arrowup" size={12} /> Thu gọn
                </button>
              </div>
            </div>

            <div className="st-compose">
            <textarea
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const f = e.dataTransfer.files?.[0]
                if (f) {
                  e.preventDefault()
                  loadTxt(f)
                }
              }}
              className="muse-textarea"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder={PROMPT_PLACEHOLDER}
              rows={6}
            />

            <div className="muse-ref-row">
              <button type="button" className="muse-ref-btn" onClick={() => imgRef.current?.click()}>
                <Ico n="upload" size={14} /> + Tải ảnh tham chiếu
              </button>
              <span className="muse-muted">
                {mode === 'i2v'
                  ? 'Prompt gọi @tên thì dùng đúng ảnh đó; không gọi thì ảnh thứ i đi với prompt thứ i. Tối đa 8 ảnh.'
                  : 'Tuỳ chọn — gõ @tên trong prompt để gửi kèm ảnh đó. Tối đa 8 ảnh.'}
              </span>
            </div>
            </div>
            {refs.length > 0 && (
              <div className="muse-ref-list">
                {refs.map((r) => (
                  <span key={r.id} className="muse-ref-tag" title={r.name}>
                    {r.tag}
                    <button type="button" onClick={() => setRefs((prev) => prev.filter((x) => x.id !== r.id))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="muse-run-row">
              <div className="muse-aspect">
                <button type="button" className={aspect === '16:9' ? 'on' : ''} onClick={() => setAspect('16:9')}>
                  16:9 Ngang
                </button>
                <button type="button" className={aspect === '9:16' ? 'on' : ''} onClick={() => setAspect('9:16')}>
                  9:16 Dọc
                </button>
              </div>
              <div className="muse-parallel-mini" title="Số cảnh gửi chung một tin — Rocky dựng song song">
                <Ico n="spin" size={13} />
                <select value={parallel} onChange={(e) => setParallel(Number(e.target.value))}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              {needRefWarn ? (
                <span className="muse-warn-pill">Cần ít nhất 1 ảnh tham chiếu</span>
              ) : (
                <span className="muse-muted sm-help">
                  {mode === 't2v'
                    ? 'Mô tả cảnh, muse.ai dựng video — mỗi dòng là một job.'
                    : mode === 't2i'
                      ? 'Mỗi dòng = 1 ảnh.'
                      : 'Ảnh tham chiếu + prompt → video.'}
                </span>
              )}
              {running && (
                <button type="button" className="muse-ghost" onClick={stopAll}>
                  ⏹ Dừng
                </button>
              )}
              <button
                type="button"
                className="muse-run"
                onClick={() => void runPrompts()}
                disabled={!promptCount || needRefWarn}
              >
                <Ico n="play" size={13} /> Chạy prompt <span className="st-kbd">(ctrl+↵)</span>
              </button>
            </div>
          </section>
        )}

        {collapsed && (
          <button type="button" className="muse-expand-prompt" onClick={() => setCollapsed(false)}>
            Mở khung prompt ▾ · {promptCount} job · {modeLabel(mode, aspect)}
          </button>
        )}

        <section className="muse-queue">
          <div className="muse-queue-head">
            <div className="muse-tabs">
              <button type="button" className={queueTab === 'all' ? 'on' : ''} onClick={() => setQueueTab('all')}>
                Tất cả ({counts.all})
              </button>
              <button type="button" className={queueTab === 'done' ? 'on' : ''} onClick={() => setQueueTab('done')}>
                Hoàn thành ({counts.done})
              </button>
              <button
                type="button"
                className={`err ${queueTab === 'error' ? 'on' : ''}`}
                onClick={() => setQueueTab('error')}
              >
                Lỗi ({counts.err})
              </button>
            </div>
            <div className="muse-queue-tools">
              <div className="st-search">
                <Ico n="search" size={14} />
                <input
                  className="muse-search"
                  placeholder="Tìm prompt..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button type="button" className="st-btn" onClick={() => setSortDesc((v) => !v)} title="Đảo thứ tự">
                <Ico n={sortDesc ? 'arrowdown' : 'arrowup'} size={13} /> STT
              </button>
              <div className="st-viewtog">
                <button type="button" className={!gridView ? 'on' : ''} onClick={() => setGridView(false)} title="Danh sách">
                  <Ico n="list" size={14} />
                </button>
                <button type="button" className={gridView ? 'on' : ''} onClick={() => setGridView(true)} title="Lưới">
                  <Ico n="grid" size={14} />
                </button>
              </div>
              <button type="button" className="st-btn ok" onClick={() => openFolder()} title="Mở thư mục chứa video đã tải">
                <Ico n="download" size={13} /> Tải tất cả ({counts.done})
              </button>
              <button type="button" className="st-btn warn" onClick={retryErrors}>
                <Ico n="refresh" size={13} /> Tạo lại lỗi ({counts.err})
              </button>
              <button type="button" className="st-btn info" onClick={retryPending}>
                <Ico n="refresh" size={13} /> Tạo lại tất cả chưa tạo ({counts.all - counts.done})
              </button>
              <button type="button" className="st-btn" onClick={clearDone}>
                <Ico n="refresh" size={13} /> Xoá đã xong
              </button>
              <button type="button" className="st-btn" onClick={clearAll}>
                <Ico n="trash" size={13} /> Xoá toàn bộ
              </button>
            </div>
          </div>

          <div className="muse-table-wrap">
            <table className={`muse-table${gridView ? ' st-grid' : ''}`}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={filteredRows.length > 0 && filteredRows.every((r) => selected.includes(r.id))}
                      onChange={selectAllFiltered}
                    />
                  </th>
                  <th style={{ width: 44 }}>
                    # <Ico n={sortDesc ? 'arrowdown' : 'arrowup'} size={11} />
                  </th>
                  <th style={{ width: 72 }}>MEDIA</th>
                  <th>PROMPT</th>
                  <th style={{ width: 130 }}>CHẾ ĐỘ</th>
                  <th style={{ width: 110 }}>THỜI GIAN</th>
                  <th style={{ width: 110 }}>TRẠNG THÁI</th>
                  <th style={{ width: 120 }}>THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muse-empty">
                      Chưa có mục trong hàng đợi
                    </td>
                  </tr>
                )}
                {filteredRows.map((r) => (
                  <tr key={r.id} className={r.status === 'loi' ? 'is-err' : ''}>
                    <td>
                      <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSelect(r.id)} />
                    </td>
                    <td className="muse-num">{r.so}</td>
                    <td className="muse-media">
                      {r.status === 'loi' ? (
                        <span className="muse-warn-tri" title="Lỗi">
                          <Ico n="alert" size={18} />
                        </span>
                      ) : r.status === 'xong' && r.outPath ? (
                        <a className="muse-media-ok st-thumb" href={fileUrl(r.outPath)} target="_blank" rel="noreferrer" title={r.outPath}>
                          {/\.(png|jpe?g|webp)$/i.test(r.outPath) ? (
                            <img src={fileUrl(r.outPath)} alt="" />
                          ) : (
                            <video src={`${fileUrl(r.outPath)}#t=1`} preload="metadata" muted />
                          )}
                          <span className="st-play"><Ico n="play" size={12} /></span>
                        </a>
                      ) : (
                        <span className="muse-media-wait"><Ico n="spin" size={16} className={r.status === 'dang_chay' ? 'st-spin' : ''} /></span>
                      )}
                    </td>
                    <td className="muse-prompt-cell">
                      <div className="muse-prompt-text">{r.prompt}</div>
                      {r.soAnh > 0 && (
                        <div className="st-file">
                          <Ico n="image" size={11} /> {r.soAnh} ảnh tham chiếu
                        </div>
                      )}
                      {r.status === 'xong' && r.outPath && (
                        <div className="st-file" title={r.outPath}>
                          <Ico n="folder" size={11} /> {r.outPath.split(/[\\/]/).pop()}
                        </div>
                      )}
                      {r.status === 'loi' && r.error && (
                        <div className="muse-err-box">
                          <div className="st-err-line">
                            <Ico n="xcircle" size={12} />
                            <span>{r.error}</span>
                          </div>
                          {/sẵn sàng|đăng nhập|kết nối/i.test(r.error) && (
                            <button type="button" className="muse-cookie-link" onClick={openChrome}>
                              Mở Chrome muse.ai
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="muse-type">
                        <Ico n={r.mode === 't2i' ? 'image' : 'video'} size={11} /> {modeLabel(r.mode, r.aspect)}
                      </span>
                    </td>
                    <td>
                      <div className="muse-time">{r.time}</div>
                      <div className="muse-muted tiny">{r.duration}</div>
                    </td>
                    <td>
                      <span className={`muse-status ${r.status}`}>
                        <Ico
                          n={r.status === 'xong' ? 'checkcircle' : r.status === 'loi' ? 'xcircle' : 'spin'}
                          size={12}
                          className={r.status === 'dang_chay' ? 'st-spin' : ''}
                        />
                        {r.status === 'loi'
                          ? 'Lỗi'
                          : r.status === 'xong'
                            ? 'Hoàn thành'
                            : r.status === 'dang_chay'
                              ? BUOC[r.buoc] || 'Đang chạy'
                              : 'Chờ'}
                      </span>
                    </td>
                    <td className="muse-ops">
                      {r.status === 'xong' && r.outPath && (
                        <>
                          <button type="button" title="Mở thư mục chứa file" onClick={() => openFolder(r.outPath)}>
                            <Ico n="folder" size={15} />
                          </button>
                          <a className="st-op" title="Tải / mở file" href={fileUrl(r.outPath)} download>
                            <Ico n="download" size={15} />
                          </a>
                          <a className="st-op" title="Xem ở tab mới" href={fileUrl(r.outPath)} target="_blank" rel="noreferrer">
                            <Ico n="external" size={15} />
                          </a>
                        </>
                      )}
                      <button
                        type="button"
                        title="Chép prompt"
                        onClick={() => {
                          navigator.clipboard?.writeText(r.prompt).catch(() => {})
                          flash('Đã chép prompt')
                        }}
                      >
                        <Ico n="copy" size={15} />
                      </button>
                      <button
                        type="button"
                        title="Chạy lại"
                        disabled={r.status === 'dang_chay'}
                        onClick={() => void retryIds([r.id], 'Chạy lại')}
                      >
                        <Ico n="refresh" size={15} />
                      </button>
                      <button
                        type="button"
                        title="Sửa"
                        onClick={() => {
                          setPromptText(r.prompt)
                          setMode(r.mode)
                          setAspect(r.aspect)
                          setCollapsed(false)
                          flash('Đã đưa prompt lên khung nhập')
                        }}
                      >
                        <Ico n="pencil" size={15} />
                      </button>
                      <button
                        type="button"
                        title="Xoá"
                        disabled={r.status === 'dang_chay'}
                        onClick={() => deleteRows([r.id])}
                      >
                        <Ico n="trash" size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showLog && (
        <aside className="muse-log">
          <div className="muse-log-head">
            <div>
              <strong>NHẬT KÝ HOẠT ĐỘNG</strong>
              <span className="muse-muted">
                {' '}
                — {logs.length} dòng · {logErrCount} lỗi
              </span>
            </div>
            <div className="muse-log-actions">
              <button
                type="button"
                className="muse-ghost"
                onClick={() => {
                  setLogs([])
                  flash('Đã xoá nhật ký')
                }}
              >
                Xoá
              </button>
              <button type="button" className="muse-icon-btn" onClick={() => setShowLog(false)}>
                ×
              </button>
            </div>
          </div>
          <div className="muse-log-body">
            {logs.length === 0 && (
              <div className="muse-muted" style={{ padding: 12 }}>
                Chưa có dòng nhật ký
              </div>
            )}
            {logs.map((l) => (
              <div
                key={l.id}
                className={`muse-log-line ${l.level === 'LỖI' ? 'err' : ''} ${l.level === 'OK' ? 'ok' : ''}`}
              >
                <span className="muse-log-time">{l.time}</span>
                <span className={`muse-log-lvl ${l.level === 'LỖI' ? 'err' : ''} ${l.level === 'OK' ? 'ok' : ''}`}>
                  {l.level}
                </span>
                <span className="muse-log-tag">[{l.tag}]</span>
                <span className="muse-log-msg">{l.msg}</span>
              </div>
            ))}
          </div>
        </aside>
      )}

      {showCreate && (
        <div className="muse-modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="muse-modal" onClick={(e) => e.stopPropagation()}>
            <div className="muse-modal-title">
              <span>✦</span> Tạo dự án Muse
            </div>
            <label className="muse-field-label">Tên dự án</label>
            <input
              className="muse-input"
              placeholder="Ví dụ: aa"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') createProject()
              }}
            />
            <div className="muse-modal-foot">
              <button type="button" className="muse-ghost" onClick={() => setShowCreate(false)}>
                Huỷ
              </button>
              <button type="button" className="muse-run" onClick={createProject}>
                Tạo dự án
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) loadTxt(f)
          e.target.value = ''
        }}
      />
      <input
        ref={imgRef}
        type="file"
        accept="image/*"
        hidden
        multiple
        onChange={(e) => {
          const files = e.target.files
          if (files) Array.from(files).forEach((f) => void addRef(f))
          e.target.value = ''
        }}
      />

      {toast && <div className="muse-toast">{toast}</div>}
    </div>
  )
}
