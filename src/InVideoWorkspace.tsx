import { useEffect, useRef, useState } from 'react'
import { api, baseName, errText, fileUrl, openFolder, pickFiles, useJobs } from './bridge'

type View = 'manager' | 'create'
type InputKind = 'idea' | 'script' | 'audio' | 'link' | 'dub'
type MediaKind = 'stock_img' | 'stock_vid' | 'ai_motion' | 'gameplay'
type AudioSrc = 'original' | 'tts'
type Ratio = 'doc' | 'ngang' | 'vuong'
type TransitionId =
  | string
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

type SetupState = {
  ffmpeg: boolean
  ytdlp: boolean
  deno: boolean
  whisper: boolean
  gemini: number
  pexels: boolean
}

type InvVideo = { path: string; name: string; t: number; size: number }

const LS_SETUP = 'pb.invideo.setupDone'
const LS_WAVE = 'pb.invideo.wave'
const LS_RATIO = 'pb.invideo.ratio'
const LS_INPUT = 'pb.invideo.input'
const LS_MEDIA = 'pb.invideo.media'
const LS_TRANS = 'pb.invideo.trans'
const LS_VOICE = 'pb.invideo.voice'
const LS_AUDIO_SRC = 'pb.invideo.audioSrc'
const LS_LANG = 'pb.invideo.lang'
const LS_BG = 'pb.invideo.bg'

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

function ratioMeta(r: Ratio) {
  if (r === 'doc') return { label: '9:16', wh: '1080 × 1920', cls: 'portrait' }
  if (r === 'ngang') return { label: '16:9', wh: '1920 × 1080', cls: 'landscape' }
  return { label: '1:1', wh: '1080 × 1080', cls: 'square' }
}

export default function InVideoWorkspace() {
  const [view, setView] = useState<View>('manager')
  const [showSetup, setShowSetup] = useState(false)
  const [setupDone, setSetupDone] = useState(() => readLS(LS_SETUP, false))
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [pexelsKey, setPexelsKey] = useState('')

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
  const [bg, setBg] = useState(() => readLS(LS_BG, ''))
  const [toast, setToast] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [videos, setVideos] = useState<InvVideo[]>([])
  const [playing, setPlaying] = useState<string | null>(null)
  const [logOpen, setLogOpen] = useState(true)
  const [logs, setLogs] = useState<{ id: number; time: string; level: string; msg: string }[]>([])
  const logSince = useRef(0)
  const jobs = useJobs(['invideo', 'invideo-setup'])
  const running = jobs.filter((j) => j.loai === 'invideo' && j.status === 'dang_chay')
  const setupJob = jobs.find((j) => j.loai === 'invideo-setup')

  const rMeta = ratioMeta(ratio)
  const doneJobs = jobs.filter((j) => j.loai === 'invideo' && j.status !== 'dang_chay').length

  async function loadVideos() {
    try {
      const r = await api<{ items: InvVideo[] }>('/api/invideo/list', {})
      setVideos(r.items)
    } catch {
      /* cầu nối tắt */
    }
  }

  async function loadSetup() {
    try {
      setSetup(await api<SetupState>('/api/invideo/setup', {}))
    } catch (e) {
      flash(errText(e))
    }
  }

  // Danh sách video có sẵn + mỗi lần có việc vừa xong thì tải lại
  useEffect(() => {
    void loadVideos()
  }, [doneJobs])

  useEffect(() => {
    if (setupJob?.status === 'xong') void loadSetup()
  }, [setupJob?.status])

  // Nhật ký: chỉ dòng tag «invideo» của cầu nối
  useEffect(() => {
    let dead = false
    async function tick() {
      try {
        const r = await api<{ logs: { id: number; time: string; level: string; tag: string; msg: string }[] }>(
          `/api/logs?since=${logSince.current}`,
        )
        if (dead || !r.logs.length) return
        logSince.current = r.logs[r.logs.length - 1].id
        const mine = r.logs.filter((x) => x.tag === 'invideo' || x.tag === 'voice')
        if (mine.length) setLogs((prev) => [...prev, ...mine].slice(-200))
      } catch {
        /* cầu nối tắt */
      }
    }
    void tick()
    const t = window.setInterval(tick, 2000)
    return () => {
      dead = true
      window.clearInterval(t)
    }
  }, [])

  useEffect(() => writeLS(LS_INPUT, input), [input])
  useEffect(() => writeLS(LS_MEDIA, media), [media])
  useEffect(() => writeLS(LS_TRANS, trans), [trans])
  useEffect(() => writeLS(LS_WAVE, wave), [wave])
  useEffect(() => writeLS(LS_RATIO, ratio), [ratio])
  useEffect(() => writeLS(LS_LANG, lang), [lang])
  useEffect(() => writeLS(LS_AUDIO_SRC, audioSrc), [audioSrc])
  useEffect(() => writeLS(LS_VOICE, voice), [voice])
  useEffect(() => writeLS(LS_BG, bg), [bg])

  function pushLog(level: string, msg: string) {
    setLogs((prev) => [
      ...prev.slice(-200),
      { id: Date.now(), time: new Date().toLocaleTimeString('vi-VN', { hour12: false }), level, msg },
    ])
  }

  function flash(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }

  function openCreate() {
    setView('create')
    if (!setupDone) setShowSetup(true)
    void loadSetup()
  }

  function closeSetup(markDone = false) {
    setShowSetup(false)
    if (markDone) {
      setSetupDone(true)
      writeLS(LS_SETUP, true)
    }
  }

  async function savePexels() {
    try {
      await api('/api/config/bridge', { set: { pexels_key: pexelsKey.trim() } })
      setPexelsKey('')
      flash('Đã lưu Pexels key')
      void loadSetup()
    } catch (e) {
      flash(errText(e))
    }
  }

  async function installWhisper() {
    try {
      await api('/api/invideo/setup', { install: 'whisper' })
      pushLog('INFO', 'Đang cài faster-whisper + tải model…')
    } catch (e) {
      flash(errText(e))
    }
  }

  async function chooseAudio() {
    try {
      const [p] = await pickFiles('audio', false)
      if (p) {
        setAudioFile(p)
        flash(`Đã chọn: ${baseName(p)}`)
      }
    } catch (e) {
      flash(errText(e))
    }
  }

  async function chooseVideo(set: (p: string) => void) {
    try {
      const [p] = await pickFiles('video', false)
      if (p) set(p)
    } catch (e) {
      flash(errText(e))
    }
  }

  async function handleCreateVideo() {
    if (creating) return
    if (input === 'audio' && !audioFile) return flash('Hãy chọn file âm thanh trước')
    if ((input === 'link' || input === 'dub') && !link.trim()) return flash('Hãy dán link / chọn file trước')
    if (input === 'idea' && !ideaText.trim()) return flash('Hãy nhập ý tưởng trước')
    if (input === 'script' && !scriptText.trim()) return flash('Hãy nhập kịch bản trước')
    if (media === 'gameplay' && input !== 'dub' && !bg) return flash('Hãy chọn video nền trước')
    setCreating(true)
    try {
      await api('/api/invideo/create', {
        input,
        text: input === 'idea' ? ideaText : scriptText,
        audio: audioFile,
        link: link.trim(),
        lang,
        audioSrc,
        voice,
        media,
        bg,
        trans,
        ratio,
        wave,
      })
      flash('Đã bắt đầu tạo video — theo dõi ở Video Manager')
      setView('manager')
    } catch (e) {
      flash(errText(e))
    } finally {
      setCreating(false)
    }
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

          {jobs
            .filter((j) => j.loai === 'invideo')
            .slice(0, 5)
            .map((j) => (
              <div key={j.id} className={`inv-job ${j.status}`}>
                <span>{j.status === 'dang_chay' ? '⏳' : j.status === 'xong' ? '✅' : '❌'}</span>
                <strong>{j.nguon}</strong>
                <span className="muted">{j.msg || 'Đang chạy…'}</span>
              </div>
            ))}

          {videos.length === 0 ? (
            <div className="inv-empty">
              <div className="inv-empty-ico" aria-hidden>
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                  <rect x="8" y="14" width="48" height="36" rx="6" stroke="#c4c9d4" strokeWidth="2.5" />
                  <path d="M8 22h48M8 42h48M20 14v36M44 14v36" stroke="#c4c9d4" strokeWidth="2" />
                  <circle cx="32" cy="32" r="7" stroke="#c4c9d4" strokeWidth="2" />
                </svg>
              </div>
              <div className="inv-empty-title">{running.length ? 'Đang tạo video…' : 'No videos yet'}</div>
              <div className="inv-empty-sub">Click &apos;Create&apos; to get started.</div>
              <button type="button" className="inv-btn-create ghost" onClick={openCreate}>
                + Create
              </button>
            </div>
          ) : (
            <div className="inv-video-grid">
              {videos.map((v) => (
                <article key={v.path} className="inv-video-card">
                  <div className="inv-video-thumb" onClick={() => setPlaying(v.path)} role="button" tabIndex={0}>
                    <video src={`${fileUrl(v.path)}#t=0.5`} preload="metadata" muted />
                    <span>▶</span>
                  </div>
                  <div className="inv-video-meta">
                    <div className="inv-video-title" title={v.name}>
                      {v.name.replace(/^\d{8}_\d{6}_/, '').replace(/\.mp4$/i, '')}
                    </div>
                    <div className="inv-video-when">
                      {new Date(v.t * 1000).toLocaleString('vi-VN')} · {(v.size / 1048576).toFixed(1)} MB
                    </div>
                    <div className="inv-video-acts">
                      <button type="button" className="inv-linkish" onClick={() => openFolder(v.path.replace(/[\\/][^\\/]*$/, ''))}>
                        📂 Thư mục
                      </button>
                      <button
                        type="button"
                        className="inv-linkish"
                        onClick={() => {
                          if (!window.confirm(`Xoá ${v.name}?`)) return
                          void api('/api/invideo/delete', { path: v.path }).then(loadVideos)
                        }}
                      >
                        🗑 Xoá
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {playing && (
            <div className="inv-modal-backdrop" onClick={() => setPlaying(null)}>
              <video className="inv-player" src={fileUrl(playing)} controls autoPlay onClick={(e) => e.stopPropagation()} />
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
                onClick={() => setLogs([])}
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
                  void loadSetup()
                }}
              >
                AI Models
              </button>
              <button
                type="button"
                className="inv-btn-primary"
                disabled={creating}
                onClick={() => void handleCreateVideo()}
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

                {(input === 'idea' || input === 'script') && (
                  <div className="inv-grid-2">
                    <div className="inv-field">
                      <label>Ngôn ngữ</label>
                      <select value={lang} onChange={(e) => setLang(e.target.value)}>
                        {LANGS.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="inv-field">
                      <label>Giọng đọc (Gemini TTS)</label>
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

                {input === 'audio' && (
                  <>
                    <div className="inv-field">
                      <label>Âm thanh đầu vào</label>
                      <div
                        className="inv-drop"
                        role="button"
                        tabIndex={0}
                        onClick={() => void chooseAudio()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') void chooseAudio()
                        }}
                      >
                        <div className="inv-drop-ico">☁️</div>
                        <div>
                          {audioFile ? (
                            <>
                              <strong>{baseName(audioFile)}</strong>
                              <div className="muted">Nhấn để đổi file</div>
                            </>
                          ) : (
                            <>
                              <strong>Nhấn để chọn file</strong>
                              <div className="muted">MP3, WAV, M4A… — phiên âm bằng Whisper / Gemini</div>
                            </>
                          )}
                        </div>
                      </div>
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
                      <div className="inv-link-row">
                        <div className="inv-link-input">
                          <span className="ico">🌐</span>
                          <input
                            type="text"
                            placeholder="Dán link hoặc đường dẫn file cần dịch & lồng tiếng…"
                            value={link}
                            onChange={(e) => setLink(e.target.value)}
                          />
                        </div>
                        <button type="button" className="inv-btn-ghost" onClick={() => void chooseVideo(setLink)}>
                          📁 File…
                        </button>
                      </div>
                    </div>
                    <div className="inv-grid-2">
                      <div className="inv-field">
                        <label>Dịch sang</label>
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
                    <div className="inv-link-row">
                      <button type="button" className="inv-btn-ghost" onClick={() => void chooseVideo(setBg)}>
                        📁 Chọn video nền…
                      </button>
                      <span className="muted" title={bg}>
                        {bg ? baseName(bg) : 'Chưa chọn — video được lặp cho đủ thời lượng, phụ đề ở giữa'}
                      </span>
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
                    {showMoreTrans ? 'Thu gọn' : `Xem thêm ${EXTRA_TRANS.length} hiệu ứng`} ▾
                  </button>
                  {showMoreTrans && (
                    <div className="inv-trans-grid wipe extra">
                      {EXTRA_TRANS.map((t) => (
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
                    Nền: <strong>{bg ? baseName(bg) : '—'}</strong>
                  </div>
                )}
                {(input === 'idea' || input === 'script' || input === 'dub' || (input === 'link' && audioSrc === 'tts')) && (
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
                <p>Công cụ & khoá cần cho InVideo</p>
              </div>
              <button type="button" className="inv-modal-x" onClick={() => closeSetup(false)}>
                ×
              </button>
            </header>
            <div className="inv-model-list">
              {(
                [
                  ['ffmpeg', 'FFmpeg', 'Dựng & ghép video', setup?.ffmpeg, 'winget install Gyan.FFmpeg'],
                  ['ytdlp', 'yt-dlp', 'Tải video từ link', setup?.ytdlp, 'winget install yt-dlp.yt-dlp'],
                  ['deno', 'Deno', 'yt-dlp cần để giải mã YouTube', setup?.deno, 'winget install DenoLand.Deno'],
                  ['whisper', 'faster-whisper', 'Phiên âm cục bộ (không có thì dùng Gemini)', setup?.whisper, ''],
                  ['gemini', 'Gemini key', `Viết kịch bản, TTS, dịch · ${setup?.gemini ?? 0} key`, !!setup?.gemini, 'Cài đặt › Tài khoản'],
                  ['pexels', 'Pexels API key', 'Ảnh / video stock (miễn phí)', setup?.pexels, ''],
                ] as const
              ).map(([id, name, desc, ok, hint]) => (
                <div key={id} className="inv-model-row">
                  <div className={`inv-model-ico ${ok ? 'blue' : 'orange'}`}>{ok ? '✓' : '!'}</div>
                  <div className="inv-model-info">
                    <strong>{name}</strong>
                    <span>{desc}</span>
                    {!ok && hint && <span className="muted">Cài: {hint}</span>}
                    {id === 'whisper' && !ok && (
                      <button
                        type="button"
                        className="inv-btn-ghost"
                        disabled={setupJob?.status === 'dang_chay'}
                        onClick={() => void installWhisper()}
                      >
                        {setupJob?.status === 'dang_chay' ? setupJob.msg || 'Đang cài…' : '⬇ Cài faster-whisper + model'}
                      </button>
                    )}
                    {id === 'whisper' && setupJob?.status === 'loi' && <span className="muted">❌ {setupJob.msg}</span>}
                    {id === 'pexels' && (
                      <div className="inv-link-row">
                        <input
                          className="inv-key"
                          type="password"
                          placeholder={ok ? 'Đã lưu — dán key mới để thay' : 'Dán Pexels API key…'}
                          value={pexelsKey}
                          onChange={(e) => setPexelsKey(e.target.value)}
                        />
                        <button type="button" className="inv-btn-ghost" disabled={!pexelsKey.trim()} onClick={() => void savePexels()}>
                          Lưu
                        </button>
                      </div>
                    )}
                  </div>
                  <div className={`inv-model-status ${ok ? 'done' : 'pending'}`}>{ok ? '✓' : '—'}</div>
                </div>
              ))}
            </div>
            <button type="button" className="inv-dl-all" onClick={() => void loadSetup()}>
              ↻ Kiểm tra lại
            </button>
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
