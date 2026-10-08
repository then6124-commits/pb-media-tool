import { OnePromptCheck, cleanPromptFile, splitPrompts, useOnePrompt } from './OnePrompt'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Ico } from './SettingsPanes'
import './studio_sv.css'

type ProjKind = 'video' | 'nano'
type Aspect = '16:9' | '9:16'
type RowStatus = 'cho' | 'dang_chay' | 'xong' | 'loi' | 'tu_choi'
type QueueTab = 'all' | 'done' | 'error'
type LogLevel = 'INFO' | 'DEBUG' | 'LỖI' | 'WARN'

type Project = {
  id: number
  name: string
  kind: ProjKind
  aspect: Aspect
  savePath: string
  googleDocId: string
  parallel: number
}

/** Ảnh đã gửi lên cầu nối — `path` là file thật trên máy. */
type RefImage = { id: number; name: string; tag: string; path: string }

type QueueRow = {
  id: string
  stt: number
  prompt: string
  aspect: Aspect
  duration: string
  status: RowStatus
  error?: string
  buoc?: string
  outPath?: string
  tk?: string
  extendFrom?: string
  when?: string
}

type LogLine = {
  id: number
  time: string
  level: LogLevel
  tag: string
  msg: string
}

type Props = {
  onOpenSettings?: () => void
}

type BridgeJob = {
  id: string
  stt: number
  prompt: string
  aspect: Aspect
  duration: number
  status: RowStatus
  error: string
  buoc: string
  out_path: string
  tk: string
  extend_from?: string
  bat_dau?: number
  ket_thuc?: number
}

/** «14:05 · 1m20s» — giờ xong (hoặc giờ bắt đầu khi đang chạy) và thời gian dựng. */
function thoiGian(batDau?: number, ketThuc?: number): string {
  if (!batDau) return ''
  const moc = new Date((ketThuc || batDau) * 1000)
  const gio = `${String(moc.getHours()).padStart(2, '0')}:${String(moc.getMinutes()).padStart(2, '0')}`
  if (!ketThuc) return gio
  const giay = Math.max(0, Math.round(ketThuc - batDau))
  return `${gio} · ${giay >= 60 ? `${Math.floor(giay / 60)}m${giay % 60}s` : `${giay}s`}`
}

/** Video gửi sang tab «Kéo dài»: video gốc + prompt cho đoạn nối tiếp. */
type ExtendItem = { id: string; src: string; prompt: string; duration: number }

const LS_PROJECTS = 'pb.vids.projects'
const LS_ACTIVE = 'pb.vids.active'
const LS_PROMPT = 'pb.vids.prompt'
const LS_ASPECT = 'pb.vids.aspect'
const LS_PARALLEL = 'pb.vids.parallel'
const LS_DOC = 'pb.vids.doc.v2'
const LS_PATH = 'pb.vids.path.v2'
const LS_COLLAPSED = 'pb.vids.promptCollapsed'
const LS_REFS = 'pb.vids.refs.v2'
const LS_DUR = 'pb.vids.duration'
const LS_RES = 'pb.vids.res'

/** Gọi cầu nối Python (Vite chuyển /api → 127.0.0.1:1431). */
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

function defaultProjects(): Project[] {
  return [
    {
      id: 1,
      name: 'bao',
      kind: 'video',
      aspect: '16:9',
      savePath: '',
      googleDocId: '',
      parallel: 4,
    },
  ]
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

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result || ''))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(file)
  })
}

const PROMPT_PLACEHOLDER = `Mỗi dòng = 1 prompt. Dùng @tên để gắn ảnh tham chiếu.
Ví dụ: 001. @CHAR_01 | @BG_02. A woman walks through the market…

Hoặc dán JSON:
[
  {"shot": "Medium shot", "subject": {"description": "A young woman walking"}}
]`

export default function VidsWorkspace({ onOpenSettings }: Props) {
  const [projects, setProjects] = useState<Project[]>(() =>
    loadJson(LS_PROJECTS, defaultProjects()),
  )
  const [activeId, setActiveId] = useState<number>(() => {
    const v = loadJson<number | null>(LS_ACTIVE, null)
    return v ?? defaultProjects()[0].id
  })
  const [rows, setRows] = useState<QueueRow[]>([])
  const [onePrompt, setOnePrompt] = useOnePrompt('vids')
  const [promptText, setPromptText] = useState(() => {
    try {
      return localStorage.getItem(LS_PROMPT) || ''
    } catch {
      return ''
    }
  })
  const [aspect, setAspect] = useState<Aspect>(() => loadJson(LS_ASPECT, '16:9'))
  const [parallel, setParallel] = useState(() => loadJson(LS_PARALLEL, 4))
  const [duration, setDuration] = useState(() => loadJson(LS_DUR, 8))
  const [resolution, setResolution] = useState<'720p' | '1080p'>(() => loadJson(LS_RES, '1080p'))
  const [docId, setDocId] = useState(() => {
    try {
      return localStorage.getItem(LS_DOC) || ''
    } catch {
      return ''
    }
  })
  const [savePath, setSavePath] = useState(() => {
    try {
      return localStorage.getItem(LS_PATH) || ''
    } catch {
      return ''
    }
  })
  const [refs, setRefs] = useState<RefImage[]>(() => loadJson(LS_REFS, [] as RefImage[]))
  const [queueTab, setQueueTab] = useState<QueueTab>('all')
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(() => loadJson(LS_COLLAPSED, false))
  const [showCfg, setShowCfg] = useState(() => loadJson('pb.vids.showcfg', false))
  /** Hộp «Sửa prompt» của một dòng trong hàng đợi. */
  const [editRow, setEditRow] = useState<{ id: string; status: RowStatus; text: string } | null>(null)
  /** Cỡ video kết quả: dạng danh sách = bề ngang ảnh (px), dạng lưới = số cột. */
  const [thumbW, setThumbW] = useState(() => loadJson('pb.vids.thumbw', 44))
  const [gridCols, setGridCols] = useState(() => {
    const n: number = loadJson('pb.vids.gridcols', 4 as number)
    return n === 6 || n === 8 ? n : 4
  })
  useEffect(() => {
    try {
      localStorage.setItem('pb.vids.thumbw', JSON.stringify(thumbW))
      localStorage.setItem('pb.vids.gridcols', JSON.stringify(gridCols))
    } catch {
      /* ignore */
    }
  }, [thumbW, gridCols])
  useEffect(() => {
    try {
      localStorage.setItem('pb.vids.showcfg', JSON.stringify(showCfg))
    } catch {
      /* ignore */
    }
  }, [showCfg])
  const [view, setView] = useState<'create' | 'extend'>('create')
  const [extendList, setExtendList] = useState<ExtendItem[]>(() => loadJson('pb.vids.extend', [] as ExtendItem[]))
  useEffect(() => {
    try {
      localStorage.setItem('pb.vids.extend', JSON.stringify(extendList))
    } catch {
      /* ignore */
    }
  }, [extendList])
  const [sideCollapsed, setSideCollapsed] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<ProjKind>('video')
  const [showParallelMenu, setShowParallelMenu] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null)
  const [account, setAccount] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(100)
  const logSince = useRef(0)
  const [nguonMap, setNguonMap] = useState<Record<string, { co: boolean; email: string }>>({})
  useEffect(() => {
    if (extendList.length) {
      api('/api/vids/extend-src', { paths: extendList.map((x) => x.src) }).catch(() => {})
    }
    // chỉ lúc mở tab — video thêm sau đã đăng ký khi thêm
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const thieu = extendList.map((x) => x.src).filter((src) => !(src in nguonMap))
    if (!thieu.length) return
    let dead = false
    void Promise.all(
      thieu.map((src) =>
        api<{ co: boolean; email: string }>(`/api/vids/nguon?path=${encodeURIComponent(src)}`)
          .then((r) => [src, { co: !!r.co, email: r.email || '' }] as const)
          .catch(() => [src, { co: false, email: '' }] as const),
      ),
    ).then((ds) => {
      if (!dead) setNguonMap((m) => ({ ...m, ...Object.fromEntries(ds) }))
    })
    return () => {
      dead = true
    }
  }, [extendList, nguonMap])

  const active = projects.find((p) => p.id === activeId) || projects[0]

  useEffect(() => {
    try {
      localStorage.setItem(LS_PROJECTS, JSON.stringify(projects))
      localStorage.setItem(LS_ACTIVE, JSON.stringify(activeId))
      localStorage.setItem(LS_PROMPT, promptText)
      localStorage.setItem(LS_ASPECT, JSON.stringify(aspect))
      localStorage.setItem(LS_PARALLEL, JSON.stringify(parallel))
      localStorage.setItem(LS_DUR, JSON.stringify(duration))
      localStorage.setItem(LS_RES, JSON.stringify(resolution))
      localStorage.setItem(LS_DOC, docId)
      localStorage.setItem(LS_PATH, savePath)
      localStorage.setItem(LS_COLLAPSED, JSON.stringify(collapsed))
      localStorage.setItem(LS_REFS, JSON.stringify(refs))
    } catch {
      /* ignore */
    }
  }, [projects, activeId, promptText, aspect, parallel, duration, resolution, docId, savePath, collapsed, refs])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  // ── Đồng bộ với cầu nối: hàng đợi + nhật ký thật, 1,5 giây một lần ──
  useEffect(() => {
    let dead = false
    const tick = async () => {
      try {
        const [j, l] = await Promise.all([
          api<{ jobs: BridgeJob[] }>('/api/vids/jobs'),
          api<{ logs: LogLine[] }>(`/api/logs?since=${logSince.current}`),
        ])
        if (dead) return
        setBridgeOk(true)
        setRows(
          j.jobs.map((x) => ({
            id: x.id,
            stt: x.stt,
            prompt: x.prompt,
            aspect: x.aspect,
            duration: x.duration ? `${x.duration}s` : '',
            status: x.status,
            error: x.error,
            buoc: x.buoc,
            outPath: x.out_path,
            tk: x.tk,
            extendFrom: x.extend_from || undefined,
            when: thoiGian(x.bat_dau, x.ket_thuc),
          })),
        )
        if (l.logs.length) {
          logSince.current = l.logs[l.logs.length - 1].id
          setLogs((prev) => [...l.logs.slice().reverse(), ...prev].slice(0, 800))
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

  useEffect(() => {
    if (!bridgeOk) return
    api<{ accounts: { email: string; bat: boolean; cookie_ok: boolean; tier: string }[] }>('/api/accounts')
      .then((r) => {
        const a = r.accounts.find((x) => x.bat && x.cookie_ok) || r.accounts[0]
        setAccount(
          a
            ? `${a.email}${a.tier ? ' · ' + a.tier : ''}${a.cookie_ok ? '' : ' (cookie hỏng)'}`
            : 'chưa có tài khoản',
        )
      })
      .catch(() => setAccount(''))
  }, [bridgeOk])

  const counts = useMemo(() => {
    const done = rows.filter((r) => r.status === 'xong').length
    const err = rows.filter((r) => r.status === 'loi' || r.status === 'tu_choi').length
    return { all: rows.length, done, err }
  }, [rows])

  const logErrCount = useMemo(
    () => logs.filter((l) => l.level === 'LỖI').length,
    [logs],
  )

  const [sortDesc, setSortDesc] = useState(false)
  const [gridView, setGridView] = useState(false)
  const filteredRows = useMemo(() => {
    let list = sortDesc ? [...rows].reverse() : rows
    if (queueTab === 'done') list = list.filter((r) => r.status === 'xong')
    if (queueTab === 'error') list = list.filter((r) => r.status === 'loi' || r.status === 'tu_choi')
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((r) => r.prompt.toLowerCase().includes(q))
    return list
  }, [rows, queueTab, search, sortDesc])

  const parsePrompts = (text: string): string[] => {
    const joined = text.trim()
    if (!joined) return []
    if (onePrompt) return [joined]
    if (joined.startsWith('[') || joined.startsWith('{')) {
      try {
        const parsed = JSON.parse(joined)
        if (Array.isArray(parsed)) {
          return parsed.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
        }
        return [JSON.stringify(parsed)]
      } catch {
        /* fallthrough */
      }
    }
    return splitPrompts(joined, false)
  }

  const promptCount = useMemo(() => parsePrompts(promptText).length, [promptText, onePrompt])

  const flash = (msg: string) => setToast(msg)

  const createProject = () => {
    const name = newName.trim() || `Dự án ${projects.length + 1}`
    const id = Date.now()
    const p: Project = {
      id,
      name,
      kind: newKind,
      aspect: '16:9',
      savePath,
      googleDocId: docId,
      parallel,
    }
    setProjects((prev) => [...prev, p])
    setActiveId(id)
    setShowCreate(false)
    setNewName('')
    setNewKind('video')
    flash(`Đã tạo dự án «${name}»`)
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

  /** Tab Kéo dài: thêm video có sẵn trên máy (hộp chọn file của Windows). */
  const addPcVideos = async () => {
    try {
      const pick = await api<{ paths: string[] }>('/api/pick-files', { kind: 'video' })
      if (!pick.paths?.length) return
      const ok = await api<{ paths: string[] }>('/api/vids/extend-src', { paths: pick.paths })
      if (!ok.paths.length) {
        flash('Không đọc được video đã chọn')
        return
      }
      setExtendList((prev) => [
        ...ok.paths
          .filter((src) => !prev.some((x) => x.src === src))
          .map((src, i) => ({ id: `pc_${Date.now()}_${i}`, src, prompt: '', duration: 8 })),
        ...prev,
      ])
      setView('extend')
      flash(`Đã thêm ${ok.paths.length} video từ máy`)
    } catch (e) {
      flash(`Không mở được hộp chọn file: ${(e as Error).message}`)
    }
  }

  /** Chép video đã xong sang thư mục người dùng chọn. */
  const downloadFiles = async (paths: string[]) => {
    if (!paths.length) {
      flash('Chưa có video nào xong')
      return
    }
    try {
      const pick = await api<{ path: string }>('/api/pick-folder', { start: savePath })
      if (!pick.path) return
      const r = await api<{ n: number }>('/api/util/copy-files', { paths, dest: pick.path })
      flash(`Đã chép ${r.n} video → ${pick.path}`)
    } catch (e) {
      flash(`Không chép được: ${(e as Error).message}`)
    }
  }

  /** Mở thư mục chứa một file (nút 📂 trên từng dòng). */
  const openFileFolder = (path: string) => {
    api('/api/open-folder', { path }).catch((e) => flash(`Không mở được thư mục: ${(e as Error).message}`))
  }

  /** Gửi video đã xong sang tab «Kéo dài». */
  const sendToExtend = (r: QueueRow) => {
    if (!r.outPath) return
    setExtendList((prev) =>
      prev.some((x) => x.src === r.outPath)
        ? prev
        : [{ id: `ext_${Date.now()}`, src: r.outPath!, prompt: '', duration: 8 }, ...prev],
    )
    setView('extend')
    flash('Đã chuyển video sang tab Kéo dài')
  }

  const runExtend = async (it: ExtendItem) => {
    if (!it.prompt.trim()) {
      flash('Nhập prompt cho đoạn kéo dài')
      return
    }
    try {
      await api('/api/vids/start', {
        prompts: [it.prompt.trim()],
        extend_from: it.src,
        aspect,
        resolution,
        duration: it.duration,
        parallel,
        out_dir: savePath,
        doc_id: docId,
        project: active?.name || 'du_an',
      })
      flash(nguonMap[it.src]?.co ? 'Đã gửi lệnh Kéo dài gốc của Vids' : 'Đã gửi lệnh kéo dài (khung cuối làm ảnh tham chiếu)')
    } catch (e) {
      flash(`Không gửi được: ${(e as Error).message}`)
    }
  }

  const openFolder = () => {
    api('/api/open-folder', { path: savePath, tab: 'Vids', project: active?.name || '' }).catch((e) =>
      flash(`Không mở được thư mục: ${(e as Error).message}`),
    )
  }

  const loadTxt = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = cleanPromptFile(String(reader.result || ''))
      setPromptText((prev) => (prev.trim() ? prev.trimEnd() + '\n\n' + text : text))
      setCollapsed(false)
      flash(`Đã nạp ${file.name} · ${splitPrompts(text, false).length} prompt`)
    }
    reader.readAsText(file)
  }

  const addRef = async (file: File) => {
    try {
      const data = await readAsDataUrl(file)
      const r = await api<{ path: string; name: string; tag: string }>('/api/refs/upload', {
        name: file.name,
        data,
      })
      setRefs((prev) => [
        ...prev.filter((x) => x.path !== r.path),
        { id: ++nextId.current, name: r.name, tag: r.tag, path: r.path },
      ])
      flash(`Đã thêm ${r.tag}`)
    } catch (e) {
      flash(`Không gửi được ảnh ${file.name}: ${(e as Error).message}`)
    }
  }

  const runPrompts = async () => {
    const items = parsePrompts(promptText)
    if (!items.length) {
      flash('Chưa có prompt')
      return
    }
    if (bridgeOk === false) {
      flash('Cầu nối Python chưa chạy — tắt và chạy lại npm run dev')
      return
    }
    try {
      await api('/api/vids/start', {
        prompts: items,
        aspect,
        resolution,
        duration,
        parallel,
        out_dir: savePath,
        doc_id: docId,
        project: active?.name || 'du_an',
        refs: refs.map((r) => ({ tag: r.tag, path: r.path })),
      })
      setQueueTab('all')
      flash(`Đã gửi ${items.length} prompt`)
    } catch (e) {
      flash(`Không gửi được: ${(e as Error).message}`)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        runPrompts()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** Lưu prompt đã sửa; again=true → chạy lại (dòng lỗi/chờ) hoặc tạo video mới (dòng đã xong). */
  const saveEdit = async (again: boolean) => {
    if (!editRow) return
    const text = editRow.text.trim()
    if (!text) {
      flash('Prompt trống')
      return
    }
    try {
      if (again && editRow.status === 'xong') {
        await api('/api/vids/start', {
          prompts: [text],
          aspect,
          resolution,
          duration,
          parallel,
          out_dir: savePath,
          doc_id: docId,
          project: active?.name || 'du_an',
          refs: refs.map((r) => ({ tag: r.tag, path: r.path })),
        })
        flash('Đã tạo video mới với prompt đã sửa (video cũ giữ nguyên)')
      } else {
        await api('/api/vids/edit', { id: editRow.id, prompt: text })
        if (again) await api('/api/vids/retry', { ids: [editRow.id] })
        flash(again ? 'Đã lưu và chạy lại' : 'Đã lưu prompt')
      }
      setEditRow(null)
    } catch (e) {
      flash(`Không lưu được: ${(e as Error).message}`)
    }
  }

  const retryIds = async (ids: string[], label: string) => {
    if (!ids.length) {
      flash('Không có dòng nào để chạy lại')
      return
    }
    try {
      const r = await api<{ n: number }>('/api/vids/retry', { ids })
      flash(`${label}: ${r.n} prompt`)
    } catch (e) {
      flash(`Lỗi: ${(e as Error).message}`)
    }
  }

  const retryErrors = () =>
    retryIds(
      rows.filter((r) => r.status === 'loi' || r.status === 'tu_choi').map((r) => r.id),
      'Tạo lại lỗi',
    )

  const retryPending = () =>
    retryIds(
      rows.filter((r) => r.status !== 'xong' && r.status !== 'dang_chay').map((r) => r.id),
      'Tạo lại chưa tạo',
    )

  const stopAll = () => {
    api('/api/vids/stop', {})
      .then(() => flash('Đã dừng — cảnh đang chạy sẽ xong nốt'))
      .catch(() => {})
  }

  const deleteRows = (ids?: string[]) => {
    api('/api/vids/delete', { ids: ids || null }).catch(() => {})
    setSelected([])
  }

  const clearAll = () => {
    deleteRows()
    flash('Đã xoá các dòng không chạy')
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const selectAllFiltered = () => {
    const ids = filteredRows.map((r) => r.id)
    const allOn = ids.every((id) => selected.includes(id))
    setSelected(allOn ? selected.filter((id) => !ids.includes(id)) : [
      ...new Set([...selected, ...ids]),
    ])
  }

  const fileUrl = (p: string) => `/api/file?path=${encodeURIComponent(p)}`
  const upscale = (p: string) =>
    api('/api/util/upscale', { path: p, scale: 2 })
      .then(() => flash('Đang upscale x2 — file *_x2.mp4 cạnh video gốc'))
      .catch((e) => flash(`Không upscale được: ${(e as Error).message}`))
  const dangChay = rows.some((r) => r.status === 'dang_chay' || r.status === 'cho')

  return (
    <div className="vids-root">
      {!sideCollapsed && (
        <aside className="vids-side">
          <div className="vids-brand">
            <span className="st-brand-ico"><Ico n="wand" size={16} /></span>
            <div>
              <div className="vids-brand-title">Vids</div>
              <div className="vids-brand-sub">Video Studio</div>
            </div>
            <button
              type="button"
              className="vids-icon-btn"
              title="Thu gọn"
              onClick={() => setSideCollapsed(true)}
            >
              ‹
            </button>
          </div>
          <div className="vids-proj-head">
            <span>DỰ ÁN ({projects.length})</span>
            <button
              type="button"
              className="vids-plus"
              title="Tạo dự án"
              onClick={() => setShowCreate(true)}
            >
              +
            </button>
          </div>
          <div className="vids-proj-list">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`vids-proj ${p.id === activeId ? 'on' : ''}`}
                onClick={() => setActiveId(p.id)}
              >
                <span className="vids-proj-ico">
                  <Ico n={p.kind === 'video' ? 'video' : 'image'} size={15} />
                </span>
                <span className="vids-proj-name">{p.name}</span>
              </button>
            ))}
          </div>
        </aside>
      )}

      <div className="vids-main">
        <div className="vids-topbar">
          {sideCollapsed && (
            <button
              type="button"
              className="vids-icon-btn"
              onClick={() => setSideCollapsed(false)}
              title="Mở sidebar"
            >
              ›
            </button>
          )}
          <div className="vids-proj-title">
            <span className="st-title-ico"><Ico n="video" size={17} /></span>
            <strong>{active?.name || '—'}</strong>
          </div>
          <div className="st-viewswitch">
            <button type="button" className={view === 'create' ? 'on' : ''} onClick={() => setView('create')}>
              <Ico n="video" size={13} /> Tạo video
            </button>
            <button type="button" className={view === 'extend' ? 'on' : ''} onClick={() => setView('extend')}>
              <Ico n="extend" size={14} /> Kéo dài{extendList.length ? ` (${extendList.length})` : ''}
            </button>
          </div>
          <div className="st-save" title={savePath || 'Mặc định: Videos\\PB_MEDIA\\Vids\\<dự án>'}>
            <button type="button" className="st-save-main" onClick={pickPath}>
              <Ico n="folder" size={14} />
              <span className="st-dim">Lưu vào</span>
              <b>{savePath ? savePath.split(/[\\/]/).filter(Boolean).slice(-2).join('/') : 'Mặc định'}</b>
            </button>
            <button type="button" className="st-save-ico" title="Mở thư mục lưu" onClick={openFolder}>
              <Ico n="folderopen" size={14} />
            </button>
            <button type="button" className="st-save-ico" title="Dùng thư mục mặc định" onClick={() => setSavePath('')}>
              <Ico n="x" size={14} />
            </button>
          </div>
          <div className="vids-progress" title={account || ''}>
            <span
              className="vids-progress-dot"
              style={{ background: bridgeOk === false ? '#f87171' : undefined }}
            />
            {bridgeOk === false
              ? 'Cầu nối Python chưa chạy'
              : `${counts.done}/${counts.all} hoàn thành${account ? ' · ' + account : ''}`}
          </div>
          <button
            type="button"
            className="vids-bell"
            title="Nhật ký hoạt động"
            onClick={() => setShowLog((v) => !v)}
          >
            <Ico n="terminal" size={16} />
            {logErrCount > 0 && <span className="vids-bell-badge">{logErrCount}</span>}
          </button>
          <button
            type="button"
            className={`vids-bell${showCfg ? ' on' : ''}`}
            title="Cấu hình: số prompt song song, Google Doc ID"
            onClick={() => setShowCfg((v) => !v)}
          >
            <Ico n="sliders" size={16} />
          </button>
        </div>

        {view === 'extend' && (
          <section className="st-extend">
            <div className="st-extend-head">
              <div>
                <strong>Kéo dài video</strong>
                <span className="st-dim">
                  {' '}
                  — video tạo bằng tab Vids dùng lệnh Kéo dài gốc của Vids (cùng tài khoản); video khác dùng khung cuối làm ảnh tham chiếu. Kết quả lưu thành một file
                  «_keo_dai.mp4».
                </span>
              </div>
              {extendList.length > 0 && (
                <div className="st-extend-actions">
                  <button type="button" className="st-btn ok" onClick={() => void addPcVideos()}>
                    <Ico n="upload" size={13} /> Thêm video từ máy
                  </button>
                  <button type="button" className="st-btn" onClick={() => setExtendList([])}>
                    <Ico n="trash" size={13} /> Xoá danh sách
                  </button>
                </div>
              )}
            </div>
            {extendList.length === 0 ? (
              <div className="st-extend-empty">
                Chưa có video nào. Bấm <b>Thêm video từ máy</b> để chọn video có sẵn trên PC, hoặc ở tab
                «Tạo video» bấm nút <Ico n="extend" size={13} /> trên dòng video đã xong để chuyển sang đây.
                <div>
                  <button type="button" className="st-btn ok st-extend-add" onClick={() => void addPcVideos()}>
                    <Ico n="upload" size={14} /> Thêm video từ máy
                  </button>
                </div>
              </div>
            ) : (
              extendList.map((it) => {
                const jobs = rows.filter((r) => r.extendFrom === it.src)
                const last = jobs[0]
                return (
                  <div key={it.id} className="st-extend-card">
                    <video className="st-extend-src" src={fileUrl(it.src)} controls preload="metadata" />
                    <div className="st-extend-body">
                      <div className="st-extend-name" title={it.src}>
                        <Ico n="video" size={13} /> {it.src.split(/[\\/]/).pop()}
                        {nguonMap[it.src] && (
                          <span
                            className={`st-ext-mode ${nguonMap[it.src].co ? 'goc' : ''}`}
                            title={nguonMap[it.src].co ? `Tạo bởi ${nguonMap[it.src].email || 'tài khoản Vids'}` : 'Không có mã video Vids'}
                          >
                            {nguonMap[it.src].co ? 'Extend gốc Vids' : 'Khung cuối'}
                          </span>
                        )}
                        <button type="button" className="st-icon" title="Mở thư mục" onClick={() => openFileFolder(it.src)}>
                          <Ico n="folderopen" size={14} />
                        </button>
                        <button
                          type="button"
                          className="st-icon red"
                          title="Bỏ khỏi danh sách"
                          onClick={() => setExtendList((prev) => prev.filter((x) => x.id !== it.id))}
                        >
                          <Ico n="trash" size={14} />
                        </button>
                      </div>
                      <textarea
                        className="vids-textarea st-extend-prompt"
                        rows={3}
                        value={it.prompt}
                        onChange={(e) =>
                          setExtendList((prev) => prev.map((x) => (x.id === it.id ? { ...x, prompt: e.target.value } : x)))
                        }
                        placeholder="Prompt cho đoạn tiếp theo — ví dụ: nhân vật quay lại nhìn máy, camera lùi chậm…"
                      />
                      <div className="st-extend-row">
                        <div className="vids-parallel-mini" title="Thời lượng đoạn kéo dài">
                          <Ico n="clock" size={13} />
                          <select
                            value={it.duration}
                            onChange={(e) =>
                              setExtendList((prev) =>
                                prev.map((x) => (x.id === it.id ? { ...x, duration: Number(e.target.value) } : x)),
                              )
                            }
                          >
                            {[4, 5, 6, 7, 8, 9, 10].map((n) => (
                              <option key={n} value={n}>
                                {n}s
                              </option>
                            ))}
                          </select>
                        </div>
                        {last && (
                          <span className={`vids-status ${last.status === 'tu_choi' ? 'loi' : last.status}`}>
                            <Ico
                              n={last.status === 'xong' ? 'checkcircle' : last.status === 'loi' || last.status === 'tu_choi' ? 'xcircle' : 'spin'}
                              size={12}
                              className={last.status === 'dang_chay' ? 'st-spin' : ''}
                            />
                            {last.status === 'xong' ? 'Đã kéo dài' : last.status === 'dang_chay' ? last.buoc || 'Đang chạy' : last.status === 'cho' ? 'Chờ' : 'Lỗi'}
                          </span>
                        )}
                        <span className="grow" />
                        <button
                          type="button"
                          className="vids-run"
                          disabled={!it.prompt.trim() || last?.status === 'dang_chay' || last?.status === 'cho'}
                          onClick={() => void runExtend(it)}
                        >
                          <Ico n="play" size={13} /> Kéo dài
                        </button>
                      </div>
                      {last?.status === 'loi' && last.error && <div className="st-err-line"><Ico n="xcircle" size={12} /> <span>{last.error}</span></div>}
                      {last?.status === 'xong' && last.outPath && (
                        <div className="st-extend-out">
                          <video src={fileUrl(last.outPath)} controls preload="metadata" />
                          <div className="st-file" title={last.outPath}>
                            <Ico n="folder" size={11} /> {last.outPath.split(/[\\/]/).pop()}
                            <button type="button" className="st-icon" title="Mở thư mục" onClick={() => openFileFolder(last.outPath!)}>
                              <Ico n="folderopen" size={14} />
                            </button>
                            <button
                              type="button"
                              className="st-icon"
                              title="Kéo dài tiếp video này"
                              onClick={() => sendToExtend(last)}
                            >
                              <Ico n="extend" size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </section>
        )}

        {view === 'create' && (
        <>
        {showCfg && (
        <div className="vids-cfg">
          <div className="vids-cfg-item">
            <label>
              <Ico n="spin" size={12} /> SỐ PROMPT SONG SONG
            </label>
            <div className="vids-parallel-wrap">
              <button
                type="button"
                className="vids-select"
                onClick={() => setShowParallelMenu((v) => !v)}
              >
                <Ico n="spin" size={13} /> {parallel} luồng <span className="st-caret">▾</span>
              </button>
              {showParallelMenu && (
                <div className="vids-menu">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`vids-menu-item ${parallel === n ? 'on' : ''}`}
                      onClick={() => {
                        setParallel(n)
                        setShowParallelMenu(false)
                      }}
                    >
                      {n} {parallel === n && <span className="vids-check">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="vids-cfg-item grow">
            <label>
              GOOGLE DOC ID <span className="st-dim">— Bỏ trống nếu dùng mặc định</span>
            </label>
            <input
              className="vids-input"
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
              placeholder="Google Doc ID"
            />
          </div>
        </div>
        )}

        {!collapsed && (
          <section className="vids-prompt-card">
            <div className="vids-prompt-head">
              <span className="vids-chip"><Ico n="video" size={14} /> Video {aspect}</span>
              <div className="vids-prompt-actions">
                <button
                  type="button"
                  className="vids-ghost"
                  onClick={() => fileRef.current?.click()}
                >
                  <Ico n="file" size={13} /> Nạp TXT
                </button>
                <OnePromptCheck on={onePrompt} setOn={setOnePrompt} />
                <span className="vids-ghost muted st-count">{promptCount} prompt</span>
                <button
                  type="button"
                  className="vids-ghost"
                  onClick={() => setCollapsed(true)}
                >
                  <Ico n="arrowup" size={12} /> Thu gọn
                </button>
              </div>
            </div>
            <div className="st-compose">
            <textarea
              className="vids-textarea"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const f = e.dataTransfer.files?.[0]
                if (f) {
                  e.preventDefault()
                  loadTxt(f)
                }
              }}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder={PROMPT_PLACEHOLDER}
              rows={7}
            />
            <div className="vids-ref-row">
              <button
                type="button"
                className="vids-ref-btn"
                onClick={() => imgRef.current?.click()}
              >
                <Ico n="upload" size={14} /> + Tải ảnh tham chiếu
              </button>
              <span className="vids-muted">
                Tải ảnh lên rồi gõ <code className="st-at">@Tên</code> trong prompt để AI tham chiếu nhân vật/bối cảnh.
              </span>
            </div>
            </div>
            {refs.length > 0 && (
              <div className="vids-ref-list">
                {refs.map((r) => (
                  <span key={r.id} className="vids-ref-tag">
                    {r.tag}
                    <button
                      type="button"
                      onClick={() => setRefs((prev) => prev.filter((x) => x.id !== r.id))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="vids-run-row">
              <div className="vids-aspect">
                <button
                  type="button"
                  className={aspect === '16:9' ? 'on' : ''}
                  onClick={() => setAspect('16:9')}
                >
                  16:9 Ngang
                </button>
                <button
                  type="button"
                  className={aspect === '9:16' ? 'on' : ''}
                  onClick={() => setAspect('9:16')}
                >
                  9:16 Dọc
                </button>
              </div>
              <div className="vids-parallel-mini" title="Số prompt song song">
                <Ico n="spin" size={13} />
                <select
                  value={parallel}
                  onChange={(e) => setParallel(Number(e.target.value))}
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="vids-parallel-mini" title="Thời lượng mỗi video">
                <Ico n="clock" size={13} />
                <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  {[4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}s
                    </option>
                  ))}
                </select>
              </div>
              <div className="vids-parallel-mini" title="Độ phân giải">
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as '720p' | '1080p')}
                >
                  <option value="1080p">1080p</option>
                  <option value="720p">720p</option>
                </select>
              </div>
              {dangChay && (
                <button type="button" className="vids-ghost" onClick={stopAll}>
                  ⏹ Dừng
                </button>
              )}
              <button
                type="button"
                className="vids-run"
                onClick={runPrompts}
                disabled={!promptCount}
              >
                <Ico n="play" size={13} /> Chạy prompt <span className="st-kbd">(ctrl+↵)</span>
              </button>
            </div>
          </section>
        )}
        {collapsed && (
          <button
            type="button"
            className="vids-expand-prompt"
            onClick={() => setCollapsed(false)}
          >
            Mở khung prompt ▾ · {promptCount} prompt · Video {aspect}
          </button>
        )}

        <section className="vids-queue">
          <div className="vids-queue-head">
            <div className="vids-tabs">
              <button
                type="button"
                className={queueTab === 'all' ? 'on' : ''}
                onClick={() => setQueueTab('all')}
              >
                Tất cả ({counts.all})
              </button>
              <button
                type="button"
                className={queueTab === 'done' ? 'on' : ''}
                onClick={() => setQueueTab('done')}
              >
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
            <div className="vids-queue-tools">
              <div className="st-search">
                <Ico n="search" size={14} />
                <input
                  className="vids-search"
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
                {(
                  [
                    [4, 'grid', 'Lưới 4 video mỗi hàng'],
                    [6, 'grid6', 'Lưới 6 video mỗi hàng'],
                    [8, 'grid8', 'Lưới 8 video mỗi hàng'],
                  ] as const
                ).map(([n, ico, tip]) => (
                  <button
                    key={n}
                    type="button"
                    className={gridView && gridCols === n ? 'on' : ''}
                    title={tip}
                    onClick={() => {
                      setGridView(true)
                      setGridCols(n)
                    }}
                  >
                    <Ico n={ico} size={16} className="st-gridico" />
                  </button>
                ))}
              </div>
              {gridView ? null : (
                <label className="st-size" title="Chỉnh to / nhỏ video kết quả">
                  <Ico n="image" size={12} />
                  <input
                    type="range"
                    min={44}
                    max={240}
                    step={4}
                    value={thumbW}
                    onChange={(e) => setThumbW(Number(e.target.value))}
                  />
                  <Ico n="image" size={16} />
                </label>
              )}
              <button
                type="button"
                className="st-btn ok"
                onClick={() => void downloadFiles(rows.filter((r) => r.status === 'xong' && r.outPath).map((r) => r.outPath!))}
              >
                <Ico n="download" size={13} /> Tải tất cả ({counts.done})
              </button>
              <button type="button" className="st-btn warn" onClick={retryErrors}>
                <Ico n="refresh" size={13} /> Tạo lại lỗi ({counts.err})
              </button>
              <button type="button" className="st-btn info" onClick={retryPending}>
                <Ico n="refresh" size={13} /> Tạo lại tất cả chưa tạo ({counts.all - counts.done})
              </button>
              <button type="button" className="st-btn" onClick={clearAll}>
                <Ico n="trash" size={13} /> Xoá toàn bộ
              </button>
            </div>
          </div>

          <div className="vids-table-wrap">
            <table
              className={`vids-table${gridView ? ' st-grid' : ''}`}
              style={{ '--st-thumb-w': `${thumbW}px`, '--st-cols': gridCols } as CSSProperties}
            >
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={
                        filteredRows.length > 0 &&
                        filteredRows.every((r) => selected.includes(r.id))
                      }
                      onChange={selectAllFiltered}
                    />
                  </th>
                  <th style={{ width: 44 }}>
                    # <Ico n={sortDesc ? 'arrowdown' : 'arrowup'} size={11} />
                  </th>
                  <th className="st-media-th">MEDIA</th>
                  <th>PROMPT</th>
                  <th style={{ width: 72 }}>LOẠI</th>
                  <th style={{ width: 88 }}>THỜI GIAN</th>
                  <th style={{ width: 110 }}>TRẠNG THÁI</th>
                  <th className="st-ops-th">THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="vids-empty">
                      Chưa có mục trong hàng đợi
                    </td>
                  </tr>
                )}
                {filteredRows.map((r, idx) => (
                  <tr key={r.id} className={r.status === 'loi' || r.status === 'tu_choi' ? 'is-err' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(r.id)}
                        onChange={() => toggleSelect(r.id)}
                      />
                    </td>
                    <td className="vids-num">
                      {/^\s*(\d{1,4})\s*[.)\-:]/.exec(r.prompt)?.[1]?.padStart(3, '0') ?? String(r.stt || idx + 1).padStart(2, '0')}
                    </td>
                    <td className="vids-media">
                      {r.status === 'loi' || r.status === 'tu_choi' ? (
                        <span className="vids-warn-tri" title="Lỗi">
                          <Ico n="alert" size={18} />
                        </span>
                      ) : r.status === 'xong' && r.outPath ? (
                        <a
                          className="vids-media-ok st-thumb"
                          href={fileUrl(r.outPath)}
                          target="_blank"
                          rel="noreferrer"
                          title={r.outPath}
                        >
                          <video src={`${fileUrl(r.outPath)}#t=1`} preload="metadata" muted />
                          <span className="st-play"><Ico n="play" size={12} /></span>
                        </a>
                      ) : (
                        <span className="vids-media-wait"><Ico n="spin" size={16} className={r.status === 'dang_chay' ? 'st-spin' : ''} /></span>
                      )}
                    </td>
                    <td className="vids-prompt-cell">
                      {r.extendFrom && (
                        <span className="st-ext-tag" title={r.extendFrom}>
                          <Ico n="extend" size={11} /> Kéo dài từ {r.extendFrom.split(/[\\/]/).pop()}
                        </span>
                      )}
                      <div className="vids-prompt-text">{r.prompt}</div>
                      {r.status === 'xong' && r.outPath && (
                        <div className="st-file" title={r.outPath}>
                          <Ico n="folder" size={11} /> {r.outPath.split(/[\\/]/).pop()}
                          {r.tk ? ` · ${r.tk}` : ''}
                        </div>
                      )}
                      {(r.status === 'loi' || r.status === 'tu_choi') && r.error && (
                        <div className="vids-err-box">
                          <div className="st-err-line">
                            <Ico n={/cookie|SESSION_COOKIE|401/i.test(r.error) ? 'key' : 'xcircle'} size={12} />
                            <span>{r.error}</span>
                          </div>
                          {/cookie|SESSION_COOKIE|401/i.test(r.error) && (
                            <button
                              type="button"
                              className="vids-cookie-link"
                              onClick={() => onOpenSettings?.()}
                            >
                              <Ico n="key" size={11} /> Đổi cookie trong Cài đặt
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="vids-type"><Ico n="video" size={11} /> {r.aspect}</span>
                    </td>
                    <td className="st-time">
                      <div>{r.when || '–'}</div>
                      <div className="st-dim">{r.duration}</div>
                    </td>
                    <td>
                      <span
                        className={`vids-status ${r.status === 'tu_choi' ? 'loi' : r.status}`}
                      >
                        <Ico
                          n={r.status === 'xong' ? 'checkcircle' : r.status === 'loi' || r.status === 'tu_choi' ? 'xcircle' : 'spin'}
                          size={12}
                          className={r.status === 'dang_chay' ? 'st-spin' : ''}
                        />
                        {r.status === 'loi'
                          ? 'Lỗi'
                          : r.status === 'tu_choi'
                            ? 'Bị từ chối'
                            : r.status === 'xong'
                              ? 'Xong'
                              : r.status === 'dang_chay'
                                ? r.buoc || 'Đang chạy'
                                : 'Chờ'}
                      </span>
                    </td>
                    <td className="vids-ops">
                      {r.status === 'xong' && r.outPath && (
                        <span className="st-ops-done">
                          <button type="button" title="Mở thư mục chứa video" onClick={() => openFileFolder(r.outPath!)}>
                            <Ico n="folderopen" size={16} />
                          </button>
                          <button type="button" title="Tải về — chép video sang thư mục khác" onClick={() => void downloadFiles([r.outPath!])}>
                            <Ico n="download" size={16} />
                          </button>
                          <button type="button" title="Upscale x2 (realesrgan)" onClick={() => void upscale(r.outPath!)}>
                            <Ico n="upload" size={16} />
                          </button>
                          <button type="button" className="st-op-extend" title="Kéo dài — chuyển sang tab Kéo dài" onClick={() => sendToExtend(r)}>
                            <Ico n="extend" size={16} />
                          </button>
                        </span>
                      )}
                      <button
                        type="button"
                        title="Chép prompt"
                        onClick={() => {
                          navigator.clipboard?.writeText(r.prompt).catch(() => {})
                          flash('Đã chép prompt')
                        }}
                      >
                        <Ico n="copy" size={16} />
                      </button>
                      <button
                        type="button"
                        title="Chạy lại"
                        disabled={r.status === 'dang_chay'}
                        onClick={() => retryIds([r.id], 'Chạy lại')}
                      >
                        <Ico n="refresh" size={16} />
                      </button>
                      <button
                        type="button"
                        title="Sửa prompt"
                        onClick={() => setEditRow({ id: r.id, status: r.status, text: r.prompt })}
                      >
                        <Ico n="pencil" size={16} />
                      </button>
                      <button
                        type="button"
                        title="Xoá"
                        disabled={r.status === 'dang_chay'}
                        onClick={() => deleteRows([r.id])}
                      >
                        <Ico n="trash" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        </>
        )}
      </div>

      {showLog && (
        <aside className="vids-log">
          <div className="vids-log-head">
            <div>
              <strong>NHẬT KÍ HOẠT ĐỘNG</strong>
              <span className="vids-muted">
                {' '}
                — {logs.length} dòng • {logErrCount} lỗi (mất khi đóng app)
              </span>
            </div>
            <div className="vids-log-actions">
              <button
                type="button"
                className="vids-ghost"
                onClick={() => {
                  setLogs([])
                  flash('Đã xoá nhật ký')
                }}
              >
                Xoá
              </button>
              <button
                type="button"
                className="vids-icon-btn"
                onClick={() => setShowLog(false)}
              >
                ×
              </button>
            </div>
          </div>
          <div className="vids-log-body">
            {logs.length === 0 && (
              <div className="vids-muted" style={{ padding: 12 }}>
                Chưa có dòng nhật ký
              </div>
            )}
            {logs.map((l) => (
              <div key={l.id} className={`vids-log-line ${l.level === 'LỖI' ? 'err' : ''}`}>
                <span className="vids-log-time">{l.time}</span>
                <span className={`vids-log-lvl ${l.level === 'LỖI' ? 'err' : ''}`}>
                  {l.level}
                </span>
                <span className="vids-log-tag">[{l.tag}]</span>
                <span className="vids-log-msg">{l.msg}</span>
              </div>
            ))}
          </div>
        </aside>
      )}

      {editRow && (
        <div className="vids-modal-backdrop" onClick={() => setEditRow(null)}>
          <div className="vids-modal st-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vids-modal-title">
              <Ico n="pencil" size={16} /> Sửa prompt
            </div>
            <textarea
              className="vids-textarea st-edit-text"
              value={editRow.text}
              onChange={(e) => setEditRow({ ...editRow, text: e.target.value })}
              autoFocus
            />
            <div className="vids-modal-foot">
              <button
                type="button"
                className="vids-ghost"
                onClick={() => {
                  navigator.clipboard?.writeText(editRow.text).catch(() => {})
                  flash('Đã chép prompt')
                }}
              >
                <Ico n="copy" size={13} /> Chép
              </button>
              <span className="grow" />
              <button type="button" className="vids-ghost" onClick={() => setEditRow(null)}>
                Huỷ
              </button>
              {editRow.status !== 'xong' && (
                <button type="button" className="vids-ghost" onClick={() => void saveEdit(false)}>
                  Lưu
                </button>
              )}
              <button type="button" className="vids-run" onClick={() => void saveEdit(true)}>
                {editRow.status === 'xong' ? 'Tạo video mới với prompt này' : 'Lưu & chạy lại'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="vids-modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="vids-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vids-modal-title">
              <span>📁</span> Tạo dự án mới
            </div>
            <label className="vids-field-label">Tên dự án</label>
            <input
              className="vids-input"
              placeholder="Ví dụ: Quảng cáo sản phẩm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') createProject()
              }}
            />
            <label className="vids-field-label" style={{ marginTop: 12 }}>
              Loại dự án
            </label>
            <div className="vids-kind-grid">
              <button
                type="button"
                className={`vids-kind ${newKind === 'video' ? 'on' : ''}`}
                onClick={() => setNewKind('video')}
              >
                <span className="vids-kind-ico">🎬</span>
                <strong>Video</strong>
                <span className="vids-muted">16:9 / 9:16</span>
                {newKind === 'video' && <span className="vids-kind-check">✓</span>}
              </button>
              <button
                type="button"
                className={`vids-kind ${newKind === 'nano' ? 'on' : ''}`}
                onClick={() => setNewKind('nano')}
              >
                <span className="vids-kind-ico">🖼️</span>
                <strong>Nano Banana</strong>
                <span className="vids-muted">Ảnh</span>
                {newKind === 'nano' && <span className="vids-kind-check">✓</span>}
              </button>
            </div>
            <div className="vids-modal-foot">
              <button type="button" className="vids-ghost" onClick={() => setShowCreate(false)}>
                Huỷ
              </button>
              <button type="button" className="vids-run" onClick={createProject}>
                Tạo dự án
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.json,.srt"
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
          if (files) Array.from(files).forEach(addRef)
          e.target.value = ''
        }}
      />

      {toast && <div className="vids-toast">{toast}</div>}
    </div>
  )
}
