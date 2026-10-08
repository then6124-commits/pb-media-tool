import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { api, baseName, errText, fileUrl, pickFiles, waitJob } from './bridge'

type ToolId = 'pan' | 'text' | 'image' | 'video' | 'scissors' | 'frame'
type NodeKind = 'text' | 'image' | 'video' | 'frame'
type PanelView = null | 'log' | 'results' | 'import'

type FlowNode = {
  id: number
  kind: NodeKind
  x: number
  y: number
  title: string
  text?: string
  mediaLabel?: string
  mediaPath?: string
  busy?: boolean
  err?: string
}

type FlowEdge = { from: number; to: number }

type FlowStateItem = { scene: string; prompt: string; status: string; msg: string; files?: string[]; t: number }

type SavedFlow = {
  id: number
  name: string
  date: string
  nodes: number
  data?: { nodes: FlowNode[]; edges: FlowEdge[] }
}

const LS_NAME = 'pb.flow.name'
const LS_NODES = 'pb.flow.nodes'
const LS_SAVED = 'pb.flow.saved'
const LS_STATS = 'pb.flow.stats'
const LS_EDGES = 'pb.flow.edges'
const IMG_MODEL = 'Banana 2'
const VID_MODEL = 'Veo 3.1 Fast'
const NODE_W: Record<NodeKind, number> = { text: 260, image: 300, video: 300, frame: 340 }

const isVideo = (p?: string) => !!p && /\.(mp4|mov|webm|mkv)$/i.test(p)

const TOOLS: { id: ToolId; label: string; tip: string; tipCls: string }[] = [
  { id: 'pan', label: '↖', tip: 'Pan mode', tipCls: 'tip-pan' },
  { id: 'text', label: 'T', tip: 'Click Text', tipCls: 'tip-text' },
  { id: 'image', label: '🖼', tip: 'Click Image', tipCls: 'tip-image' },
  { id: 'video', label: '🎥', tip: 'Click Video', tipCls: 'tip-video' },
  { id: 'scissors', label: '✂', tip: 'Cut / Trim', tipCls: 'tip-cut' },
  { id: 'frame', label: '⬚', tip: 'Frame', tipCls: 'tip-frame' },
]

function todayStr() {
  const d = new Date()
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
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

function defaultSaved(): SavedFlow[] {
  return []
}

export default function FlowWorkspace() {
  const [name, setName] = useState(() => loadJson(LS_NAME, 'Untitled Workflow'))
  const [nodes, setNodes] = useState<FlowNode[]>(() => loadJson(LS_NODES, [] as FlowNode[]))
  const [saved, setSaved] = useState<SavedFlow[]>(() => loadJson(LS_SAVED, defaultSaved()))
  const [tool, setTool] = useState<ToolId>('pan')
  const [hoverTool, setHoverTool] = useState<ToolId | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [panel, setPanel] = useState<PanelView>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [nameOpen, setNameOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState<number | null>(null)
  const [autoSaved, setAutoSaved] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [stats, setStats] = useState(() =>
    loadJson(LS_STATS, { running: 0, done: 0, errors: 0 }),
  )
  const [logs, setLogs] = useState<string[]>([
    `[${todayStr()}] Flow workspace sẵn sàng.`,
    '[INFO] Thêm node Text / Image / Video · nối cổng + (phải → trái) để dùng text làm prompt, ảnh làm khung đầu video.',
  ])
  const [edges, setEdges] = useState<FlowEdge[]>(() => loadJson(LS_EDGES, [] as FlowEdge[]))
  const [connecting, setConnecting] = useState<number | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const uploadFor = useRef<number | null>(null)
  const [results, setResults] = useState<{ id: number; label: string; status: string }[]>([])
  const [history, setHistory] = useState<FlowNode[][]>([])
  const [future, setFuture] = useState<FlowNode[][]>([])
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState<{ id: number; ox: number; oy: number } | null>(null)
  const [panning, setPanning] = useState<{ sx: number; sy: number; px: number; py: number } | null>(
    null,
  )
  const canvasRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(Math.max(0, ...nodes.map((n) => n.id)) + 1)

  useEffect(() => {
    try {
      localStorage.setItem(LS_NAME, JSON.stringify(name))
    } catch {
      /* ignore */
    }
  }, [name])

  useEffect(() => {
    try {
      localStorage.setItem(LS_NODES, JSON.stringify(nodes))
    } catch {
      /* ignore */
    }
  }, [nodes])

  useEffect(() => {
    try {
      localStorage.setItem(LS_SAVED, JSON.stringify(saved))
    } catch {
      /* ignore */
    }
  }, [saved])

  useEffect(() => {
    try {
      localStorage.setItem(LS_EDGES, JSON.stringify(edges))
    } catch {
      /* ignore */
    }
  }, [edges])

  useEffect(() => {
    try {
      localStorage.setItem(LS_STATS, JSON.stringify(stats))
    } catch {
      /* ignore */
    }
  }, [stats])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const nodeCount = nodes.length
  const canUndo = history.length > 0
  const canRedo = future.length > 0

  const pushHistory = (prev: FlowNode[]) => {
    setHistory((h) => [...h.slice(-40), prev])
    setFuture([])
  }

  const showToast = (msg: string) => setToast(msg)

  const addLog = (msg: string) => {
    const stamp = new Date().toLocaleTimeString('vi-VN', { hour12: false })
    setLogs((L) => [`[${stamp}] ${msg}`, ...L].slice(0, 80))
  }

  const createNew = () => {
    if (nodes.length && !confirm('Tạo canvas trống? Thay đổi chưa lưu sẽ mất.')) return
    pushHistory(nodes)
    setNodes([])
    setEdges([])
    setSelectedId(null)
    setName('Untitled Workflow')
    setStats({ running: 0, done: 0, errors: 0 })
    setAutoSaved(true)
    setPan({ x: 0, y: 0 })
    addLog('Tạo mới · Canvas trống')
    showToast('Canvas trống')
  }

  const saveNow = () => {
    const entry: SavedFlow = {
      id: Date.now(),
      name: `${name} v${saved.length + 1}`,
      date: todayStr(),
      nodes: nodes.length,
      data: { nodes: nodes.map((n) => ({ ...n, busy: false })), edges },
    }
    setSaved((s) => [entry, ...s].slice(0, 20))
    setAutoSaved(true)
    addLog(`Lưu ngay · ${entry.name} (${entry.nodes} nodes)`)
    showToast('Đã lưu (Force save)')
  }

  const loadSaved = (s: SavedFlow) => {
    if (s.data) {
      pushHistory(nodes)
      setNodes(s.data.nodes)
      setEdges(s.data.edges || [])
      nextId.current = Math.max(0, ...s.data.nodes.map((n) => n.id)) + 1
    }
    setName(s.name.replace(/ v\d+$/, '') || s.name)
    setAutoSaved(true)
    addLog(`Mở workflow đã lưu · ${s.name}`)
    showToast(`Đã mở: ${s.name}`)
  }

  const placeNode = (kind: NodeKind, clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = clientX - rect.left - pan.x - 140
    const y = clientY - rect.top - pan.y - 40
    const id = nextId.current++
    const titles: Record<NodeKind, string> = {
      text: 'Text',
      image: 'Image',
      video: 'Video',
      frame: 'Frame',
    }
    const node: FlowNode = {
      id,
      kind,
      x: Math.max(20, x),
      y: Math.max(20, y),
      title: titles[kind],
      text: kind === 'text' ? 'Nhập nội dung…' : undefined,
    }
    pushHistory(nodes)
    setNodes((n) => [...n, node])
    setSelectedId(id)
    setAutoSaved(false)
    setTool('pan')
    addLog(`Thêm node ${titles[kind]} #${id}`)
  }

  const onCanvasClick = (e: ReactMouseEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('flow-canvas-inner'))
      return
    setSelectedId(null)
    setUploadOpen(null)
    setNameOpen(false)
    if (tool === 'text') placeNode('text', e.clientX, e.clientY)
    else if (tool === 'image') placeNode('image', e.clientX, e.clientY)
    else if (tool === 'video') placeNode('video', e.clientX, e.clientY)
    else if (tool === 'frame') placeNode('frame', e.clientX, e.clientY)
  }

  const onCanvasDown = (e: ReactMouseEvent) => {
    if (tool !== 'pan') return
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('flow-canvas-inner'))
      return
    setPanning({ sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y })
  }

  useEffect(() => {
    if (!panning && !dragging) return
    const onMove = (e: MouseEvent) => {
      if (panning) {
        setPan({
          x: panning.px + (e.clientX - panning.sx),
          y: panning.py + (e.clientY - panning.sy),
        })
      }
      if (dragging) {
        const rect = canvasRef.current?.getBoundingClientRect()
        if (!rect) return
        const x = e.clientX - rect.left - pan.x - dragging.ox
        const y = e.clientY - rect.top - pan.y - dragging.oy
        setNodes((list) =>
          list.map((n) => (n.id === dragging.id ? { ...n, x, y } : n)),
        )
        setAutoSaved(false)
      }
    }
    const onUp = () => {
      setPanning(null)
      setDragging(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [panning, dragging, pan.x, pan.y])

  const undo = () => {
    if (!history.length) return
    const prev = history[history.length - 1]
    setFuture((f) => [nodes, ...f])
    setHistory((h) => h.slice(0, -1))
    setNodes(prev)
    addLog('Undo')
  }

  const redo = () => {
    if (!future.length) return
    const next = future[0]
    setHistory((h) => [...h, nodes])
    setFuture((f) => f.slice(1))
    setNodes(next)
    addLog('Redo')
  }

  const dupNode = (id: number) => {
    const src = nodes.find((n) => n.id === id)
    if (!src) return
    const nid = nextId.current++
    pushHistory(nodes)
    setNodes((list) => [...list, { ...src, id: nid, x: src.x + 36, y: src.y + 36 }])
    setSelectedId(nid)
    setAutoSaved(false)
    addLog(`Duplicate node #${id} → #${nid}`)
  }

  const delNode = (id: number) => {
    pushHistory(nodes)
    setNodes((list) => list.filter((n) => n.id !== id))
    setEdges((list) => list.filter((e) => e.from !== id && e.to !== id))
    if (selectedId === id) setSelectedId(null)
    setAutoSaved(false)
    addLog(`Xóa node #${id}`)
  }

  const patchNode = (id: number, patch: Partial<FlowNode>) =>
    setNodes((list) => list.map((n) => (n.id === id ? { ...n, ...patch } : n)))

  const setMedia = (id: number, path: string, label: string) => {
    patchNode(id, { mediaPath: path, mediaLabel: label, err: undefined, busy: false })
    setAutoSaved(false)
  }

  /** Cổng: bấm cổng phải (Out) của node nguồn rồi cổng trái (In) của node đích. */
  const onPort = (id: number, side: 'in' | 'out') => {
    if (side === 'out') {
      setConnecting(connecting === id ? null : id)
      if (connecting !== id) showToast('Bấm cổng trái (In) của node đích để nối')
      return
    }
    if (connecting == null || connecting === id) {
      // Bấm cổng In khi không nối → gỡ mọi dây vào node này
      if (edges.some((e) => e.to === id)) {
        setEdges((list) => list.filter((e) => e.to !== id))
        addLog(`Gỡ dây vào node #${id}`)
      }
      return
    }
    if (!edges.some((e) => e.from === connecting && e.to === id)) {
      setEdges((list) => [...list, { from: connecting, to: id }])
      addLog(`Nối #${connecting} → #${id}`)
    }
    setConnecting(null)
    setAutoSaved(false)
  }

  const inputsOf = (id: number) => edges.filter((e) => e.to === id).map((e) => nodes.find((n) => n.id === e.from)).filter(Boolean) as FlowNode[]

  const uploadDevice = async (id: number, file: File) => {
    try {
      const r = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })
      const j = (await r.json()) as { ok?: boolean; path?: string; error?: string }
      if (!j.ok || !j.path) throw new Error(j.error || 'Upload lỗi')
      setMedia(id, j.path, file.name)
      addLog(`Upload ${file.name} → node #${id}`)
    } catch (e) {
      showToast(errText(e))
    }
  }

  const browseFile = async (id: number, kind: NodeKind) => {
    setUploadOpen(null)
    try {
      const [p] = await pickFiles(kind === 'video' ? 'video' : 'anh', false)
      if (!p) return
      const r = await api<{ path: string; name: string }>('/api/mini/import-file', { path: p })
      setMedia(id, r.path, r.name)
      addLog(`Chọn file ${r.name} → node #${id}`)
    } catch (e) {
      showToast(errText(e))
    }
  }

  /** Generate qua Flow (Google) của tool cũ: Banana cho ảnh, Veo 3.1 cho video. */
  const generate = async (id: number) => {
    const node = nodes.find((n) => n.id === id)
    if (!node) return
    const ins = inputsOf(id)
    const prompt = [node.text, ...ins.filter((n) => n.kind === 'text').map((n) => n.text)]
      .map((x) => (x || '').trim())
      .filter((x) => x && x !== 'Nhập nội dung…')
      .join('\n')
      .replace(/\s*\n\s*/g, ' ')
    const srcImg = ins.find((n) => n.kind === 'image' && n.mediaPath && !isVideo(n.mediaPath))
    if (!prompt && !srcImg) {
      showToast('Nhập prompt trên node hoặc nối node Text vào')
      return
    }
    const kind = node.kind === 'image' ? 'anh' : 'veo3'
    const body =
      node.kind === 'image'
        ? { prompts: [prompt], model: IMG_MODEL, ratio: '16:9' }
        : srcImg
          ? { mode: 'i2v', model: VID_MODEL, ratio: '16:9', images: [{ path: srcImg.mediaPath, prompt }] }
          : { prompts: [prompt], model: VID_MODEL, ratio: '16:9', duration: '8s' }
    const t0 = Date.now() / 1000 - 2
    patchNode(id, { busy: true, err: undefined })
    setStats((s) => ({ ...s, running: s.running + 1 }))
    addLog(`Generate ${node.kind} #${id} · ${srcImg ? 'ảnh → video' : prompt.slice(0, 60)}`)
    const fail = (m: string) => {
      patchNode(id, { busy: false, err: m })
      setStats((s) => ({ ...s, running: Math.max(0, s.running - 1), errors: s.errors + 1 }))
      addLog(`❌ #${id}: ${m}`)
      showToast(m)
    }
    try {
      await api(`/api/flow/start?kind=${kind}`, body)
    } catch (e) {
      fail(errText(e))
      return
    }
    // Hỏi trạng thái Flow tới khi cảnh của node này xong
    const want = (prompt || 'Bring this image to life').slice(0, 40)
    for (let i = 0; i < 600; i++) {
      await new Promise((ok) => window.setTimeout(ok, 2500))
      let it: FlowStateItem | undefined
      try {
        const st = await api<{ items: FlowStateItem[] }>(`/api/flow/state?kind=${kind}`)
        it = st.items.find((x) => x.t >= t0 && x.prompt.includes(want))
      } catch {
        continue
      }
      if (!it) continue
      if (it.status === 'xong' && it.files?.length) {
        const f = it.files[0]
        setMedia(id, f, baseName(f))
        setStats((s) => ({ ...s, running: Math.max(0, s.running - 1), done: s.done + 1 }))
        setResults((r) => [{ id: Date.now(), label: `${node.title} #${id} · ${baseName(f)}`, status: 'Xong' }, ...r])
        addLog(`✅ #${id} → ${f}`)
        return
      }
      if (it.status === 'loi') {
        fail(it.msg || 'Flow lỗi')
        return
      }
    }
    fail('Quá thời gian chờ Flow')
  }

  /** Kéo (scissors): cắt đoạn video của node đang chọn → node video mới. */
  const trimSelected = async () => {
    const node = nodes.find((n) => n.id === selectedId)
    if (!node || node.kind !== 'video' || !node.mediaPath) {
      showToast('Chọn một node Video đã có video để cắt')
      return
    }
    const raw = window.prompt('Cắt đoạn (giây bắt đầu-kết thúc), ví dụ 1.5-6', '0-5')
    const m = raw?.match(/^\s*([\d.]+)\s*-\s*([\d.]+)\s*$/)
    if (!m) return
    try {
      const r = await api<{ id: string }>('/api/mini/trim', { path: node.mediaPath, start: Number(m[1]), end: Number(m[2]) })
      addLog(`✂ Cắt #${node.id} ${m[1]}–${m[2]}s…`)
      const j = await waitJob(r.id)
      const nid = nextId.current++
      setNodes((list) => [
        ...list,
        { ...node, id: nid, x: node.x + 40, y: node.y + 330, title: `Cut ${m[1]}–${m[2]}s`, mediaPath: j.out_path, mediaLabel: baseName(j.out_path), busy: false },
      ])
      setEdges((list) => [...list, { from: node.id, to: nid }])
      setSelectedId(nid)
      addLog(`✂ Xong → node #${nid}`)
    } catch (e) {
      showToast(errText(e))
    }
  }

  const resetStats = () => {
    setStats({ running: 0, done: 0, errors: 0 })
    addLog('Reset status')
    showToast('Đã reset status')
  }

  const exportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ name, nodes, edges, savedAt: new Date().toISOString() }, null, 2)],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.replace(/\s+/g, '_') || 'workflow'}.json`
    a.click()
    URL.revokeObjectURL(url)
    addLog('Export JSON')
    showToast('Đã export JSON')
    setPanel(null)
  }

  const importJson = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        pushHistory(nodes)
        if (typeof data.name === 'string') setName(data.name)
        if (Array.isArray(data.edges)) setEdges(data.edges)
        if (Array.isArray(data.nodes)) {
          setNodes(data.nodes)
          nextId.current = Math.max(0, ...data.nodes.map((n: FlowNode) => n.id)) + 1
        }
        setAutoSaved(false)
        addLog(`Import · ${file.name}`)
        showToast('Import OK')
      } catch {
        showToast('File JSON không hợp lệ')
        addLog(`Import lỗi · ${file.name}`)
      }
      setPanel(null)
    }
    reader.readAsText(file)
  }

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) || null,
    [nodes, selectedId],
  )

  return (
    <div className="flow-root">
      {/* Header */}
      <header className="flow-header">
        <div className="flow-header-left">
          <div className="flow-name-wrap">
            <button
              type="button"
              className="flow-name-btn"
              onClick={() => setNameOpen((v) => !v)}
            >
              <span className="flow-folder">📁</span>
              <span className="flow-name-text">{name}</span>
              <span className={`flow-auto-dot ${autoSaved ? 'ok' : ''}`} title="Tự động lưu" />
              <span className="flow-chev">▾</span>
            </button>
            {nameOpen && (
              <div className="flow-name-menu">
                <input
                  className="flow-name-input"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setAutoSaved(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setNameOpen(false)
                  }}
                />
                <button type="button" onClick={() => { setName('Untitled Workflow'); setNameOpen(false) }}>
                  Đặt lại Untitled
                </button>
                <button type="button" onClick={() => { saveNow(); setNameOpen(false) }}>
                  Lưu bản này…
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="flow-ie-btn"
            onClick={() => setPanel(panel === 'import' ? null : 'import')}
          >
            <span className="flow-ie-ico">⇄</span>
            Import / Export
          </button>
        </div>
        <div className="flow-header-right">
          <button
            type="button"
            className={`flow-hdr-btn ${panel === 'log' ? 'on' : ''}`}
            onClick={() => setPanel(panel === 'log' ? null : 'log')}
          >
            <span>☰</span> Log
          </button>
          <button
            type="button"
            className={`flow-hdr-btn ${panel === 'results' ? 'on' : ''}`}
            onClick={() => setPanel(panel === 'results' ? null : 'results')}
          >
            <span>▣</span> Kết quả
          </button>
          <button
            type="button"
            className="flow-hdr-btn ghost"
            onClick={() => setSidebarOpen((v) => !v)}
            title="Ẩn/hiện sidebar"
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>
      </header>

      <div className="flow-body">
        {/* Left sidebar */}
        {sidebarOpen && (
          <aside className="flow-side">
            <div className="flow-side-sec">
              <div className="flow-side-label">WORKFLOW HIỆN TẠI</div>
              <div className="flow-current">
                <div className="flow-current-name">{name}</div>
                <div className={`flow-autosave ${autoSaved ? 'ok' : 'dirty'}`}>
                  {autoSaved ? '✓ Tự động lưu' : '● Chưa lưu'}
                </div>
              </div>
              <div className="flow-side-actions">
                <button type="button" className="flow-big-btn" onClick={createNew}>
                  <span className="flow-big-ico">＋</span>
                  <span>
                    <strong>Tạo mới</strong>
                    <small>Canvas trống</small>
                  </span>
                </button>
                <button type="button" className="flow-big-btn save" onClick={saveNow}>
                  <span className="flow-big-ico">💾</span>
                  <span>
                    <strong>Lưu ngay</strong>
                    <small>Force save</small>
                  </span>
                </button>
              </div>
            </div>

            <div className="flow-side-sec grow">
              <div className="flow-side-label">ĐÃ LƯU ({saved.length})</div>
              <div className="flow-saved-list">
                {saved.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="flow-saved-item"
                    onClick={() => loadSaved(s)}
                  >
                    <div className="flow-saved-name">{s.name}</div>
                    <div className="flow-saved-meta">
                      {s.date} · {s.nodes} nodes
                    </div>
                  </button>
                ))}
                {!saved.length && (
                  <div className="flow-empty-saved">Chưa có workflow đã lưu</div>
                )}
              </div>
            </div>
          </aside>
        )}

        {/* Canvas area */}
        <div className="flow-stage">
          {/* Vertical toolbar */}
          <div className="flow-toolbar">
            {TOOLS.map((t, i) => (
              <div key={t.id} className="flow-tool-wrap">
                {i === 1 && <div className="flow-tool-div" />}
                <button
                  type="button"
                  className={`flow-tool tool-${t.id} ${tool === t.id ? 'on' : ''}`}
                  onClick={() => {
                    setTool(t.id)
                    if (t.id === 'scissors') {
                      setTool('pan')
                      void trimSelected()
                    }
                  }}
                  onMouseEnter={() => setHoverTool(t.id)}
                  onMouseLeave={() => setHoverTool(null)}
                >
                  {t.id === 'image' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
                      <circle cx="9" cy="10" r="1.5" fill="currentColor" />
                      <path d="M3 16l5-4 4 3 3-2 6 4" stroke="currentColor" strokeWidth="2" fill="none" />
                    </svg>
                  ) : t.id === 'video' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M4 6h11a2 2 0 012 2v1.5l4-2.5v11l-4-2.5V16a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" />
                    </svg>
                  ) : t.id === 'frame' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2">
                      <rect x="4" y="4" width="16" height="16" rx="1" />
                    </svg>
                  ) : t.id === 'pan' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M4 4l8 16 1.5-6.5L20 12 4 4z" />
                    </svg>
                  ) : (
                    t.label
                  )}
                </button>
                {hoverTool === t.id && (
                  <div className={`flow-tooltip ${t.tipCls}`}>
                    {t.id === 'image' || t.id === 'video' || t.id === 'text' ? (
                      <>
                        <span className="muted">Click</span>{' '}
                        <span className="emph">
                          {t.id === 'image' ? 'Image' : t.id === 'video' ? 'Video' : 'Text'}
                        </span>
                      </>
                    ) : (
                      t.tip
                    )}
                  </div>
                )}
                {i === 5 && <div className="flow-tool-div" />}
              </div>
            ))}
            <button
              type="button"
              className={`flow-tool tool-undo ${canUndo ? '' : 'off'}`}
              disabled={!canUndo}
              onClick={undo}
              title="Undo"
            >
              ↶
            </button>
            <button
              type="button"
              className={`flow-tool tool-redo ${canRedo ? '' : 'off'}`}
              disabled={!canRedo}
              onClick={redo}
              title="Redo"
            >
              ↷
            </button>
          </div>

          {/* Status panel */}
          <div className="flow-status">
            <div className="flow-stat">
              <i className="dot white" /> Nodes <b>{nodeCount}</b>
            </div>
            <div className="flow-stat">
              <i className="dot green" /> Done <b>{stats.done}</b>
            </div>
            <div className="flow-stat">
              <i className="dot yellow" /> Running <b>{stats.running}</b>
            </div>
            <div className="flow-stat">
              <i className="dot red" /> Errors <b>{stats.errors}</b>
            </div>
            <button type="button" className="flow-reset" onClick={resetStats} title="Reset">
              ↻
            </button>
          </div>

          {/* Canvas */}
          <div
            ref={canvasRef}
            className={`flow-canvas ${tool === 'pan' ? 'pan' : 'place'}`}
            onClick={onCanvasClick}
            onMouseDown={onCanvasDown}
          >
            <div
              className="flow-canvas-inner"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
            >
              <svg className="flow-edges" width="4000" height="4000">
                {edges.map((e) => {
                  const a = nodes.find((n) => n.id === e.from)
                  const b = nodes.find((n) => n.id === e.to)
                  if (!a || !b) return null
                  const x1 = a.x + NODE_W[a.kind]
                  const y1 = a.y + 40
                  const x2 = b.x
                  const y2 = b.y + 40
                  const dx = Math.max(40, Math.abs(x2 - x1) / 2)
                  return (
                    <path
                      key={`${e.from}-${e.to}`}
                      d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`}
                      stroke="#4b8bf5"
                      strokeWidth="2"
                      fill="none"
                    />
                  )
                })}
              </svg>
              {!nodes.length && (
                <div className="flow-canvas-hint">
                  Canvas trống — chọn <b>T</b> / Image / Video rồi click để thêm node
                </div>
              )}
              {nodes.map((n) => (
                <div
                  key={n.id}
                  className={`flow-node kind-${n.kind} ${selectedId === n.id ? 'sel' : ''}`}
                  style={{ left: n.x, top: n.y }}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    setSelectedId(n.id)
                    if (tool === 'pan') {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setDragging({
                        id: n.id,
                        ox: e.clientX - rect.left,
                        oy: e.clientY - rect.top,
                      })
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flow-node-head">
                    <span className="flow-node-title">
                      {n.kind === 'video' && <span className="ico-vid">🎥</span>}
                      {n.kind === 'image' && <span className="ico-img">🖼</span>}
                      {n.kind === 'text' && <span className="ico-txt">T</span>}
                      {n.kind === 'frame' && <span className="ico-frm">⬚</span>}
                      {n.title}
                    </span>
                    <span className="flow-node-acts">
                      <button type="button" title="Duplicate" onClick={() => dupNode(n.id)}>
                        ▤
                      </button>
                      <button type="button" title="Delete" onClick={() => delNode(n.id)}>
                        🗑
                      </button>
                    </span>
                  </div>
                  <div className="flow-node-body">
                    {n.kind === 'text' && (
                      <textarea
                        value={n.text || ''}
                        onChange={(e) => {
                          setNodes((list) =>
                            list.map((x) =>
                              x.id === n.id ? { ...x, text: e.target.value } : x,
                            ),
                          )
                          setAutoSaved(false)
                        }}
                        placeholder="Nhập text…"
                      />
                    )}
                    {n.kind === 'image' && (
                      <div className="flow-empty-media">
                        {n.mediaPath ? (
                          <div className="flow-media-ok">
                            {isVideo(n.mediaPath) ? (
                              <video className="flow-media-view" src={fileUrl(n.mediaPath)} controls preload="metadata" />
                            ) : (
                              <img className="flow-media-view" src={fileUrl(n.mediaPath)} alt="" />
                            )}
                            <div className="flow-media-name" title={n.mediaPath}>
                              🖼 {n.mediaLabel || baseName(n.mediaPath)}
                              <button type="button" className="flow-linkish" onClick={() => patchNode(n.id, { mediaPath: undefined, mediaLabel: undefined })}>
                                Gỡ
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flow-media-ico">🖼</div>
                            <div className="flow-media-title">Add an image</div>
                            <div className="flow-media-sub">
                              {n.busy ? '⏳ Đang tạo qua Flow…' : 'Upload, hoặc Generate từ prompt / node nối vào'}
                            </div>
                            <textarea
                              className="flow-node-prompt"
                              placeholder="Prompt (tuỳ chọn nếu đã nối node Text)…"
                              value={n.text || ''}
                              onMouseDown={(e) => e.stopPropagation()}
                              onChange={(e) => patchNode(n.id, { text: e.target.value })}
                            />
                            {n.err && <div className="flow-node-err">❌ {n.err}</div>}
                            <div className="flow-media-acts">
                              <div className="flow-upload-wrap">
                                <button
                                  type="button"
                                  className="flow-upload"
                                  onClick={() => setUploadOpen(uploadOpen === n.id ? null : n.id)}
                                >
                                  Upload ▾
                                </button>
                                {uploadOpen === n.id && (
                                  <div className="flow-upload-menu">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setUploadOpen(null)
                                        uploadFor.current = n.id
                                        if (uploadRef.current) {
                                          uploadRef.current.accept = 'image/*'
                                          uploadRef.current.click()
                                        }
                                      }}
                                    >
                                      <span>⬆</span> Upload from device
                                    </button>
                                    <button type="button" onClick={() => void browseFile(n.id, 'image')}>
                                      <span>📁</span> Browse my files
                                    </button>
                                  </div>
                                )}
                              </div>
                              <span className="or">or</span>
                              <button
                                type="button"
                                className="flow-gen"
                                disabled={n.busy}
                                onClick={() => void generate(n.id)}
                              >
                                {n.busy ? '⏳' : '✦ Generate'}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {n.kind === 'video' && (
                      <div className="flow-empty-media">
                        {n.mediaPath ? (
                          <div className="flow-media-ok">
                            {isVideo(n.mediaPath) ? (
                              <video className="flow-media-view" src={fileUrl(n.mediaPath)} controls preload="metadata" />
                            ) : (
                              <img className="flow-media-view" src={fileUrl(n.mediaPath)} alt="" />
                            )}
                            <div className="flow-media-name" title={n.mediaPath}>
                              🎥 {n.mediaLabel || baseName(n.mediaPath)}
                              <button type="button" className="flow-linkish" onClick={() => patchNode(n.id, { mediaPath: undefined, mediaLabel: undefined })}>
                                Gỡ
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flow-media-ico vid">🎥</div>
                            <div className="flow-media-title">Add a video</div>
                            <div className="flow-media-sub">
                              {n.busy ? '⏳ Đang tạo qua Flow…' : 'Upload, hoặc Generate từ prompt / node nối vào'}
                            </div>
                            <textarea
                              className="flow-node-prompt"
                              placeholder="Prompt (tuỳ chọn nếu đã nối node Text)…"
                              value={n.text || ''}
                              onMouseDown={(e) => e.stopPropagation()}
                              onChange={(e) => patchNode(n.id, { text: e.target.value })}
                            />
                            {n.err && <div className="flow-node-err">❌ {n.err}</div>}
                            <div className="flow-media-acts">
                              <div className="flow-upload-wrap">
                                <button
                                  type="button"
                                  className="flow-upload"
                                  onClick={() => setUploadOpen(uploadOpen === n.id ? null : n.id)}
                                >
                                  Upload ▾
                                </button>
                                {uploadOpen === n.id && (
                                  <div className="flow-upload-menu">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setUploadOpen(null)
                                        uploadFor.current = n.id
                                        if (uploadRef.current) {
                                          uploadRef.current.accept = 'video/*'
                                          uploadRef.current.click()
                                        }
                                      }}
                                    >
                                      <span>⬆</span> Upload from device
                                    </button>
                                    <button type="button" onClick={() => void browseFile(n.id, 'video')}>
                                      <span>📁</span> Browse my files
                                    </button>
                                  </div>
                                )}
                              </div>
                              <span className="or">or</span>
                              <button
                                type="button"
                                className="flow-gen"
                                disabled={n.busy}
                                onClick={() => void generate(n.id)}
                              >
                                {n.busy ? '⏳' : '✦ Generate'}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {n.kind === 'frame' && (
                      <textarea
                        className="flow-frame-box"
                        value={n.text || ''}
                        placeholder="Frame · ghi chú cho nhóm node"
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => patchNode(n.id, { text: e.target.value })}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    className={`flow-port left ${connecting != null && connecting !== n.id ? 'target' : ''}`}
                    title="In — bấm để nhận dây (bấm khi không nối = gỡ dây vào)"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onPort(n.id, 'in')}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className={`flow-port right ${connecting === n.id ? 'on' : ''}`}
                    title="Out — bấm rồi chọn cổng In của node đích"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onPort(n.id, 'out')}
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Side panels */}
          {panel === 'log' && (
            <div className="flow-panel">
              <div className="flow-panel-head">
                <strong>Log</strong>
                <button type="button" onClick={() => setPanel(null)}>
                  ✕
                </button>
              </div>
              <div className="flow-panel-body log">
                {logs.map((l, i) => (
                  <div key={i} className="flow-log-line">
                    {l}
                  </div>
                ))}
              </div>
            </div>
          )}
          {panel === 'results' && (
            <div className="flow-panel">
              <div className="flow-panel-head">
                <strong>Kết quả</strong>
                <button type="button" onClick={() => setPanel(null)}>
                  ✕
                </button>
              </div>
              <div className="flow-panel-body">
                {!results.length && (
                  <div className="flow-empty-saved">Chưa có kết quả — Generate trên node Video/Image</div>
                )}
                {results.map((r) => (
                  <div key={r.id} className="flow-result-row">
                    <span>{r.label}</span>
                    <span className="tag done">{r.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {panel === 'import' && (
            <div className="flow-panel">
              <div className="flow-panel-head">
                <strong>Import / Export</strong>
                <button type="button" onClick={() => setPanel(null)}>
                  ✕
                </button>
              </div>
              <div className="flow-panel-body">
                <p className="flow-ie-note">JSON workflow: node + dây nối + đường dẫn media</p>
                <button type="button" className="flow-big-btn" onClick={exportJson}>
                  <span className="flow-big-ico">⬇</span>
                  <span>
                    <strong>Export</strong>
                    <small>Tải file .json</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="flow-big-btn save"
                  onClick={() => fileRef.current?.click()}
                >
                  <span className="flow-big-ico">⬆</span>
                  <span>
                    <strong>Import</strong>
                    <small>Chọn file .json</small>
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="flow-foot-hint">
          Đang chọn: <b>{selected.title}</b> #{selected.id} · kéo để di chuyển (Pan) · Duplicate / Delete trên node
        </div>
      )}

      <input
        ref={uploadRef}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f && uploadFor.current != null) void uploadDevice(uploadFor.current, f)
          e.target.value = ''
        }}
      />

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importJson(f)
          e.target.value = ''
        }}
      />

      {toast && <div className="flow-toast">{toast}</div>}
    </div>
  )
}
