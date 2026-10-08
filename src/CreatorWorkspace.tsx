import { useEffect, useMemo, useRef, useState } from 'react'
import { api, dirName, downloadText, errText, openFolder } from './bridge'
import './creator.css'

type ModalTab = 'script' | 'ads'
type PromptType = 'Auto' | 'Manual'
type WorkflowStatus = 'draft' | 'ready' | 'running' | 'done'

type Workflow = {
  id: number
  name: string
  kind: ModalTab
  status: WorkflowStatus
  createdAt: string
  model: string
  ratio: string
  scenes: string
  input?: Record<string, unknown>
  result?: CreatorResult
  path?: string
  err?: string
}

type CreatorScene = { vo: string; img: string; vid: string }
type CreatorResult = { title?: string; voiceover?: string; scenes: CreatorScene[] }

const LS_WORKFLOWS = 'pb.creator.workflows'
const LS_LOG_COUNT = 'pb.creator.logCount'

const AI_MODELS = [
  { id: 'gemini-3-flash', label: '🚀 Gemini 3.0 Flash' },
  { id: 'gemini-2.5-pro', label: '✨ Gemini 2.5 Pro' },
]

const IDEA_SOURCES = [
  { id: 'idea', label: '💡 Ý tưởng / Idea' },
  { id: 'outline', label: '📝 Outline có sẵn' },
  { id: 'url', label: '🔗 Link tham khảo' },
]

const RATIOS = [
  { id: '9:16', label: '📱 Dọc (9:16)' },
  { id: '16:9', label: '🖥️ Ngang (16:9)' },
  { id: '1:1', label: '⬜ Vuông (1:1)' },
]

const SCENE_OPTS = ['Auto', '4', '6', '8', '10', '12']

const IMAGE_STYLES = [
  'Tự động nhận diện (Auto Detect)',
  'Realistic (Live-Action)',
  'Cinematic Live-Action',
  'Realistic CGI',
  '3D CGI Realistic',
  'Documentary Style',
  'Epic Survival Cinematic',
  'Pixar 3D',
]

const LANGS = [
  'Auto (Tự động nhận diện)',
  'Tiếng Việt',
  'English',
  '中文',
  '日本語',
  '한국어',
]

const VIDEO_STYLES_VOICE = [
  {
    id: 'auto',
    icon: '🤖',
    label: 'Auto',
    desc: 'AI tự phân tích SP và chọn kiểu phù hợp nhất',
  },
  {
    id: 'review',
    icon: '🎬',
    label: 'Review',
    desc: 'Đánh giá chi tiết, unboxing, so sánh',
  },
  {
    id: 'livestream',
    icon: '🔴',
    label: 'Livestream',
    desc: 'Bán hàng trực tiếp, deal, CTA mạnh',
  },
  {
    id: 'tiktok',
    icon: '📱',
    label: 'TikTok',
    desc: 'Hook mạnh, trend, nhanh, Gen-Z',
  },
  {
    id: 'affiliate',
    icon: '🛒',
    label: 'Affiliate',
    desc: 'Review cá nhân, tự nhiên, storytelling',
  },
]

const VIDEO_STYLES_SILENT = [
  {
    id: 'showcase',
    icon: '✨',
    label: 'Showcase',
    desc: 'Trưng bày sản phẩm + nhạc nền',
  },
  {
    id: 'cinematic',
    icon: '🎥',
    label: 'Cinematic',
    desc: 'Quay chậm, ánh sáng điện ảnh',
  },
  {
    id: 'demo',
    icon: '📦',
    label: 'Product Demo',
    desc: 'Demo tính năng, không lời thoại',
  },
  {
    id: 'loop',
    icon: '🔁',
    label: 'Product Loop',
    desc: 'Clip ngắn lặp cho ads feed',
  },
]

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as T
  } catch {
    /* ignore */
  }
  return fallback
}

function nowStamp() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function statusLabel(s: WorkflowStatus) {
  if (s === 'draft') return 'Nháp'
  if (s === 'ready') return 'Sẵn sàng'
  if (s === 'running') return 'Đang chạy'
  return 'Xong'
}

export default function CreatorWorkspace() {
  const [workflows, setWorkflows] = useState<Workflow[]>(() =>
    loadJson(LS_WORKFLOWS, [] as Workflow[]),
  )
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTab, setModalTab] = useState<ModalTab>('script')
  const [toast, setToast] = useState<string | null>(null)
  const [logCount, setLogCount] = useState(() => loadJson(LS_LOG_COUNT, 0))
  const [logOpen, setLogOpen] = useState(false)
  const [logs, setLogs] = useState<string[]>([`[${nowStamp()}] Creator sẵn sàng.`])
  const [openId, setOpenId] = useState<number | null>(null)
  const opened = workflows.find((w) => w.id === openId) || null

  // Video Script form
  const [wfName, setWfName] = useState('')
  const [promptType, setPromptType] = useState<PromptType>('Auto')
  const [model, setModel] = useState(AI_MODELS[0].id)
  const [ideaSource, setIdeaSource] = useState(IDEA_SOURCES[0].id)
  const [idea, setIdea] = useState('')
  const [ratio, setRatio] = useState('9:16')
  const [scenes, setScenes] = useState('Auto')
  const [imgStyle, setImgStyle] = useState(IMAGE_STYLES[0])
  const [lang, setLang] = useState(LANGS[0])

  // Product Ads form
  const [adsName, setAdsName] = useState('')
  const [adsModel, setAdsModel] = useState(AI_MODELS[0].id)
  const [videoStyle, setVideoStyle] = useState('auto')
  const [styleMenuOpen, setStyleMenuOpen] = useState(false)
  const [imgStyleMenuOpen, setImgStyleMenuOpen] = useState(false)
  const [promptTypeMenuOpen, setPromptTypeMenuOpen] = useState(false)
  const [productPrompt, setProductPrompt] = useState('')
  const [adsRatio, setAdsRatio] = useState('9:16')
  const [adsScenes, setAdsScenes] = useState('Auto')
  const [adsImgStyle, setAdsImgStyle] = useState(IMAGE_STYLES[0])
  const [adsLang, setAdsLang] = useState(LANGS[0])
  const [productFile, setProductFile] = useState<{ name: string; url: string; path?: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(Math.max(0, ...workflows.map((w) => w.id)) + 1)

  useEffect(() => {
    try {
      localStorage.setItem(LS_WORKFLOWS, JSON.stringify(workflows))
    } catch {
      /* ignore */
    }
  }, [workflows])

  useEffect(() => {
    try {
      localStorage.setItem(LS_LOG_COUNT, JSON.stringify(logCount))
    } catch {
      /* ignore */
    }
  }, [logCount])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(t)
  }, [toast])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return workflows
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.kind.includes(q) ||
        statusLabel(w.status).toLowerCase().includes(q),
    )
  }, [workflows, query])

  const allChecked = filtered.length > 0 && filtered.every((w) => selected.includes(w.id))

  function pushLog(msg: string) {
    setLogs((prev) => [`[${nowStamp()}] ${msg}`, ...prev].slice(0, 80))
    setLogCount((c) => c + 1)
  }

  function resetForms() {
    setWfName('')
    setPromptType('Auto')
    setModel(AI_MODELS[0].id)
    setIdeaSource(IDEA_SOURCES[0].id)
    setIdea('')
    setRatio('9:16')
    setScenes('Auto')
    setImgStyle(IMAGE_STYLES[0])
    setLang(LANGS[0])
    setAdsName('')
    setAdsModel(AI_MODELS[0].id)
    setVideoStyle('auto')
    setProductPrompt('')
    setAdsRatio('9:16')
    setAdsScenes('Auto')
    setAdsImgStyle(IMAGE_STYLES[0])
    setAdsLang(LANGS[0])
    if (productFile?.url) URL.revokeObjectURL(productFile.url)
    setProductFile(null)
    setStyleMenuOpen(false)
    setImgStyleMenuOpen(false)
    setPromptTypeMenuOpen(false)
  }

  function openNew() {
    resetForms()
    setModalTab('script')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setStyleMenuOpen(false)
    setImgStyleMenuOpen(false)
    setPromptTypeMenuOpen(false)
  }

  function modelLabel(id: string) {
    return AI_MODELS.find((m) => m.id === id)?.label || id
  }

  function videoStyleLabel(id: string) {
    const all = [...VIDEO_STYLES_VOICE, ...VIDEO_STYLES_SILENT]
    const hit = all.find((x) => x.id === id)
    return hit ? `${hit.icon} ${hit.label}` : id
  }

  async function runWorkflow(id: number, input: Record<string, unknown>) {
    setWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, status: 'running', err: undefined } : w)))
    try {
      const r = await api<{ result: CreatorResult; path: string }>('/api/creator/run', input)
      setWorkflows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, status: 'done', result: r.result, path: r.path, scenes: String(r.result.scenes.length) } : w)),
      )
      pushLog(`Xong: ${input.name} — ${r.result.scenes.length} cảnh`)
    } catch (e) {
      const m = errText(e)
      setWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, status: 'draft', err: m } : w)))
      pushLog(`Lỗi ${input.name}: ${m}`)
      setToast(m)
    }
  }

  function createWorkflow() {
    if (modalTab === 'script') {
      const name = wfName.trim() || `Video Script ${nextId.current}`
      if (!idea.trim()) {
        setToast(promptType === 'Auto' ? 'Nhập ý tưởng / Idea trước khi tạo' : 'Nhập prompt (mỗi dòng một cảnh)')
        return
      }
      const input = { kind: 'script', name, promptType, model, ideaSource, idea, ratio, scenes, imgStyle, lang }
      const row: Workflow = {
        id: nextId.current++,
        name,
        kind: 'script',
        status: 'running',
        createdAt: nowStamp(),
        model: modelLabel(model),
        ratio,
        scenes,
        input,
      }
      setWorkflows((prev) => [row, ...prev])
      pushLog(`Tạo workflow Video Script: ${name}`)
      closeModal()
      void runWorkflow(row.id, input)
      return
    }

    const name = adsName.trim() || `Product Ads ${nextId.current}`
    if (!productFile?.path) {
      setToast(productFile ? 'Ảnh đang tải lên — chờ chút' : 'Thêm ảnh sản phẩm trước khi tạo')
      return
    }
    const input = {
      kind: 'ads',
      name,
      model: adsModel,
      videoStyle,
      idea: productPrompt,
      image: productFile.path,
      ratio: adsRatio,
      scenes: adsScenes,
      imgStyle: adsImgStyle,
      lang: adsLang,
    }
    const row: Workflow = {
      id: nextId.current++,
      name,
      kind: 'ads',
      status: 'running',
      createdAt: nowStamp(),
      model: modelLabel(adsModel),
      ratio: adsRatio,
      scenes: adsScenes,
      input,
    }
    setWorkflows((prev) => [row, ...prev])
    pushLog(`Tạo workflow Product Ads: ${name} (${productFile.name})`)
    closeModal()
    void runWorkflow(row.id, input)
  }

  function onPickFile(file: File | null) {
    if (!file) return
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      setToast('Chỉ hỗ trợ JPG, PNG, WebP')
      return
    }
    if (productFile?.url) URL.revokeObjectURL(productFile.url)
    const url = URL.createObjectURL(file)
    setProductFile({ name: file.name, url })
    // Cầu nối đọc ảnh từ đĩa → tải lên một bản để có đường dẫn
    fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })
      .then((r) => r.json())
      .then((j: { ok?: boolean; path?: string; error?: string }) => {
        if (!j.ok || !j.path) throw new Error(j.error || 'Tải ảnh lỗi')
        setProductFile((cur) => (cur && cur.url === url ? { ...cur, path: j.path } : cur))
      })
      .catch((e) => setToast(errText(e)))
  }

  function toggleSelect(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleAll() {
    if (allChecked) setSelected([])
    else setSelected(filtered.map((w) => w.id))
  }

  function removeSelected() {
    if (!selected.length) return
    setWorkflows((prev) => prev.filter((w) => !selected.includes(w.id)))
    pushLog(`Xóa ${selected.length} workflow`)
    setSelected([])
    setToast('Đã xóa workflow đã chọn')
  }

  function refreshList() {
    pushLog('Làm mới danh sách workflow')
    setToast('Đã làm mới')
  }

  return (
    <div className="cr-root">
      <header className="cr-header">
        <div className="cr-header-left">
          <span className="cr-title-ico" aria-hidden>
            📄
          </span>
          <h1>Creator</h1>
        </div>
        <div className="cr-header-right">
          <button
            type="button"
            className="cr-icon-btn"
            title="Nhật ký"
            onClick={() => setLogOpen((v) => !v)}
          >
            &gt;_
          </button>
          <button
            type="button"
            className="cr-badge"
            title="Hoạt động"
            onClick={() => setLogOpen((v) => !v)}
          >
            {logCount}
          </button>
        </div>
      </header>

      <div className="cr-toolbar">
        <div className="cr-search-wrap">
          <span className="cr-search-ico" aria-hidden>
            🔍
          </span>
          <input
            className="cr-search"
            placeholder="Find workflow..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="button" className="cr-refresh" title="Refresh" onClick={refreshList}>
          ↻
        </button>
        {selected.length > 0 && (
          <button type="button" className="cr-del" onClick={removeSelected}>
            Xóa ({selected.length})
          </button>
        )}
        <div className="cr-spacer" />
        <button type="button" className="cr-new" onClick={openNew}>
          + New Workflow
        </button>
      </div>

      <div className="cr-table-wrap">
        <div className="cr-table-head">
          <label className="cr-check">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
          </label>
          <span>WORKFLOW NAME</span>
          <span>STATUS</span>
          <span>CREATED</span>
        </div>

        {filtered.length === 0 ? (
          <div className="cr-empty">
            <div className="cr-empty-title">Chưa có workflow nào</div>
            <div className="cr-empty-sub">
              Nhấn <button type="button" className="cr-empty-link" onClick={openNew}>+ New Workflow</button> để bắt đầu tạo kịch bản
            </div>
          </div>
        ) : (
          <ul className="cr-list">
            {filtered.map((w) => (
              <li key={w.id} className={`cr-row ${selected.includes(w.id) ? 'on' : ''}`}>
                <label className="cr-check">
                  <input
                    type="checkbox"
                    checked={selected.includes(w.id)}
                    onChange={() => toggleSelect(w.id)}
                  />
                </label>
                <div
                  className="cr-name-cell"
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setOpenId(w.id)}
                >
                  <span className="cr-kind">{w.kind === 'script' ? '🎬' : '📦'}</span>
                  <div>
                    <div className="cr-name">{w.name}</div>
                    <div className="cr-meta">
                      {w.model} · {w.ratio} · {w.scenes} cảnh
                      {w.err && <span className="cr-err"> · ❌ {w.err}</span>}
                    </div>
                  </div>
                </div>
                <span className={`cr-status st-${w.status}`}>{statusLabel(w.status)}</span>
                <span className="cr-created">{w.createdAt}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {opened && (
        <aside className="cr-detail">
          <div className="cr-log-head">
            <strong>
              {opened.kind === 'script' ? '🎬' : '📦'} {opened.result?.title || opened.name}
            </strong>
            <button type="button" onClick={() => setOpenId(null)}>
              ✕
            </button>
          </div>
          <div className="cr-detail-acts">
            {opened.input && (
              <button
                type="button"
                className="cr-btn-ghost"
                disabled={opened.status === 'running'}
                onClick={() => void runWorkflow(opened.id, opened.input as Record<string, unknown>)}
              >
                {opened.status === 'running' ? '⏳ Đang chạy…' : '↻ Chạy lại'}
              </button>
            )}
            {opened.result && (
              <>
                <button
                  type="button"
                  className="cr-btn-ghost"
                  onClick={() => navigator.clipboard?.writeText(opened.result!.scenes.map((x) => x.img).join('\n'))}
                >
                  Copy prompt ảnh
                </button>
                <button
                  type="button"
                  className="cr-btn-ghost"
                  onClick={() => navigator.clipboard?.writeText(opened.result!.scenes.map((x) => x.vid).join('\n'))}
                >
                  Copy prompt video
                </button>
                <button
                  type="button"
                  className="cr-btn-ghost"
                  onClick={() => downloadText(`${opened.name}.json`, JSON.stringify(opened.result, null, 2))}
                >
                  Xuất JSON
                </button>
              </>
            )}
            {opened.path && (
              <button type="button" className="cr-btn-ghost" onClick={() => openFolder(dirName(opened.path!))}>
                📂
              </button>
            )}
          </div>
          {opened.err && <div className="cr-err">❌ {opened.err}</div>}
          {opened.status === 'running' && <div className="cr-hint">Gemini đang viết kịch bản…</div>}
          {opened.result?.voiceover && (
            <div className="cr-scene">
              <b>Lời đọc</b>
              <p>{opened.result.voiceover}</p>
            </div>
          )}
          {opened.result?.scenes.map((sc, i) => (
            <div key={i} className="cr-scene">
              <b>Cảnh {i + 1}</b>
              {sc.vo && <p>🎙 {sc.vo}</p>}
              <p>
                <span className="cr-tag">ẢNH</span> {sc.img}
              </p>
              <p>
                <span className="cr-tag">VIDEO</span> {sc.vid}
              </p>
            </div>
          ))}
        </aside>
      )}

      {logOpen && (
        <aside className="cr-log-panel">
          <div className="cr-log-head">
            <strong>Nhật ký hoạt động</strong>
            <button type="button" onClick={() => setLogOpen(false)}>
              ✕
            </button>
          </div>
          <ul>
            {logs.map((l, i) => (
              <li key={`${i}-${l.slice(0, 12)}`}>{l}</li>
            ))}
          </ul>
        </aside>
      )}

      {modalOpen && (
        <div
          className="cr-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div className="cr-modal" role="dialog" aria-modal="true">
            <div className="cr-modal-tabs">
              <button
                type="button"
                className={modalTab === 'script' ? 'on' : ''}
                onClick={() => {
                  setModalTab('script')
                  setStyleMenuOpen(false)
                  setImgStyleMenuOpen(false)
                }}
              >
                <span>🎬</span> Video Script
              </button>
              <button
                type="button"
                className={modalTab === 'ads' ? 'on' : ''}
                onClick={() => {
                  setModalTab('ads')
                  setPromptTypeMenuOpen(false)
                }}
              >
                <span>📦</span> Product Ads
              </button>
              <button type="button" className="cr-modal-x" onClick={closeModal} aria-label="Đóng">
                ✕
              </button>
            </div>

            <div className="cr-modal-body">
              {modalTab === 'script' ? (
                <>
                  <label className="cr-field">
                    <span>Tên Workflow</span>
                    <input
                      placeholder="Nhập tên workflow..."
                      value={wfName}
                      onChange={(e) => setWfName(e.target.value)}
                    />
                  </label>

                  <div className="cr-grid-2">
                    <label className="cr-field">
                      <span>Loại Prompt</span>
                      <div className="cr-dd">
                        <button
                          type="button"
                          className="cr-dd-btn"
                          onClick={() => setPromptTypeMenuOpen((v) => !v)}
                        >
                          {promptType}
                          <span>▾</span>
                        </button>
                        {promptTypeMenuOpen && (
                          <div className="cr-dd-menu">
                            {(['Auto', 'Manual'] as PromptType[]).map((p) => (
                              <button
                                key={p}
                                type="button"
                                className={promptType === p ? 'on' : ''}
                                onClick={() => {
                                  setPromptType(p)
                                  setPromptTypeMenuOpen(false)
                                }}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                    <label className="cr-field">
                      <span>Model AI</span>
                      <select value={model} onChange={(e) => setModel(e.target.value)}>
                        {AI_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {promptType === 'Auto' && (
                    <label className="cr-field">
                      <span>Nguồn Tự Động</span>
                      <select value={ideaSource} onChange={(e) => setIdeaSource(e.target.value)}>
                        {IDEA_SOURCES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="cr-field">
                    <span>Ý tưởng / Idea</span>
                    <textarea
                      rows={4}
                      placeholder="Nhập ý tưởng câu chuyện, AI sẽ tự viết kịch bản và tạo cảnh..."
                      value={idea}
                      onChange={(e) => setIdea(e.target.value)}
                    />
                  </label>

                  <div className="cr-grid-2">
                    <label className="cr-field">
                      <span>Tỉ lệ khung hình</span>
                      <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                        {RATIOS.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="cr-field">
                      <span>Số Cảnh</span>
                      <select value={scenes} onChange={(e) => setScenes(e.target.value)}>
                        {SCENE_OPTS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      {scenes === 'Auto' && (
                        <small className="cr-hint">✨ AI tự chọn số cảnh phù hợp</small>
                      )}
                    </label>
                  </div>

                  <div className="cr-grid-2">
                    <label className="cr-field">
                      <span>Phong cách hình ảnh</span>
                      <select value={imgStyle} onChange={(e) => setImgStyle(e.target.value)}>
                        {IMAGE_STYLES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="cr-field">
                      <span>Ngôn ngữ thoại</span>
                      <select value={lang} onChange={(e) => setLang(e.target.value)}>
                        {LANGS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <label className="cr-field">
                    <span>Tên Workflow</span>
                    <input
                      placeholder="Nhập tên workflow..."
                      value={adsName}
                      onChange={(e) => setAdsName(e.target.value)}
                    />
                  </label>

                  <div className="cr-grid-2">
                    <label className="cr-field">
                      <span>Model AI</span>
                      <select value={adsModel} onChange={(e) => setAdsModel(e.target.value)}>
                        {AI_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="cr-field">
                      <span>Kiểu video</span>
                      <div className="cr-dd">
                        <button
                          type="button"
                          className="cr-dd-btn"
                          onClick={() => {
                            setStyleMenuOpen((v) => !v)
                            setImgStyleMenuOpen(false)
                          }}
                        >
                          {videoStyleLabel(videoStyle)}
                          <span>▾</span>
                        </button>
                        {styleMenuOpen && (
                          <div className="cr-dd-menu cr-dd-wide">
                            <div className="cr-dd-sec">CÓ LỜI</div>
                            {VIDEO_STYLES_VOICE.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                className={videoStyle === s.id ? 'on' : ''}
                                onClick={() => {
                                  setVideoStyle(s.id)
                                  setStyleMenuOpen(false)
                                }}
                              >
                                <strong>
                                  {s.icon} {s.label}
                                </strong>
                                <small>{s.desc}</small>
                              </button>
                            ))}
                            <div className="cr-dd-sec">KHÔNG LỜI (LỒNG NHẠC)</div>
                            {VIDEO_STYLES_SILENT.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                className={videoStyle === s.id ? 'on' : ''}
                                onClick={() => {
                                  setVideoStyle(s.id)
                                  setStyleMenuOpen(false)
                                }}
                              >
                                <strong>
                                  {s.icon} {s.label}
                                </strong>
                                <small>{s.desc}</small>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                  </div>

                  <div className="cr-field">
                    <span>Ảnh sản phẩm</span>
                    <div
                      className={`cr-drop ${productFile ? 'has' : ''}`}
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        onPickFile(e.dataTransfer.files?.[0] || null)
                      }}
                    >
                      {productFile ? (
                        <div className="cr-drop-preview">
                          <img src={productFile.url} alt="" />
                          <div>
                            <div className="cr-drop-name">{productFile.name}</div>
                            <button
                              type="button"
                              className="cr-drop-clear"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (productFile.url) URL.revokeObjectURL(productFile.url)
                                setProductFile(null)
                              }}
                            >
                              Gỡ ảnh
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="cr-drop-ico">🖼️+</div>
                          <div className="cr-drop-title">
                            Click hoặc kéo thả ảnh sản phẩm vào đây
                          </div>
                          <div className="cr-drop-sub">Hỗ trợ JPG, PNG, WebP</div>
                        </>
                      )}
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                        hidden
                        onChange={(e) => onPickFile(e.target.files?.[0] || null)}
                      />
                    </div>
                  </div>

                  <label className="cr-field">
                    <span>Prompt / Thông tin (tùy chọn)</span>
                    <textarea
                      rows={4}
                      placeholder={`Tên SP, kịch bản, hoặc ý tưởng — AI tự phân tích ảnh và viết kịch bản QC:\n• Chỉ cần tên: 'iPhone 16 Pro Max'\n• Có kịch bản? Paste vào — AI tự chia cảnh 8s`}
                      value={productPrompt}
                      onChange={(e) => setProductPrompt(e.target.value)}
                    />
                  </label>

                  <div className="cr-grid-2">
                    <label className="cr-field">
                      <span>Tỉ lệ khung hình</span>
                      <select value={adsRatio} onChange={(e) => setAdsRatio(e.target.value)}>
                        {RATIOS.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="cr-field">
                      <span>Số Cảnh</span>
                      <select value={adsScenes} onChange={(e) => setAdsScenes(e.target.value)}>
                        {SCENE_OPTS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      {adsScenes === 'Auto' && (
                        <small className="cr-hint">✨ AI tự chọn số cảnh phù hợp</small>
                      )}
                    </label>
                  </div>

                  <div className="cr-grid-2">
                    <label className="cr-field">
                      <span>Phong cách hình ảnh</span>
                      <div className="cr-dd">
                        <button
                          type="button"
                          className="cr-dd-btn"
                          onClick={() => {
                            setImgStyleMenuOpen((v) => !v)
                            setStyleMenuOpen(false)
                          }}
                        >
                          {adsImgStyle}
                          <span>▾</span>
                        </button>
                        {imgStyleMenuOpen && (
                          <div className="cr-dd-menu">
                            {IMAGE_STYLES.map((s) => (
                              <button
                                key={s}
                                type="button"
                                className={adsImgStyle === s ? 'on' : ''}
                                onClick={() => {
                                  setAdsImgStyle(s)
                                  setImgStyleMenuOpen(false)
                                }}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                    <label className="cr-field">
                      <span>Ngôn ngữ thoại</span>
                      <select value={adsLang} onChange={(e) => setAdsLang(e.target.value)}>
                        {LANGS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </>
              )}
            </div>

            <footer className="cr-modal-foot">
              <button type="button" className="cr-btn-ghost" onClick={closeModal}>
                Hủy
              </button>
              <button type="button" className="cr-btn-primary" onClick={createWorkflow}>
                Tạo & Mở
              </button>
            </footer>
          </div>
        </div>
      )}

      {toast && <div className="cr-toast">{toast}</div>}
    </div>
  )
}
