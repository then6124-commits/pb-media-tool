import { ClearPromptBtn, PastePromptBtn, OnePromptCheck, cleanPromptFile, splitPrompts, useOnePrompt } from './OnePrompt'
import { useEffect, useMemo, useRef, useState } from 'react'
import './tao_anh.css'
import DrawEngineModal, {
  DEFAULT_DRAW_CONFIG,
  type DrawEngineConfig,
} from './DrawEngineModal'

/** Flow chỉ nhận 5 tỷ lệ này (image_gen.IMG_RATIO_MAP). */
type RatioId = '16:9' | '9:16' | '1:1' | '4:3' | '3:4'

/** Nhãn → mã Flow nằm ở cầu nối (pb_bridge.IMG_MODEL). */
type ModelId = 'Banana 2' | 'Banana 2 Lite' | 'Banana Pro'

type QueueItem = {
  id: number
  text: string
  model: ModelId
  ratio: RatioId
  status: 'wait' | 'error' | 'run'
  error?: string
}

/** Một cảnh do cầu nối báo về (FLOW.items). */
type ResultItem = {
  id: string
  scene: string
  text: string
  status: 'error' | 'done' | 'run'
  msg: string
  files: string[]
}

type BridgeItem = {
  scene: string
  prompt: string
  status: 'cho' | 'dang_chay' | 'xong' | 'loi'
  msg: string
  files: string[]
}

type RefImage = { id: number; name: string; tag: string; path: string }

const MODELS: ModelId[] = ['Banana 2', 'Banana 2 Lite', 'Banana Pro']

const RATIOS: { id: RatioId; label: string }[] = [
  { id: '16:9', label: 'Ngang 16:9' },
  { id: '9:16', label: 'Dọc 9:16' },
  { id: '1:1', label: 'Vuông 1:1' },
  { id: '4:3', label: 'Ngang 4:3' },
  { id: '3:4', label: 'Dọc 3:4' },
]

const LS_MODEL = 'pb.anh.model'
const LS_RATIO = 'pb.anh.ratio'
const LS_CROP = 'pb.anh.crop'
const LS_AUTO = 'pb.anh.autoDl'
const LS_DRAW = 'pb.anh.draw'
const LS_DRAW_CFG = 'pb.anh.drawCfg'
const LS_QUEUE = 'pb.anh.queue'
const LS_OUT = 'pb.anh.outDir.v2'
const LS_REFS = 'pb.anh.refs.v2'

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

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result || ''))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(file)
  })
}

function loadStr(key: string, fallback: string) {
  try {
    const v = localStorage.getItem(key)
    if (v != null && v !== '') return v
  } catch {
    /* ignore */
  }
  return fallback
}

function loadBool(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key)
    if (v === '1' || v === 'true') return true
    if (v === '0' || v === 'false') return false
  } catch {
    /* ignore */
  }
  return fallback
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

function saveJson(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val))
  } catch {
    /* ignore */
  }
}

function snippet(text: string, n = 48) {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= n ? one : one.slice(0, n - 1) + '…'
}

export default function TaoAnhWorkspace() {
  const [onePrompt, setOnePrompt] = useOnePrompt('taoanh')
  const [model, setModel] = useState<ModelId>(() => {
    const v = loadStr(LS_MODEL, 'Banana 2')
    return (MODELS.includes(v as ModelId) ? v : 'Banana 2') as ModelId
  })
  const [ratio, setRatio] = useState<RatioId>(() => {
    const v = loadStr(LS_RATIO, '16:9')
    return (RATIOS.some((r) => r.id === v) ? v : '16:9') as RatioId
  })
  const [modelOpen, setModelOpen] = useState(false)
  const [ratioOpen, setRatioOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [crop, setCrop] = useState(() => loadBool(LS_CROP, false))
  const [autoDl, setAutoDl] = useState(() => loadBool(LS_AUTO, false))
  const [draw, setDraw] = useState(() => loadBool(LS_DRAW, false))
  const [drawOpen, setDrawOpen] = useState(false)
  const [drawCfg, setDrawCfg] = useState<DrawEngineConfig>(() => {
    const saved = loadJson<Partial<DrawEngineConfig>>(LS_DRAW_CFG, {})
    return { ...DEFAULT_DRAW_CONFIG, ...saved }
  })
  const [refsOpen, setRefsOpen] = useState(false)
  const [refs, setRefs] = useState<RefImage[]>(() => loadJson(LS_REFS, [] as RefImage[]))
  const [outDir, setOutDir] = useState(() => loadStr(LS_OUT, ''))
  const [queueOpen, setQueueOpen] = useState(true)
  const [queue, setQueue] = useState<QueueItem[]>(() => loadJson(LS_QUEUE, [] as QueueItem[]))
  const [results, setResults] = useState<ResultItem[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyOther, setBusyOther] = useState('')
  const [acctHint, setAcctHint] = useState('Đang hỏi cầu nối…')
  const [lastLog, setLastLog] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const refFileRef = useRef<HTMLInputElement>(null)
  const nextQ = useRef(Math.max(0, ...queue.map((q) => q.id)) + 1)
  const nextRef = useRef(1)
  const logSince = useRef(0)

  const promptLines = useMemo(() => splitPrompts(prompt, onePrompt), [prompt, onePrompt])
  const waitCount = queue.filter((q) => q.status === 'wait').length
  const errCount = queue.filter((q) => q.status === 'error').length
  const refCount = refs.length
  const shown = results.filter((r) => !hidden.includes(r.id))

  useEffect(() => {
    try {
      localStorage.setItem(LS_MODEL, model)
      localStorage.setItem(LS_RATIO, ratio)
      localStorage.setItem(LS_CROP, crop ? '1' : '0')
      localStorage.setItem(LS_AUTO, autoDl ? '1' : '0')
      localStorage.setItem(LS_DRAW, draw ? '1' : '0')
      localStorage.setItem(LS_DRAW_CFG, JSON.stringify(drawCfg))
      localStorage.setItem(LS_OUT, outDir)
    } catch {
      /* ignore */
    }
  }, [model, ratio, crop, autoDl, draw, drawCfg, outDir])

  useEffect(() => {
    saveJson(LS_QUEUE, queue)
  }, [queue])

  useEffect(() => {
    saveJson(LS_REFS, refs)
  }, [refs])

  // ── Đồng bộ với cầu nối: kết quả thật + dòng log mới nhất ──
  useEffect(() => {
    let dead = false
    const tick = async () => {
      try {
        const [st, lg] = await Promise.all([
          api<{ running: boolean; busy: boolean; busy_kind: string; items: BridgeItem[] }>(
            '/api/flow/state?kind=anh',
          ),
          api<{ logs: { id: number; tag: string; msg: string }[] }>(`/api/logs?since=${logSince.current}`),
        ])
        if (dead) return
        setBusy(st.running)
        setBusyOther(st.busy && !st.running ? st.busy_kind : '')
        setResults(
          st.items.map((x) => ({
            id: `anh:${x.scene}`,
            scene: x.scene,
            text: x.prompt,
            status: x.status === 'xong' ? 'done' : x.status === 'loi' ? 'error' : 'run',
            msg: x.msg,
            files: x.files || [],
          })),
        )
        if (lg.logs.length) {
          logSince.current = lg.logs[lg.logs.length - 1].id
          const mine = lg.logs.filter((l) => l.tag === 'anh')
          if (mine.length) setLastLog(mine[mine.length - 1].msg)
        }
      } catch {
        if (!dead) setAcctHint('Cầu nối Python chưa chạy — tắt và chạy lại npm run dev')
      }
    }
    tick()
    const id = window.setInterval(tick, 1500)
    return () => {
      dead = true
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    api<{ accounts: { email: string; bat: boolean; cookie_ok: boolean; tier: string; credits: number }[] }>(
      '/api/accounts',
    )
      .then((r) => {
        const on = r.accounts.filter((a) => a.bat)
        const a = on[0] || r.accounts[0]
        setAcctHint(
          a
            ? `TK: ${a.email}${a.tier ? ' · ' + a.tier : ''}${a.credits != null ? ' · ' + a.credits + ' credit' : ''}${on.length > 1 ? ` (+${on.length - 1} TK xoay)` : ''}`
            : 'Sổ tài khoản trống — thêm tài khoản ở tool cũ',
        )
      })
      .catch(() => setAcctHint('Cầu nối Python chưa chạy — tắt và chạy lại npm run dev'))
  }, [])

  function flash(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2600)
  }

  function addToQueue() {
    const lines = splitPrompts(prompt, onePrompt)
    if (!lines.length) {
      flash('Nhập ít nhất 1 prompt (mỗi dòng một prompt)')
      return
    }
    const items: QueueItem[] = lines.map((text) => {
      const id = nextQ.current++
      return { id, text, model, ratio, status: 'wait' as const }
    })
    setQueue((prev) => [...prev, ...items])
    setPrompt('')
    flash(`Đã thêm ${items.length} prompt vào hàng đợi`)
  }

  function clearQueue() {
    if (!queue.length) return
    if (!window.confirm(`Xóa ${queue.length} mục trong hàng đợi?`)) return
    setQueue([])
  }

  function removeQueueItem(id: number) {
    setQueue((prev) => prev.filter((q) => q.id !== id))
  }

  async function startGen() {
    const pending = queue.filter((q) => q.status === 'wait' || q.status === 'error')
    if (!pending.length) {
      flash('Hàng đợi trống - thêm prompt trước')
      return
    }
    // Một mẻ = một model + một tỷ lệ (Flow gửi theo lô). Lấy theo dòng đầu.
    const m = pending[0].model
    const ra = pending[0].ratio
    const lo = pending.filter((q) => q.model === m && q.ratio === ra)
    // Học SuperVeo: «draw style» là mẫu prompt cho ẢNH đầu vào — ảnh nét sạch nền
    // trắng thì video vẽ tay mới đẹp (dò nét gọn, lộ màu đúng chỗ). Thêm vào CUỐI
    // prompt để không đụng số cảnh «001.» ở đầu dòng.
    const duoiStyle = draw
      ? ` — Style: ${drawCfg.styleName}. Clean hand-drawn illustration with clear dark outlines on a plain white background, simple flat colors, generous empty space, no text, no watermark, no hands, pens or drawing tools in the image.`
      : ''
    try {
      const r = await api<{ n: number; out_dir: string }>('/api/flow/start?kind=anh', {
        prompts: lo.map((q) => q.text + duoiStyle),
        model: m,
        ratio: ra,
        out_dir: outDir,
        refs: refs.map((x) => ({ tag: x.tag, path: x.path })),
      })
      setQueue((prev) => prev.filter((q) => !lo.some((p) => p.id === q.id)))
      setBusy(true)
      if (!outDir) setOutDir(r.out_dir)
      flash(
        `Đã gửi ${r.n} prompt · ${m} · ${ra}` +
          (lo.length < pending.length ? ` (còn ${pending.length - lo.length} dòng khác model/tỷ lệ — chạy mẻ sau)` : ''),
      )
    } catch (e) {
      flash(`Không chạy được: ${(e as Error).message}`)
    }
  }

  function stopGen() {
    api('/api/flow/stop', {})
      .then(() => flash('Đã bấm Dừng — cảnh đang chạy sẽ dừng ở bước kế'))
      .catch(() => {})
  }

  async function pickOutDir() {
    try {
      flash('Đang mở hộp chọn thư mục…')
      const r = await api<{ path: string }>('/api/pick-folder', { start: outDir })
      if (r.path) {
        setOutDir(r.path)
        flash('Đã chọn nơi lưu')
      }
    } catch (e) {
      flash(`Không mở được hộp chọn thư mục: ${(e as Error).message}`)
    }
  }

  function onLoadFile(file: File | null) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = cleanPromptFile(String(reader.result || ''))
      setPrompt((prev) => (prev.trim() ? prev.trimEnd() + '\n\n' + text : text))
      flash(`Đã tải ${file.name}`)
    }
    reader.readAsText(file)
  }

  async function addRefFiles(files: FileList | null) {
    if (!files?.length) return
    let n = 0
    for (const f of Array.from(files)) {
      try {
        const data = await readAsDataUrl(f)
        const r = await api<{ path: string; name: string; tag: string }>('/api/refs/upload', {
          name: f.name,
          data,
        })
        setRefs((prev) => [
          ...prev.filter((x) => x.path !== r.path),
          { id: nextRef.current++ + Date.now(), name: r.name, tag: r.tag, path: r.path },
        ])
        n++
      } catch (e) {
        flash(`Không gửi được ${f.name}: ${(e as Error).message}`)
      }
    }
    setRefsOpen(true)
    if (n) flash(`Đã thêm ${n} ảnh tham chiếu`)
  }

  function insertTag(tag: string) {
    setPrompt((prev) => (prev ? prev + (prev.endsWith(' ') || prev.endsWith('\n') ? '' : ' ') + tag : tag))
  }

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function deleteSelectedResults() {
    if (!selected.length) {
      flash('Chưa chọn kết quả')
      return
    }
    setHidden((prev) => [...prev, ...selected])
    setSelected([])
  }

  function clearResults() {
    if (!shown.length) return
    if (!window.confirm(`Ẩn ${shown.length} kết quả khỏi danh sách? (file ảnh vẫn giữ)`)) return
    api('/api/flow/clear', { kind: 'anh' }).catch(() => {})
    setHidden((prev) => [...prev, ...shown.filter((r) => r.status !== 'run').map((r) => r.id)])
    setSelected([])
  }

  function openOutDir() {
    if (!outDir) {
      flash('Chưa có nơi lưu — mặc định Videos\\PB_MEDIA\\Tao_anh')
      return
    }
    api('/api/open-folder', { path: outDir }).catch(() => flash('Không mở được thư mục'))
  }

  function upscaleAnh(path: string) {
    api('/api/util/upscale', { path, scale: 4 })
      .then(() => flash('Đang upscale x4 — file *_x4.png cạnh ảnh gốc'))
      .catch((e) => flash(`Không upscale được: ${(e as Error).message}`))
  }

  /** Video vẽ tay từ ảnh (scripts/draw_engine.py) theo cấu hình Draw đang chọn. */
  function veTay(path: string) {
    api('/api/draw', { path, cfg: drawCfg })
      .then(() => flash(`Đang dựng video vẽ tay (${drawCfg.drawSec}s) — file *_draw.mp4 cạnh ảnh`))
      .catch((e) => flash(`Không dựng được: ${(e as Error).message}`))
  }

  // Ô «🎨 Draw» bật: ảnh vừa xong thì tự dựng video vẽ tay (một lần mỗi file).
  const daVe = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!draw) return
    for (const r of results) {
      const f = r.files[0]
      if (r.status === 'done' && f && !daVe.current.has(f)) {
        daVe.current.add(f)
        veTay(f)
      }
    }
  }, [results, draw]) // eslint-disable-line react-hooks/exhaustive-deps

  const ratioLabel = RATIOS.find((r) => r.id === ratio)?.label || ratio

  return (
    <div className="ta-root">
      <div className={`ta-layout ${queueOpen ? '' : 'queue-collapsed'}`}>
        {/* LEFT — prompt */}
        <aside className="ta-col ta-left">
          <div className="ta-toolbar">
            <button
              type="button"
              className="ta-btn ghost teal"
              onClick={() => fileRef.current?.click()}
              title="Tải tệp prompt"
            >
              📄 Tải tệp
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.csv,.prompt"
              hidden
              onChange={(e) => {
                onLoadFile(e.target.files?.[0] || null)
                e.target.value = ''
              }}
            />
            <div className="ta-toolbar-right">
              <div className="ta-dd">
                <button
                  type="button"
                  className="ta-dd-btn"
                  onClick={() => {
                    setModelOpen((v) => !v)
                    setRatioOpen(false)
                  }}
                >
                  {model} <span className="ta-caret">▾</span>
                </button>
                {modelOpen && (
                  <div className="ta-dd-menu">
                    {MODELS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={m === model ? 'on' : ''}
                        onClick={() => {
                          setModel(m)
                          setModelOpen(false)
                        }}
                      >
                        {m === model && <span className="ta-dd-tick">✓</span>}
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="ta-dd">
                <button
                  type="button"
                  className="ta-dd-btn"
                  onClick={() => {
                    setRatioOpen((v) => !v)
                    setModelOpen(false)
                  }}
                >
                  {ratioLabel} <span className="ta-caret">▾</span>
                </button>
                {ratioOpen && (
                  <div className="ta-dd-menu">
                    {RATIOS.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={r.id === ratio ? 'on' : ''}
                        onClick={() => {
                          setRatio(r.id)
                          setRatioOpen(false)
                        }}
                      >
                        {r.id === ratio && <span className="ta-dd-tick">✓</span>}
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="ta-prompt-wrap">
            <span className="ta-prompt-count" title="Số dòng prompt">
              {promptLines.length} prompts
            </span>
            <span className="prompt-tools">
              <PastePromptBtn value={prompt} setValue={setPrompt} />
              <ClearPromptBtn value={prompt} setValue={setPrompt} />
              <OnePromptCheck on={onePrompt} setOn={setOnePrompt} />
            </span>
            <textarea
              className="ta-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder=""
              spellCheck={false}
            />
            {!prompt && (
              <div className="ta-prompt-hint" aria-hidden>
                <div className="ta-hint-title">Nhập prompt để tạo ảnh...</div>
                <div className="ta-hint-ex">Ví dụ:</div>
                <div className="ta-hint-bullet">• Mỗi dòng một prompt:</div>
                <div className="ta-hint-code">A cat playing in the garden</div>
                <div className="ta-hint-code">A dog running on the beach</div>
                <div className="ta-hint-bullet">• Dùng @tag để chèn ảnh tham chiếu:</div>
                <div className="ta-hint-code">Cô gái mặc @ao đang đi trên phố</div>
                <div className="ta-hint-code">@nguoimay mặc @quanjean ngồi uống cafe</div>
              </div>
            )}
          </div>

          <div className="ta-opts">
            <button
              type="button"
              className="ta-btn ghost sm"
              title={outDir || 'Mặc định: Videos\\PB_MEDIA\\Tao_anh'}
              onClick={() => void pickOutDir()}
            >
              📁 {outDir ? outDir.split(/[\\/]/).filter(Boolean).pop() : 'Nơi lưu'}
            </button>
            <div className="ta-opts-right">
              <label className="ta-opt">
                <input type="checkbox" checked={crop} onChange={(e) => setCrop(e.target.checked)} />
                <span>Crop</span>
              </label>
              <label className="ta-opt">
                <input type="checkbox" checked={autoDl} onChange={(e) => setAutoDl(e.target.checked)} />
                <span>Tự tải</span>
              </label>
              <label className="ta-opt">
                <input type="checkbox" checked={draw} onChange={(e) => setDraw(e.target.checked)} />
                <span>🎨 Draw</span>
              </label>
              <button
                type="button"
                className="ta-icon-btn"
                title="Tuỳ chọn Draw"
                onClick={() => {
                  if (!draw) setDraw(true)
                  setDrawOpen(true)
                }}
              >
                ⚙
              </button>
            </div>
          </div>

          <div className={`ta-refs ${refsOpen ? 'open' : ''}`}>
            <button type="button" className="ta-refs-toggle" onClick={() => setRefsOpen((v) => !v)}>
              {refsOpen ? '▾' : '▸'} Ảnh tham chiếu (tuỳ chọn)
              {refs.length > 0 && <span className="ta-badge">{refs.length}</span>}
            </button>
            {refsOpen && (
              <div className="ta-refs-body">
                <div className="ta-refs-actions">
                  <button type="button" className="ta-btn ghost sm" onClick={() => refFileRef.current?.click()}>
                    + Thêm ảnh
                  </button>
                  <input
                    ref={refFileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      void addRefFiles(e.target.files)
                      e.target.value = ''
                    }}
                  />
                  {refs.length > 0 && (
                    <button type="button" className="ta-text danger" onClick={() => setRefs([])}>
                      Xóa hết
                    </button>
                  )}
                </div>
                {refs.length === 0 ? (
                  <p className="ta-muted">Chưa có ảnh — thêm rồi dùng @tag trong prompt.</p>
                ) : (
                  <ul className="ta-ref-list">
                    {refs.map((r) => (
                      <li key={r.id}>
                        <button type="button" className="ta-tag" onClick={() => insertTag(r.tag)} title="Chèn vào prompt">
                          {r.tag}
                        </button>
                        <span className="ta-ref-name">{r.name}</span>
                        <button
                          type="button"
                          className="ta-x"
                          onClick={() => setRefs((prev) => prev.filter((x) => x.id !== r.id))}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <button type="button" className="ta-primary" onClick={addToQueue}>
            + Thêm vào hàng đợi ({promptLines.length} prompts)
          </button>
        </aside>

        {/* MIDDLE rail / queue */}
        <div className="ta-rail">
          <button
            type="button"
            className="ta-rail-btn"
            title={queueOpen ? 'Thu gọn hàng đợi' : 'Mở hàng đợi'}
            onClick={() => setQueueOpen((v) => !v)}
          >
            {queueOpen ? '‹' : '›'}
          </button>
          <span className="ta-rail-badge">{queue.length}</span>
        </div>

        {queueOpen && (
          <section className="ta-col ta-mid">
            <div className="ta-mid-head">
              <div className="ta-mid-stats">
                <span className="ta-stat wait">{waitCount} chờ</span>
                {errCount > 0 && <span className="ta-stat err">{errCount} ✕</span>}
              </div>
              <div className="ta-mid-actions">
                <button type="button" className="ta-icon-btn" title="Xóa hàng đợi" onClick={clearQueue}>
                  🗑
                </button>
                <span className="ta-round">{queue.length}</span>
              </div>
            </div>

            <div className="ta-queue-body">
              {queue.length === 0 ? (
                <div className="ta-empty">Chưa có prompt trong hàng đợi.</div>
              ) : (
                <ul className="ta-queue-list">
                  {queue.map((q, idx) => (
                    <li key={q.id} className={`ta-q-item st-${q.status}`}>
                      <div className="ta-q-top">
                        <span className="ta-q-num">#{idx + 1}</span>
                        <span className="ta-q-meta">
                          {q.model} · {q.ratio}
                        </span>
                        <button type="button" className="ta-x" onClick={() => removeQueueItem(q.id)}>
                          ×
                        </button>
                      </div>
                      {q.error && <div className="ta-q-err">{q.error}</div>}
                      <div className="ta-q-text">{q.text}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="ta-acct-hint" title="Tài khoản Flow đang tick trong tool cũ">{acctHint}</div>
            <div className="ta-real-status" title="Dòng log mới nhất của mẻ ảnh">
              {busyOther
                ? `Đang chạy mẻ ${busyOther === 'veo3' ? 'Veo3' : busyOther} — chờ xong mới chạy được ảnh`
                : lastLog || 'Sẵn sàng'}
            </div>
            {busy ? (
              <button type="button" className="ta-primary alt" onClick={stopGen}>
                <div>⏹ Dừng mẻ</div>
                <div className="ta-primary-sub">
                  {results.filter((r) => r.status === 'run').length} cảnh đang chạy
                </div>
              </button>
            ) : (
              <button
                type="button"
                className="ta-primary alt"
                disabled={!!busyOther}
                onClick={() => void startGen()}
              >
                <div>Bắt đầu gen</div>
                <div className="ta-primary-sub">
                  {queue.length} prompt · {refCount} ảnh tham chiếu
                </div>
              </button>
            )}

          </section>
        )}

        {/* RIGHT — results */}
        <section className="ta-col ta-right">
          <div className="ta-right-head">
            <div className="ta-result-title">
              Kết quả <span className="ta-round">{shown.length}</span>
            </div>
            <div className="ta-toolbar-icons">
              <button
                type="button"
                title="Hiện lại kết quả đã ẩn"
                onClick={() => setHidden([])}
              >
                ↻
              </button>
              <button
                type="button"
                title="Chọn tất cả"
                onClick={() => setSelected(shown.map((r) => r.id))}
              >
                ▢
              </button>
              <button type="button" title="Ẩn đã chọn" onClick={deleteSelectedResults}>
                🗑
              </button>
              <button type="button" title="Mở thư mục lưu ảnh" onClick={openOutDir}>
                ⬇
              </button>
              <button type="button" className="danger" title="Ẩn hết (file vẫn giữ)" onClick={clearResults}>
                ✕
              </button>
              <span className="ta-round sm">{shown.length}</span>
            </div>
          </div>

          <div className="ta-results-body">
            {shown.length === 0 ? (
              <div className="ta-empty-results">
                <div className="ta-empty-ico">🖼</div>
                <h3>Chưa có kết quả</h3>
                <p>Thêm prompt → Bắt đầu gen. Tool dùng tài khoản Flow đang tick, tự đúc reCAPTCHA và lưu ảnh vào thư mục đã chọn.</p>
              </div>
            ) : (
              <div className="ta-grid">
                {shown.map((r, idx) => (
                  <article
                    key={r.id}
                    className={`ta-card st-${r.status} ${selected.includes(r.id) ? 'sel' : ''}`}
                    onClick={() => toggleSelect(r.id)}
                  >
                    <div className="ta-card-num">{r.scene || idx + 1}</div>
                    <div className="ta-card-body">
                      {r.status === 'error' ? (
                        <>
                          <div className="ta-card-x">×</div>
                          <div className="ta-card-err">{r.msg || 'Lỗi'}</div>
                        </>
                      ) : r.status === 'run' ? (
                        <div className="ta-card-ok">{r.msg || 'Đang chạy…'}</div>
                      ) : (
                        <>
                          {r.files[0] ? (
                            <a href={fileUrl(r.files[0])} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                              <img className="ta-card-img" src={fileUrl(r.files[0])} alt={`cảnh ${r.scene}`} />
                            </a>
                          ) : (
                            <div className="ta-card-ok">✓ Xong</div>
                          )}
                          {r.files[0] ? (
                            <div className="ta-card-mail" title={r.files[0]}>💾 {r.files[0].split(/[\\/]/).pop()}</div>
                          ) : null}
                        </>
                      )}
                      <div className="ta-card-snip">{snippet(r.text)}</div>
                    </div>
                    <div className="ta-card-foot" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        title="Copy prompt"
                        onClick={() => {
                          void navigator.clipboard?.writeText(r.text)
                          flash('Đã copy prompt')
                        }}
                      >
                        ⧉
                      </button>
                      <button
                        type="button"
                        title="Sửa / đưa lại prompt"
                        onClick={() => {
                          setPrompt(r.text)
                          flash('Đã đưa prompt lên ô nhập')
                        }}
                      >
                        ✎
                      </button>
                      {r.status === 'done' && r.files[0] && (
                        <button type="button" title="Dựng video vẽ tay" onClick={() => veTay(r.files[0])}>
                          ✍
                        </button>
                      )}
                      {r.status === 'done' && r.files[0] && (
                        <button type="button" title="Upscale x4 (realesrgan)" onClick={() => upscaleAnh(r.files[0])}>
                          ⇧
                        </button>
                      )}
                      <button
                        type="button"
                        title="Remix"
                        onClick={() => {
                          setPrompt(r.text)
                          flash('Remix — chỉnh prompt rồi thêm lại hàng đợi')
                        }}
                      >
                        ✦
                      </button>
                      <button
                        type="button"
                        title="Xóa"
                        onClick={() => {
                          setHidden((prev) => [...prev, r.id])
                          setSelected((prev) => prev.filter((x) => x !== r.id))
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {toast && <div className="ta-toast">{toast}</div>}
      {drawOpen && (
        <DrawEngineModal
          open={drawOpen}
          initial={drawCfg}
          onClose={() => setDrawOpen(false)}
          onApply={(cfg) => {
            setDrawCfg(cfg)
            setDraw(true)
            setDrawOpen(false)
            flash(`Đã áp dụng Draw: ${cfg.handName}`)
          }}
        />
      )}

    </div>
  )
}
