import { OnePromptCheck, splitPrompts, useOnePrompt } from './OnePrompt'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MutableRefObject,
} from 'react'
import { errText, pickFolder, waitJob } from './bridge'
import './t2v.css'

type VeoMode = 'text' | 'image' | 'ingredients' | 'video' | 'omni' | 'script'
type IngTab = 'ingredients' | 'character'
type ProjectTab = 'sync' | 'youtube' | 'tiktok' | 'upload' | 'ideas'
type JobStatus = 'cho' | 'dang_chay' | 'xong' | 'loi'
type ViewMode = 'list' | 'grid2' | 'grid3' | 'grid4'

type FileItem = { id: string; name: string; url?: string; kind: 'image' | 'video' | 'text' }
type I2VItem = {
  id: string
  name: string
  url?: string
  prompt: string
  endFrame?: { id: string; name: string; url?: string } | null
}
type Ingredient = { id: string; prompt: string; images: FileItem[] }
type CharItem = { id: string; tag: string; image?: FileItem }
type ScriptProject = {
  id: string
  title: string
  source: ProjectTab
  style: string
  script: string
  durationSec: number
  createdAt: number
  link?: string
}
type VeoJob = {
  id: string
  title: string
  prompt: string
  mode: VeoMode
  ratio: string
  status: JobStatus
  progress: number
  createdAt: number
  fileId?: string
  /** Job thật do cầu nối Python chạy (Text To Video). */
  bridge?: boolean
  files?: string[]
  msg?: string
}

type BridgeItem = {
  scene: string
  prompt: string
  status: 'cho' | 'dang_chay' | 'xong' | 'loi'
  msg: string
  files: string[]
  t: number
}

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

const fileUrl = (p: string) => `/api/file?path=${encodeURIComponent(p)}`

/** Tiến độ ước theo dòng trạng thái của image_gen (Google không trả %). */
function progressOf(it: BridgeItem): number {
  if (it.status === 'xong' || it.status === 'loi') return 100
  if (it.status === 'cho') return 0
  const m = it.msg || ''
  if (m.includes('Tải video')) return 92
  if (m.includes('Đang dựng')) {
    const sec = Number((m.match(/(\d+)s/) || [])[1] || 0)
    return Math.min(88, 20 + Math.round(sec / 2))
  }
  return 12
}

const LS_KEY = 'pb_media_veo3_mock_v1'
const MODE_LABEL: Record<VeoMode, string> = {
  text: 'Text To Video',
  image: 'Image To Video',
  ingredients: 'Ingredients To Video',
  video: 'Video To Video',
  omni: 'Omni (abra_edit)',
  script: 'Script To Video',
}
const STYLES = [
  'Default', 'Pixar', 'Disney', 'Anime', 'Stick Figure Animation', '2D Cartoon',
  '3D Animation', 'Claymation', 'Whiteboard Animation', 'Motion Graphics',
  'Black & White', 'Vintage/Retro',
]
const OMNI_INTENTS = [
  { id: 'restyle', label: 'Style transfer', hint: 'Đổi phong cách video theo style/ảnh' },
  { id: 'edit', label: 'Edit scene', hint: 'Sửa nội dung / hành động trong video' },
  { id: 'extend', label: 'Extend', hint: 'Kéo dài / tiếp nối cảnh' },
] as const
type OmniIntent = (typeof OMNI_INTENTS)[number]['id']
const OMNI_MODEL = 'Omni (abra_edit)'
const DEFAULT_MODELS = ['Veo 3.1 Fast', 'Veo 3.1', 'Veo 3.1 Lite', 'Veo 3 Quality', OMNI_MODEL]
const VOICE_NONE = 'Không dùng giọng nói'
const VEO_VOICES = [
  VOICE_NONE,
  'Achernar', 'Achird', 'Algenib', 'Aoede', 'Charon',
  'Fenrir', 'Kore', 'Leda', 'Orus', 'Puck', 'Zephyr',
] as const
const MODES: VeoMode[] = ['text', 'image', 'ingredients', 'video', 'omni', 'script']

/* ---- Text To Video (bố cục theo SuperVeo) ---- */
type T2VFile = { id: string; name: string; prompts: string[] }
const T2V_RATIOS = ['9:16', '16:9'] as const
const T2V_OMNI_FLASH = '✨ Omni Flash'
const T2V_MODELS: readonly string[] = ['Veo 3.1 Fast', 'Veo 3.1 Lite', 'Veo 3.1 Relax', 'Veo 3.1 Quality', T2V_OMNI_FLASH]
const T2V_DURATIONS = [
  { id: '8s', label: '8 giây (12 credits)' },
  { id: '10s', label: '10 giây (15 credits)' },
] as const
const T2V_PLACEHOLDER = [
  'Nhập prompt cho video...',
  '',
  'Viết mỗi dòng một prompt:',
  '• A dog running on the beach',
  '• A cat sleeping on a sunny sofa',
  '',
  '• Hoặc dán JSON object (cả khối = 1 prompt):',
  '{',
  '  "scene": {',
  '    "composition": "Medium shot, golden hour"',
  '  },',
  '  "subject": {',
  '    "description": "a young woman walking"',
  '  }',
  '}',
].join('\n')
function parseT2VPrompts(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const v: unknown = JSON.parse(t)
      if (Array.isArray(v)) {
        return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)).trim()).filter(Boolean)
      }
      if (v && typeof v === 'object') return [JSON.stringify(v)]
    } catch { /* không phải JSON → tách theo dòng */ }
  }
  return t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}
function t2vLogTone(line: string) {
  if (line.includes('❌')) return 'err'
  if (line.includes('✅') || line.includes('🎉') || line.includes('🏁')) return 'ok'
  if (line.includes('⚠️') || line.includes('🛑')) return 'warn'
  if (line.includes('ℹ️') || line.includes('⚡')) return 'info'
  return ''
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}
function statusLabel(s: JobStatus) {
  switch (s) {
    case 'cho': return { text: 'Chờ xử lý', cls: 'wait' }
    case 'dang_chay': return { text: 'Đang tạo', cls: 'run' }
    case 'xong': return { text: 'Completed', cls: 'done' }
    case 'loi': return { text: 'Lỗi', cls: 'err' }
  }
}
function countPromptLines(text: string) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length
}
function readPersisted(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
function filesToItems(files: File[], kind: FileItem['kind']): FileItem[] {
  return files.map((f) => ({
    id: uid('f'),
    name: f.name,
    kind,
    url: kind === 'image' || kind === 'video' ? URL.createObjectURL(f) : undefined,
  }))
}

function FilePicker({
  accept, multiple, onFiles, inputRef,
}: {
  accept: string
  multiple?: boolean
  onFiles: (files: File[]) => void
  inputRef?: MutableRefObject<HTMLInputElement | null>
}) {
  const localRef = useRef<HTMLInputElement | null>(null)
  const ref = inputRef ?? localRef
  return (
    <input
      ref={(el) => { ref.current = el }}
      type="file"
      accept={accept}
      multiple={multiple}
      hidden
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        const list = Array.from(e.target.files || [])
        if (list.length) onFiles(list)
        e.target.value = ''
      }}
    />
  )
}

export default function Veo3Workspace() {
  const saved = useMemo(() => readPersisted(), [])
  const [mode, setMode] = useState<VeoMode>((saved.mode as VeoMode) || 'text')
  const [modeOpen, setModeOpen] = useState(false)
  const [ratio, setRatio] = useState((saved.ratio as string) || '9:16')
  const [model, setModel] = useState((saved.model as string) || 'Veo 3.1 Fast')
  const [autoUpscale, setAutoUpscale] = useState(Boolean(saved.autoUpscale))
  const [autoCrop, setAutoCrop] = useState(Boolean(saved.autoCrop))
  const [voice, setVoice] = useState(() => {
    const raw = (saved.voice as string) || VOICE_NONE
    if (raw === 'No voice (default)' || raw === 'Auto voice' || raw === 'Custom voice' || raw === 'Không') return VOICE_NONE
    return (VEO_VOICES as readonly string[]).includes(raw) ? raw : VOICE_NONE
  })
  const [outDir, setOutDir] = useState((saved.outDir as string) || '')
  const [prompt, setPrompt] = useState(
    (saved.prompt as string) ||
      'Aloha Floral Parade 2026 — sunny street, flower floats, warm crowd energy, cinematic tracking shot…',
  )
  const [promptFileName, setPromptFileName] = useState<string | null>(null)
  const [t2vModel, setT2vModel] = useState(() => {
    const s0 = (saved.t2vModel as string) || ''
    return T2V_MODELS.includes(s0) ? s0 : T2V_MODELS[0]
  })
  const [t2vDuration, setT2vDuration] = useState((saved.t2vDuration as string) || '8s')
  const [t2vFiles, setT2vFiles] = useState<T2VFile[]>([])
  const [t2vDrag, setT2vDrag] = useState(false)
  const [t2vLogAll, setT2vLogAll] = useState(false)
  const [view, setView] = useState<ViewMode>((saved.view as ViewMode) || 'list')
  const [picked, setPicked] = useState<string[]>([])
  const [logOpen, setLogOpen] = useState(saved.logOpen !== false)
  const [logs, setLogs] = useState<string[]>(['Sẵn sàng — mọi mode chạy thật qua tool Python'])
  const [scriptBusy, setScriptBusy] = useState(false)
  const [ingTab, setIngTab] = useState<IngTab>((saved.ingTab as IngTab) || 'ingredients')
  const [ingredients, setIngredients] = useState<Ingredient[]>([
    { id: uid('ing'), prompt: '', images: [] },
  ])
  const [chars, setChars] = useState<CharItem[]>([{ id: uid('char'), tag: '@nhanvat1' }])
  const [charPrompt, setCharPrompt] = useState('')
  const [images, setImages] = useState<I2VItem[]>([])
  const [endFrameOn, setEndFrameOn] = useState(false)
  const [batchPromptOpen, setBatchPromptOpen] = useState(false)
  const [batchPromptText, setBatchPromptText] = useState('')
  const endFrameTarget = useRef<string | null>(null)
  const endFrameRef = useRef<HTMLInputElement | null>(null)
  const [sourceVideo, setSourceVideo] = useState<FileItem | null>(null)
  const [refImages, setRefImages] = useState<FileItem[]>([])
  const [v2vDuration, setV2vDuration] = useState((saved.v2vDuration as string) || '8')
  const [v2vPrompts, setV2vPrompts] = useState([''])
  const [projects, setProjects] = useState<ScriptProject[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [projectOpen, setProjectOpen] = useState(false)
  const [projectTab, setProjectTab] = useState<ProjectTab>('sync')
  const [ytLink, setYtLink] = useState('')
  const [ttLink, setTtLink] = useState('')
  const [style, setStyle] = useState((saved.style as string) || 'Default')
  const [styleSearch, setStyleSearch] = useState('')
  const [removeOverlay, setRemoveOverlay] = useState(saved.removeOverlay !== false)
  const [omniIntent, setOmniIntent] = useState<OmniIntent>((saved.omniIntent as OmniIntent) || 'restyle')
  const [styleRefImages, setStyleRefImages] = useState<FileItem[]>([])
  const [syncScript, setSyncScript] = useState('')
  const [syncDuration, setSyncDuration] = useState('30')
  const [syncImages, setSyncImages] = useState<(FileItem | null)[]>([null, null, null])
  const [ideaText, setIdeaText] = useState('')
  const [ideaMinutes, setIdeaMinutes] = useState(1)
  const [ideaSeconds, setIdeaSeconds] = useState(0)
  const [customPrompt, setCustomPrompt] = useState('')
  const [uploadScriptName, setUploadScriptName] = useState<string | null>(null)
  const [uploadScriptBody, setUploadScriptBody] = useState('')
  const [mockJobs, setJobs] = useState<VeoJob[]>([])
  const [bridgeJobs, setBridgeJobs] = useState<VeoJob[]>([])
  const [hiddenJobs, setHiddenJobs] = useState<string[]>([])
  const [bridgeRunning, setBridgeRunning] = useState(false)
  const [bridgeBusyOther, setBridgeBusyOther] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const jobs = useMemo(
    () => [...bridgeJobs.filter((j) => !hiddenJobs.includes(j.id)), ...mockJobs],
    [bridgeJobs, hiddenJobs, mockJobs],
  )
  const logSince = useRef(0)
  const daUpscale = useRef<Set<string>>(new Set())

  async function upscaleFile(path: string) {
    try {
      await api('/api/util/upscale', { path, scale: 2 })
      pushLog(`⬆ Upscale x2: ${path.split(/[\\/]/).pop()} → *_x2.mp4 (xem nhật ký Upscale)`)
      showToast('Đang upscale x2…')
    } catch (e) {
      showToast(`Không upscale được: ${(e as Error).message}`)
    }
  }

  const txtInputRef = useRef<HTMLInputElement | null>(null)
  const imgFolderRef = useRef<HTMLInputElement | null>(null)
  const imgFilesRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLInputElement | null>(null)
  const refImgRef = useRef<HTMLInputElement | null>(null)
  const syncSlotRef = useRef<HTMLInputElement | null>(null)
  const syncSlotIndex = useRef(0)
  const uploadScriptRef = useRef<HTMLInputElement | null>(null)
  const charImgRef = useRef<HTMLInputElement | null>(null)
  const charImgTarget = useRef<string | null>(null)
  const ingSlotRef = useRef<HTMLInputElement | null>(null)
  const ingSlotTarget = useRef<{ ingId: string; slot: number } | null>(null)

  const [onePrompt, setOnePrompt] = useOnePrompt('veo3')
  const t2vTextPrompts = useMemo(
    () => (onePrompt ? splitPrompts(prompt, true) : parseT2VPrompts(prompt)),
    [prompt, onePrompt],
  )
  const t2vAllPrompts = useMemo(
    () => (t2vFiles.length ? t2vFiles.flatMap((f) => f.prompts) : t2vTextPrompts),
    [t2vFiles, t2vTextPrompts],
  )
  const promptCount = t2vAllPrompts.length
  const t2vRatio: string = (T2V_RATIOS as readonly string[]).includes(ratio) ? ratio : '9:16'
  const charPromptCount = useMemo(() => splitPrompts(charPrompt, onePrompt).length, [charPrompt, onePrompt])
  const v2vPromptCount = useMemo(() => v2vPrompts.filter((p) => p.trim()).length, [v2vPrompts])
  const totalIngImages = useMemo(
    () => ingredients.reduce((n, i) => n + i.images.length, 0),
    [ingredients],
  )
  const filteredStyles = STYLES.filter((s) => s.toLowerCase().includes(styleSearch.toLowerCase()))
  const activeProject = projects.find((p) => p.id === activeProjectId) || null
  const doneCount = jobs.filter((j) => j.status === 'xong').length
  const errCount = jobs.filter((j) => j.status === 'loi').length
  const runCount = jobs.filter((j) => j.status === 'dang_chay').length

  const pushLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('vi-VN', { hour12: false })
    setLogs((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 300))
  }, [])

  // ── Job thật của Text To Video: đồng bộ từ cầu nối 1,5 giây một lần ──
  useEffect(() => {
    let dead = false
    const tick = async () => {
      try {
        const [st, lg] = await Promise.all([
          api<{ running: boolean; busy: boolean; busy_kind: string; items: BridgeItem[] }>(
            '/api/flow/state?kind=veo3',
          ),
          api<{ logs: { id: number; time: string; tag: string; msg: string }[] }>(
            `/api/logs?since=${logSince.current}`,
          ),
        ])
        if (dead) return
        setBridgeRunning(st.running)
        setBridgeBusyOther(st.busy && !st.running ? st.busy_kind : '')
        setBridgeJobs(
          st.items.map((x) => ({
            id: `veo3:${x.scene}`,
            title: `Cảnh ${x.scene}`,
            prompt: x.prompt,
            mode: 'text' as VeoMode,
            ratio: '',
            status: x.status,
            progress: progressOf(x),
            createdAt: Math.round(x.t * 1000),
            bridge: true,
            files: x.files || [],
            msg: x.msg,
          })),
        )
        if (lg.logs.length) {
          logSince.current = lg.logs[lg.logs.length - 1].id
          const mine = lg.logs.filter((l) => l.tag === 'veo3')
          if (mine.length) {
            setLogs((prev) =>
              [...mine.slice().reverse().map((l) => `[${l.time}] ${l.msg}`), ...prev].slice(0, 300),
            )
          }
        }
      } catch {
        /* cầu nối chưa chạy — nút Bắt đầu sẽ báo lỗi */
      }
    }
    tick()
    const t = window.setInterval(tick, 1500)
    return () => {
      dead = true
      window.clearInterval(t)
    }
  }, [])
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        mode, ratio, model, outDir, autoUpscale, autoCrop, voice, prompt,
        view, logOpen, ingTab, v2vDuration, style, removeOverlay, omniIntent,
        t2vModel, t2vDuration,
      }))
    } catch { /* ignore */ }
  }, [mode, ratio, model, outDir, autoUpscale, autoCrop, voice, prompt, view, logOpen, ingTab, v2vDuration, style, removeOverlay, omniIntent, t2vModel, t2vDuration])


  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest?.('.veo-mode-dd')) setModeOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Auto Upscale: video thật vừa xong thì tự upscale x2 (một lần mỗi file).
  useEffect(() => {
    if (!autoUpscale) return
    for (const j of bridgeJobs) {
      const f = j.files?.[0]
      if (j.status === 'xong' && f && !/_x[24]\.mp4$/i.test(f) && !daUpscale.current.has(f)) {
        daUpscale.current.add(f)
        void upscaleFile(f)
      }
    }
  }, [bridgeJobs, autoUpscale]) // eslint-disable-line react-hooks/exhaustive-deps

  const startLabel = (() => {
    if (mode === 'text') return `Bắt đầu tạo video (${promptCount})`
    if (mode === 'image') return `Bắt đầu tạo video (${images.length})`
    if (mode === 'ingredients' && ingTab === 'character')
      return `Tạo ${charPromptCount} video (${chars.length} nhân vật)`
    if (mode === 'ingredients') return `Bắt đầu tạo video (${ingredients.length} ingredients)`
    if (mode === 'video') return `Tạo Video (${v2vPromptCount} prompts)`
    if (mode === 'omni') return `Omni edit (${v2vPromptCount} prompts)`
    if (activeProject) return 'Tạo video từ dự án'
    return 'Chọn dự án để tạo video'
  })()

  const canStart = (() => {
    if (mode === 'text') return promptCount > 0
    if (mode === 'image') return images.length > 0
    if (mode === 'ingredients' && ingTab === 'character') return charPromptCount > 0
    if (mode === 'ingredients') return ingredients.length > 0
    if (mode === 'video') return !!sourceVideo && v2vPromptCount > 0
    if (mode === 'omni') return !!sourceVideo && v2vPromptCount > 0
    if (mode === 'script') return !!activeProject
    return false
  })()

  async function startTextReal(prompts: string[]) {
    try {
      const r = await api<{ n: number; out_dir: string }>('/api/flow/start?kind=veo3', {
        prompts,
        model: t2vModel,
        duration: t2vModel === T2V_OMNI_FLASH ? t2vDuration : '8s',
        ratio: t2vRatio,
        out_dir: outDir,
        workers: 8,
      })
      if (!outDir) setOutDir(r.out_dir)
      pushLog(`▶ Gửi ${r.n} prompt · ${t2vModel} · ${t2vRatio} → ${r.out_dir}`)
      showToast(`Đã gửi ${r.n} prompt`)
    } catch (e) {
      showToast(`Không chạy được: ${(e as Error).message}`)
      pushLog(`❌ ${(e as Error).message}`)
    }
  }

  /** Đẩy file người dùng chọn (blob URL) lên cầu nối → đường dẫn trên máy. Nhớ theo URL. */
  const uploaded = useRef<Map<string, string>>(new Map())
  async function uploadUrl(url: string | undefined, name: string): Promise<string> {
    if (!url) throw new Error(`Thiếu file ${name}`)
    const hit = uploaded.current.get(url)
    if (hit) return hit
    const blob = await fetch(url).then((r) => r.blob())
    const r = await fetch(`/api/upload?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; path?: string; error?: string }
    if (!r.ok || !j.ok || !j.path) throw new Error(j.error || `Không gửi được ${name}`)
    uploaded.current.set(url, j.path)
    return j.path
  }

  async function startModeReal() {
    try {
      let body: Record<string, unknown>
      // Cài đặt › Ảnh (pad/crop) — cầu nối khớp ảnh tham chiếu về đúng tỉ lệ khi bật Auto Crop
      let cropMode = 'pad'
      try {
        cropMode = JSON.parse(localStorage.getItem('pb.settings.img.mode') || '"pad"') === 'crop' ? 'crop' : 'pad'
      } catch {
        /* mặc định pad */
      }
      const base = { ratio, out_dir: outDir, workers: 8, auto_crop: autoCrop, crop_mode: cropMode }
      if (mode === 'image') {
        pushLog(`⬆ Gửi ${images.length} ảnh lên tool…`)
        const items = []
        for (const im of images) {
          items.push({ path: await uploadUrl(im.url, im.name), prompt: im.prompt })
        }
        if (images.some((im) => im.endFrame)) pushLog('ℹ️ End Frame chưa hỗ trợ — chỉ dùng ảnh đầu.')
        body = { ...base, mode: 'i2v', images: items, model, duration: '8s' }
      } else if (mode === 'ingredients' && ingTab === 'ingredients') {
        const ings = []
        for (const ing of ingredients) {
          const paths = []
          for (const f of ing.images) paths.push(await uploadUrl(f.url, f.name))
          ings.push({ prompt: ing.prompt, images: paths })
        }
        body = { ...base, mode: 'chars', ingredients: ings }
      } else if (mode === 'ingredients') {
        const refs = []
        for (const c of chars) {
          if (c.image) refs.push({ tag: c.tag, path: await uploadUrl(c.image.url, c.image.name) })
        }
        body = {
          ...base,
          mode: 'chars',
          prompts: splitPrompts(charPrompt, onePrompt),
          refs,
        }
      } else if (mode === 'video' || mode === 'omni') {
        if (!sourceVideo) throw new Error('Chưa chọn video nguồn')
        pushLog(`⬆ Gửi video nguồn ${sourceVideo.name}…`)
        const vid = await uploadUrl(sourceVideo.url, sourceVideo.name)
        const imgs = mode === 'video' ? refImages : styleRefImages
        const refs = []
        for (const f of imgs.slice(0, 5)) refs.push({ path: await uploadUrl(f.url, f.name) })
        const intentLabel = OMNI_INTENTS.find((x) => x.id === omniIntent)?.label || omniIntent
        const prompts = v2vPrompts
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) =>
            mode === 'omni'
              ? `${intentLabel}: ${x}${style !== 'Default' ? `. Style: ${style}` : ''}`
              : x,
          )
        body = {
          ...base,
          mode: 'v2v',
          prompts,
          v2v_videos: [vid],
          refs,
          v2v_seconds: v2vDuration,
          voice: mode === 'video' && voice !== VOICE_NONE ? voice : '',
        }
      } else {
        throw new Error(`${MODE_LABEL[mode]} chưa nối API thật`)
      }
      const r = await api<{ n: number; out_dir: string }>('/api/flow/start?kind=veo3', body)
      if (!outDir) setOutDir(r.out_dir)
      pushLog(`▶ ${MODE_LABEL[mode]} · gửi ${r.n} cảnh → ${r.out_dir}`)
      showToast(`Đã gửi ${r.n} cảnh`)
    } catch (e) {
      showToast(`Không chạy được: ${(e as Error).message}`)
      pushLog(`❌ ${(e as Error).message}`)
    }
  }

  function handleStart() {
    if (mode === 'text') {
      if (!canStart || bridgeRunning) return
      void startTextReal(t2vAllPrompts.slice(0, 200))
      return
    }
    if (mode !== 'script') {
      if (!canStart || bridgeRunning) return
      if (bridgeBusyOther) {
        showToast('Đang chạy mẻ Tạo ảnh — chờ xong')
        return
      }
      void startModeReal()
      return
    }
    if (!canStart || !activeProject || scriptBusy || bridgeRunning) return
    void startScriptReal(activeProject)
  }

  /** Script To Video: Gemini chia dự án thành prompt từng cảnh 8s → gửi Veo3 T2V như mode Text. */
  async function startScriptReal(proj: ScriptProject) {
    setScriptBusy(true)
    pushLog(`🎬 ${proj.title}: Gemini đang chia cảnh…`)
    try {
      const r = await api<{ id: string }>('/api/veo3/script', {
        title: proj.title,
        source: proj.source,
        script: proj.script,
        link: proj.link,
        style: proj.style,
        durationSec: proj.durationSec,
        ratio,
      })
      const j = await waitJob(r.id)
      const prompts = ((j as unknown as { result?: { prompts: string[] } }).result?.prompts || []).slice(0, 200)
      if (!prompts.length) throw new Error('Không có prompt nào')
      pushLog(`✅ ${prompts.length} cảnh — gửi Veo3`)
      await startTextReal(prompts)
    } catch (e) {
      showToast(errText(e))
      pushLog(`❌ ${errText(e)}`)
    } finally {
      setScriptBusy(false)
    }
  }
  function handleStop() {
    api('/api/flow/stop', {}).catch(() => {})
    pushLog('⏹ Đã bấm Dừng')
  }
  async function ingestTxtFiles(files: File[]) {
    const texts: string[] = []
    for (const f of files) {
      if (!/\.(txt|json|md)$/i.test(f.name) && !f.type.startsWith('text')) continue
      texts.push(await f.text())
    }
    if (!texts.length) { showToast('Không đọc được file TXT/JSON'); return }
    const merged = texts.join('\n').trim()
    setPrompt(merged)
    setPromptFileName(files[0]?.name || 'prompts.txt')
    pushLog(`Đã nạp ${files.length} file prompt · ${countPromptLines(merged)} dòng`)
    showToast(`Nạp ${countPromptLines(merged)} prompt`)
  }
  function addImages(files: File[]) {
    const imgs = files.filter((f) => /\.(png|jpe?g|jfif|webp|gif)$/i.test(f.name) || f.type.startsWith('image/'))
    if (!imgs.length) { showToast('Chỉ nhận ảnh PNG/JPG/WebP'); return }
    const items: I2VItem[] = imgs.map((f) => ({
      id: uid('i2v'),
      name: f.name,
      url: URL.createObjectURL(f),
      prompt: '',
      endFrame: null,
    }))
    setImages((prev) => [...prev, ...items])
    pushLog(`Đã thêm ${items.length} ảnh`)
    showToast(`+${items.length} ảnh`)
  }
  function clearAllImages() {
    images.forEach((i) => {
      if (i.url) URL.revokeObjectURL(i.url)
      if (i.endFrame?.url) URL.revokeObjectURL(i.endFrame.url)
    })
    setImages([])
    pushLog('Đã xóa hết ảnh Image To Video')
    showToast('Đã xóa hết ảnh')
  }
  function setImagePrompt(id: string, prompt: string) {
    setImages((list) => list.map((x) => (x.id === id ? { ...x, prompt } : x)))
  }
  function removeImage(id: string) {
    setImages((list) => {
      const hit = list.find((x) => x.id === id)
      if (hit?.url) URL.revokeObjectURL(hit.url)
      if (hit?.endFrame?.url) URL.revokeObjectURL(hit.endFrame.url)
      return list.filter((x) => x.id !== id)
    })
  }
  function duplicateImage(id: string) {
    setImages((list) => {
      const hit = list.find((x) => x.id === id)
      if (!hit) return list
      const copy: I2VItem = {
        ...hit,
        id: uid('i2v'),
        name: hit.name.replace(/(\.[^.]+)?$/, '_copy$1'),
        prompt: hit.prompt,
        endFrame: hit.endFrame
          ? { id: uid('ef'), name: hit.endFrame.name, url: hit.endFrame.url }
          : null,
      }
      const idx = list.findIndex((x) => x.id === id)
      const next = [...list]
      next.splice(idx + 1, 0, copy)
      pushLog(`Đã nhân bản ${hit.name}`)
      return next
    })
  }
  function assignEndFrame(files: File[]) {
    const id = endFrameTarget.current
    if (!id) return
    const f = files.find((x) => /\.(png|jpe?g|jfif|webp|gif)$/i.test(x.name) || x.type.startsWith('image/'))
    if (!f) { showToast('Chỉ nhận ảnh cho End Frame'); return }
    const url = URL.createObjectURL(f)
    setImages((list) => list.map((x) => {
      if (x.id !== id) return x
      if (x.endFrame?.url) URL.revokeObjectURL(x.endFrame.url)
      return { ...x, endFrame: { id: uid('ef'), name: f.name, url } }
    }))
    pushLog(`End Frame → ${f.name}`)
    endFrameTarget.current = null
  }
  function clearEndFrame(id: string) {
    setImages((list) => list.map((x) => {
      if (x.id !== id) return x
      if (x.endFrame?.url) URL.revokeObjectURL(x.endFrame.url)
      return { ...x, endFrame: null }
    }))
  }
  function parseBatchPrompts(raw: string): string[] {
    const t = raw.trim()
    if (!t) return []
    if (t.startsWith('[') || t.startsWith('{')) {
      try {
        const j = JSON.parse(t)
        if (Array.isArray(j)) {
          return j.map((x) => {
            if (typeof x === 'string') return x.trim()
            if (x && typeof x === 'object' && typeof (x as { prompt?: string }).prompt === 'string')
              return String((x as { prompt: string }).prompt).trim()
            return String(x).trim()
          }).filter(Boolean)
        }
        if (j && typeof j === 'object' && Array.isArray((j as { prompts?: unknown }).prompts)) {
          return ((j as { prompts: unknown[] }).prompts).map((x) => String(x).trim()).filter(Boolean)
        }
      } catch { /* fallthrough to lines */ }
    }
    return t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  }
  function applyBatchPrompts() {
    const prompts = parseBatchPrompts(batchPromptText)
    if (!prompts.length) { showToast('Chưa có prompt nào'); return }
    setImages((list) => list.map((item, i) => (
      i < prompts.length ? { ...item, prompt: prompts[i] } : item
    )))
    const n = Math.min(prompts.length, images.length)
    pushLog(`Áp dụng ${n} prompts hàng loạt`)
    showToast(`Đã áp dụng ${n} prompts`)
    setBatchPromptOpen(false)
  }
  function setVideoFromFiles(files: File[]) {
    const vid = files.find((f) => /\.(mp4|webm|mov|mkv)$/i.test(f.name) || f.type.startsWith('video/'))
    if (!vid) { showToast('Chỉ nhận video MP4/WebM/MOV'); return }
    if (sourceVideo?.url) URL.revokeObjectURL(sourceVideo.url)
    setSourceVideo(filesToItems([vid], 'video')[0])
    pushLog(`Đã chọn video nguồn: ${vid.name}`)
  }
  function addRefImages(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name))
    if (!imgs.length) return
    setRefImages((prev) => {
      const room = Math.max(0, 5 - prev.length)
      return [...prev, ...filesToItems(imgs.slice(0, room), 'image')]
    })
  }
  function addStyleRefImages(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name))
    if (!imgs.length) return
    setStyleRefImages((prev) => {
      const room = Math.max(0, 3 - prev.length)
      const next = [...prev, ...filesToItems(imgs.slice(0, room), 'image')]
      pushLog(`Omni style ref +${Math.min(room, imgs.length)} ảnh`)
      return next
    })
  }
  function onDropZone(e: DragEvent, kind: 'txt' | 'image' | 'video') {
    e.preventDefault(); e.stopPropagation()
    const files = Array.from(e.dataTransfer.files || [])
    if (!files.length) return
    if (kind === 'txt') void ingestTxtFiles(files)
    else if (kind === 'image') addImages(files)
    else setVideoFromFiles(files)
  }
  function retryJobs(filter?: 'loi' | 'all') {
    const real = bridgeJobs.filter(
      (j) => !hiddenJobs.includes(j.id) && (filter === 'loi' ? j.status === 'loi' : j.status !== 'dang_chay'),
    )
    if (real.length) {
      if (bridgeRunning || bridgeBusyOther) {
        showToast('Đang chạy mẻ khác — chờ xong rồi tạo lại')
        return
      }
      setHiddenJobs((prev) => [...prev, ...real.map((j) => j.id)])
      void startTextReal(real.map((j) => j.prompt))
      return
    }
    showToast(filter === 'loi' ? 'Không có video lỗi để tạo lại' : 'Không có video để tạo lại')
  }
  function deleteJob(id: string) {
    setHiddenJobs((prev) => [...prev, id])
    setJobs((prev) => prev.filter((j) => j.id !== id))
    pushLog('Đã xóa 1 job')
  }
  function clearJobs() {
    api('/api/flow/clear', { kind: 'veo3' }).catch(() => {})
    setHiddenJobs((prev) => [...prev, ...bridgeJobs.filter((j) => j.status !== 'dang_chay').map((j) => j.id)])
    setJobs([]); pushLog('Đã xóa tất cả job (file video vẫn giữ)')
  }
  function createProjectFromModal() {
    const ideaTotalSec = ideaMinutes * 60 + ideaSeconds
    let title = 'Dự án mới'; let script = ''; let durationSec = 30; let link = ''
    if (projectTab === 'sync') {
      title = `Character Sync · ${new Date().toLocaleString('vi-VN')}`
      script = syncScript; durationSec = Number(syncDuration) || 30
    } else if (projectTab === 'youtube') {
      title = `YouTube · ${ytLink.slice(0, 40) || 'link'}`
      script = ''; link = ytLink.trim(); durationSec = 48
    } else if (projectTab === 'tiktok') {
      title = `TikTok · ${ttLink.slice(0, 40) || 'link'}`
      script = ''; link = ttLink.trim(); durationSec = 32
    } else if (projectTab === 'upload') {
      title = uploadScriptName || 'Upload kịch bản'
      script = uploadScriptBody || customPrompt; durationSec = 40
    } else if (projectTab === 'ideas') {
      title = `Ideas · ${ideaText.slice(0, 32) || 'ý tưởng'}`
      script = ideaText; durationSec = Math.max(8, ideaTotalSec)
    }
    const proj: ScriptProject = {
      id: uid('proj'), title, source: projectTab, style,
      script: script + (customPrompt ? `\n\n[Custom]\n${customPrompt}` : ''),
      durationSec, createdAt: Date.now(), link: link || undefined,
    }
    setProjects((p) => [proj, ...p])
    setActiveProjectId(proj.id)
    setProjectOpen(false)
    pushLog(`Đã tạo dự án: ${proj.title}`)
    showToast('Đã tạo dự án — bấm bắt đầu để Gemini chia cảnh và gửi Veo3')
  }

  const ideaTotalSec = ideaMinutes * 60 + ideaSeconds
  const canAnalyze =
    projectTab === 'youtube' ? ytLink.trim().length > 8
    : projectTab === 'tiktok' ? ttLink.trim().length > 8
    : projectTab === 'sync' ? syncScript.trim().length > 0
    : projectTab === 'ideas' ? ideaText.trim().length > 0 && ideaTotalSec > 0
    : projectTab === 'upload' ? !!uploadScriptBody.trim()
    : false

  function ModeDropdown({ meta }: { meta?: string }) {
    return (
      <div className={`veo-mode-dd${meta ? ' with-meta' : ''}`}>
        <button type="button" className={`veo-mode-btn ${modeOpen ? 'open' : ''}`}
          onClick={() => setModeOpen((v) => !v)} aria-expanded={modeOpen}>
          <span className="veo-mode-label">{MODE_LABEL[mode]}</span>
          <span className="chev">{modeOpen ? '▴' : '▾'}</span>
        </button>
        {meta && (
          <span className="veo-mode-meta">
            <span className="veo-mode-meta-ico" aria-hidden>🎬</span>
            <span>{meta}</span>
          </span>
        )}
        {modeOpen && (
          <div className="veo-mode-menu" role="listbox">
            {MODES.map((m) => (
              <button key={m} type="button" role="option" aria-selected={mode === m}
                className={`veo-mode-item ${mode === m ? 'on' : ''}`}
                onClick={() => { setMode(m); setModeOpen(false); pushLog(`Chuyển mode → ${MODE_LABEL[m]}`) }}>
                <span>{MODE_LABEL[m]}</span>
                {mode === m && <span className="veo-mode-check">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  function CommonFooter({ disabled, label, logFirst, hideStatus }: {
    disabled?: boolean; label: string; logFirst?: boolean; hideStatus?: boolean
  }) {
    const dangChay = mode === 'script' ? scriptBusy || bridgeRunning : bridgeRunning
    const startBtn = !dangChay ? (
      <button type="button" className={`veo-start ${disabled ? 'disabled' : ''}`}
        disabled={disabled} onClick={handleStart}>
        <span className="play">▶</span>{label}
      </button>
    ) : (
      <button type="button" className="veo-start stop" onClick={handleStop}>■ Dừng</button>
    )
    const status = (!hideStatus && mode !== 'script') ? (
      <div className={`veo-status ${dangChay ? 'live' : ''}`}>
        {dangChay
          ? `Đang chạy · ${runCount} job · ${doneCount} xong`
          : bridgeBusyOther
            ? 'Đang chạy mẻ Tạo ảnh — chờ xong'
            : 'Sẵn sàng — chọn mode và bấm Bắt đầu'}
      </div>
    ) : null
    const logBox = (
      <div className={`veo-log ${logOpen ? 'open' : ''}`}>
        <div className="veo-log-head">
          <button type="button" className="veo-log-toggle" onClick={() => setLogOpen((v) => !v)}>
            <span className="veo-log-dot" />
            <span>Nhật ký ({logs.length})</span>
            <span className="grow" />
            <span className="chev">{logOpen ? '▴' : '▾'}</span>
          </button>
          <button type="button" className="veo-log-clear"
            onClick={() => { setLogs(['Nhật ký đã xóa']); pushLog('Đã xóa nhật ký') }}>Xóa</button>
        </div>
        {logOpen && (
          <div className="veo-log-body">
            {logs.map((l, i) => (
              <div key={`${i}-${l.slice(0, 16)}`} className="veo-log-line">{l}</div>
            ))}
          </div>
        )}
      </div>
    )
    return logFirst ? (
      <>
        {logBox}
        {startBtn}
      </>
    ) : (
      <>
        {startBtn}
        {status}
        {logBox}
      </>
    )
  }

  function CommonSettings({
    showVoice, showCrop, modelOptions,
  }: { showVoice?: boolean; showCrop?: boolean; modelOptions?: string[] }) {
    const base = modelOptions ?? ['Veo 3.1 Fast', 'Veo 3.1', 'Veo 3.1 Lite', 'Veo 3 Quality']
    const opts = base.includes(OMNI_MODEL) ? base : [...base, OMNI_MODEL]
    const selectValue = opts.includes(model) ? model : opts[0]
    const isOmni = model === OMNI_MODEL
    return (
      <>
        <div className="veo-row2">
          <select className="veo-select" value={ratio} onChange={(e) => setRatio(e.target.value)}>
            <option>9:16</option><option>16:9</option><option>1:1</option>
          </select>
          <select className="veo-select" value={selectValue} onChange={(e) => {
            const v = e.target.value
            setModel(v)
            if (v === OMNI_MODEL) pushLog('Chọn model Omni (abra_edit)')
          }}>
            {opts.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        {isOmni && (
          <div className="veo-omni hero">
            <div className="veo-omni-title">Model: Omni (abra_edit)</div>
            <div className="veo-omni-sub">Video editing &amp; style transfer</div>
          </div>
        )}
        <div className="veo-path">
          <input className="veo-path-input" placeholder="Thư mục lưu..." value={outDir}
            onChange={(e) => setOutDir(e.target.value)} />
          <button type="button" className="veo-path-btn" title="Chọn thư mục"
            onClick={t2vPickFolder}>📁</button>
        </div>
        {showVoice && (
          <select className="veo-select" value={voice} onChange={(e) => setVoice(e.target.value)}>
            {VEO_VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <label className="veo-check">
          <input type="checkbox" checked={autoUpscale} onChange={(e) => setAutoUpscale(e.target.checked)} />
          <span>Auto Upscale</span>
        </label>
        {showCrop && (
          <label className="veo-check">
            <input type="checkbox" checked={autoCrop} onChange={(e) => setAutoCrop(e.target.checked)} />
            <span>Tự động crop ảnh</span>
          </label>
        )}
      </>
    )
  }

  /* ===== Text To Video — bố cục theo SuperVeo ===== */
  async function t2vAddFiles(files: File[]) {
    const added: T2VFile[] = []
    for (const f of files) {
      const okType = /\.(txt|json|md)$/i.test(f.name) || f.type.startsWith('text') || f.type === 'application/json'
      if (!okType) continue
      const prompts = parseT2VPrompts(await f.text())
      if (prompts.length) added.push({ id: uid('t2vf'), name: f.name, prompts })
    }
    if (!added.length) {
      showToast('Không đọc được prompt từ file TXT / JSON')
      pushLog('❌ Không đọc được prompt từ file TXT / JSON')
      return
    }
    setT2vFiles((prev) => [...prev, ...added])
    setPromptFileName(added[0].name)
    const total = added.reduce((n, f) => n + f.prompts.length, 0)
    pushLog(`✅ Đã thêm ${added.length} file · ${total} prompt`)
    showToast(`Đã thêm ${added.length} file (${total} prompt)`)
  }
  function t2vRemoveFile(id: string) {
    setT2vFiles((prev) => prev.filter((f) => f.id !== id))
  }
  function t2vClearFiles() {
    setT2vFiles([])
    setPromptFileName(null)
    pushLog('ℹ️ Đã xóa tất cả file prompt')
  }
  function t2vDragOver(e: DragEvent) {
    e.preventDefault()
    if (!t2vDrag) setT2vDrag(true)
  }
  function t2vDrop(e: DragEvent) {
    e.preventDefault()
    setT2vDrag(false)
    const files = Array.from(e.dataTransfer?.files || [])
    if (files.length) void t2vAddFiles(files)
  }
  function t2vFileStats(id: string) {
    const fj = jobs.filter((j) => j.fileId === id)
    const done = fj.filter((j) => j.status === 'xong').length
    const err = fj.filter((j) => j.status === 'loi').length
    const live = fj.some((j) => j.status === 'dang_chay' || j.status === 'cho')
    return { total: fj.length, done, err, live }
  }
  function t2vCopyPrompts(f: T2VFile) {
    const text = f.prompts.join('\n')
    navigator.clipboard?.writeText(text)
      .then(() => showToast(`Đã copy ${f.prompts.length} prompt`))
      .catch(() => showToast('Không copy được'))
  }
  function t2vPickFolder() {
    showToast('Đang mở hộp chọn thư mục…')
    api<{ path: string }>('/api/pick-folder', { start: outDir })
      .then((r) => {
        if (r.path) {
          setOutDir(r.path)
          pushLog(`ℹ️ Thư mục lưu video: ${r.path}`)
        }
      })
      .catch((e) => showToast(`Không mở được hộp chọn thư mục: ${(e as Error).message}`))
  }

  function renderTextPanel() {
    const isOmniFlash = t2vModel === T2V_OMNI_FLASH
    const textJobs = jobs.filter((j) => j.mode === 'text')
    const textDone = textJobs.filter((j) => j.status === 'xong').length
    const doneFiles = t2vFiles.filter((f) => {
      const st = t2vFileStats(f.id)
      return st.total > 0 && !st.live && st.done + st.err >= st.total
    }).length
    const shownLogs = t2vLogAll ? logs : logs.slice(0, 10)
    return (
      <div className="t2v-panel">
        <div className="t2v-head">
          <div className="t2v-sel t2v-mode">
            <select value={mode} aria-label="Chế độ tạo video"
              onChange={(e) => {
                const m = e.target.value as VeoMode
                setMode(m)
                pushLog(`Chuyển mode → ${MODE_LABEL[m]}`)
              }}>
              {MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </select>
            <span className="t2v-chev" aria-hidden>▾</span>
          </div>
          {t2vFiles.length === 0 && <OnePromptCheck on={onePrompt} setOn={setOnePrompt} />}
          <span className="t2v-count" title={promptFileName ?? undefined}>
            {promptCount} prompt{promptCount !== 1 ? 's' : ''}
          </span>
        </div>

        {t2vFiles.length === 0 ? (
          <textarea className={`t2v-textarea${t2vDrag ? ' drag' : ''}`}
            placeholder={T2V_PLACEHOLDER} value={prompt} spellCheck={false}
            onChange={(e) => { setPrompt(e.target.value); setPromptFileName(null) }}
            onDragOver={t2vDragOver} onDragLeave={() => setT2vDrag(false)} onDrop={t2vDrop} />
        ) : (
          <div className="t2v-files">
            <div className="t2v-files-head">
              <span>Đã thêm {t2vFiles.length} file, sẽ chạy lần lượt.</span>
              <span className="t2v-files-prog">{doneFiles}/{t2vFiles.length}</span>
            </div>
            <div className="t2v-files-bar">
              <span className="t2v-files-title">Danh sách file</span>
              {!bridgeRunning && (
                <button type="button" className="t2v-mini" title="Xóa tất cả file" onClick={t2vClearFiles}>
                  ✕ Xóa tất cả
                </button>
              )}
            </div>
            <div className="t2v-file-list">
              {t2vFiles.map((f) => {
                const st = t2vFileStats(f.id)
                const pct = st.total ? Math.round(((st.done + st.err) / st.total) * 100) : 0
                const state = st.live ? 'running' : st.total && st.done + st.err >= st.total ? 'completed' : 'pending'
                return (
                  <div key={f.id} className={`t2v-file ${state}`}>
                    <span className="t2v-file-ico" aria-hidden>
                      {state === 'completed' ? '✓' : state === 'running' ? '⟳' : '📄'}
                    </span>
                    <div className="t2v-file-body">
                      <div className="t2v-file-name" title={f.name}>{f.name}</div>
                      <div className="t2v-file-meta">
                        {f.prompts.length} prompts
                        {st.total ? ` · ${st.done}/${st.total} xong` : ''}
                        {st.err ? ` · ${st.err} lỗi` : ''}
                      </div>
                      <div className="t2v-file-track">
                        <div className="t2v-file-fill" style={{ width: `${pct}%` }} />
                      </div>
                      {outDir && <div className="t2v-file-path" title={outDir}>{outDir}</div>}
                    </div>
                    <div className="t2v-file-acts">
                      <button type="button" className="t2v-icon" title="Copy toàn bộ prompt trong file"
                        onClick={() => t2vCopyPrompts(f)}>📋</button>
                      {state !== 'running' && (
                        <button type="button" className="t2v-icon danger" title="Xóa file"
                          onClick={() => t2vRemoveFile(f.id)}>✕</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <button type="button" className={`t2v-drop${t2vDrag ? ' drag' : ''}`} disabled={bridgeRunning}
          onClick={() => txtInputRef.current?.click()}
          onDragOver={t2vDragOver} onDragLeave={() => setT2vDrag(false)} onDrop={t2vDrop}>
          <span className="t2v-drop-ico" aria-hidden>🗎</span>
          <span>{bridgeRunning ? 'Đang tạo...' : t2vDrag ? 'Thả file vào đây' : 'Kéo thả hoặc chọn file TXT / JSON'}</span>
        </button>
        <FilePicker accept=".txt,.json,.md,text/plain,application/json" multiple
          inputRef={txtInputRef} onFiles={(files) => void t2vAddFiles(files)} />

        <div className="t2v-settings">
          <div className={`t2v-grid${isOmniFlash ? ' four' : ' three'}`}>
            <div className="t2v-sel">
              <select value={t2vRatio} aria-label="Tỉ lệ khung hình" onChange={(e) => setRatio(e.target.value)}>
                {T2V_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <span className="t2v-chev" aria-hidden>▾</span>
            </div>
            <div className="t2v-sel">
              <select value={t2vModel} aria-label="Model"
                onChange={(e) => { setT2vModel(e.target.value); pushLog(`ℹ️ Model → ${e.target.value}`) }}>
                {T2V_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <span className="t2v-chev" aria-hidden>▾</span>
            </div>
            {isOmniFlash && (
              <div className="t2v-sel">
                <select value={t2vDuration} aria-label="Thời lượng" onChange={(e) => setT2vDuration(e.target.value)}>
                  {T2V_DURATIONS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
                <span className="t2v-chev" aria-hidden>▾</span>
              </div>
            )}
            <div className="t2v-folder">
              <input type="text" placeholder="Thư mục lưu video..." value={outDir} title={outDir || undefined}
                onChange={(e) => setOutDir(e.target.value)} />
              <button type="button" title="Chọn thư mục lưu video" onClick={t2vPickFolder}>🗁</button>
            </div>
          </div>
          {t2vRatio === '16:9' && (
            <label className="veo-check t2v-upscale">
              <input type="checkbox" checked={autoUpscale} onChange={(e) => setAutoUpscale(e.target.checked)} />
              <span>Auto Upscale</span>
            </label>
          )}
        </div>

        {bridgeRunning ? (
          <button type="button" className="t2v-start stop" onClick={handleStop}>
            <span className="t2v-stop-ico" aria-hidden /> Dừng tạo video
          </button>
        ) : (
          <button type="button" className="t2v-start" disabled={!canStart || !!bridgeBusyOther} onClick={handleStart}
            title={bridgeBusyOther ? 'Đang chạy mẻ Tạo ảnh — chờ xong' : undefined}>
            <span aria-hidden>▶</span> {startLabel}
          </button>
        )}
        <div className="t2v-status">
          {bridgeRunning
            ? `Đã gửi job lên server. Đang chờ xử lý... (${textDone}/${textJobs.length})`
            : textJobs.length > 0
              ? `${textDone}/${textJobs.length} video xong · lưu vào ${outDir || 'thư mục mặc định'}`
              : 'Đang chờ xử lý...'}
        </div>

        {logs.length > 0 && (
          <div className="t2v-log">
            <div className="t2v-log-head">
              <button type="button" className="t2v-log-toggle" onClick={() => setLogOpen((v) => !v)}
                aria-expanded={logOpen}>
                <span className="t2v-log-dot" aria-hidden />
                <span>Nhật ký ({logs.length})</span>
                <span className={`chev${logOpen ? ' up' : ''}`} aria-hidden>▾</span>
              </button>
              <button type="button" className="t2v-mini" onClick={() => { setLogs([]); setT2vLogAll(false) }}>
                Xóa
              </button>
            </div>
            {logOpen && (
              <>
                <div className="t2v-log-box">
                  {shownLogs.map((l, i) => (
                    <div key={`${i}-${l.slice(0, 16)}`} className={`t2v-log-line ${t2vLogTone(l)}`}>{l}</div>
                  ))}
                </div>
                {logs.length > 10 && (
                  <button type="button" className="t2v-log-more" onClick={() => setT2vLogAll((v) => !v)}>
                    {t2vLogAll ? 'Thu gọn log' : `Xem thêm ${logs.length - 10} log cũ hơn`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  function ImagePanel() {
    const batchLines = parseBatchPrompts(batchPromptText)
    const batchCount = batchLines.length
    return (
      <>
        <div className="veo-mode-dd i2v-bar">
          <button type="button" className={`veo-mode-btn ${modeOpen ? 'open' : ''}`}
            onClick={() => setModeOpen((v) => !v)} aria-expanded={modeOpen}>
            <span className="veo-mode-label">{MODE_LABEL[mode]}</span>
            <span className="chev">{modeOpen ? '▴' : '▾'}</span>
          </button>
          <button type="button" className={`veo-endframe-toggle ${endFrameOn ? 'on' : ''}`}
            title="Bật/tắt End Frame cho mỗi ảnh"
            onClick={() => {
              setEndFrameOn((v) => {
                const next = !v
                pushLog(next ? 'Bật EndFrame' : 'Tắt EndFrame')
                return next
              })
            }}>EndFrame</button>
          <div className="i2v-bar-acts">
            <button type="button" className="i2v-ico-btn" title="Xóa hết ảnh"
              disabled={!images.length}
              onClick={() => { if (images.length) clearAllImages() }}>🗑</button>
            <button type="button" className="i2v-ico-btn wand" title="Áp dụng prompts hàng loạt"
              disabled={!images.length}
              onClick={() => {
                if (!images.length) return
                setBatchPromptText(images.map((x) => x.prompt).join('\n'))
                setBatchPromptOpen(true)
              }}>🪄</button>
            <span className="i2v-count-badge">{images.length} ảnh</span>
          </div>
          {modeOpen && (
            <div className="veo-mode-menu" role="listbox">
              {MODES.map((m) => (
                <button key={m} type="button" role="option" aria-selected={mode === m}
                  className={`veo-mode-item ${mode === m ? 'on' : ''}`}
                  onClick={() => { setMode(m); setModeOpen(false); pushLog(`Chuyển mode → ${MODE_LABEL[m]}`) }}>
                  <span>{MODE_LABEL[m]}</span>
                  {mode === m && <span className="veo-mode-check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {images.length === 0 ? (
          <div className="veo-i2v-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropZone(e, 'image')}>
            <div className="veo-i2v-ico">🖼️</div>
            <div className="veo-i2v-title">Chưa có ảnh nào được tải lên</div>
            <div className="veo-i2v-sub">
              Kéo thả ảnh PNG/JPG/JFIF/WebP hoặc thư mục chứa ảnh, hoặc sử dụng các nút bên dưới
            </div>
            <div className="veo-i2v-btns">
              <button type="button" className="veo-teal-btn" onClick={() => imgFolderRef.current?.click()}>Chọn thư mục</button>
              <button type="button" className="veo-teal-btn" onClick={() => imgFilesRef.current?.click()}>Tải ảnh riêng lẻ</button>
            </div>
          </div>
        ) : (
          <div className="i2v-list-wrap"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDropZone(e, 'image')}>
            <div className="i2v-list">
              {images.map((img) => (
                <div key={img.id} className={`i2v-card ${endFrameOn ? 'with-end' : 'start-only'}`}>
                  <div className="i2v-card-top">
                    <span className="i2v-card-name" title={img.name}>{img.name}</span>
                    <div className="i2v-card-acts">
                      <button type="button" className="i2v-act" title="Copy prompt"
                        onClick={() => {
                          const text = img.prompt || img.name
                          void navigator.clipboard?.writeText(text).then(
                            () => showToast('Đã copy prompt'),
                            () => { duplicateImage(img.id) },
                          )
                        }}>📋</button>
                      <button type="button" className="i2v-act" title="Xóa" onClick={() => removeImage(img.id)}>✕</button>
                    </div>
                  </div>
                  {!endFrameOn ? (
                    <div className="i2v-row-start">
                      <div className="i2v-frame-label">Start Frame</div>
                      <div className="i2v-frame-spacer" />
                      <div className="i2v-frame-box filled sm">
                        {img.url ? <img src={img.url} alt={img.name} /> : <span>🖼️</span>}
                      </div>
                      <textarea
                        className="i2v-prompt beside"
                        placeholder="Nhập prompt cho ảnh này..."
                        value={img.prompt}
                        onChange={(e) => setImagePrompt(img.id, e.target.value)}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="i2v-frames two">
                        <div className="i2v-frame">
                          <div className="i2v-frame-label">Start Frame</div>
                          <div className="i2v-frame-box filled">
                            {img.url ? <img src={img.url} alt={img.name} /> : <span>🖼️</span>}
                          </div>
                        </div>
                        <div className="i2v-frame">
                          <div className="i2v-frame-label">End Frame</div>
                          {img.endFrame?.url ? (
                            <div className="i2v-frame-box filled">
                              <img src={img.endFrame.url} alt={img.endFrame.name} />
                              <button type="button" className="i2v-frame-x" title="Xóa End Frame"
                                onClick={() => clearEndFrame(img.id)}>✕</button>
                            </div>
                          ) : (
                            <button type="button" className="i2v-frame-box dashed"
                              title="Chọn End Frame"
                              onClick={() => {
                                endFrameTarget.current = img.id
                                endFrameRef.current?.click()
                              }}>
                              <span className="up">⬆</span>
                            </button>
                          )}
                        </div>
                      </div>
                      <textarea
                        className="i2v-prompt"
                        placeholder="Nhập prompt cho ảnh này..."
                        value={img.prompt}
                        onChange={(e) => setImagePrompt(img.id, e.target.value)}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="i2v-add-row">
              <button type="button" className="veo-mini teal" onClick={() => imgFilesRef.current?.click()}>+ Thêm ảnh</button>
              <button type="button" className="veo-mini" onClick={() => imgFolderRef.current?.click()}>📁 Thư mục</button>
            </div>
          </div>
        )}

        <input ref={(el) => {
            imgFolderRef.current = el
            if (el) el.setAttribute('webkitdirectory', '')
          }} type="file" accept="image/*" multiple
          hidden
          onChange={(e) => { addImages(Array.from(e.target.files || [])); e.target.value = '' }} />
        <FilePicker accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.jfif,.webp"
          multiple inputRef={imgFilesRef} onFiles={addImages} />
        <input ref={(el) => { endFrameRef.current = el }} type="file" accept="image/*" hidden
          onChange={(e) => {
            assignEndFrame(Array.from(e.target.files || []))
            e.target.value = ''
          }} />

        <CommonSettings showCrop modelOptions={['Veo 3.1 Lite', 'Veo 3.1 Fast', 'Veo 3.1', 'Veo 3 Quality']} />
        <CommonFooter label={startLabel} disabled={!canStart} />

        {batchPromptOpen && (
          <div className="veo-modal-backdrop" onClick={() => setBatchPromptOpen(false)}>
            <div className="veo-modal i2v-batch-modal" onClick={(e) => e.stopPropagation()}>
              <div className="veo-modal-head">
                <h3>Áp dụng Prompts hàng loạt cho {images.length} ảnh</h3>
                <button type="button" className="veo-modal-x" onClick={() => setBatchPromptOpen(false)}>✕</button>
              </div>
              <div className="veo-modal-body i2v-batch-body">
                <div className="i2v-batch-guide">
                  <strong>Hướng dẫn:</strong> nhập mỗi prompt trên một dòng, hoặc dán JSON (mảng string / {'{'}prompts:[]{'}'}).
                  Prompts áp dụng lần lượt theo thứ tự ảnh; nếu ít hơn số ảnh thì ảnh còn lại giữ nguyên.
                </div>
                <div className="i2v-batch-meta">
                  <span className="i2v-batch-count">{batchCount} prompts</span>
                  <button type="button" className="veo-link" onClick={() => setBatchPromptText('')}>Clear all</button>
                </div>
                <textarea
                  className="veo-modal-textarea tall i2v-batch-ta"
                  placeholder="Nhập mỗi prompt trên một dòng hoặc dán nội dung JSON..."
                  value={batchPromptText}
                  onChange={(e) => setBatchPromptText(e.target.value)}
                />
                <div className="i2v-batch-preview-label">Xem trước áp dụng:</div>
                <div className="i2v-batch-preview">
                  {images.map((img, i) => (
                    <div key={img.id} className="i2v-batch-row">
                      <div className="i2v-batch-thumb">
                        {img.url ? <img src={img.url} alt="" /> : <span>🖼️</span>}
                      </div>
                      <div className="i2v-batch-info">
                        <div className="i2v-batch-name">{img.name}</div>
                        <div className={`i2v-batch-prompt ${batchLines[i] ? '' : 'empty'}`}>
                          {batchLines[i] || 'Chưa có prompt'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="veo-modal-foot">
                <button type="button" className="veo-mini" onClick={() => setBatchPromptOpen(false)}>Hủy</button>
                <button type="button"
                  className={`veo-teal-btn ${batchCount ? '' : 'dim'}`}
                  disabled={!batchCount}
                  onClick={applyBatchPrompts}>
                  Áp dụng {batchCount} prompts
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  function IngredientsPanel() {
    return (
      <>
        <ModeDropdown meta={ingTab === 'character'
          ? `${chars.length} nhân vật`
          : `${ingredients.length} ingredients, ${totalIngImages} images`} />
        <div className="veo-subtabs">
          <button type="button" className={`veo-subtab ${ingTab === 'ingredients' ? 'on' : ''}`}
            onClick={() => setIngTab('ingredients')}>Ingredients</button>
          <button type="button" className={`veo-subtab ${ingTab === 'character' ? 'on char' : ''}`}
            onClick={() => setIngTab('character')}>Character</button>
        </div>
        {ingTab === 'ingredients' ? (
          <div className="veo-ing-scroll">
            <div className="veo-ing-toolbar">
              <button type="button" className="veo-mini" onClick={() => imgFolderRef.current?.click()}>📁 Thư mục</button>
              <button type="button" className="veo-mini" onClick={() => {
                const first = prompt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
                setIngredients((list) => list.map((ing, i) => ({
                  ...ing, prompt: first[i] || ing.prompt || first[0] || '',
                })))
                pushLog('Áp dụng prompts vào ingredients'); showToast('Đã áp dụng prompts')
              }}>Áp dụng Prompts</button>
              <button type="button" className="veo-mini danger" onClick={() => {
                setIngredients([{ id: uid('ing'), prompt: '', images: [] }]); pushLog('Reset ingredients')
              }}>🗑</button>
            </div>
            {ingredients.map((ing, idx) => (
              <div key={ing.id} className="veo-ing-card">
                <div className="veo-ing-head">
                  <span>Ingredient {idx + 1}{' '}
                    <span className="muted">· {ing.images.length}/3 ảnh{ing.prompt.trim() ? '' : ' - chưa có prompt riêng'}</span>
                  </span>
                  <div className="veo-ing-acts">
                    <button type="button" title="Nhân đôi" onClick={() =>
                      setIngredients((list) => [...list, { id: uid('ing'), prompt: ing.prompt, images: [...ing.images] }])
                    }>📋</button>
                    <button type="button" title="Xóa" disabled={ingredients.length <= 1}
                      onClick={() => setIngredients((list) => list.filter((x) => x.id !== ing.id))}>✕</button>
                  </div>
                </div>
                <textarea className="veo-ing-prompt" placeholder="Prompt riêng cho ingredient này..."
                  value={ing.prompt}
                  onChange={(e) => setIngredients((list) => list.map((x) =>
                    x.id === ing.id ? { ...x, prompt: e.target.value } : x))} />
                <div className="veo-ing-slots">
                  {[0, 1, 2].map((s) => {
                    const img = ing.images[s]
                    return (
                      <button key={s} type="button" className={`veo-slot ${img ? 'filled' : ''}`}
                        title={img ? img.name : 'Tải ảnh'}
                        onClick={() => {
                          if (img) {
                            setIngredients((list) => list.map((x) =>
                              x.id === ing.id ? { ...x, images: x.images.filter((_, i) => i !== s) } : x))
                          } else {
                            ingSlotTarget.current = { ingId: ing.id, slot: s }
                            ingSlotRef.current?.click()
                          }
                        }}>
                        {img?.url ? <img src={img.url} alt="" className="veo-slot-img" /> : '⬆'}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            <button type="button" className="veo-add-dashed"
              onClick={() => setIngredients((list) => [...list, { id: uid('ing'), prompt: '', images: [] }])}>
              + Thêm Ingredient
            </button>
            <FilePicker accept="image/*" inputRef={ingSlotRef} onFiles={(files) => {
              const t = ingSlotTarget.current
              if (!t || !files[0]) return
              const item = filesToItems([files[0]], 'image')[0]
              setIngredients((list) => list.map((x) => {
                if (x.id !== t.ingId) return x
                const images = [...x.images]
                if (images.length < 3) images.push(item)
                return { ...x, images: images.slice(0, 3) }
              }))
            }} />
          </div>
        ) : (
          <div className="veo-ing-scroll">
            <div className="veo-char-head">
              <span>Nhân vật (tối đa 3 tag / prompt)</span>
              <button type="button" className="veo-add-char" disabled={chars.length >= 6}
                onClick={() => setChars((list) => [...list, { id: uid('char'), tag: `@nhanvat${list.length + 1}` }])}>
                + Thêm nhân vật ({chars.length})
              </button>
            </div>
            {chars.map((c) => (
              <div key={c.id} className="veo-char-row">
                <button type="button" className={`veo-slot sm ${c.image ? 'filled' : ''}`}
                  onClick={() => {
                    if (c.image) {
                      if (c.image.url) URL.revokeObjectURL(c.image.url)
                      setChars((list) => list.map((x) => x.id === c.id ? { ...x, image: undefined } : x))
                    } else { charImgTarget.current = c.id; charImgRef.current?.click() }
                  }}>
                  {c.image?.url ? <img src={c.image.url} alt="" className="veo-slot-img" /> : '⬆'}
                </button>
                <div className="veo-char-meta">
                  <input className="veo-char-tag" value={c.tag}
                    onChange={(e) => setChars((list) => list.map((x) =>
                      x.id === c.id ? { ...x, tag: e.target.value } : x))} />
                  <span className="muted">Dùng {c.tag} trong prompt</span>
                </div>
                <button type="button" className="veo-mini danger" disabled={chars.length <= 1}
                  onClick={() => setChars((list) => list.filter((x) => x.id !== c.id))}>✕</button>
              </div>
            ))}
            <FilePicker accept="image/*" inputRef={charImgRef} onFiles={(files) => {
              const id = charImgTarget.current
              if (!id || !files[0]) return
              const item = filesToItems([files[0]], 'image')[0]
              setChars((list) => list.map((x) => (x.id === id ? { ...x, image: item } : x)))
            }} />
            <div className="one-prompt-row">
              <OnePromptCheck on={onePrompt} setOn={setOnePrompt} />
            </div>
            <textarea className="veo-prompt tall"
              placeholder="Mỗi dòng = 1 video. Ví dụ: Tạo video @nhanvat1 đang chiến đấu với @nhanvat2 trên đấu trường..."
              value={charPrompt} onChange={(e) => setCharPrompt(e.target.value)} />
          </div>
        )}
        <CommonSettings showVoice showCrop />
        <CommonFooter label={startLabel} disabled={!canStart} />
      </>
    )
  }

  function VideoPanel() {
    const voiceLabel = voice === VOICE_NONE ? 'Không' : voice
    return (
      <>
        <ModeDropdown meta={sourceVideo ? `1 video | ${refImages.length} ảnh` : `No video | ${refImages.length} ảnh`} />
        <div className="veo-section-label with-ico">
          <span className="veo-sec-ico film" aria-hidden>🎞</span>
          <span>Video nguồn <span className="req">*</span></span>
          <span className="veo-sec-muted">(bắt buộc)</span>
        </div>
        <div className={`veo-v2v-drop ${sourceVideo ? '' : 'need'}`}
          onClick={() => videoRef.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropZone(e, 'video')}>
          {sourceVideo ? (
            <>
              <div className="veo-v2v-cloud" aria-hidden>🎬</div>
              <div><b>{sourceVideo.name}</b></div>
              <button type="button" className="veo-mini danger" onClick={(e) => {
                e.stopPropagation()
                if (sourceVideo.url) URL.revokeObjectURL(sourceVideo.url)
                setSourceVideo(null)
              }}>Xóa video</button>
            </>
          ) : (
            <>
              <div className="veo-v2v-cloud" aria-hidden>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 16.5a3.5 3.5 0 0 0-2.1-6.4 5 5 0 0 0-9.6-1.2A4 4 0 0 0 6 16.5" />
                  <path d="M12 12v7" />
                  <path d="m9 15 3-3 3 3" />
                </svg>
              </div>
              <div>Chọn hoặc kéo thả video (MP4, WebM, MOV)</div>
              <div className="veo-req-warn">Bắt buộc upload video để tạo</div>
            </>
          )}
        </div>
        <FilePicker accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
          inputRef={videoRef} onFiles={setVideoFromFiles} />

        <div className="veo-section-label row">
          <span className="veo-section-label-inline">
            <span className="veo-sec-ico spark" aria-hidden>✨</span>
            <span>Ảnh tham chiếu (tối đa 5 ảnh)</span>
          </span>
          <button type="button" className="veo-linkish" disabled={refImages.length >= 5}
            onClick={() => refImgRef.current?.click()}>+ Thêm ảnh</button>
        </div>
        <div className="veo-ref-pickbox">
          {refImages.map((img) => (
            <div key={img.id} className="veo-ref-thumb">
              {img.url && <img src={img.url} alt={img.name} />}
              <button type="button" onClick={() => {
                if (img.url) URL.revokeObjectURL(img.url)
                setRefImages((list) => list.filter((x) => x.id !== img.id))
              }}>✕</button>
            </div>
          ))}
          <span className="veo-tag">@ nhanvat1</span>
          <button type="button" className="veo-ref-add" onClick={() => refImgRef.current?.click()}>+ Chọn ảnh...</button>
        </div>
        <FilePicker accept="image/*" multiple inputRef={refImgRef} onFiles={addRefImages} />

        <div className="veo-section-label row">
          <span>Prompts ({v2vPrompts.length})</span>
          <div className="veo-row-gap">
            <button type="button" className="veo-linkish" onClick={() => txtInputRef.current?.click()}>Bulk import</button>
            <button type="button" className="veo-linkish" onClick={() => setV2vPrompts((p) => [...p, ''])}>+ Thêm prompt</button>
          </div>
        </div>
        <FilePicker accept=".txt,.json,text/plain" inputRef={txtInputRef} onFiles={async (files) => {
          const t = await files[0]?.text(); if (!t) return
          const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
          setV2vPrompts(lines.length ? lines : [''])
          pushLog(`Bulk import ${lines.length} prompts`)
        }} />
        {v2vPrompts.map((p, i) => (
          <div key={i} className="veo-v2v-prompt tall">
            <div className="veo-v2v-prompt-top">
              <span className="veo-num">#{i + 1}</span>
              {v2vPrompts.length > 1 && (
                <button type="button" className="veo-mini danger"
                  onClick={() => setV2vPrompts((list) => list.filter((_, j) => j !== i))}>✕</button>
              )}
            </div>
            <textarea
              value={p}
              placeholder="Nhập prompt cho video... (gõ @ để chèn tag)"
              onChange={(e) => setV2vPrompts((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </div>
        ))}

        <div className="veo-section-label">Cài đặt</div>
        <div className="veo-seg row">
          <span className="veo-seg-label">Aspect Ratio</span>
          <div className="veo-seg-btns">
            {['9:16', '16:9'].map((r) => (
              <button key={r} type="button" className={`veo-seg-btn ${ratio === r ? 'on' : ''}`}
                onClick={() => setRatio(r)}>{r}</button>
            ))}
          </div>
        </div>
        <div className="veo-seg row">
          <span className="veo-seg-label">Thời lượng</span>
          <div className="veo-seg-btns">
            {['8', '10'].map((d) => (
              <button key={d} type="button" className={`veo-seg-btn ${v2vDuration === d ? 'on' : ''}`}
                onClick={() => setV2vDuration(d)}>{d} giây</button>
            ))}
          </div>
        </div>
        <div className="veo-toggle-row">
          <span>Auto Crop ảnh theo tỷ lệ</span>
          <button type="button" className={`toggle ${autoCrop ? 'on' : ''}`}
            aria-pressed={autoCrop}
            onClick={() => setAutoCrop((v) => !v)}>
            <span className="toggle-knob" />
          </button>
        </div>
        <div className="veo-toggle-row">
          <span>Auto Upscale</span>
          <button type="button" className={`toggle ${autoUpscale ? 'on' : ''}`}
            aria-pressed={autoUpscale}
            onClick={() => setAutoUpscale((v) => !v)}>
            <span className="toggle-knob" />
          </button>
        </div>

        <div className="veo-voice-head">
          <span className="veo-voice-left"><span aria-hidden>🎤</span> Giọng nói</span>
          <span className="veo-voice-current">{voiceLabel}</span>
        </div>
        <div className="veo-voice-list" role="listbox" aria-label="Giọng nói">
          {VEO_VOICES.map((v) => (
            <button
              key={v}
              type="button"
              role="option"
              aria-selected={voice === v}
              className={`veo-voice-opt ${voice === v ? 'on' : ''}`}
              onClick={() => { setVoice(v); pushLog(`Giọng nói → ${v}`) }}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="veo-omni banner">
          Model: Omni (abra_edit) — Video editing &amp; style transfer
        </div>
        <CommonFooter label={startLabel} disabled={!canStart} logFirst hideStatus />
      </>
    )
  }

  function OmniPanel() {
    const intentMeta = OMNI_INTENTS.find((x) => x.id === omniIntent)
    return (
      <>
        <ModeDropdown meta={sourceVideo
          ? `1 video · ${style} · ${intentMeta?.label || ''}`
          : `No video · ${v2vPromptCount} prompts`} />
        <div className="veo-omni hero">
          <div className="veo-omni-title">Model: Omni (abra_edit)</div>
          <div className="veo-omni-sub">Video editing &amp; style transfer — khóa model Omni</div>
        </div>
        <div className="veo-section-label">Video nguồn <span className="req">*</span> (bắt buộc)</div>
        <div className={`veo-v2v-drop ${sourceVideo ? '' : 'need'}`}
          onClick={() => videoRef.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropZone(e, 'video')}>
          <div className="veo-i2v-ico">🎬</div>
          {sourceVideo ? (
            <>
              <div><b>{sourceVideo.name}</b></div>
              <button type="button" className="veo-mini danger" onClick={(e) => {
                e.stopPropagation()
                if (sourceVideo.url) URL.revokeObjectURL(sourceVideo.url)
                setSourceVideo(null)
              }}>Xóa video</button>
            </>
          ) : (
            <>
              <div>Chọn hoặc kéo thả video (MP4, WebM, MOV)</div>
              <div className="veo-req-warn">Omni cần video nguồn để edit / style transfer</div>
            </>
          )}
        </div>
        <FilePicker accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
          inputRef={videoRef} onFiles={setVideoFromFiles} />

        <div className="veo-section-label">Chế độ Omni</div>
        <div className="veo-omni-intents">
          {OMNI_INTENTS.map((it) => (
            <button key={it.id} type="button"
              className={`veo-omni-intent ${omniIntent === it.id ? 'on' : ''}`}
              onClick={() => { setOmniIntent(it.id); pushLog(`Omni intent → ${it.label}`) }}
              title={it.hint}>
              <span className="veo-omni-intent-label">{it.label}</span>
              <span className="veo-omni-intent-hint">{it.hint}</span>
            </button>
          ))}
        </div>

        <div className="veo-section-label row">
          <span>Ảnh style / tham chiếu (tối đa 3)</span>
          <button type="button" className="veo-mini teal" disabled={styleRefImages.length >= 3}
            onClick={() => refImgRef.current?.click()}>+ Thêm ảnh style</button>
        </div>
        <div className="veo-ref-row">
          {styleRefImages.map((img) => (
            <div key={img.id} className="veo-ref-thumb">
              {img.url && <img src={img.url} alt={img.name} />}
              <button type="button" onClick={() => {
                if (img.url) URL.revokeObjectURL(img.url)
                setStyleRefImages((list) => list.filter((x) => x.id !== img.id))
              }}>✕</button>
            </div>
          ))}
          {styleRefImages.length === 0 && <span className="muted">Không bắt buộc — dùng Style grid bên dưới</span>}
        </div>
        <FilePicker accept="image/*" multiple inputRef={refImgRef} onFiles={addStyleRefImages} />

        <StyleGrid />

        <div className="veo-section-label row">
          <span>Prompts edit ({v2vPromptCount})</span>
          <div className="veo-row-gap">
            <button type="button" className="veo-linkish" onClick={() => txtInputRef.current?.click()}>Bulk import</button>
            <button type="button" className="veo-mini teal" onClick={() => setV2vPrompts((p) => [...p, ''])}>+ Thêm prompt</button>
          </div>
        </div>
        <FilePicker accept=".txt,.json,text/plain" inputRef={txtInputRef} onFiles={async (files) => {
          const t = await files[0]?.text(); if (!t) return
          const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
          setV2vPrompts(lines.length ? lines : [''])
          pushLog(`Omni bulk import ${lines.length} prompts`)
        }} />
        {v2vPrompts.map((p, i) => (
          <div key={i} className="veo-v2v-prompt">
            <span className="veo-num">#{i + 1}</span>
            <input value={p} placeholder={
              omniIntent === 'restyle'
                ? 'Mô tả style muốn chuyển… (vd: anime, cinematic dusk)'
                : omniIntent === 'extend'
                  ? 'Mô tả cảnh tiếp theo / kéo dài…'
                  : 'Mô tả edit… (vd: đổi áo nhân vật thành đỏ, bỏ text overlay)'
            }
              onChange={(e) => setV2vPrompts((list) => list.map((x, j) => (j === i ? e.target.value : x)))} />
            {v2vPrompts.length > 1 && (
              <button type="button" className="veo-mini danger"
                onClick={() => setV2vPrompts((list) => list.filter((_, j) => j !== i))}>✕</button>
            )}
          </div>
        ))}

        <div className="veo-section-label">Cài đặt Omni</div>
        <div className="veo-seg">
          <span className="veo-seg-label">Aspect Ratio</span>
          <div className="veo-seg-btns">
            {['9:16', '16:9'].map((r) => (
              <button key={r} type="button" className={`veo-seg-btn ${ratio === r ? 'on' : ''}`}
                onClick={() => setRatio(r)}>{r}</button>
            ))}
          </div>
        </div>
        <div className="veo-seg">
          <span className="veo-seg-label">Thời lượng</span>
          <div className="veo-seg-btns">
            {['8', '10'].map((d) => (
              <button key={d} type="button" className={`veo-seg-btn ${v2vDuration === d ? 'on' : ''}`}
                onClick={() => setV2vDuration(d)}>{d} giây</button>
            ))}
          </div>
        </div>
        <label className="veo-check switch">
          <span>Auto Crop ảnh theo tỷ lệ</span>
          <input type="checkbox" checked={autoCrop} onChange={(e) => setAutoCrop(e.target.checked)} />
        </label>
        <label className="veo-check switch">
          <span>Auto Upscale</span>
          <input type="checkbox" checked={autoUpscale} onChange={(e) => setAutoUpscale(e.target.checked)} />
        </label>
        <label className="veo-check switch">
          <span>Loại bỏ text overlays &amp; watermarks</span>
          <input type="checkbox" checked={removeOverlay} onChange={(e) => setRemoveOverlay(e.target.checked)} />
        </label>
        <div className="veo-voice-line">Giọng nói: <b>Không</b> · Model khóa: <b>Omni (abra_edit)</b></div>
        <div className="veo-omni">Model: Omni (abra_edit) — Video editing &amp; style transfer</div>
        <CommonFooter label={startLabel} disabled={!canStart} />
      </>
    )
  }

  function ScriptPanel() {
    return (
      <>
        <ModeDropdown meta={projects.length ? `${projects.length} dự án` : undefined} />
        <button type="button" className="veo-create-project"
          onClick={() => { setProjectTab('sync'); setProjectOpen(true) }}>+ Tạo dự án</button>
        {projects.length === 0 ? (
          <div className="veo-script-empty">
            <div className="veo-i2v-ico">🔗</div>
            <div>Chưa có dự án nào. Nhấn &apos;Tạo dự án&apos; để bắt đầu</div>
          </div>
        ) : (
          <div className="veo-project-list">
            {projects.map((p) => (
              <button key={p.id} type="button"
                className={`veo-project-card ${activeProjectId === p.id ? 'on' : ''}`}
                onClick={() => setActiveProjectId(p.id)}>
                <div className="veo-project-title">{p.title}</div>
                <div className="veo-project-meta">{p.source} · {p.style} · {p.durationSec}s</div>
                <button type="button" className="veo-mini danger" onClick={(e) => {
                  e.stopPropagation()
                  setProjects((list) => list.filter((x) => x.id !== p.id))
                  if (activeProjectId === p.id) setActiveProjectId(null)
                }}>Xóa</button>
              </button>
            ))}
          </div>
        )}
        <div className="veo-field">
          <label>Tỉ lệ khung hình</label>
          <select className="veo-select" value={ratio} onChange={(e) => setRatio(e.target.value)}>
            <option>9:16</option><option>16:9</option><option>1:1</option>
          </select>
        </div>
        <div className="veo-field">
          <label>Model</label>
          <select className="veo-select" value={DEFAULT_MODELS.includes(model) ? model : DEFAULT_MODELS[0]}
            onChange={(e) => {
              const v = e.target.value
              setModel(v)
              if (v === OMNI_MODEL) pushLog('Chọn model Omni (abra_edit)')
            }}>
            {DEFAULT_MODELS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        {model === OMNI_MODEL && (
          <div className="veo-omni hero">
            <div className="veo-omni-title">Model: Omni (abra_edit)</div>
            <div className="veo-omni-sub">Video editing &amp; style transfer</div>
          </div>
        )}
        <div className="veo-field">
          <label>Nơi lưu video</label>
          <div className="veo-path">
            <input className="veo-path-input" placeholder="Chọn thư mục lưu video..." value={outDir}
              onChange={(e) => setOutDir(e.target.value)} />
            <button type="button" className="veo-path-btn" onClick={() => {
              pickFolder(outDir).then((d) => d && setOutDir(d)).catch((e) => showToast(errText(e)))
            }}>📁</button>
          </div>
        </div>
        <label className="veo-check">
          <input type="checkbox" checked={autoUpscale} onChange={(e) => setAutoUpscale(e.target.checked)} />
          <span>Auto Upscale</span>
        </label>
        <CommonFooter label={startLabel} disabled={!canStart} />
      </>
    )
  }

  function StyleGrid() {
    return (
      <div className="veo-style-block">
        <div className="veo-section-label">Style (Tùy chọn)</div>
        <div className="veo-style-search">
          <span>🔍</span>
          <input placeholder="Tìm style..." value={styleSearch} onChange={(e) => setStyleSearch(e.target.value)} />
        </div>
        <div className="veo-style-grid">
          {filteredStyles.map((s) => (
            <button key={s} type="button" className={`veo-style-item ${style === s ? 'on' : ''}`}
              onClick={() => setStyle(s)}>
              {style === s && <span className="check">✓</span>}{s}
            </button>
          ))}
        </div>
      </div>
    )
  }

  function ProjectModal() {
    if (!projectOpen) return null
    const title =
      projectTab === 'youtube' ? 'Phân tích video YouTube'
      : projectTab === 'ideas' ? 'Ý tưởng & Kịch bản'
      : projectTab === 'sync' ? 'Đồng bộ nhân vật'
      : projectTab === 'tiktok' ? 'Phân tích TikTok'
      : 'Upload kịch bản'
    return (
      <div className="veo-modal-backdrop" onClick={() => setProjectOpen(false)}>
        <div className="veo-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <div className="veo-modal-head">
            <h3>
              {projectTab === 'youtube' && <span className="veo-modal-ico red">🔗</span>}
              {projectTab === 'sync' && <span className="veo-modal-ico green">👤</span>}
              {projectTab === 'ideas' && <span className="veo-modal-ico amber">💡</span>}
              {projectTab === 'tiktok' && <span className="veo-modal-ico red">🎵</span>}
              {projectTab === 'upload' && <span className="veo-modal-ico">📄</span>}
              {title}
            </h3>
            <button type="button" className="veo-modal-x" onClick={() => setProjectOpen(false)}>✕</button>
          </div>
          <div className="veo-modal-tabs">
            {([['sync', 'Character Sync'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'],
              ['upload', 'Upload'], ['ideas', 'Ideas']] as [ProjectTab, string][]).map(([id, label]) => (
              <button key={id} type="button"
                className={`veo-modal-tab ${projectTab === id ? `on ${id}` : ''}`}
                onClick={() => setProjectTab(id)}>{label}</button>
            ))}
          </div>
          <div className="veo-modal-body">
            {projectTab === 'sync' && (
              <>
                <div className="veo-section-label">Ảnh nhân vật (1-3 ảnh)</div>
                <div className="veo-sync-slots">
                  {[0, 1, 2].map((i) => (
                    <button key={i} type="button" className={`veo-sync-slot ${syncImages[i] ? 'filled' : ''}`}
                      onClick={() => {
                        if (syncImages[i]) {
                          const cur = syncImages[i]
                          if (cur?.url) URL.revokeObjectURL(cur.url)
                          setSyncImages((arr) => arr.map((x, j) => (j === i ? null : x)))
                        } else { syncSlotIndex.current = i; syncSlotRef.current?.click() }
                      }}>
                      {syncImages[i]?.url ? <img src={syncImages[i]!.url} alt="" /> : (<><span>⬆</span><span>Tải ảnh</span></>)}
                    </button>
                  ))}
                </div>
                <FilePicker accept="image/*" inputRef={syncSlotRef} onFiles={(files) => {
                  if (!files[0]) return
                  const item = filesToItems([files[0]], 'image')[0]
                  const idx = syncSlotIndex.current
                  setSyncImages((arr) => arr.map((x, j) => (j === idx ? item : x)))
                }} />
                <p className="veo-hint">Upload ảnh rồi đặt @tag cho mỗi ảnh. Dùng @tag trong prompt bên phải để tham chiếu.</p>
                <div className="veo-section-label">Kịch bản (dùng @tag để tham chiếu)</div>
                <textarea className="veo-modal-textarea"
                  placeholder="Ví dụ: @nhanvat1 đi dạo trong công viên, gặp @nhanvat2 đang ngồi đọc sách..."
                  value={syncScript} onChange={(e) => setSyncScript(e.target.value)} />
                <div className="veo-field">
                  <label>Thời lượng video (giây)</label>
                  <input className="veo-path-input" value={syncDuration}
                    onChange={(e) => setSyncDuration(e.target.value)} />
                </div>
              </>
            )}
            {projectTab === 'youtube' && (
              <>
                <div className="veo-field">
                  <label>Link YouTube</label>
                  <input className="veo-path-input" placeholder="https://www.youtube.com/watch?v=... hoặc /shorts/..."
                    value={ytLink} onChange={(e) => setYtLink(e.target.value)} />
                </div>
                <StyleGrid />
              </>
            )}
            {projectTab === 'tiktok' && (
              <>
                <div className="veo-field">
                  <label>Link TikTok</label>
                  <input className="veo-path-input" placeholder="https://www.tiktok.com/@.../video/..."
                    value={ttLink} onChange={(e) => setTtLink(e.target.value)} />
                </div>
                <StyleGrid />
              </>
            )}
            {projectTab === 'upload' && (
              <>
                <button type="button" className="veo-i2v-drop compact"
                  onClick={() => uploadScriptRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async (e) => {
                    e.preventDefault()
                    const f = e.dataTransfer.files?.[0]; if (!f) return
                    setUploadScriptName(f.name); setUploadScriptBody(await f.text())
                  }}>
                  <div className="veo-i2v-ico">📄</div>
                  <div>{uploadScriptName ? `Đã chọn: ${uploadScriptName}` : 'Kéo thả file kịch bản (.txt / .md / .json)'}</div>
                </button>
                <FilePicker accept=".txt,.md,.json,text/plain" inputRef={uploadScriptRef}
                  onFiles={async (files) => {
                    const f = files[0]; if (!f) return
                    setUploadScriptName(f.name); setUploadScriptBody(await f.text())
                  }} />
                {uploadScriptBody && (
                  <textarea className="veo-modal-textarea" value={uploadScriptBody}
                    onChange={(e) => setUploadScriptBody(e.target.value)} />
                )}
              </>
            )}
            {projectTab === 'ideas' && (
              <>
                <div className="veo-section-label">Ý tưởng &amp; Kịch bản</div>
                <textarea className="veo-modal-textarea tall" placeholder="Mô tả ý tưởng hoặc dán kịch bản ngắn…"
                  value={ideaText} onChange={(e) => setIdeaText(e.target.value)} />
                <div className="veo-section-label">Thời lượng</div>
                <div className="veo-idea-presets">
                  {[1, 2, 3, 4, 5].map((m) => (
                    <button key={m} type="button"
                      className={`veo-seg-btn ${ideaMinutes === m && ideaSeconds === 0 ? 'on' : ''}`}
                      onClick={() => { setIdeaMinutes(m); setIdeaSeconds(0) }}>{m} phút</button>
                  ))}
                </div>
                <div className="veo-idea-custom">
                  <label>Phút<input type="number" min={0} max={30} value={ideaMinutes}
                    onChange={(e) => setIdeaMinutes(Number(e.target.value) || 0)} /></label>
                  <label>Giây<input type="number" min={0} max={59} value={ideaSeconds}
                    onChange={(e) => setIdeaSeconds(Number(e.target.value) || 0)} /></label>
                  <span className="veo-idea-total">= {ideaTotalSec}s</span>
                </div>
                <StyleGrid />
              </>
            )}
            {(projectTab === 'sync' || projectTab === 'youtube' || projectTab === 'ideas' || projectTab === 'tiktok') && (
              <div className="veo-modal-opts">
                <label className="veo-check">
                  <input type="checkbox" checked={removeOverlay}
                    onChange={(e) => setRemoveOverlay(e.target.checked)} />
                  <span>Loại bỏ text overlays &amp; watermarks</span>
                </label>
                <select className="veo-select sm" value={style} onChange={(e) => setStyle(e.target.value)}>
                  {STYLES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            )}
            <details className="veo-custom-prompt">
              <summary>Custom Prompt <span className="muted">· Tùy chọn</span></summary>
              <textarea className="veo-modal-textarea" placeholder="Prompt tùy chỉnh thêm…"
                value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} />
            </details>
          </div>
          <div className="veo-modal-foot">
            <button type="button" className="veo-btn-ghost" onClick={() => setProjectOpen(false)}>Hủy</button>
            <button type="button" className={`veo-btn-go ${projectTab} ${canAnalyze ? '' : 'disabled'}`}
              disabled={!canAnalyze} onClick={createProjectFromModal}>
              ▶{' '}
              {projectTab === 'ideas' ? 'Tạo từ ý tưởng'
                : projectTab === 'youtube' || projectTab === 'tiktok' ? 'Phân tích video'
                : projectTab === 'upload' ? 'Tạo dự án'
                : 'Bắt đầu phân tích'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  /** «Download»: chép video đã xong sang thư mục người dùng chọn (cầu nối chép file thật). */
  async function downloadFiles(paths: string[]) {
    const ds = paths.filter(Boolean)
    if (!ds.length) return showToast('Chưa có video nào xong')
    try {
      const dest = await pickFolder(outDir)
      if (!dest) return
      const r = await api<{ n: number }>('/api/util/copy-files', { paths: ds, dest })
      pushLog(`⬇ Đã chép ${r.n} video → ${dest}`)
      showToast(`Đã chép ${r.n} video`)
    } catch (e) {
      showToast(errText(e))
    }
  }

  function JobCard({ job, no }: { job: VeoJob; no: number }) {
    const st = statusLabel(job.status)
    const file = job.files?.[0]
    const on = picked.includes(job.id)
    return (
      <div className={`veo-job-card sv ${job.status}${on ? ' picked' : ''}`}>
        <button
          type="button"
          className="veo-job-no"
          title={on ? 'Bỏ chọn' : 'Chọn'}
          onClick={() => setPicked((p) => (on ? p.filter((x) => x !== job.id) : [...p, job.id]))}
        >
          {on ? '✓' : no}
        </button>
        <div className="veo-job-thumb">
          {file ? (
            <video src={`${fileUrl(file)}#t=0.5`} preload="metadata" controls muted />
          ) : (
            <span className="veo-job-wait">{job.status === 'loi' ? 'Lỗi' : 'Đang xử lý...'}</span>
          )}
        </div>
        <div className="veo-job-body">
          <div className="veo-job-head">
            <span className={`veo-job-st ${st.cls}`}>
              {st.text}
              {(job.status === 'cho' || job.status === 'dang_chay') && <i className="veo-dots" aria-hidden>•••</i>}
            </span>
            <span className="veo-job-acts">
              {job.status === 'xong' && (
                <button type="button" className="veo-job-act blue" title="Sửa prompt (đưa lên khung nhập)"
                  onClick={() => { setPrompt(job.prompt); setMode('text'); showToast('Đã đưa prompt lên khung nhập') }}>
                  ✎
                </button>
              )}
              {job.status !== 'dang_chay' && (
                <button type="button" className="veo-job-act violet" title="Tạo lại"
                  disabled={job.bridge && bridgeRunning}
                  onClick={() => {
                    if (job.bridge) {
                      setHiddenJobs((prev) => [...prev, job.id])
                      void startTextReal([job.prompt])
                    }
                  }}>
                  ✦
                </button>
              )}
              {job.bridge && job.status === 'xong' && file && (
                <button type="button" className="veo-job-act" title="Upscale x2 (realesrgan)"
                  onClick={() => void upscaleFile(file)}>⇧</button>
              )}
              <button type="button" className="veo-job-act red" title="Xóa" onClick={() => deleteJob(job.id)}>
                🗑
              </button>
            </span>
          </div>
          <div className="veo-job-prompt" title={job.prompt}>{job.prompt}</div>
          {job.status === 'loi' && job.msg && <div className="veo-job-err" title={job.msg}>{job.msg}</div>}
          {job.status === 'dang_chay' && job.msg && !/^⏸?\s*Chờ/.test(job.msg) && (
            <div className="veo-job-msg" title={job.msg}>{job.msg}</div>
          )}
          {job.status === 'xong' && file && (
            <button type="button" className="veo-job-dl" onClick={() => void downloadFiles([file])}>
              ⬇ Download
            </button>
          )}
          <div className="veo-job-time">{new Date(job.createdAt).toLocaleString('en-US')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className={`veo-sv${mode === 'text' ? ' t2v-wide' : ''}`}>
      <aside className="veo-sv-left">
        {mode === 'text' && renderTextPanel()}
        {mode === 'image' && <ImagePanel />}
        {mode === 'ingredients' && <IngredientsPanel />}
        {mode === 'video' && <VideoPanel />}
        {mode === 'omni' && <OmniPanel />}
        {mode === 'script' && <ScriptPanel />}
      </aside>
      <section className="veo-sv-right">
        <div className="veo-canvas-bar sv">
          <label className="veo-pick-all">
            <input type="checkbox" checked={jobs.length > 0 && picked.length === jobs.length}
              onChange={(e) => setPicked(e.target.checked ? jobs.map((j) => j.id) : [])} />
            <span>Chọn tất cả{picked.length ? ` (${picked.length})` : ''}</span>
          </label>
          <div className="veo-view-toggles sv">
            {(['list', 'grid2', 'grid3', 'grid4'] as const).map((v, i) => (
              <button key={v} type="button" className={`veo-view ${view === v ? 'on' : ''}`}
                onClick={() => setView(v)} title={['Danh sách', 'Lưới 2 cột', 'Lưới 3 cột', 'Lưới 4 cột'][i]}>
                {['☰', '▦', '⊞', '▩'][i]}
              </button>
            ))}
          </div>
          <span className="grow" />
          <div className="veo-canvas-actions">
            {(() => {
              const nguon = picked.length ? jobs.filter((j) => picked.includes(j.id)) : jobs
              const xong = nguon.filter((j) => j.status === 'xong' && j.files?.[0]).map((j) => j.files![0])
              return (
                <button type="button" className="veo-link" disabled={xong.length === 0}
                  onClick={() => void downloadFiles(xong)}>
                  ⬇ Download ({xong.length})
                </button>
              )
            })()}
            <button type="button" className="veo-link" disabled={errCount === 0}
              onClick={() => retryJobs('loi')}>↻ Tạo lại video lỗi ({errCount})</button>
            <button type="button" className="veo-link" disabled={jobs.length === 0}
              onClick={() => retryJobs('all')}>↻ Tạo lại ({jobs.length})</button>
            <button type="button" className="veo-link strong" disabled={jobs.length === 0}
              onClick={() => { clearJobs(); setPicked([]) }}>Xóa tất cả</button>
          </div>
        </div>
        <div className="veo-canvas">
          {jobs.length === 0 ? (
            <div className="veo-empty">
              <div className="veo-empty-ico" aria-hidden>▶</div>
              <div className="veo-empty-title">Chưa có video</div>
              <div className="veo-empty-sub">
                Hàng đợi trống — chọn mode <b>{MODE_LABEL[mode]}</b> rồi bấm bắt đầu
              </div>
            </div>
          ) : (
            <div className={`veo-job-grid ${view}`}>
              {jobs.map((j, i) => <JobCard key={j.id} job={j} no={i + 1} />)}
            </div>
          )}
        </div>
      </section>
      <ProjectModal />
      {toast && <div className="veo-toast">{toast}</div>}
    </div>
  )
}
