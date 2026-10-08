import { useEffect, useMemo, useRef, useState } from 'react'
import { api, dirName, errText, fileUrl, openFolder, useJobs } from './bridge'
import './voice.css'

type EngineId = 'gemini' | 'eleven' | 'capcut' | 'omni'
type SegStatus = 'cho' | 'dang_chay' | 'xong' | 'loi'

type Segment = {
  id: number
  text: string
  duration: string
  status: SegStatus
  selected: boolean
  path?: string
  err?: string
}

type ElevenVoice = {
  id: string
  name: string
  desc: string
  fav?: boolean
}

const LS_ENGINE = 'pb.voice.engine'
const LS_GEM_VOICE = 'pb.voice.gem.voice'
const LS_GEM_LANG = 'pb.voice.gem.lang'
const LS_GEM_LIMIT = 'pb.voice.gem.limit'
const LS_EL_VOICE = 'pb.voice.el.voice'
const LS_EL_MODEL = 'pb.voice.el.model'
const LS_EL_LANG = 'pb.voice.el.lang'
const LS_TEXT = 'pb.voice.text'
const LS_SEGS = 'pb.voice.segs'
const MIN_CHARS = 20

const ENGINES: { id: EngineId; label: string; icon: string }[] = [
  { id: 'gemini', label: 'Gemini', icon: '✨' },
  { id: 'eleven', label: 'ElevenLabs', icon: '〰️' },
  { id: 'capcut', label: 'CapCut', icon: '✂' },
  { id: 'omni', label: 'OmniVoice (Colab)', icon: '🔗' },
]

/** 30 giọng dựng sẵn của Gemini TTS (tên · giới tính · chất giọng theo tài liệu Google). */
const GEM_VOICE_INFO: { name: string; gender: 'Nam' | 'Nữ'; style: string }[] = [
  { name: 'Zephyr', gender: 'Nữ', style: 'Tươi sáng' },
  { name: 'Puck', gender: 'Nam', style: 'Sôi nổi' },
  { name: 'Charon', gender: 'Nam', style: 'Truyền đạt, rõ ràng' },
  { name: 'Kore', gender: 'Nữ', style: 'Chắc, dứt khoát' },
  { name: 'Fenrir', gender: 'Nam', style: 'Hào hứng' },
  { name: 'Leda', gender: 'Nữ', style: 'Trẻ trung' },
  { name: 'Orus', gender: 'Nam', style: 'Chắc, dứt khoát' },
  { name: 'Aoede', gender: 'Nữ', style: 'Nhẹ nhàng, thoáng' },
  { name: 'Callirrhoe', gender: 'Nữ', style: 'Thoải mái' },
  { name: 'Autonoe', gender: 'Nữ', style: 'Tươi sáng' },
  { name: 'Enceladus', gender: 'Nam', style: 'Hơi thở, trầm' },
  { name: 'Iapetus', gender: 'Nam', style: 'Trong, rõ' },
  { name: 'Umbriel', gender: 'Nam', style: 'Thoải mái' },
  { name: 'Algieba', gender: 'Nam', style: 'Mượt' },
  { name: 'Despina', gender: 'Nữ', style: 'Mượt' },
  { name: 'Erinome', gender: 'Nữ', style: 'Trong, rõ' },
  { name: 'Algenib', gender: 'Nam', style: 'Khàn, sỏi' },
  { name: 'Rasalgethi', gender: 'Nam', style: 'Truyền đạt, rõ ràng' },
  { name: 'Laomedeia', gender: 'Nữ', style: 'Sôi nổi' },
  { name: 'Achernar', gender: 'Nữ', style: 'Mềm' },
  { name: 'Alnilam', gender: 'Nam', style: 'Chắc, dứt khoát' },
  { name: 'Schedar', gender: 'Nam', style: 'Đều, ổn định' },
  { name: 'Gacrux', gender: 'Nữ', style: 'Trưởng thành' },
  { name: 'Pulcherrima', gender: 'Nữ', style: 'Thẳng thắn' },
  { name: 'Achird', gender: 'Nam', style: 'Thân thiện' },
  { name: 'Zubenelgenubi', gender: 'Nam', style: 'Đời thường' },
  { name: 'Vindemiatrix', gender: 'Nữ', style: 'Dịu dàng' },
  { name: 'Sadachbia', gender: 'Nam', style: 'Sinh động' },
  { name: 'Sadaltager', gender: 'Nam', style: 'Uyên bác' },
  { name: 'Sulafat', gender: 'Nữ', style: 'Ấm' },
]
const GEM_VOICES = GEM_VOICE_INFO.map((v) => v.name)
const gemInfo = (name: string) => GEM_VOICE_INFO.find((v) => v.name === name)

/** Nghe thử giọng: bridge tạo một câu mẫu (lưu đệm, lần sau phát lại ngay). */
function usePreview() {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const audio = useRef<HTMLAudioElement | null>(null)
  async function play(engine: string, voice: string, lang = '', model = '') {
    const key = `${engine}:${voice}`
    if (busy) return
    setBusy(key)
    setErr('')
    try {
      const r = await api<{ path: string }>('/api/voice/preview', { engine, voice, lang, model })
      audio.current?.pause()
      audio.current = new Audio(fileUrl(r.path))
      await audio.current.play()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy('')
    }
  }
  return { busy, err, play }
}

const GEM_LANGS: { code: string; flag: string; label: string; locale: string }[] = [
  { code: 'VN', flag: '🇻🇳', label: 'Tiếng Việt', locale: 'vi-VN' },
  { code: 'US', flag: '🇺🇸', label: 'English (US)', locale: 'en-US' },
  { code: 'GB', flag: '🇬🇧', label: 'English (UK)', locale: 'en-GB' },
  { code: 'US', flag: '🇺🇸', label: 'Tiếng Tây Ban Nha (US)', locale: 'es-US' },
  { code: 'FR', flag: '🇫🇷', label: 'Tiếng Pháp (Pháp)', locale: 'fr-FR' },
  { code: 'CA', flag: '🇨🇦', label: 'Tiếng Pháp (Canada)', locale: 'fr-CA' },
  { code: 'DE', flag: '🇩🇪', label: 'Tiếng Đức', locale: 'de-DE' },
  { code: 'JP', flag: '🇯🇵', label: 'Tiếng Nhật', locale: 'ja-JP' },
  { code: 'KR', flag: '🇰🇷', label: 'Tiếng Hàn', locale: 'ko-KR' },
  { code: 'CN', flag: '🇨🇳', label: 'Tiếng Trung', locale: 'cmn-CN' },
]

/** Giọng dựng sẵn của ElevenLabs — mọi tài khoản/key đều dùng được qua API. */
const EL_VOICES: ElevenVoice[] = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', desc: 'Nam · Anh · ấm, kể chuyện', fav: true },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', desc: 'Nữ · Mỹ · nhẹ nhàng, chuyên nghiệp' },
  { id: '9BWtsMINqrJLrRacOk9x', name: 'Aria', desc: 'Nữ · Mỹ · biểu cảm' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', desc: 'Nam · Mỹ · tự tin' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', desc: 'Nữ · Mỹ · tươi tắn' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', desc: 'Nam · Úc · tự nhiên' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', desc: 'Nam · Mỹ · khàn' },
  { id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', desc: 'Trung tính · Mỹ · điềm tĩnh' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', desc: 'Nam · Mỹ · trẻ, rõ' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', desc: 'Nữ · Thuỵ Điển · quyến rũ' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', desc: 'Nữ · Anh · tự tin, tin tức' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', desc: 'Nữ · Mỹ · thân thiện' },
  { id: 'bIHbv24MWmeRgasZH58o', name: 'Will', desc: 'Nam · Mỹ · thân thiện' },
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', desc: 'Nữ · Mỹ · biểu cảm' },
  { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', desc: 'Nam · Mỹ · thân thiện' },
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', desc: 'Nam · Mỹ · đời thường' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', desc: 'Nam · Mỹ · trầm, thuyết minh' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', desc: 'Nam · Anh · tin tức' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', desc: 'Nữ · Anh · ấm' },
  { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', desc: 'Nam · Mỹ · lớn tuổi, tin cậy' },
]

const EL_MODELS = [
  {
    id: 'v4',
    label: 'Eleven v4',
    desc: 'Biểu cảm nhất, 90+ ngôn ngữ',
  },
  {
    id: 'v3',
    label: 'Eleven v3',
    desc: 'Biểu cảm mạnh, 70+ ngôn ngữ',
  },
  {
    id: 'flash',
    label: 'Eleven Flash v2.5',
    desc: 'Nhanh, hỗ trợ đa ngôn ngữ',
  },
]

const EL_LANG_CODE: Record<string, string> = {
  Vietnamese: 'vi',
  English: 'en',
  Afrikaans: 'af',
  Arabic: 'ar',
  Armenian: 'hy',
  Assamese: 'as',
  Azerbaijani: 'az',
  Belarusian: 'be',
  Bengali: 'bn',
  Bosnian: 'bs',
  Bulgarian: 'bg',
}

const EL_LANGS = [
  'Vietnamese',
  'English',
  'Afrikaans',
  'Arabic',
  'Armenian',
  'Assamese',
  'Azerbaijani',
  'Belarusian',
  'Bengali',
  'Bosnian',
  'Bulgarian',
]

function loadStr(key: string, fallback: string) {
  try {
    const v = localStorage.getItem(key)
    if (v != null && v !== '') return v
  } catch {
    /* ignore */
  }
  return fallback
}

function loadNum(key: string, fallback: number) {
  try {
    const v = localStorage.getItem(key)
    if (v != null && v !== '') {
      const n = Number(v)
      if (!Number.isNaN(n)) return n
    }
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

function splitSegments(text: string, limit: number): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim()
  if (!cleaned) return []
  const paras = cleaned.split(/\n+/).map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  for (const p of paras) {
    if (p.length <= limit) {
      out.push(p)
      continue
    }
    let rest = p
    while (rest.length > limit) {
      let cut = rest.lastIndexOf(' ', limit)
      if (cut < limit * 0.4) cut = limit
      out.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    if (rest) out.push(rest)
  }
  return out
}

function statusLabel(s: SegStatus) {
  if (s === 'cho') return 'Chờ'
  if (s === 'dang_chay') return 'Đang chạy'
  if (s === 'xong') return 'Xong'
  return 'Lỗi'
}

function EngineTabs({
  engine,
  onChange,
}: {
  engine: EngineId
  onChange: (e: EngineId) => void
}) {
  return (
    <div className="vo-engines">
      {ENGINES.map((e) => (
        <button
          key={e.id}
          type="button"
          className={`vo-engine ${engine === e.id ? 'on' : ''}`}
          onClick={() => onChange(e.id)}
        >
          <span className="vo-engine-ico">{e.icon}</span>
          {e.label}
        </button>
      ))}
    </div>
  )
}

function SegmentsPanel({
  segs,
  setSegs,
  onRun,
  running,
  emptyHint,
  showProxyCta,
  onOpenProxy,
  disabledReason,
}: {
  segs: Segment[]
  setSegs: (s: Segment[]) => void
  onRun: () => void
  running: boolean
  emptyHint: string
  showProxyCta?: boolean
  onOpenProxy?: () => void
  disabledReason?: string
}) {
  const selected = segs.filter((s) => s.selected).length
  const done = segs.filter((s) => s.status === 'xong').length
  const [gap, setGap] = useState(500)
  const [joinMsg, setJoinMsg] = useState('')
  const joinJobs = useJobs(['voice-noi'])
  const lastJoin = joinJobs[0]
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function play(path?: string) {
    if (!path) return
    audioRef.current?.pause()
    audioRef.current = new Audio(fileUrl(path))
    void audioRef.current.play()
  }

  async function joinAll() {
    setJoinMsg('')
    try {
      await api('/api/voice/join', {
        paths: segs.filter((s) => s.status === 'xong' && s.path).map((s) => s.path),
        gap_ms: gap,
      })
    } catch (e) {
      setJoinMsg(errText(e))
    }
  }

  const firstDone = segs.find((s) => (s.selected || selected === 0) && s.path)
  const allChecked = segs.length > 0 && segs.every((s) => s.selected)

  return (
    <section className="vo-segs">
      <div className="vo-segs-head">
        <div className="vo-segs-title">
          <span className="vo-segs-ico">🎧</span>
          Phân đoạn ({segs.length})
        </div>
        <div className="vo-segs-actions">
          <button
            type="button"
            className="vo-btn primary"
            disabled={segs.length === 0 || running || !!disabledReason}
            title={disabledReason}
            onClick={onRun}
          >
            {running ? '… Đang đọc' : '▶ Chạy TTS'}
          </button>
          <button
            type="button"
            className="vo-btn"
            disabled={done === 0 || running}
            onClick={() =>
              setSegs(
                segs.map((s) =>
                  s.status === 'xong' || s.status === 'loi'
                    ? { ...s, status: 'cho' as SegStatus, duration: '—' }
                    : s,
                ),
              )
            }
          >
            ↻ Chạy lại
          </button>
          <button
            type="button"
            className="vo-btn"
            disabled={!firstDone}
            title="Mở thư mục chứa file đã đọc"
            onClick={() => firstDone?.path && openFolder(dirName(firstDone.path))}
          >
            📂 Mở thư mục
          </button>
          <button type="button" className="vo-btn" disabled={done === 0 || running} onClick={() => void joinAll()}>
            ⛓ Nối File ({done}) {gap}ms
          </button>
          <select
            className="vo-icon-btn"
            title="Khoảng lặng giữa các đoạn khi nối"
            value={gap}
            onChange={(e) => setGap(Number(e.target.value))}
          >
            {[0, 200, 300, 500, 800, 1000].map((g) => (
              <option key={g} value={g}>
                {g}ms
              </option>
            ))}
          </select>
        </div>
      </div>
      {(disabledReason || joinMsg || lastJoin) && (
        <div className="vo-join-bar">
          {disabledReason && <span className="vo-join-err">{disabledReason}</span>}
          {joinMsg && <span className="vo-join-err">{joinMsg}</span>}
          {lastJoin && (
            <>
              <span>
                {lastJoin.status === 'dang_chay' ? '⏳ Đang nối…' : lastJoin.status === 'xong' ? '✅ Đã nối' : '❌ ' + lastJoin.msg}
              </span>
              {lastJoin.status === 'xong' && lastJoin.out_path && (
                <>
                  <audio controls src={fileUrl(lastJoin.out_path)} />
                  <button type="button" className="vo-btn" onClick={() => openFolder(dirName(lastJoin.out_path))}>
                    📂
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {segs.length === 0 ? (
        <div className="vo-empty">
          <div className="vo-empty-ico">📄</div>
          <div className="vo-empty-title">Chưa có phân đoạn nào được tạo.</div>
          <div className="vo-empty-desc">{emptyHint}</div>
          {showProxyCta && (
            <button type="button" className="vo-btn warn-outline" onClick={onOpenProxy}>
              ⚙ Cấu hình Proxy ngay để bắt đầu tạo
            </button>
          )}
        </div>
      ) : (
        <div className="vo-table-wrap">
          <table className="vo-table">
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) =>
                      setSegs(segs.map((s) => ({ ...s, selected: e.target.checked })))
                    }
                  />
                </th>
                <th className="col-num">#</th>
                <th>Nội dung văn bản</th>
                <th className="col-dur">Thời lượng</th>
                <th className="col-st">Trạng thái</th>
                <th className="col-act">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {segs.map((s, i) => (
                <tr key={s.id} className={s.selected ? 'sel' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={s.selected}
                      onChange={(e) =>
                        setSegs(
                          segs.map((x) =>
                            x.id === s.id ? { ...x, selected: e.target.checked } : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>{i + 1}</td>
                  <td className="vo-seg-text">{s.text}</td>
                  <td>{s.duration}</td>
                  <td>
                    <span className={`vo-st ${s.status}`} title={s.err}>
                      {statusLabel(s.status)}
                    </span>
                  </td>
                  <td>
                    <div className="vo-row-acts">
                      <button
                        type="button"
                        className="vo-mini"
                        title="Nghe"
                        disabled={s.status !== 'xong'}
                        onClick={() => play(s.path)}
                      >
                        ▶
                      </button>
                      <button
                        type="button"
                        className="vo-mini"
                        title="Xóa"
                        onClick={() => setSegs(segs.filter((x) => x.id !== s.id))}
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function GeminiPanel({
  text,
  setText,
  segs,
  setSegs,
  onRun,
  running,
}: {
  text: string
  setText: (t: string) => void
  segs: Segment[]
  setSegs: (s: Segment[]) => void
  onRun: () => void
  running: boolean
}) {
  const [voice, setVoice] = useState(() => loadStr(LS_GEM_VOICE, 'Zubenelgenubi'))
  const [langIdx, setLangIdx] = useState(() => {
    const saved = loadStr(LS_GEM_LANG, 'vi-VN')
    const i = GEM_LANGS.findIndex((l) => l.locale === saved)
    return i >= 0 ? i : 0
  })
  const [limit, setLimit] = useState(() => loadNum(LS_GEM_LIMIT, 2000))
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [voiceQ, setVoiceQ] = useState('')
  const pv = usePreview()
  const [langQ, setLangQ] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const lang = GEM_LANGS[langIdx]
  const chars = text.length
  const need = Math.max(0, MIN_CHARS - chars)

  useEffect(() => {
    try {
      localStorage.setItem(LS_GEM_VOICE, voice)
      localStorage.setItem(LS_GEM_LANG, lang.locale)
      localStorage.setItem(LS_GEM_LIMIT, String(limit))
    } catch {
      /* ignore */
    }
  }, [voice, lang.locale, limit])

  const filteredVoices = useMemo(() => {
    const q = voiceQ.trim().toLowerCase()
    if (!q) return GEM_VOICES
    return GEM_VOICE_INFO.filter((v) => `${v.name} ${v.gender} ${v.style}`.toLowerCase().includes(q)).map((v) => v.name)
  }, [voiceQ])

  const filteredLangs = useMemo(() => {
    const q = langQ.trim().toLowerCase()
    if (!q) return GEM_LANGS
    return GEM_LANGS.filter(
      (l) =>
        l.label.toLowerCase().includes(q) ||
        l.locale.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q),
    )
  }, [langQ])

  function addToQueue() {
    if (chars < MIN_CHARS) return
    const parts = splitSegments(text, limit)
    const next: Segment[] = parts.map((p, i) => ({
      id: Date.now() + i,
      text: p,
      duration: '—',
      status: 'cho' as SegStatus,
      selected: false,
    }))
    setSegs([...segs, ...next])
  }

  function onFile(file: File | null) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result || '')
      setText(raw)
    }
    reader.readAsText(file)
  }

  return (
    <div className="vo-body">
      <aside className="vo-side">
        <div className="vo-input-card">
          <div className="vo-input-top">
            <button type="button" className="vo-link" onClick={() => fileRef.current?.click()}>
              📁 Mở file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.srt,.vtt,.ass"
              hidden
              onChange={(e) => onFile(e.target.files?.[0] || null)}
            />
          </div>
          <textarea
            className="vo-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Dán nội dung hoặc kéo thả file TXT/SRT/VTT/ASS vào đây (tối thiểu 20 ký tự)..."
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f) onFile(f)
            }}
          />
          <div className={`vo-char ${chars >= MIN_CHARS ? 'ok' : ''}`}>
            {chars >= MIN_CHARS
              ? `${chars} ký tự`
              : `Cần tối thiểu ${MIN_CHARS} ký tự (Hiện tại: ${chars})`}
          </div>
          <button
            type="button"
            className="vo-btn block"
            disabled={chars < MIN_CHARS}
            onClick={addToQueue}
          >
            {chars < MIN_CHARS
              ? `Cần tối thiểu ${MIN_CHARS} ký tự (Hiện tại: ${chars})`
              : 'Thêm vào hàng đợi TTS'}
          </button>
        </div>

        <div className="vo-cfg">
          <div className="vo-cfg-title">CẤU HÌNH</div>
          <div className="vo-cfg-row">
            <div className="vo-field">
              <label>Giọng đọc</label>
              <div className="vo-dd-wrap">
                <button
                  type="button"
                  className={`vo-dd ${voiceOpen ? 'open' : ''}`}
                  onClick={() => {
                    setVoiceOpen(!voiceOpen)
                    setLangOpen(false)
                  }}
                >
                  <span>
                    🔊 {voice}
                    {gemInfo(voice) && <span className="vo-dd-sub"> · {gemInfo(voice)?.gender} · {gemInfo(voice)?.style}</span>}
                  </span>
                  <span>▾</span>
                </button>
                {voiceOpen && (
                  <div className="vo-dd-menu">
                    <input
                      className="vo-dd-search"
                      placeholder="Tìm giọng..."
                      value={voiceQ}
                      onChange={(e) => setVoiceQ(e.target.value)}
                      autoFocus
                    />
                    <div className="vo-dd-list">
                      {filteredVoices.map((v) => (
                        <button
                          key={v}
                          type="button"
                          className={`vo-dd-item ${v === voice ? 'on' : ''}`}
                          onClick={() => {
                            setVoice(v)
                            setVoiceOpen(false)
                            setVoiceQ('')
                          }}
                        >
                          <span>
                            {v}
                            <span className="vo-dd-sub">
                              {' '}
                              · {gemInfo(v)?.gender} · {gemInfo(v)?.style}
                            </span>
                          </span>
                          <span
                            className="vo-play-mini"
                            title="Nghe thử"
                            onClick={(e) => {
                              e.stopPropagation()
                              void pv.play('gemini', v, lang.locale)
                            }}
                          >
                            {pv.busy === `gemini:${v}` ? '⏳' : '▶'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="vo-field">
              <label>Ngôn ngữ</label>
              <div className="vo-dd-wrap">
                <button
                  type="button"
                  className={`vo-dd ${langOpen ? 'open' : ''}`}
                  onClick={() => {
                    setLangOpen(!langOpen)
                    setVoiceOpen(false)
                  }}
                >
                  <span>
                    {lang.flag} {lang.code} {lang.label}
                  </span>
                  <span>▾</span>
                </button>
                {langOpen && (
                  <div className="vo-dd-menu">
                    <input
                      className="vo-dd-search"
                      placeholder="Tìm ngôn ngữ..."
                      value={langQ}
                      onChange={(e) => setLangQ(e.target.value)}
                      autoFocus
                    />
                    <div className="vo-dd-list">
                      {filteredLangs.map((l) => (
                        <button
                          key={l.locale + l.label}
                          type="button"
                          className={`vo-dd-item ${l.locale === lang.locale ? 'on' : ''}`}
                          onClick={() => {
                            const idx = GEM_LANGS.findIndex((x) => x.locale === l.locale)
                            setLangIdx(idx >= 0 ? idx : 0)
                            setLangOpen(false)
                            setLangQ('')
                          }}
                        >
                          <span>
                            <b>{l.code}</b> {l.label}
                          </span>
                          <span className="vo-muted">{l.locale}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="vo-field">
            <div className="vo-slider-lab">
              <span>Giới hạn text / đoạn</span>
              <span className="vo-slider-val">{limit}</span>
            </div>
            <input
              type="range"
              min={200}
              max={2000}
              step={50}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="vo-slider"
            />
          </div>
          <div className="vo-voice-id">{lang.locale}-Chirp3-HD-{voice}</div>
          {pv.err && <div className="vo-join-err">Nghe thử lỗi: {pv.err}</div>}
          {need > 0 && chars > 0 && (
            <div className="vo-hint-soft">Cần thêm {need} ký tự để chạy TTS</div>
          )}
        </div>
      </aside>

      <SegmentsPanel
        segs={segs}
        setSegs={setSegs}
        onRun={onRun}
        running={running}
        emptyHint="Nhập text để bắt đầu."
      />
    </div>
  )
}

function ElevenPanel({
  text,
  setText,
  segs,
  setSegs,
  onRun,
  running,
  onOpenSettings,
}: {
  text: string
  setText: (t: string) => void
  segs: Segment[]
  setSegs: (s: Segment[]) => void
  onRun: () => void
  running: boolean
  onOpenSettings?: () => void
}) {
  const [voiceId, setVoiceId] = useState(() => {
    const v = loadStr(LS_EL_VOICE, EL_VOICES[0].id)
    return /^[a-z]{2,8}$/.test(v) ? EL_VOICES[0].id : v // id giả của bản cũ ('tung'…) → giọng thật
  })
  const [model, setModel] = useState(() => loadStr(LS_EL_MODEL, 'v3'))
  const [lang, setLang] = useState(() => loadStr(LS_EL_LANG, 'Vietnamese'))
  const [q, setQ] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [favs, setFavs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(EL_VOICES.map((v) => [v.id, !!v.fav])),
  )
  const [accVoices, setAccVoices] = useState<ElevenVoice[]>([])
  const allVoices = useMemo(() => {
    const seen = new Set(accVoices.map((v) => v.id))
    return [...accVoices, ...EL_VOICES.filter((v) => !seen.has(v.id))]
  }, [accVoices])
  const pv = usePreview()
  const [voiceErr, setVoiceErr] = useState('')

  useEffect(() => {
    api<{ voices: ElevenVoice[] }>('/api/voice/eleven-voices', {})
      .then((r) => setAccVoices(r.voices))
      .catch((e) => setVoiceErr(errText(e)))
  }, [])
  const fileRef = useRef<HTMLInputElement>(null)

  const chars = text.length
  const voice = allVoices.find((v) => v.id === voiceId) || { id: voiceId, name: voiceId, desc: '' }
  const modelMeta = EL_MODELS.find((m) => m.id === model) || EL_MODELS[1]

  useEffect(() => {
    try {
      localStorage.setItem(LS_EL_VOICE, voiceId)
      localStorage.setItem(LS_EL_MODEL, model)
      localStorage.setItem(LS_EL_LANG, lang)
    } catch {
      /* ignore */
    }
  }, [voiceId, model, lang])

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    const pasted = /^[A-Za-z0-9]{18,}$/.test(q.trim()) && !allVoices.some((v) => v.id === q.trim())
    const extra = pasted ? [{ id: q.trim(), name: 'Voice ID: ' + q.trim(), desc: 'Dùng ID vừa dán' }] : []
    if (!qq) return allVoices
    return [...extra, ...allVoices].filter(
      (v) =>
        v.id === q.trim() ||
        v.name.toLowerCase().includes(qq) ||
        v.desc.toLowerCase().includes(qq) ||
        v.id.toLowerCase().includes(qq),
    )
  }, [q, allVoices])

  function addToQueue() {
    if (chars < MIN_CHARS) return
    const parts = splitSegments(text, 1200)
    const next: Segment[] = parts.map((p, i) => ({
      id: Date.now() + i,
      text: p,
      duration: '—',
      status: 'cho' as SegStatus,
      selected: false,
    }))
    setSegs([...segs, ...next])
  }

  function onFile(file: File | null) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result || ''))
    reader.readAsText(file)
  }

  return (
    <div className="vo-body">
      <aside className="vo-side el">
        <div className="vo-warn-banner">
          Gọi API ElevenLabs bằng key ở cấu hình TTS của tool cũ (eleven_keys). Danh sách giọng lấy
          từ thư viện tài khoản của bạn — hoặc dán Voice ID vào ô tìm.
        </div>

        <div className="vo-voice-pick">
          <div className="vo-section-head">
            <span>CHỌN GIỌNG NÓI (VOICE)</span>
            <button type="button" className="vo-link sm">
              📚 Thư viện
            </button>
          </div>
          <input
            className="vo-search"
            placeholder="Tìm voice hoặc dán Voice ID..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {voiceErr && (
            <div className="vo-join-err">
              Chưa tải được giọng trong tài khoản ({voiceErr}) — vẫn dùng được {EL_VOICES.length} giọng có sẵn bên dưới.
            </div>
          )}
          {pv.err && <div className="vo-join-err">Nghe thử lỗi: {pv.err}</div>}
          <div className="vo-voice-list">
            {filtered.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`vo-voice-card ${v.id === voiceId ? 'on' : ''}`}
                onClick={() => setVoiceId(v.id)}
              >
                <div className="vo-voice-main">
                  <div className="vo-voice-name">{v.name}</div>
                  <div className="vo-voice-desc">{v.desc}</div>
                </div>
                <div className="vo-voice-acts" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="vo-mini"
                    title="Nghe thử"
                    disabled={!!pv.busy}
                    onClick={() => void pv.play('eleven', v.id, lang, model)}
                  >
                    {pv.busy === `eleven:${v.id}` ? '⏳' : '▶'}
                  </button>
                  <button
                    type="button"
                    className={`vo-mini ${favs[v.id] ? 'fav' : ''}`}
                    title="Yêu thích"
                    onClick={() => setFavs({ ...favs, [v.id]: !favs[v.id] })}
                  >
                    {favs[v.id] ? '★' : '☆'}
                  </button>
                </div>
              </button>
            ))}
          </div>
          <div className="vo-voice-meta">
            <span>
              {filtered.length} / {allVoices.length}
            </span>
            <button type="button" className="vo-link sm">
              Tìm nâng cao
            </button>
          </div>
        </div>

        <div className="vo-cfg el-cfg">
          <div className="vo-cfg-row">
            <div className="vo-field">
              <label>MẪU MODEL</label>
              <div className="vo-dd-wrap">
                <button
                  type="button"
                  className={`vo-dd ${modelOpen ? 'open' : ''}`}
                  onClick={() => {
                    setModelOpen(!modelOpen)
                    setLangOpen(false)
                  }}
                >
                  <span>{modelMeta.label}</span>
                  <span>▾</span>
                </button>
                {modelOpen && (
                  <div className="vo-dd-menu wide">
                    {EL_MODELS.map((m) => (
                      <div key={m.id} className={`vo-model-row ${m.id === model ? 'on' : ''}`}>
                        <div>
                          <div className="vo-model-name">{m.label}</div>
                          <div className="vo-muted">{m.desc}</div>
                        </div>
                        {m.id === model ? (
                          <span className="vo-using">Đang dùng</span>
                        ) : (
                          <button
                            type="button"
                            className="vo-btn sm"
                            onClick={() => {
                              setModel(m.id)
                              setModelOpen(false)
                            }}
                          >
                            Sử dụng
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="vo-field">
              <label>NGÔN NGỮ</label>
              <div className="vo-dd-wrap">
                <button
                  type="button"
                  className={`vo-dd ${langOpen ? 'open' : ''}`}
                  onClick={() => {
                    setLangOpen(!langOpen)
                    setModelOpen(false)
                  }}
                >
                  <span>{lang}</span>
                  <span>▾</span>
                </button>
                {langOpen && (
                  <div className="vo-dd-menu">
                    <div className="vo-dd-list">
                      {EL_LANGS.map((l) => (
                        <button
                          key={l}
                          type="button"
                          className={`vo-dd-item ${l === lang ? 'on' : ''}`}
                          onClick={() => {
                            setLang(l)
                            setLangOpen(false)
                          }}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="vo-input-card">
          <div className="vo-input-top">
            <button type="button" className="vo-link" onClick={() => fileRef.current?.click()}>
              📁 Mở file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.srt,.vtt,.ass"
              hidden
              onChange={(e) => onFile(e.target.files?.[0] || null)}
            />
          </div>
          <textarea
            className="vo-textarea short"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Nhập nội dung hoặc kéo thả đây (tối thiểu 20 ký tự)..."
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f) onFile(f)
            }}
          />
          <div className={`vo-char ${chars >= MIN_CHARS ? 'ok' : 'bad'}`}>
            {chars >= MIN_CHARS
              ? `${chars} ký tự · Voice: ${voice.name}`
              : `Cần thêm ${Math.max(0, MIN_CHARS - chars)} kí tự`}
          </div>
          <button
            type="button"
            className="vo-btn block"
            disabled={chars < MIN_CHARS}
            onClick={addToQueue}
          >
            {chars < MIN_CHARS
              ? `Cần tối thiểu ${MIN_CHARS} ký tự (Hiện tại: ${chars})`
              : 'Thêm vào hàng đợi TTS'}
          </button>
        </div>

        <div className="vo-proxy-box">
          <div className="vo-proxy-mode">
            Chế độ Proxy hiện tại: <b>KẾT NỐI TRỰC TIẾP</b>
          </div>
          <div className="vo-proxy-warn">
            ⚠ Cảnh báo: ElevenLabs có thể chặn IP trực tiếp nhanh chóng. Nên sử dụng Proxy Xoay
            trong tab Settings.
          </div>
        </div>
      </aside>

      <SegmentsPanel
        segs={segs}
        setSegs={setSegs}
        onRun={onRun}
        running={running}
        emptyHint="Nhập văn bản trong panel bên trái rồi nhấn 'Thêm vào hàng đợi TTS' để bắt đầu."
        onOpenProxy={onOpenSettings}
      />
    </div>
  )
}

function SimpleEnginePanel({
  title,
  note,
  text,
  setText,
  segs,
  setSegs,
  onRun,
  running,
}: {
  title: string
  note: string
  text: string
  setText: (t: string) => void
  segs: Segment[]
  setSegs: (s: Segment[]) => void
  onRun: () => void
  running: boolean
}) {
  const chars = text.length
  return (
    <div className="vo-body">
      <aside className="vo-side">
        <div className="vo-simple-note">{note}</div>
        <div className="vo-input-card">
          <textarea
            className="vo-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Dán nội dung (tối thiểu 20 ký tự)..."
          />
          <div className={`vo-char ${chars >= MIN_CHARS ? 'ok' : ''}`}>
            {chars >= MIN_CHARS
              ? `${chars} ký tự`
              : `Cần tối thiểu ${MIN_CHARS} ký tự (Hiện tại: ${chars})`}
          </div>
          <button
            type="button"
            className="vo-btn block"
            disabled={chars < MIN_CHARS}
            onClick={() => {
              const parts = splitSegments(text, 1000)
              setSegs([
                ...segs,
                ...parts.map((p, i) => ({
                  id: Date.now() + i,
                  text: p,
                  duration: '—',
                  status: 'cho' as SegStatus,
                  selected: false,
                })),
              ])
            }}
          >
            Thêm vào hàng đợi · {title}
          </button>
        </div>
      </aside>
      <SegmentsPanel
        segs={segs}
        setSegs={setSegs}
        onRun={onRun}
        running={running}
        emptyHint={`${title} — nhập text rồi thêm vào hàng đợi.`}
        disabledReason={`${title} chưa hỗ trợ: không có API công khai để gọi. Dùng Gemini hoặc ElevenLabs.`}
      />
    </div>
  )
}

export default function VoiceWorkspace({
  onOpenSettings,
}: {
  onOpenSettings?: () => void
}) {
  const [engine, setEngine] = useState<EngineId>(
    () => loadStr(LS_ENGINE, 'gemini') as EngineId,
  )
  const [text, setText] = useState(() => loadStr(LS_TEXT, ''))
  const [segs, setSegs] = useState<Segment[]>(() => loadJson(LS_SEGS, []))
  const [running, setRunning] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(LS_ENGINE, engine)
      localStorage.setItem(LS_TEXT, text)
    } catch {
      /* ignore */
    }
  }, [engine, text])

  useEffect(() => {
    saveJson(LS_SEGS, segs)
  }, [segs])

  const jobs = useJobs(['voice'])
  const [jobId, setJobId] = useState('')
  const [runErr, setRunErr] = useState('')
  const job = jobs.find((j) => j.id === jobId)

  // Tiến độ từng đoạn từ việc nền → bảng phân đoạn
  useEffect(() => {
    if (!job) return
    const items = (job as unknown as { items?: { id: number; status: SegStatus; path: string; dur: number; msg: string }[] }).items
    if (items) {
      setSegs((prev) =>
        prev.map((s) => {
          const it = items.find((x) => x.id === s.id)
          if (!it) return s
          return {
            ...s,
            status: it.status,
            path: it.path || s.path,
            err: it.msg || undefined,
            duration: it.dur ? `${it.dur.toFixed(1)}s` : s.duration,
          }
        }),
      )
    }
    if (job.status !== 'dang_chay') {
      setRunning(false)
      if (job.status === 'loi') setRunErr(job.msg)
    }
  }, [job])

  async function runTts() {
    if (segs.length === 0 || running) return
    // Đoạn đã xong thì thôi — trừ khi người dùng bấm «Chạy lại»
    const todo = segs.filter((s) => s.status !== 'xong')
    if (todo.length === 0) return
    setRunErr('')
    setRunning(true)
    setSegs(segs.map((s) => (s.status !== 'xong' ? { ...s, status: 'cho', duration: '—', err: undefined } : s)))
    const body =
      engine === 'gemini'
        ? { engine, voice: loadStr(LS_GEM_VOICE, 'Kore') }
        : {
            engine,
            voice: loadStr(LS_EL_VOICE, ''),
            model: loadStr(LS_EL_MODEL, 'v3'),
            lang: EL_LANG_CODE[loadStr(LS_EL_LANG, 'Vietnamese')] || '',
          }
    try {
      const r = await api<{ id: string }>('/api/voice/tts', {
        ...body,
        items: todo.map((s) => ({ id: s.id, text: s.text })),
      })
      setJobId(r.id)
    } catch (e) {
      setRunErr(errText(e))
      setRunning(false)
    }
  }

  const title =
    engine === 'gemini'
      ? 'TTS Gemini'
      : engine === 'eleven'
        ? 'TTS ElevenLabs'
        : engine === 'capcut'
          ? 'TTS CapCut'
          : 'TTS OmniVoice'

  return (
    <div className="vo-root">
      <header className="vo-top">
        <div className="vo-top-left">
          <h1>{title}</h1>
          <span className="vo-crumb">Voice · Gemini TTS · ElevenLabs</span>
        </div>
        <EngineTabs engine={engine} onChange={setEngine} />
      </header>
      {runErr && <div className="vo-join-bar"><span className="vo-join-err">{runErr}</span></div>}

      {engine === 'gemini' && (
        <GeminiPanel
          text={text}
          setText={setText}
          segs={segs}
          setSegs={setSegs}
          onRun={runTts}
          running={running}
        />
      )}
      {engine === 'eleven' && (
        <ElevenPanel
          text={text}
          setText={setText}
          segs={segs}
          setSegs={setSegs}
          onRun={runTts}
          running={running}
          onOpenSettings={onOpenSettings}
        />
      )}
      {engine === 'capcut' && (
        <SimpleEnginePanel
          title="CapCut"
          note="CapCut TTS chưa hỗ trợ: CapCut không có API công khai cho giọng đọc."
          text={text}
          setText={setText}
          segs={segs}
          setSegs={setSegs}
          onRun={runTts}
          running={running}
        />
      )}
      {engine === 'omni' && (
        <SimpleEnginePanel
          title="OmniVoice"
          note="OmniVoice (Colab) chưa hỗ trợ: cần URL máy chủ Colab của bạn và giao thức của notebook đó."
          text={text}
          setText={setText}
          segs={segs}
          setSegs={setSegs}
          onRun={runTts}
          running={running}
        />
      )}
    </div>
  )
}
