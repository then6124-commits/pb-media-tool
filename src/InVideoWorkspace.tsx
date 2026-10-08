import { useEffect, useMemo, useRef, useState } from 'react'

type View = 'manager' | 'create'
type InputKind = 'idea' | 'script' | 'audio' | 'link' | 'dub'
type MediaKind = 'stock_img' | 'stock_vid' | 'ai_motion' | 'gameplay'
type AudioSrc = 'original' | 'tts'
type Ratio = 'doc' | 'ngang' | 'vuong'
type TransitionId =
  | 'none'
  | 'fade'
  | 'fade_black'
  | 'fade_gray'
  | 'wipe_left'
  | 'wipe_right'
  | 'wipe_up'
  | 'wipe_down'
  | 'dir_wipe'
  | 'slide'
  | 'wind'
  | 'crosswarp'

type ModelItem = {
  id: string
  name: string
  desc: string
  size: string
  icon: string
  tone: 'purple' | 'orange' | 'blue'
  status: 'pending' | 'downloading' | 'done'
  progress: number
}

type BgThumb = { id: number; label: string; hue: number }

const LS_SETUP = 'pb.invideo.setupDone'
const LS_WAVE = 'pb.invideo.wave'
const LS_RATIO = 'pb.invideo.ratio'
const LS_INPUT = 'pb.invideo.input'
const LS_MEDIA = 'pb.invideo.media'
const LS_TRANS = 'pb.invideo.trans'
const LS_VOICE = 'pb.invideo.voice'
const LS_AUDIO_SRC = 'pb.invideo.audioSrc'
const LS_LANG = 'pb.invideo.lang'
const LS_BG_CAT = 'pb.invideo.bgCat'
const LS_BG_ID = 'pb.invideo.bgId'

const INPUTS: { id: InputKind; label: string; icon: string; hint?: string }[] = [
  { id: 'idea', label: 'Idea → Video', icon: '💡' },
  { id: 'script', label: 'Kịch bản → Video', icon: '📄' },
  { id: 'audio', label: 'Audio → Video', icon: '🎧', hint: '(Chỉ hỗ trợ file giọng nói)' },
  {
    id: 'link',
    label: 'Link → Video',
    icon: '🔗',
    hint: '(Hỗ trợ video dạng tin tức - YouTube, TikTok, FB, IG...)',
  },
  { id: 'dub', label: 'Dịch & Lồng tiếng', icon: '🌐' },
]

const MEDIAS: {
  id: MediaKind
  label: string
  desc: string
  icon: string
  disabled?: boolean
}[] = [
  {
    id: 'stock_img',
    label: 'Ảnh có sẵn',
    desc: 'Ảnh stock chất lượng cao + hiệu ứng zoom',
    icon: '🖼️',
  },
  {
    id: 'stock_vid',
    label: 'Video có sẵn',
    desc: 'Video chất lượng cao từ thư viện',
    icon: '🎬',
  },
  {
    id: 'ai_motion',
    label: 'Ảnh AI chuyển động',
    desc: 'Tạm thời không khả dụng',
    icon: '✨',
    disabled: true,
  },
  {
    id: 'gameplay',
    label: 'Tĩnh / Gameplay',
    desc: 'Video nền thư giãn',
    icon: '🎮',
  },
]

const BASIC_TRANS: { id: TransitionId; label: string; desc: string; icon: string }[] = [
  { id: 'none', label: 'Không dùng', desc: 'Cắt cứng', icon: '🚫' },
  { id: 'fade', label: 'Fade', desc: 'Cross-dissolve mượt', icon: '✨' },
  { id: 'fade_black', label: 'Fade Black', desc: 'Fade qua đen', icon: '⚫' },
  { id: 'fade_gray', label: 'Fade Gray', desc: 'Fade + xám', icon: '⚪' },
]

const WIPE_TRANS: { id: TransitionId; label: string; icon: string }[] = [
  { id: 'wipe_left', label: 'Wipe Left', icon: '←' },
  { id: 'wipe_right', label: 'Wipe Right', icon: '→' },
  { id: 'wipe_up', label: 'Wipe Up', icon: '↑' },
  { id: 'wipe_down', label: 'Wipe Down', icon: '↓' },
  { id: 'dir_wipe', label: 'Dir. Wipe', icon: '↗' },
  { id: 'slide', label: 'Slide', icon: '⇉' },
  { id: 'wind', label: 'Wind', icon: '≋' },
  { id: 'crosswarp', label: 'CrossWarp', icon: '✕' },
]

const EXTRA_TRANS: { id: string; label: string; icon: string }[] = [
  { id: 'zoom_in', label: 'Zoom In', icon: '＋' },
  { id: 'zoom_out', label: 'Zoom Out', icon: '－' },
  { id: 'blur', label: 'Blur', icon: '◌' },
  { id: 'pixelate', label: 'Pixelate', icon: '▦' },
  { id: 'circle', label: 'Circle Open', icon: '○' },
  { id: 'diamond', label: 'Diamond', icon: '◇' },
  { id: 'clock', label: 'Clock Wipe', icon: '◔' },
  { id: 'radial', label: 'Radial', icon: '◎' },
]

const BG_CATS = [
  'Viral Video',
  'Gameplay',
  'UGC',
  'Temple Run',
  'Subway S.',
  'Trackmania',
  'Fortnite',
  'Space',
  'Abstract',
  'Satisfying',
]

const VOICES = [
  'Achernar',
  'Aoede',
  'Charon',
  'Fenrir',
  'Kore',
  'Leda',
  'Orus',
  'Puck',
  'Zephyr',
]

const LANGS = ['Tiếng Việt', 'English', '中文', '日本語', '한국어', 'Español', 'Français']

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeLS(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val))
  } catch {
    /* ignore */
  }
}

function makeThumbs(cat: string): BgThumb[] {
  const base = cat.length * 17
  return Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    label: `${cat} ${i + 1}`,
    hue: (base + i * 41) % 360,
  }))
}

function ratioMeta(r: Ratio) {
  if (r === 'doc') return { label: '9:16', wh: '1080 × 1920', cls: 'portrait' }
  if (r === 'ngang') return { label: '16:9', wh: '1920 × 1080', cls: 'landscape' }
  return { label: '1:1', wh: '1080 × 1080', cls: 'square' }
}

function defaultModels(): ModelItem[] {
  return [
    {
      id: 'whisper',
      name: 'Whisper Large V3 Turbo',
      desc: 'Speech-to-text model • ~874MB',
      size: '~874MB',
      icon: '⬡',
      tone: 'purple',
      status: 'pending',
      progress: 0,
    },
    {
      id: 'accel',
      name: 'Whisper Accelerator',
      desc: 'GPU/BLAS engine • auto-detect',
      size: 'auto',
      icon: '⚡',
      tone: 'orange',
      status: 'pending',
      progress: 0,
    },
    {
      id: 'deno',
      name: 'YouTube Runtime (Deno)',
      desc: 'Giải mã JS challenge • ~47MB',
      size: '~47MB',
      icon: '🌐',
      tone: 'blue',
      status: 'pending',
      progress: 0,
    },
  ]
}

export default function InVideoWorkspace() {
  const [view, setView] = useState<View>('manager')
  const [showSetup, setShowSetup] = useState(false)
  const [setupDone, setSetupDone] = useState(() => readLS(LS_SETUP, false))
  const [models, setModels] = useState<ModelItem[]>(defaultModels)
  const [downloading, setDownloading] = useState(false)

  const [input, setInput] = useState<InputKind>(() => readLS(LS_INPUT, 'link'))
  const [media, setMedia] = useState<MediaKind>(() => readLS(LS_MEDIA, 'stock_img'))
  const [trans, setTrans] = useState<TransitionId>(() => readLS(LS_TRANS, 'fade'))
  const [showMoreTrans, setShowMoreTrans] = useState(false)
  const [wave, setWave] = useState(() => readLS(LS_WAVE, false))
  const [ratio, setRatio] = useState<Ratio>(() => readLS(LS_RATIO, 'doc'))
  const [audioFile, setAudioFile] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [lang, setLang] = useState(() => readLS(LS_LANG, 'Tiếng Việt'))
  const [audioSrc, setAudioSrc] = useState<AudioSrc>(() => readLS(LS_AUDIO_SRC, 'tts'))
  const [voice, setVoice] = useState(() => readLS(LS_VOICE, 'Achernar'))
  const [ideaText, setIdeaText] = useState('')
  const [scriptText, setScriptText] = useState('')
  const [bgCat, setBgCat] = useState(() => readLS(LS_BG_CAT, 'Viral Video'))
  const [bgId, setBgId] = useState(() => readLS(LS_BG_ID, 1))
  const [toast, setToast] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [videos, setVideos] = useState<{ id: number; title: string; when: string }[]>([])
  const [logOpen, setLogOpen] = useState(true)
  const [logs, setLogs] = useState<
    { id: number; time: string; level: string; msg: string }[]
  >(() => [
    {
      id: 1,
      time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
      level: 'INFO',
      msg: 'FFmpeg detected — sẵn sàng ghép video (mock).',
    },
  ])

  const fileRef = useRef<HTMLInputElement>(null)
  const dlTimer = useRef<number | null>(null)

  const thumbs = useMemo(() => makeThumbs(bgCat), [bgCat])
  const rMeta = ratioMeta(ratio)
  const remaining = models.filter((m) => m.status !== 'done').length

  useEffect(() => () => {
    if (dlTimer.current) window.clearInterval(dlTimer.current)
  }, [])

  useEffect(() => writeLS(LS_INPUT, input), [input])
  useEffect(() => writeLS(LS_MEDIA, media), [media])
  useEffect(() => writeLS(LS_TRANS, trans), [trans])
  useEffect(() => writeLS(LS_WAVE, wave), [wave])
  useEffect(() => writeLS(LS_RATIO, ratio), [ratio])
  useEffect(() => writeLS(LS_LANG, lang), [lang])
  useEffect(() => writeLS(LS_AUDIO_SRC, audioSrc), [audioSrc])
  useEffect(() => writeLS(LS_VOICE, voice), [voice])
  useEffect(() => writeLS(LS_BG_CAT, bgCat), [bgCat])
  useEffect(() => writeLS(LS_BG_ID, bgId), [bgId])

  function pushLog(level: string, msg: string) {
    setLogs((prev) => [
      ...prev.slice(-80),
      {
        id: Date.now(),
        time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
        level,
        msg,
      },
    ])
  }

  function flash(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }

  function openCreate() {
    setView('create')
    if (!setupDone) {
      setShowSetup(true)
      pushLog('INFO', 'Mở AI Models Setup — tải Whisper / Deno (mock).')
    }
  }

  function closeSetup(markDone = false) {
    setShowSetup(false)
    if (markDone) {
      setSetupDone(true)
      writeLS(LS_SETUP, true)
    }
  }

  function startDownloadAll() {
    if (downloading) return
    setDownloading(true)
    pushLog('INFO', 'Bắt đầu tải models (mock)…')
    let idx = 0
    const ids = models.map((m) => m.id)
    setModels((prev) =>
      prev.map((m, i) =>
        i === 0 ? { ...m, status: 'downloading', progress: 8 } : m,
      ),
    )
    if (dlTimer.current) window.clearInterval(dlTimer.current)
    dlTimer.current = window.setInterval(() => {
      setModels((prev) => {
        const next = prev.map((m) => ({ ...m }))
        const cur = next.find((m) => m.id === ids[idx])
        if (!cur) return prev
        if (cur.status === 'pending') cur.status = 'downloading'
        cur.progress = Math.min(100, cur.progress + 12 + Math.floor(Math.random() * 10))
        if (cur.progress >= 100) {
          cur.progress = 100
          cur.status = 'done'
          idx += 1
          if (idx < ids.length) {
            const n = next.find((m) => m.id === ids[idx])
            if (n) {
              n.status = 'downloading'
              n.progress = 5
            }
          }
        }
        if (idx >= ids.length && next.every((m) => m.status === 'done')) {
          if (dlTimer.current) window.clearInterval(dlTimer.current)
          dlTimer.current = null
          setDownloading(false)
          setSetupDone(true)
          writeLS(LS_SETUP, true)
          pushLog('INFO', 'Đã tải xong 3 models (mock).')
          flash('Models sẵn sàng (mock)')
          window.setTimeout(() => setShowSetup(false), 600)
        }
        return next
      })
    }, 280)
  }

  function onPickAudio(file?: File | null) {
    if (!file) return
    setAudioFile(file.name)
    pushLog('INFO', `Đã chọn audio: ${file.name}`)
    flash(`Đã chọn: ${file.name}`)
  }

  function handleCreateVideo() {
    if (creating) return
    if (input === 'audio' && !audioFile) {
      flash('Hãy chọn file âm thanh trước')
      return
    }
    if (input === 'link' && !link.trim()) {
      flash('Hãy dán link video trước')
      return
    }
    if (input === 'idea' && !ideaText.trim()) {
      flash('Hãy nhập ý tưởng trước')
      return
    }
    if (input === 'script' && !scriptText.trim()) {
      flash('Hãy nhập kịch bản trước')
      return
    }
    setCreating(true)
    pushLog('INFO', `Đang tạo video (${INPUTS.find((i) => i.id === input)?.label})…`)
    window.setTimeout(() => {
      const title =
        input === 'link'
          ? `Link · ${link.slice(0, 42) || 'video'}`
          : input === 'audio'
            ? `Audio · ${audioFile}`
            : input === 'idea'
              ? `Idea · ${ideaText.slice(0, 36)}`
              : input === 'script'
                ? `Script · ${scriptText.slice(0, 36)}`
                : 'Dịch & Lồng tiếng'
      setVideos((v) => [
        {
          id: Date.now(),
          title,
          when: new Date().toLocaleString('vi-VN'),
        },
        ...v,
      ])
      setCreating(false)
      pushLog('INFO', 'Tạo video xong (mock) — đã thêm vào Video Manager.')
      flash('Đã tạo video (mock)')
      setView('manager')
    }, 1400)
  }

  return (
    <div className="inv-root">
      {view === 'manager' ? (
        <div className="inv-manager">
          <header className="inv-mgr-head">
            <div>
              <h1>Video Manager</h1>
              <div className="inv-crumb">
                <span>Home</span>
                <span className="inv-crumb-sep">›</span>
                <span>Video Manager</span>
              </div>
            </div>
            <button type="button" className="inv-btn-create" onClick={openCreate}>
              <span>+</span> Create
            </button>
          </header>

          {videos.length === 0 ? (
            <div className="inv-empty">
              <div className="inv-empty-ico" aria-hidden>
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                  <rect x="8" y="14" width="48" height="36" rx="6" stroke="#c4c9d4" strokeWidth="2.5" />
                  <path d="M8 22h48M8 42h48M20 14v36M44 14v36" stroke="#c4c9d4" strokeWidth="2" />
                  <circle cx="32" cy="32" r="7" stroke="#c4c9d4" strokeWidth="2" />
                </svg>
              </div>
              <div className="inv-empty-title">No videos yet</div>
              <div className="inv-empty-sub">Click &apos;Create&apos; to get started.</div>
              <button type="button" className="inv-btn-create ghost" onClick={openCreate}>
                + Create
              </button>
            </div>
          ) : (
            <div className="inv-video-grid">
              {videos.map((v) => (
                <article key={v.id} className="inv-video-card">
                  <div className="inv-video-thumb">
                    <span>▶</span>
                  </div>
                  <div className="inv-video-meta">
                    <div className="inv-video-title">{v.title}</div>
                    <div className="inv-video-when">{v.when}</div>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className={`inv-log ${logOpen ? 'open' : ''}`}>
            <div className="inv-log-head">
              <button type="button" className="inv-log-toggle" onClick={() => setLogOpen((o) => !o)}>
                Nhật ký hoạt động {logOpen ? '▾' : '▸'}
              </button>
              <button
                type="button"
                className="inv-linkish"
                onClick={() => {
                  setLogs([
                    {
                      id: Date.now(),
                      time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
                      level: 'INFO',
                      msg: 'Đã xóa nhật ký (mock).',
                    },
                  ])
                }}
              >
                Xóa
              </button>
            </div>
            {logOpen && (
              <div className="inv-log-body">
                {logs.map((l) => (
                  <div key={l.id} className={`inv-log-line ${l.level === 'LỖI' ? 'err' : ''}`}>
                    <span className="t">{l.time}</span>
                    <span className={`lv ${l.level === 'LỖI' ? 'err' : ''}`}>{l.level}</span>
                    <span className="m">{l.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="inv-create">
          <header className="inv-create-head">
            <button
              type="button"
              className="inv-back"
              onClick={() => setView('manager')}
              title="Quay lại"
            >
              ←
            </button>
            <h1>Tạo video mới</h1>
            <div className="inv-create-actions">
              <button
                type="button"
                className="inv-btn-ghost"
                onClick={() => {
                  setShowSetup(true)
                  pushLog('INFO', 'Mở lại AI Models Setup.')
                }}
              >
                AI Models
              </button>
              <button
                type="button"
                className="inv-btn-primary"
                disabled={creating}
                onClick={handleCreateVideo}
              >
                {creating ? 'Đang tạo…' : 'Tạo video'}
              </button>
            </div>
          </header>

          <div className="inv-create-body">
            <div className="inv-create-left">
              {/* Input type */}
              <section className="inv-card">
                <h2>Chọn loại đầu vào</h2>
                <div className="inv-input-pills">
                  {INPUTS.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      className={`inv-pill ${input === it.id ? 'on' : ''}`}
                      onClick={() => {
                        setInput(it.id)
                        pushLog('INFO', `Chọn đầu vào: ${it.label}`)
                      }}
                    >
                      <span className="ico">{it.icon}</span>
                      <span className="lab">
                        <strong>{it.label}</strong>
                        {input === it.id && it.hint && <em>{it.hint}</em>}
                      </span>
                    </button>
                  ))}
                </div>

                {input === 'idea' && (
                  <div className="inv-field">
                    <label>Ý tưởng</label>
                    <textarea
                      rows={4}
                      placeholder="Mô tả ý tưởng video của bạn…"
                      value={ideaText}
                      onChange={(e) => setIdeaText(e.target.value)}
                    />
                  </div>
                )}

                {input === 'script' && (
                  <div className="inv-field">
                    <label>Kịch bản</label>
                    <textarea
                      rows={6}
                      placeholder="Dán kịch bản / thoại…"
                      value={scriptText}
                      onChange={(e) => setScriptText(e.target.value)}
                    />
                  </div>
                )}

                {input === 'audio' && (
                  <>
                    <div className="inv-field">
                      <label>Âm thanh đầu vào</label>
                      <div
                        className="inv-drop"
                        role="button"
                        tabIndex={0}
                        onClick={() => fileRef.current?.click()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click()
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          onPickAudio(e.dataTransfer.files?.[0])
                        }}
                      >
                        <div className="inv-drop-ico">☁️</div>
                        <div>
                          {audioFile ? (
                            <>
                              <strong>{audioFile}</strong>
                              <div className="muted">Nhấn để đổi file</div>
                            </>
                          ) : (
                            <>
                              <strong>Kéo thả hoặc nhấn để chọn file</strong>
                              <div className="muted">MP3, WAV, M4A…</div>
                            </>
                          )}
                        </div>
                      </div>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="audio/*"
                        hidden
                        onChange={(e) => onPickAudio(e.target.files?.[0])}
                      />
                    </div>
                    <div className="inv-wave-row">
                      <div className="inv-wave-left">
                        <span className="inv-wave-ico">🎵</span>
                        <div>
                          <strong>Sóng âm thanh</strong>
                          <div className="muted">Thêm hiệu ứng sóng nhạc vào video</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`inv-switch ${wave ? 'on' : ''}`}
                        aria-pressed={wave}
                        onClick={() => setWave((w) => !w)}
                      >
                        <span />
                      </button>
                    </div>
                  </>
                )}

                {input === 'link' && (
                  <div className="inv-link-block">
                    <div className="inv-link-lab">
                      <span>Link video</span>
                      <span className="inv-tag">subtitle → caption tự động</span>
                    </div>
                    <div className="inv-link-row">
                      <div className="inv-link-input">
                        <span className="ico">🔗</span>
                        <input
                          type="url"
                          placeholder="Dán link YouTube, TikTok, Facebook, Instagram..."
                          value={link}
                          onChange={(e) => setLink(e.target.value)}
                        />
                      </div>
                      <select value={lang} onChange={(e) => setLang(e.target.value)}>
                        {LANGS.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="inv-seg">
                      <button
                        type="button"
                        className={audioSrc === 'original' ? 'on' : ''}
                        onClick={() => setAudioSrc('original')}
                      >
                        🎵 Audio gốc
                      </button>
                      <button
                        type="button"
                        className={audioSrc === 'tts' ? 'on' : ''}
                        onClick={() => setAudioSrc('tts')}
                      >
                        🎤 TTS Dubbing
                      </button>
                    </div>
                    <p className="inv-hint">
                      {audioSrc === 'original'
                        ? `Sử dụng audio gốc từ video · Caption từ subtitle ${lang}`
                        : 'AI đọc subtitle bằng giọng TTS • Chọn giọng bên dưới (Server 2 mặc định)'}
                    </p>
                    {audioSrc === 'tts' && (
                      <div className="inv-voice">
                        <label>Chọn giọng nói (TTS)</label>
                        <div className="inv-voice-row">
                          <span className="inv-voice-avatar">♀</span>
                          <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                            {VOICES.map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                    <div className="inv-wave-row compact">
                      <div className="inv-wave-left">
                        <span className="inv-wave-ico">🎵</span>
                        <div>
                          <strong>Sóng âm thanh</strong>
                          <div className="muted">Hiển thị sóng trên preview</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`inv-switch ${wave ? 'on' : ''}`}
                        aria-pressed={wave}
                        onClick={() => setWave((w) => !w)}
                      >
                        <span />
                      </button>
                    </div>
                  </div>
                )}

                {input === 'dub' && (
                  <div className="inv-link-block">
                    <div className="inv-field">
                      <label>Link / file nguồn</label>
                      <div className="inv-link-input">
                        <span className="ico">🌐</span>
                        <input
                          type="text"
                          placeholder="Dán link hoặc đường dẫn file cần dịch & lồng tiếng…"
                          value={link}
                          onChange={(e) => setLink(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="inv-grid-2">
                      <div className="inv-field">
                        <label>Ngôn ngữ nguồn</label>
                        <select value={lang} onChange={(e) => setLang(e.target.value)}>
                          {LANGS.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="inv-field">
                        <label>Giọng TTS</label>
                        <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                          {VOICES.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Media type */}
              <section className="inv-card">
                <h2>Chọn loại media</h2>
                <div className="inv-media-grid">
                  {MEDIAS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={m.disabled}
                      className={`inv-media-card ${media === m.id ? 'on' : ''} ${
                        m.disabled ? 'off' : ''
                      }`}
                      onClick={() => {
                        if (m.disabled) return
                        setMedia(m.id)
                        pushLog('INFO', `Media: ${m.label}`)
                      }}
                    >
                      {media === m.id && <span className="chk">✓</span>}
                      <span className="ico">{m.icon}</span>
                      <strong>{m.label}</strong>
                      <span className="desc">{m.desc}</span>
                    </button>
                  ))}
                </div>

                {media === 'gameplay' && (
                  <div className="inv-bg-block">
                    <h3>Chọn video nền</h3>
                    <div className="inv-bg-cats">
                      {BG_CATS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`inv-cat ${bgCat === c ? 'on' : ''}`}
                          onClick={() => {
                            setBgCat(c)
                            setBgId(1)
                          }}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                    <div className="inv-bg-thumbs">
                      {thumbs.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={`inv-thumb ${bgId === t.id ? 'on' : ''}`}
                          style={{
                            background: `linear-gradient(145deg, hsl(${t.hue} 55% 42%), hsl(${
                              (t.hue + 40) % 360
                            } 60% 28%))`,
                          }}
                          onClick={() => setBgId(t.id)}
                          title={t.label}
                        >
                          {bgId === t.id && <span className="chk">✓</span>}
                          <span className="cap">{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* Transitions — hide when gameplay? Screenshots show transitions for stock, and bg for gameplay. When gameplay selected, transitions section may be replaced. Looking at last screenshot - when Tĩnh/Gameplay is selected, it shows "Chọn video nền" instead of transitions. */}
              {media !== 'gameplay' && (
                <section className="inv-card">
                  <h2>Hiệu ứng chuyển cảnh</h2>
                  <div className="inv-trans-group">
                    <div className="inv-trans-label">CƠ BẢN</div>
                    <div className="inv-trans-grid">
                      {BASIC_TRANS.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={`inv-trans ${trans === t.id ? 'on' : ''}`}
                          onClick={() => setTrans(t.id)}
                        >
                          {trans === t.id && <span className="chk">✓</span>}
                          <span className="ico">{t.icon}</span>
                          <strong>{t.label}</strong>
                          <span className="desc">{t.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="inv-trans-group">
                    <div className="inv-trans-label">WIPE & SLIDE</div>
                    <div className="inv-trans-grid wipe">
                      {WIPE_TRANS.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={`inv-trans ${trans === t.id ? 'on' : ''}`}
                          onClick={() => setTrans(t.id)}
                        >
                          {trans === t.id && <span className="chk">✓</span>}
                          <span className="ico blue">{t.icon}</span>
                          <strong>{t.label}</strong>
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="inv-more-trans"
                    onClick={() => setShowMoreTrans((s) => !s)}
                  >
                    {showMoreTrans ? 'Thu gọn' : 'Xem thêm 35 hiệu ứng'} ▾
                  </button>
                  {showMoreTrans && (
                    <div className="inv-trans-grid wipe extra">
                      {EXTRA_TRANS.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className="inv-trans"
                          onClick={() => flash(`Hiệu ứng ${t.label} (mock)`)}
                        >
                          <span className="ico blue">{t.icon}</span>
                          <strong>{t.label}</strong>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>

            {/* Preview */}
            <aside className="inv-preview">
              <div className="inv-ratio-row">
                <span>Ratio</span>
                <div className="inv-ratio-seg">
                  {(
                    [
                      ['doc', 'Dọc'],
                      ['ngang', 'Ngang'],
                      ['vuong', 'Vuông'],
                    ] as const
                  ).map(([id, lab]) => (
                    <button
                      key={id}
                      type="button"
                      className={ratio === id ? 'on' : ''}
                      onClick={() => setRatio(id)}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
              </div>
              <div className={`inv-stage ${rMeta.cls}`}>
                <div className="inv-stage-inner">
                  <div className="inv-stage-bg" />
                  <span className="inv-preview-tag">⚡ Xem trước</span>
                  {wave && <div className="inv-wave-viz" aria-hidden />}
                  <div className="inv-stage-title">Superveo tool</div>
                  <div className="inv-stage-foot">
                    <div>Video tạo bởi AI</div>
                    <div>
                      {rMeta.wh} · {rMeta.label}
                    </div>
                  </div>
                </div>
              </div>
              <div className="inv-preview-meta">
                <div>
                  Media:{' '}
                  <strong>{MEDIAS.find((m) => m.id === media)?.label}</strong>
                </div>
                {media !== 'gameplay' && (
                  <div>
                    Transition: <strong>{trans}</strong>
                  </div>
                )}
                {media === 'gameplay' && (
                  <div>
                    Nền: <strong>{bgCat} #{bgId}</strong>
                  </div>
                )}
                {input === 'link' && audioSrc === 'tts' && (
                  <div>
                    TTS: <strong>{voice}</strong>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      )}

      {showSetup && (
        <div className="inv-modal-backdrop" onClick={() => closeSetup(false)}>
          <div
            className="inv-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inv-setup-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="inv-modal-head">
              <div className="inv-modal-ico">⚙️</div>
              <div>
                <h2 id="inv-setup-title">AI Models Setup</h2>
                <p>Download models for transcription</p>
              </div>
              <button type="button" className="inv-modal-x" onClick={() => closeSetup(false)}>
                ×
              </button>
            </header>
            <div className="inv-steps">
              {[1, 2, 3].map((n) => (
                <div key={n} className={`inv-step ${n === 1 ? 'on' : ''}`}>
                  <span>{n}</span>
                </div>
              ))}
            </div>
            <div className="inv-model-list">
              {models.map((m) => (
                <div key={m.id} className="inv-model-row">
                  <div className={`inv-model-ico ${m.tone}`}>{m.icon}</div>
                  <div className="inv-model-info">
                    <strong>{m.name}</strong>
                    <span>{m.desc}</span>
                    {m.status === 'downloading' && (
                      <div className="inv-model-bar">
                        <i style={{ width: `${m.progress}%` }} />
                      </div>
                    )}
                  </div>
                  <div className={`inv-model-status ${m.status}`}>
                    {m.status === 'done' ? '✓' : m.status === 'downloading' ? `${m.progress}%` : m.size}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="inv-dl-all"
              disabled={downloading || remaining === 0}
              onClick={startDownloadAll}
            >
              ⬇{' '}
              {remaining === 0
                ? 'All models ready'
                : downloading
                  ? 'Downloading…'
                  : `Download All Models (${remaining} remaining)`}
            </button>
            <div className="inv-info-box">
              <span className="i">ℹ</span>
              <ul>
                <li>~920MB total disk space (Whisper + Deno)</li>
                <li>Downloads sequentially — just click once!</li>
                <li>GPU auto-detection for faster transcription</li>
                <li>Deno enables YouTube video/audio download</li>
                <li>All processing happens locally (100% private)</li>
              </ul>
            </div>
            <button type="button" className="inv-skip" onClick={() => closeSetup(true)}>
              Bỏ qua / dùng sau
            </button>
          </div>
        </div>
      )}

      {toast && <div className="inv-toast">{toast}</div>}
    </div>
  )
}
