import DrawEngineModal, { DEFAULT_DRAW_CONFIG, type DrawEngineConfig } from './DrawEngineModal'
import { useEffect, useState } from 'react'
import './mini.css'

type AppId =
  | 'hub'
  | 'stock'
  | 'cut-img'
  | 'cut-vid'
  | 'upscale'
  | 'fashion'
  | 'rewrite'
  | 'wm-vid'
  | 'wm-gem'
  | 'yt-dl'
  | 'av-srt'
  | 'translate'
  | 'script-prompt'
  | 'va-prompt'
  | 'batch-edit'
  | 'whiteboard'

type MiniCard = {
  id: AppId
  title: string
  desc: string
  icon: string
  accent: 'teal' | 'blue' | 'gold' | 'pink' | 'violet'
  openable?: boolean
}

const CARDS: MiniCard[] = [
  {
    id: 'stock',
    title: 'Tìm Stock Theo Kịch Bản',
    desc: 'Nhập kịch bản hoặc file SRT, AI phân tích ngữ cảnh và tìm video/ảnh stock khớp chính xác thời lượng từng câu.',
    icon: '🔍',
    accent: 'teal',
  },
  {
    id: 'cut-img',
    title: 'Cắt Ảnh Từ Video',
    desc: 'Tự động cắt ảnh từ video theo khoảng thời gian.',
    icon: '✂️',
    accent: 'blue',
  },
  {
    id: 'cut-vid',
    title: 'Cắt Video Theo Thời Gian',
    desc: 'Chia nhỏ video thành nhiều phần bằng nhau.',
    icon: '🎞️',
    accent: 'teal',
  },
  {
    id: 'upscale',
    title: 'Upscale ảnh hàng loạt',
    desc: 'Tăng độ phân giải ảnh hàng loạt.',
    icon: '⬆️',
    accent: 'blue',
  },
  {
    id: 'fashion',
    title: 'Tạo Ảnh Thời Trang SLL',
    desc: 'Upload ảnh sản phẩm & người mẫu, tạo ảnh thời trang hàng loạt bằng AI.',
    icon: '👕',
    accent: 'pink',
  },
  {
    id: 'rewrite',
    title: 'Viết Lại Kịch Bản',
    desc: 'Phân tích & viết lại kịch bản đối thủ với AI, đa giọng điệu & đa ngôn ngữ.',
    icon: '✏️',
    accent: 'teal',
    openable: true,
  },
  {
    id: 'wm-vid',
    title: 'Xoá Watermark Video',
    desc: 'Xoá logo/watermark hàng loạt bằng 3 chế độ. Hỗ trợ kéo thả nhiều video & thư mục.',
    icon: '🧹',
    accent: 'blue',
  },
  {
    id: 'wm-gem',
    title: 'Xoá Watermark Gemini',
    desc: 'Xoá watermark Gemini khỏi ảnh hàng loạt bằng thuật toán reverse alpha-blend. Kéo thả ảnh & thư mục.',
    icon: '🧼',
    accent: 'teal',
  },
  {
    id: 'yt-dl',
    title: 'Tải Trọn Kênh YouTube / TikTok',
    desc: 'Clone toàn bộ video từ một Kênh (Channel), Playlist hoặc Tải hàng loạt từ 1800+ nền tảng chỉ với 1 click.',
    icon: '⬇️',
    accent: 'blue',
  },
  {
    id: 'av-srt',
    title: 'Audio/Video → SRT',
    desc: 'Chuyển audio/video thành phụ đề SRT. Hỗ trợ GPU (Whisper) hoặc Cloud AI (nhanh, không cần GPU).',
    icon: '📄',
    accent: 'teal',
  },
  {
    id: 'translate',
    title: 'Dịch Nội Dung Đa Ngôn Ngữ',
    desc: 'Dịch văn bản, phụ đề SRT/VTT/ASS và 13+ loại file sang 20 ngôn ngữ bằng AI.',
    icon: '🌐',
    accent: 'blue',
  },
  {
    id: 'script-prompt',
    title: 'Kịch Bản → Prompt Ảnh/Video',
    desc: 'Dán script hoặc SRT/VTT, AI tạo prompt ảnh và video nhất quán theo toàn bộ context.',
    icon: '🎬',
    accent: 'teal',
  },
  {
    id: 'va-prompt',
    title: 'Video/Audio → Prompt Ảnh & Video',
    desc: 'Ném Video hoặc Audio thuyết minh, AI tự động bóc tách lời thoại và đạo diễn sinh Prompt ảnh + video nhất quán.',
    icon: '〰️',
    accent: 'gold',
    openable: true,
  },
  {
    id: 'batch-edit',
    title: 'Chỉnh Sửa Ảnh Hàng Loạt',
    desc: 'Xoá logo, watermark, caption hàng loạt, xoá nền, cải thiện ánh sáng cho hàng trăm ảnh cùng lúc với AI.',
    icon: '🪄',
    accent: 'violet',
  },
  {
    id: 'whiteboard',
    title: 'Whiteboard Draw Studio',
    desc: 'Tạo video hiệu ứng vẽ tay từ hình ảnh với 38 mẫu bàn tay & cọ vẽ cơ học, tự động xuất video hoàn chỉnh.',
    icon: '🎥',
    accent: 'gold',
    openable: true,
  },
]

const TONES = [
  { id: 'expert', label: 'Chuyên gia phân tích (Logic & Data)', desc: 'Sắc sảo, logic, đi sâu bản chất vấn đề' },
  { id: 'story', label: 'Kể chuyện hấp dẫn', desc: 'Nhịp kể cuốn hút, giữ attention' },
  { id: 'teacher', label: 'Giáo viên thân thiện', desc: 'Dễ hiểu, gần gũi, khuyến khích' },
  { id: 'sales', label: 'Sales / Call-to-action', desc: 'Thuyết phục, chốt sale rõ ràng' },
]

const STYLE_CHIPS = [
  'Xưng hô "mình - các bạn"',
  'Nhịp điệu nhanh dồn dập',
  'Kịch tính & Hồi hộp',
  'Dí dỏm & Hài hước',
  'Số liệu & Logic sắc bén',
  'Giàu cảm xúc & Triết lý',
  'Đặt câu hỏi tu từ',
  'Ngắn gọn, không sáo rỗng',
]

const DUR_PRESETS = [0, 1, 3, 5, 10, 15, 30, 60]

const SAMPLE_SCRIPT =
  'Bạn có bao giờ tự hỏi vì sao một số kênh tăng trưởng thần tốc trong khi bạn đăng đều mà vẫn đứng im?\n\nHôm nay mình sẽ bóc tách 3 đòn bẩy nội dung mà đối thủ đang dùng — và cách bạn áp dụng ngay trong 7 ngày tới.\n\nThứ nhất: hook trong 3 giây đầu. Thứ hai: cấu trúc retention. Thứ ba: CTA không làm mất trust.'

const VA_STYLES = [
  { id: 'wb-doodle', name: 'Whiteboard Doodle', desc: 'Nét đen + doodle tay' },
  { id: 'wb-flat', name: 'Whiteboard Flat Accent', desc: 'Viền đen, accent phẳng' },
  { id: 'paper', name: 'Paper Cutout Collage', desc: 'Cắt giấy thủ công' },
  { id: 'cine', name: 'Điện ảnh (Cinematic 8K)', desc: 'Hình điện ảnh 8K' },
  { id: 'pixar', name: '3D Pixar Animation', desc: 'Biểu cảm phong phú' },
  { id: 'ghibli', name: 'Studio Ghibli Anime', desc: 'Màu nước mềm' },
  { id: 'photo', name: 'Nhiếp ảnh chân thực', desc: 'Photo-journalism' },
  { id: 'vnfolk', name: 'Tranh cổ họa VN', desc: 'Đông Hồ & Hàng Trống' },
  { id: 'cyber', name: 'Cyberpunk Neon Noir', desc: 'Neon phản chiếu' },
  { id: 'comic', name: 'Comic / Webtoon', desc: 'Manhwa / Webtoon' },
  { id: 'custom', name: 'Tuỳ chỉnh riêng', desc: 'Nhập style riêng' },
]

const CLIP_DUR = ['4s (Nhanh)', '5s (TikTok)', '6s (Kling)', '8s (Veo 3)', '10s (Mượt)', '12s (Dài)']
const PROMPT_KIND = ['Cả Ảnh & Video', 'Chỉ Ảnh', 'Chỉ Video']
const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '21:9']

function loadStr(key: string, fallback: string) {
  try {
    const v = localStorage.getItem(key)
    if (v != null && v !== '') return v
  } catch {
    /* ignore */
  }
  return fallback
}

function saveStr(key: string, val: string) {
  try {
    localStorage.setItem(key, val)
  } catch {
    /* ignore */
  }
}

function Hub({ onOpen }: { onOpen: (id: AppId) => void }) {
  return (
    <div className="ma-hub">
      <div className="ma-grid">
        {CARDS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`ma-card accent-${c.accent}`}
            onClick={() => onOpen(c.id)}
          >
            <div className={`ma-card-ico accent-${c.accent}`}>{c.icon}</div>
            <div className="ma-card-title">{c.title}</div>
            <div className="ma-card-desc">{c.desc}</div>
            <div className={`ma-card-bar accent-${c.accent}`} />
          </button>
        ))}
      </div>
    </div>
  )
}

function StubTool({
  card,
  onBack,
}: {
  card: MiniCard
  onBack: () => void
}) {
  return (
    <div className="ma-tool">
      <header className="ma-tool-top">
        <button type="button" className="ma-back" onClick={onBack} title="Quay lại">
          ←
        </button>
        <div className="ma-tool-head">
          <h1>{card.title}</h1>
          <span className="ma-badge muted">MOCK</span>
        </div>
      </header>
      <div className="ma-stub">
        <div className="ma-stub-ico">{card.icon}</div>
        <div className="ma-stub-title">{card.title}</div>
        <p>{card.desc}</p>
        <p className="ma-muted">Mock UI — chưa kết nối API / file thật. Bạn có thể mở các tool Viết Lại Kịch Bản, Video/Audio → Prompt, Whiteboard Draw Studio để xem flow đầy đủ.</p>
        <button type="button" className="ma-btn primary" onClick={onBack}>
          Quay lại MiniApp
        </button>
      </div>
    </div>
  )
}

function RewriteTool({ onBack }: { onBack: () => void }) {
  const [script, setScript] = useState(() => loadStr('pb.mini.rewrite.script', ''))
  const [tone, setTone] = useState(() => loadStr('pb.mini.rewrite.tone', 'expert'))
  const [extra, setExtra] = useState(() => loadStr('pb.mini.rewrite.extra', ''))
  const [lang, setLang] = useState(() => loadStr('pb.mini.rewrite.lang', 'auto'))
  const [dur, setDur] = useState(() => Number(loadStr('pb.mini.rewrite.dur', '0')))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')

  const chars = script.length
  const words = script.trim() ? script.trim().split(/\s+/).length : 0
  const toneMeta = TONES.find((t) => t.id === tone) || TONES[0]

  useEffect(() => {
    saveStr('pb.mini.rewrite.script', script)
    saveStr('pb.mini.rewrite.tone', tone)
    saveStr('pb.mini.rewrite.extra', extra)
    saveStr('pb.mini.rewrite.lang', lang)
    saveStr('pb.mini.rewrite.dur', String(dur))
  }, [script, tone, extra, lang, dur])

  function toggleChip(chip: string) {
    const parts = extra
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.includes(chip)) {
      setExtra(parts.filter((p) => p !== chip).join('\n'))
    } else {
      setExtra([...parts, chip].join('\n'))
    }
  }

  function runMock() {
    if (!script.trim()) return
    setBusy(true)
    setResult('')
    window.setTimeout(() => {
      const lines = script
        .trim()
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
      const rewritten = [
        `[Mock viết lại · ${toneMeta.label} · ${lang === 'auto' ? 'Auto' : lang}${dur > 0 ? ` · ~${dur} phút` : ''}]`,
        '',
        ...lines.map((l, i) => {
          if (i === 0) return `🔥 ${l.replace(/\?$/, '')}? Hãy cùng mình đi sâu hơn.`
          return l
        }),
        '',
        extra.trim()
          ? `Phong cách bổ sung: ${extra.trim().replace(/\n/g, ' · ')}`
          : '',
        '',
        '— Kết thúc mock rewrite (không gọi Gemini thật) —',
      ]
        .filter((x) => x !== undefined)
        .join('\n')
      setResult(rewritten)
      setBusy(false)
    }, 900)
  }

  return (
    <div className="ma-tool rewrite">
      <header className="ma-tool-top">
        <button type="button" className="ma-back" onClick={onBack}>
          ←
        </button>
        <div className="ma-tool-head">
          <h1>Viết Lại Kịch Bản AI</h1>
          <span className="ma-badge green">GEMINI FLASH</span>
        </div>
        <button
          type="button"
          className="ma-btn ghost"
          onClick={() => setScript(SAMPLE_SCRIPT)}
        >
          Nạp kịch bản mẫu
        </button>
      </header>

      <div className="rw-body">
        <section className="rw-left">
          <div className="rw-sec-head">
            <span>📄 KỊCH BẢN GỐC (COMPETITOR / SOURCE SCRIPT)</span>
            <div className="rw-meta">
              <span>
                {chars} ký tự · {words} từ
              </span>
              <label className="ma-link">
                Tải tệp .txt
                <input
                  type="file"
                  accept=".txt,text/plain"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    const reader = new FileReader()
                    reader.onload = () => setScript(String(reader.result || ''))
                    reader.readAsText(f)
                  }}
                />
              </label>
            </div>
          </div>
          <textarea
            className="rw-textarea"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="Dán hoặc kéo thả nội dung kịch bản gốc vào đây để AI bắt đầu phân tích và viết lại..."
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (!f) return
              const reader = new FileReader()
              reader.onload = () => setScript(String(reader.result || ''))
              reader.readAsText(f)
            }}
          />
          <div className="rw-tip">💡 Mẹo: Hỗ trợ dán văn bản dài không giới hạn hoặc tải trực tiếp file .txt</div>
          {result && (
            <div className="rw-result">
              <div className="rw-sec-head">
                <span>✨ KỊCH BẢN VIẾT LẠI (MOCK)</span>
                <button
                  type="button"
                  className="ma-link"
                  onClick={() => navigator.clipboard?.writeText(result)}
                >
                  Copy
                </button>
              </div>
              <pre>{result}</pre>
            </div>
          )}
        </section>

        <aside className="rw-right">
          <div className="rw-cfg-title">CẤU HÌNH VIẾT LẠI</div>

          <div className="rw-block">
            <div className="rw-label">MÔ HÌNH AI XỬ LÝ</div>
            <div className="rw-model on">
              <span className="rw-model-ico">⚡</span>
              <div>
                <div className="rw-model-name">Gemini Flash — Nhanh & Chuẩn</div>
                <div className="ma-muted">Tốc độ cao, từ ngữ thông minh, mượt</div>
              </div>
            </div>
          </div>

          <div className="rw-block">
            <div className="rw-label">GIỌNG ĐIỆU (TONE & PERSONA)</div>
            <select value={tone} onChange={(e) => setTone(e.target.value)}>
              {TONES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <div className="ma-muted sm">{toneMeta.desc}</div>
          </div>

          <div className="rw-block">
            <div className="rw-label">YÊU CẦU PHONG CÁCH BỔ SUNG</div>
            <textarea
              className="rw-extra"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="Thêm yêu cầu phong cách..."
            />
            <div className="rw-chips">
              {STYLE_CHIPS.map((c) => {
                const on = extra
                  .split('\n')
                  .map((s) => s.trim())
                  .includes(c)
                return (
                  <button
                    key={c}
                    type="button"
                    className={`rw-chip ${on ? 'on' : ''}`}
                    onClick={() => toggleChip(c)}
                  >
                    {c}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rw-block">
            <div className="rw-label">NGÔN NGỮ ĐẦU RA</div>
            <select value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="auto">Auto (Tự động nhận diện)</option>
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
              <option value="zh">中文</option>
              <option value="ja">日本語</option>
            </select>
          </div>

          <div className="rw-block">
            <div className="rw-label">
              THỜI LƯỢNG MONG MUỐN{' '}
              <span className="ma-muted">{dur === 0 ? 'Tự động (Auto)' : `${dur} phút`}</span>
            </div>
            <div className="rw-dur-row">
              <input
                type="number"
                min={0}
                max={120}
                value={dur}
                onChange={(e) => setDur(Math.min(120, Math.max(0, Number(e.target.value) || 0)))}
              />
              <span>phút (max 120)</span>
            </div>
            <div className="rw-presets">
              {DUR_PRESETS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`rw-preset ${dur === d ? 'on' : ''}`}
                  onClick={() => setDur(d)}
                >
                  {d === 0 ? 'Tự động' : d}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={120}
              value={dur}
              onChange={(e) => setDur(Number(e.target.value))}
              className="rw-slider"
            />
            <div className="rw-slider-ends">
              <span>0p (Auto)</span>
              <span>120p (Max)</span>
            </div>
          </div>

          <button
            type="button"
            className="ma-btn primary block"
            disabled={!script.trim() || busy}
            onClick={runMock}
          >
            {busy ? 'Đang viết lại (mock)...' : '✨ Viết lại kịch bản'}
          </button>
        </aside>
      </div>
    </div>
  )
}

function VaPromptTool({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [fileName, setFileName] = useState('')
  const [clip, setClip] = useState('8s (Veo 3)')
  const [kind, setKind] = useState('Cả Ảnh & Video')
  const [aspect, setAspect] = useState('16:9')
  const [style, setStyle] = useState('wb-doodle')
  const [cam, setCam] = useState('Nhẹ nhàng (Slow Pan / Dolly)')
  const [face, setFace] = useState('Tự động nhận diện theo script')
  const [outLang, setOutLang] = useState<'en' | 'vi'>('en')
  const [busy, setBusy] = useState(false)
  const [scenes, setScenes] = useState<
    { id: number; time: string; text: string; img: string; vid: string }[]
  >([])

  const totalDur = scenes.length === 0 ? '00:00.00' : `00:${String(scenes.length * 8).padStart(2, '0')}.00`

  function pickFile(f: File | null | undefined) {
    if (!f) return
    setFileName(f.name)
  }

  function createPrompts() {
    if (!fileName) {
      setFileName('demo_voiceover.mp4')
    }
    setBusy(true)
    window.setTimeout(() => {
      const name = fileName || 'demo_voiceover.mp4'
      const styleName = VA_STYLES.find((s) => s.id === style)?.name || style
      setScenes([
        {
          id: 1,
          time: '00:00–00:08',
          text: `Hook mở đầu từ ${name}`,
          img: `[${styleName}] Wide establishing shot, ${aspect}, cinematic lighting, ${cam}`,
          vid: `Camera ${cam.toLowerCase()}, subject enters frame, ${clip}`,
        },
        {
          id: 2,
          time: '00:08–00:16',
          text: 'Điểm nhấn nội dung chính',
          img: `[${styleName}] Mid shot character talking to camera, consistent identity lock`,
          vid: `Subtle push-in, lip-sync friendly pacing, ${clip}`,
        },
        {
          id: 3,
          time: '00:16–00:24',
          text: 'CTA / kết thúc',
          img: `[${styleName}] End card composition, clean negative space for text`,
          vid: `Slow pull-back to logo safe area, ${clip}`,
        },
      ])
      setBusy(false)
      setStep(2)
    }, 800)
  }

  return (
    <div className="ma-tool va">
      <header className="ma-tool-top">
        <button type="button" className="ma-back" onClick={onBack}>
          ←
        </button>
        <div className="ma-tool-head grow">
          <div className="ma-title-row">
            <span className="ma-title-ico">🎞️</span>
            <h1>Video/Audio → Prompt Ảnh & Video</h1>
            <span className="ma-badge gold">AI Director Studio</span>
          </div>
          <div className="ma-sub">
            Nạp Video hoặc Audio → Tự động bóc tách lời thoại & Đạo diễn sinh Prompt ảnh + video nhất quán
          </div>
        </div>
        <div className="va-steps">
          {(
            [
              [1, '1. Nạp File & Cài đặt', '☰'],
              [2, `2. Danh sách Prompt (${scenes.length})`, '▦'],
              [3, '3. Story Bible & Thực thể', '📖'],
            ] as const
          ).map(([n, label, ico]) => (
            <button
              key={n}
              type="button"
              className={`va-step ${step === n ? 'on' : ''}`}
              onClick={() => setStep(n)}
            >
              <span className="va-step-ico">{ico}</span>
              {label}
            </button>
          ))}
        </div>
      </header>

      {step === 1 && (
        <div className="va-step1">
          <section className="va-card">
            <div className="va-card-title">1 · Nạp Video hoặc Audio Thuyết Minh</div>
            <label
              className="va-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                pickFile(e.dataTransfer.files?.[0])
              }}
            >
              <div className="va-drop-ico">⬆️</div>
              <div className="va-drop-main">
                {fileName
                  ? `Đã chọn: ${fileName}`
                  : 'Kéo thả file Video (MP4, MKV, MOV...) hoặc Audio (MP3, WAV, M4A...) vào đây'}
              </div>
              <div className="ma-muted">
                Chọn xong file và cài đặt prompt bên dưới, rồi bấm nút &quot;Tạo Prompt Từ Video/Audio&quot;
              </div>
              <input
                type="file"
                accept="video/*,audio/*"
                hidden
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </label>
          </section>

          <section className="va-card">
            <div className="va-card-title">2 · Cấu hình Phong Cách Visual & Đạo Diễn AI</div>
            <div className="va-cfg">
              <div className="va-cfg-left">
                <div className="rw-label">Thời lượng mỗi cảnh / Clip</div>
                <div className="va-seg">
                  {CLIP_DUR.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`va-pill ${clip === d ? 'on' : ''}`}
                      onClick={() => setClip(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <div className="rw-label">Loại Prompt cần sinh</div>
                <div className="va-seg">
                  {PROMPT_KIND.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`va-pill ${kind === k ? 'on' : ''}`}
                      onClick={() => setKind(k)}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <div className="rw-label">Tỷ lệ khung hình</div>
                <div className="va-seg">
                  {ASPECTS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={`va-pill ${aspect === a ? 'on' : ''}`}
                      onClick={() => setAspect(a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <div className="va-cfg-right">
                <div className="rw-label">Phong cách nghệ thuật</div>
                <div className="va-styles">
                  {VA_STYLES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`va-style ${style === s.id ? 'on' : ''}`}
                      onClick={() => setStyle(s.id)}
                    >
                      {style === s.id && <span className="va-check">✓</span>}
                      <div className="va-style-name">{s.name}</div>
                      <div className="ma-muted sm">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="va-extra">
              <div className="va-field">
                <label>Chuyển động Camera</label>
                <select value={cam} onChange={(e) => setCam(e.target.value)}>
                  <option>Nhẹ nhàng (Slow Pan / Dolly)</option>
                  <option>Động (Handheld / Whip)</option>
                  <option>Tĩnh (Locked-off)</option>
                  <option>Orbit / Arc</option>
                </select>
              </div>
              <div className="va-field">
                <label>Gương mặt / Nhân vật</label>
                <select value={face} onChange={(e) => setFace(e.target.value)}>
                  <option>Tự động nhận diện theo script</option>
                  <option>Khoá 1 nhân vật chính</option>
                  <option>Không hiện mặt</option>
                </select>
              </div>
              <div className="va-field">
                <label>Ngôn ngữ xuất Prompt</label>
                <div className="va-seg">
                  <button
                    type="button"
                    className={`va-pill ${outLang === 'en' ? 'on' : ''}`}
                    onClick={() => setOutLang('en')}
                  >
                    English (Veo3)
                  </button>
                  <button
                    type="button"
                    className={`va-pill ${outLang === 'vi' ? 'on' : ''}`}
                    onClick={() => setOutLang('vi')}
                  >
                    Tiếng Việt
                  </button>
                </div>
              </div>
            </div>
          </section>

          <footer className="va-foot">
            <div className="ma-muted">
              Quy trình tự động: Tách lời thoại → Khóa thực thể → Sinh Prompt ảnh & video
            </div>
            <button
              type="button"
              className="ma-btn gold"
              disabled={busy}
              onClick={createPrompts}
            >
              {busy ? 'Đang tạo (mock)...' : '✨ Tạo Prompt Từ Video/Audio'}
            </button>
          </footer>
        </div>
      )}

      {step === 2 && (
        <div className="va-step2">
          <div className="va-list-head">
            <div>
              Danh sách {scenes.length} phân cảnh đã sinh Prompt (Tổng thời lượng: {totalDur})
            </div>
            <div className="va-list-acts">
              <button type="button" className="ma-btn ghost">
                Copy Prompt ▾
              </button>
              <button type="button" className="ma-btn ghost">
                Xuất File ▾
              </button>
            </div>
          </div>
          {scenes.length === 0 ? (
            <div className="va-empty">
              <p>Chưa có dữ liệu phân cảnh. Vui lòng nạp Video/Audio và bấm &quot;Tạo Prompt Từ Video/Audio&quot;.</p>
              <button type="button" className="ma-btn gold" onClick={() => setStep(1)}>
                Quay lại Cài đặt
              </button>
            </div>
          ) : (
            <div className="va-scenes">
              {scenes.map((s) => (
                <article key={s.id} className="va-scene">
                  <div className="va-scene-top">
                    <b>Cảnh {s.id}</b>
                    <span className="ma-muted">{s.time}</span>
                    <span className="ma-badge muted">{kind}</span>
                  </div>
                  <div className="va-scene-line">
                    <span className="tag">VO</span> {s.text}
                  </div>
                  {(kind === 'Cả Ảnh & Video' || kind === 'Chỉ Ảnh') && (
                    <div className="va-scene-block">
                      <div className="rw-label">Prompt Ảnh</div>
                      <pre>{s.img}</pre>
                    </div>
                  )}
                  {(kind === 'Cả Ảnh & Video' || kind === 'Chỉ Video') && (
                    <div className="va-scene-block">
                      <div className="rw-label">Prompt Video</div>
                      <pre>{s.vid}</pre>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="va-step3">
          <div className="va-bible">
            <div className="va-bible-head">📖 Story Bible & Khóa Thực Thể Nhất Quán</div>
            {scenes.length === 0 ? (
              <div className="va-empty dashed">
                Chưa có dữ liệu Story Bible. Vui lòng bấm &quot;Tạo Prompt Từ Video/Audio&quot; ở tab 1.
              </div>
            ) : (
              <div className="va-bible-body">
                <div className="va-entity">
                  <b>Nhân vật chính</b>
                  <span>Auto lock từ voiceover · {face}</span>
                </div>
                <div className="va-entity">
                  <b>Phong cách</b>
                  <span>{VA_STYLES.find((s) => s.id === style)?.name}</span>
                </div>
                <div className="va-entity">
                  <b>Palette / Mood</b>
                  <span>Consistent across {scenes.length} scenes · {aspect} · {outLang === 'en' ? 'EN' : 'VI'}</span>
                </div>
                <div className="va-entity">
                  <b>Camera bible</b>
                  <span>{cam}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function WhiteboardTool({ onBack }: { onBack: () => void }) {
  const [modal, setModal] = useState(true)
  const [cfg, setCfg] = useState(DEFAULT_DRAW_CONFIG)
  const [applied, setApplied] = useState(DEFAULT_DRAW_CONFIG.handName)

  return (
    <div className="ma-tool wb">
      <header className="ma-tool-top">
        <button type="button" className="ma-back" onClick={onBack}>
          ←
        </button>
        <div className="ma-tool-head">
          <h1>Whiteboard Draw Studio</h1>
          <span className="ma-badge gold">DRAW ENGINE 2.0</span>
        </div>
        <button type="button" className="ma-btn gold" onClick={() => setModal(true)}>
          Mở thư viện tay & bút
        </button>
      </header>

      <div className="wb-main">
        <div className="wb-preview">
          <div className="wb-canvas" style={{ background: cfg.bgColor, color: '#222' }}>
            <div className="wb-hand-mock">✍️</div>
            <div className="wb-line" style={{ borderColor: '#222', height: cfg.strokePx }} />
            <div className="wb-caption">Mock canvas · {applied}</div>
          </div>
        </div>
        <aside className="wb-side">
          <div className="rw-label">Cấu hình đang áp dụng</div>
          <div className="wb-kv">
            <span>Bàn tay / Bút</span>
            <b>{applied}</b>
          </div>
          <div className="wb-kv">
            <span>Phong cách</span>
            <b>{cfg.styleName}</b>
          </div>
          <div className="wb-kv">
            <span>Thời lượng</span>
            <b>
              {cfg.drawSec}s · hold {cfg.holdSec}s
            </b>
          </div>
          <div className="wb-kv">
            <span>Nét / Nền</span>
            <b>
              {cfg.strokePx}px · {cfg.bgColor}
            </b>
          </div>
          <button type="button" className="ma-btn primary block" onClick={() => setModal(true)}>
            Chỉnh trong DRAW ENGINE 2.0
          </button>
          <button type="button" className="ma-btn ghost block" disabled>
            Xuất video (mock)
          </button>
        </aside>
      </div>

      <DrawEngineModal
        open={modal}
        initial={cfg}
        onClose={() => setModal(false)}
        onApply={(next: DrawEngineConfig) => {
          setCfg(next)
          setApplied(next.handName)
          setModal(false)
        }}
      />
    </div>
  )
}

export default function MiniAppWorkspace() {
  const [app, setApp] = useState<AppId>('hub')
  const card = CARDS.find((c) => c.id === app)

  if (app === 'hub') {
    return (
      <div className="ma-root">
        <Hub onOpen={setApp} />
      </div>
    )
  }

  if (app === 'rewrite') {
    return (
      <div className="ma-root">
        <RewriteTool onBack={() => setApp('hub')} />
      </div>
    )
  }

  if (app === 'va-prompt') {
    return (
      <div className="ma-root">
        <VaPromptTool onBack={() => setApp('hub')} />
      </div>
    )
  }

  if (app === 'whiteboard') {
    return (
      <div className="ma-root">
        <WhiteboardTool onBack={() => setApp('hub')} />
      </div>
    )
  }

  return (
    <div className="ma-root">
      <StubTool card={card || CARDS[0]} onBack={() => setApp('hub')} />
    </div>
  )
}
