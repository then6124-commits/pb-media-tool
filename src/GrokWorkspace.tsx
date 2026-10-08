import { useEffect, useMemo, useState } from 'react'

type GrokView = 'studio' | 'profiles'
type GrokMode =
  | 'Text to Video'
  | 'Image to Video'
  | 'Text to Image'
  | 'Reference to Video'
  | 'Video Extend'

type QueueItem = {
  id: number
  mode: GrokMode
  prompt: string
  profile: string
  segments?: number
}

type ResultItem = {
  id: number
  prompt: string
  status: 'pending' | 'done' | 'error'
  mode: GrokMode
}

type ProfileRow = {
  id: number
  name: string
  slug: string
  status: 'valid' | 'invalid' | 'testing'
  addon: string
  createdAt: string
  selected: boolean
}

type ExtendStep = {
  id: number
  kind: 'T2V' | 'Extend'
  prompt: string
}

const MODES: GrokMode[] = [
  'Text to Video',
  'Image to Video',
  'Text to Image',
  'Reference to Video',
  'Video Extend',
]

const LS_THEME = 'pb.grok.theme'
const LS_PROFILES = 'pb.grok.profiles'

function loadTheme(): 'light' | 'dark' {
  try {
    const v = localStorage.getItem(LS_THEME)
    if (v === 'dark' || v === 'light') return v
  } catch {
    /* ignore */
  }
  return 'light'
}

function defaultProfiles(): ProfileRow[] {
  return [
    {
      id: 1,
      name: 'Profile 1',
      slug: 'grok_17910…gmc',
      status: 'valid',
      addon: 'Chưa kích hoạt',
      createdAt: '12:56:17 4/10/2026',
      selected: false,
    },
  ]
}

function loadProfiles(): ProfileRow[] {
  try {
    const raw = localStorage.getItem(LS_PROFILES)
    if (raw) {
      const parsed = JSON.parse(raw) as ProfileRow[]
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
  } catch {
    /* ignore */
  }
  return defaultProfiles()
}

function saveProfiles(rows: ProfileRow[]) {
  try {
    localStorage.setItem(LS_PROFILES, JSON.stringify(rows))
  } catch {
    /* ignore */
  }
}

function nowStamp() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
}

export default function GrokWorkspace() {
  const [view, setView] = useState<GrokView>('studio')
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme)
  const [mode, setMode] = useState<GrokMode>('Text to Video')
  const [modeOpen, setModeOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ratio, setRatio] = useState('16:9')
  const [duration, setDuration] = useState('10s')
  const [threads, setThreads] = useState(4)
  const [prompt, setPrompt] = useState('')
  const [profileId, setProfileId] = useState(1)
  const [images, setImages] = useState<string[]>([])
  const [refImages, setRefImages] = useState<string[]>([])
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [quick, setQuick] = useState(false)
  const [steps, setSteps] = useState<ExtendStep[]>([
    { id: 1, kind: 'T2V', prompt: '' },
    { id: 2, kind: 'Extend', prompt: '' },
  ])
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [results, setResults] = useState<ResultItem[]>([])
  const [selectedResults, setSelectedResults] = useState<number[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<ProfileRow[]>(loadProfiles)
  const [addOpen, setAddOpen] = useState(false)
  const [addTab, setAddTab] = useState<'manual' | 'batch'>('manual')
  const [batchText, setBatchText] = useState('')
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [logs, setLogs] = useState<string[]>(['[mock] Grok Studio sẵn sàng'])

  useEffect(() => {
    try {
      localStorage.setItem(LS_THEME, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  useEffect(() => {
    saveProfiles(profiles)
  }, [profiles])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  const activeProfile = profiles.find((p) => p.id === profileId) || profiles[0]
  const profileName = activeProfile?.name || 'Profile 1'

  const promptLines = useMemo(
    () =>
      prompt
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    [prompt],
  )

  const segmentCount = steps.filter((s) => s.prompt.trim()).length
  const totalSeconds = segmentCount * (duration === '10s' ? 10 : 6)

  const settingsSummary =
    mode === 'Video Extend'
      ? `${ratio} · ${duration}`
      : `${ratio} · ${duration} · ${threads} luồng`

  const queueSub =
    mode === 'Image to Video'
      ? `${images.length} ảnh · ${profileName}`
      : mode === 'Text to Image'
        ? `${promptLines.length} prompt · ${refImages.length} ảnh tham chiếu · ${profileName}`
        : mode === 'Reference to Video'
          ? `${promptLines.length} prompt · ${refImages.length} ảnh tham chiếu · ${profileName}`
          : mode === 'Video Extend'
            ? `${segmentCount} segment · ${totalSeconds}s tổng · ${profileName}`
            : `${promptLines.length} prompt · ${profileName}`

  const emptyHint =
    mode === 'Image to Video'
      ? 'Chuẩn bị ảnh nguồn rồi nhập mỗi dòng một prompt chuyển động để bắt đầu'
      : mode === 'Reference to Video'
        ? 'Chọn ảnh tham chiếu, nhập prompt mỗi dòng một nội dung, rồi bấm tạo video.'
        : mode === 'Text to Image'
          ? 'Nhập prompt ảnh, thêm ảnh tham chiếu nếu cần, rồi bấm tạo.'
          : mode === 'Video Extend'
            ? 'Tạo chain extend ở panel bên trái, thêm vào hàng đợi, rồi bấm bắt đầu gen.'
            : 'Nhập prompt, mỗi dòng một nội dung, rồi bấm tạo video.'

  const pendingCount = results.filter((r) => r.status === 'pending').length
  const doneCount = results.filter((r) => r.status === 'done').length
  const errCount = results.filter((r) => r.status === 'error').length

  function log(msg: string) {
    setLogs((prev) => [`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`, ...prev].slice(0, 40))
  }

  function flash(msg: string) {
    setToast(msg)
    log(msg)
  }

  function pickFiles(multi: boolean, folderHint?: boolean): Promise<string[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.multiple = multi
      if (folderHint) {
        input.setAttribute('webkitdirectory', '')
      }
      input.onchange = () => {
        const files = Array.from(input.files || [])
        resolve(files.map((f) => f.name))
      }
      input.click()
    })
  }

  async function onPickImages(folder = false) {
    const names = await pickFiles(true, folder)
    if (!names.length) return
    setImages((prev) => [...prev, ...names])
    flash(`Đã chọn ${names.length} ảnh (mock)`)
  }

  async function onPickRef() {
    const names = await pickFiles(true)
    if (!names.length) return
    setRefImages((prev) => [...prev, ...names])
    flash(`Đã thêm ${names.length} ảnh tham chiếu`)
  }

  async function onPickSource() {
    const names = await pickFiles(false)
    if (!names.length) return
    setSourceImage(names[0])
    flash(`Ảnh nguồn: ${names[0]}`)
  }

  function addToQueue() {
    if (mode === 'Video Extend') {
      const filled = steps.filter((s) => s.prompt.trim())
      if (!filled.length) {
        flash('Nhập ít nhất 1 prompt segment')
        return
      }
      const item: QueueItem = {
        id: Date.now(),
        mode,
        prompt: filled.map((s) => s.prompt.trim()).join(' → '),
        profile: profileName,
        segments: filled.length,
      }
      setQueue((q) => [...q, item])
      flash(`Đã thêm chain ${filled.length} segment vào hàng đợi`)
      return
    }

    if (mode === 'Image to Video') {
      if (!images.length) {
        flash('Chọn ảnh trước')
        return
      }
      const lines = promptLines.length ? promptLines : images.map((_, i) => `Chuyển động ảnh ${i + 1}`)
      const items = images.map((img, i) => ({
        id: Date.now() + i,
        mode,
        prompt: `${img}: ${lines[i % lines.length]}`,
        profile: profileName,
      }))
      setQueue((q) => [...q, ...items])
      flash(`Đã thêm ${items.length} job ảnh→video`)
      return
    }

    if (!promptLines.length) {
      flash('Nhập ít nhất 1 dòng prompt')
      return
    }
    if ((mode === 'Reference to Video' || mode === 'Text to Image') && !refImages.length) {
      // still allow — screenshot says optional-ish; soft warn
      flash('Chưa có ảnh tham chiếu — vẫn thêm mock')
    }
    const items = promptLines.map((line, i) => ({
      id: Date.now() + i,
      mode,
      prompt: line,
      profile: profileName,
    }))
    setQueue((q) => [...q, ...items])
    flash(`Đã thêm ${items.length} prompt vào hàng đợi`)
  }

  function startGen() {
    if (!queue.length) {
      flash('Hàng đợi trống')
      return
    }
    const batch = [...queue]
    setQueue([])
    const pending: ResultItem[] = batch.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      status: 'pending' as const,
      mode: q.mode,
    }))
    setResults((r) => [...pending, ...r])
    flash(`Bắt đầu gen ${batch.length} jobs (mock)`)
    window.setTimeout(() => {
      setResults((r) =>
        r.map((item) =>
          pending.some((p) => p.id === item.id)
            ? { ...item, status: Math.random() > 0.12 ? 'done' : 'error' }
            : item,
        ),
      )
      flash('Gen mock hoàn tất')
    }, 1600)
  }

  function updateStep(id: number, prompt: string) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, prompt } : s)))
  }

  function removeStep(id: number) {
    setSteps((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.id !== id)))
  }

  function addStep() {
    if (steps.length >= 3) {
      flash('Với mode 10s chỉ nên tối đa 3 segment')
      return
    }
    setSteps((prev) => [...prev, { id: Date.now(), kind: 'Extend', prompt: '' }])
  }

  function toggleSelectResult(id: number) {
    setSelectedResults((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function deleteSelectedResults() {
    if (!selectedResults.length) {
      flash('Chưa chọn kết quả')
      return
    }
    setResults((r) => r.filter((x) => !selectedResults.includes(x.id)))
    setSelectedResults([])
    flash('Đã xóa kết quả đã chọn')
  }

  function retryFailed() {
    const failed = results.filter((r) => r.status === 'error')
    if (!failed.length) {
      flash('Không có job lỗi')
      return
    }
    setResults((r) => r.map((x) => (x.status === 'error' ? { ...x, status: 'pending' } : x)))
    window.setTimeout(() => {
      setResults((r) => r.map((x) => (x.status === 'pending' ? { ...x, status: 'done' } : x)))
      flash(`Retry ${failed.length} job lỗi → xong`)
    }, 900)
  }

  function testProfile(id: number) {
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'testing' } : p)))
    flash(`Đang test profile #${id}…`)
    window.setTimeout(() => {
      setProfiles((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: Math.random() > 0.15 ? 'valid' : 'invalid' } : p)),
      )
      flash(`Test profile #${id} xong`)
    }, 800)
  }

  function testAll() {
    profiles.forEach((p) => testProfile(p.id))
  }

  function relogin(id: number) {
    flash(`Re-login profile #${id} (mock — mở browser giả)`)
  }

  function deleteProfile(id: number) {
    setProfiles((prev) => prev.filter((p) => p.id !== id))
    flash(`Đã xóa profile #${id}`)
  }

  function selectAllProfiles(on: boolean) {
    setProfiles((prev) => prev.map((p) => ({ ...p, selected: on })))
  }

  function deleteSelectedProfiles() {
    const n = profiles.filter((p) => p.selected).length
    if (!n) {
      flash('Chưa chọn profile')
      return
    }
    setProfiles((prev) => prev.filter((p) => !p.selected))
    flash(`Đã xóa ${n} profile`)
  }

  function addManualProfile() {
    const id = Date.now()
    const row: ProfileRow = {
      id,
      name: `Profile ${profiles.length + 1}`,
      slug: `grok_${String(id).slice(-5)}…gmc`,
      status: 'valid',
      addon: 'Chưa kích hoạt',
      createdAt: nowStamp(),
      selected: false,
    }
    setProfiles((prev) => [...prev, row])
    setProfileId(id)
    setAddOpen(false)
    flash('Đã mở browser mock & thêm profile (đăng nhập thủ công)')
  }

  function addBatchProfiles() {
    const lines = batchText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (!lines.length) {
      flash('Dán danh sách account (mỗi dòng 1)')
      return
    }
    const rows: ProfileRow[] = lines.map((line, i) => {
      const name = line.split(/[|:\s]/)[0] || `Batch ${i + 1}`
      return {
        id: Date.now() + i,
        name,
        slug: `grok_batch_${i + 1}…gmc`,
        status: 'valid' as const,
        addon: 'Chưa kích hoạt',
        createdAt: nowStamp(),
        selected: false,
      }
    })
    setProfiles((prev) => [...prev, ...rows])
    setBatchText('')
    setAddOpen(false)
    flash(`Auto Batch: thêm ${rows.length} profile mock`)
  }

  return (
    <div className={`grok-root ${theme === 'dark' ? 'grok-dark' : 'grok-light'}`}>
      <div className="grok-subnav">
        <div className="grok-subnav-left">
          <button
            type="button"
            className={`grok-pill ${view === 'studio' ? 'on' : ''}`}
            onClick={() => setView('studio')}
          >
            <span className="grok-pill-ico" aria-hidden>
              ▦
            </span>
            Grok Studio
          </button>
          <button
            type="button"
            className={`grok-pill ${view === 'profiles' ? 'on' : ''}`}
            onClick={() => setView('profiles')}
          >
            <span className="grok-pill-ico" aria-hidden>
              👥
            </span>
            Profiles
          </button>
        </div>
        <div className="grok-subnav-right">
          <button
            type="button"
            className="grok-icon-btn"
            title={theme === 'light' ? 'Chế độ tối' : 'Chế độ sáng'}
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? '☾' : '☀'}
          </button>
          <button
            type="button"
            className={`grok-icon-btn ${consoleOpen ? 'on' : ''}`}
            title="Console"
            onClick={() => setConsoleOpen((v) => !v)}
          >
            &gt;_
          </button>
          <button type="button" className="grok-add-profile" onClick={() => setAddOpen(true)}>
            <span className="grok-plus">+</span> Thêm profile
          </button>
        </div>
      </div>

      {view === 'studio' ? (
        <div className="grok-studio">
          {/* LEFT */}
          <aside className="grok-col grok-left">
            <div className="grok-label">CHẾ ĐỘ GROK</div>
            <div className="grok-mode-wrap">
              <button
                type="button"
                className="grok-mode-btn"
                onClick={() => setModeOpen((v) => !v)}
              >
                <span>{mode}</span>
                <span className="grok-caret">{modeOpen ? '▴' : '▾'}</span>
              </button>
              {modeOpen && (
                <div className="grok-mode-menu">
                  {MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`grok-mode-item ${mode === m ? 'on' : ''}`}
                      onClick={() => {
                        setMode(m)
                        setModeOpen(false)
                      }}
                    >
                      <span className="grok-dot" />
                      {m}
                      {mode === m && <span className="grok-check">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grok-label">PROFILE</div>
            <div className="grok-profiles-list">
              {profiles.map((p) => (
                <label key={p.id} className="grok-profile-row">
                  <input
                    type="radio"
                    name="grok-profile"
                    checked={profileId === p.id}
                    onChange={() => setProfileId(p.id)}
                  />
                  <span className={`grok-status-dot ${p.status === 'valid' ? 'ok' : p.status === 'testing' ? 'run' : 'bad'}`} />
                  <span>{p.name}</span>
                </label>
              ))}
              {!profiles.length && <div className="grok-muted">Chưa có profile — bấm + Thêm profile</div>}
            </div>

            <div className="grok-settings-row">
              <span className="grok-settings-summary">{settingsSummary}</span>
              <button
                type="button"
                className="grok-gear"
                onClick={() => setSettingsOpen((v) => !v)}
              >
                ⚙ Cài đặt
              </button>
            </div>
            {settingsOpen && (
              <div className="grok-settings-panel">
                <label>
                  Tỉ lệ
                  <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                    <option>16:9</option>
                    <option>9:16</option>
                    <option>1:1</option>
                  </select>
                </label>
                <label>
                  Thời lượng
                  <select value={duration} onChange={(e) => setDuration(e.target.value)}>
                    <option>6s</option>
                    <option>10s</option>
                  </select>
                </label>
                {mode !== 'Video Extend' && (
                  <label>
                    Luồng
                    <select
                      value={threads}
                      onChange={(e) => setThreads(Number(e.target.value))}
                    >
                      {[1, 2, 3, 4, 6, 8].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}

            {mode === 'Text to Video' && (
              <textarea
                className="grok-prompt"
                placeholder="Nhập mỗi dòng một prompt video..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            )}

            {mode === 'Image to Video' && (
              <div className="grok-block">
                <div className="grok-block-head">
                  <span className="grok-label">ẢNH CẦN TẠO VIDEO</span>
                  <span className="grok-count-badge">{images.length}</span>
                </div>
                <p className="grok-hint">Upload ảnh và nhập prompt cho từng ảnh</p>
                <div className="grok-two-btn">
                  <button type="button" onClick={() => onPickImages(false)}>
                    ☁ Chọn ảnh
                  </button>
                  <button type="button" onClick={() => onPickImages(true)}>
                    📁 Chọn folder
                  </button>
                </div>
                {images.length > 0 && (
                  <ul className="grok-file-list">
                    {images.map((n) => (
                      <li key={n}>
                        {n}
                        <button type="button" onClick={() => setImages((prev) => prev.filter((x) => x !== n))}>
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <textarea
                  className="grok-prompt sm"
                  placeholder="Mỗi dòng một prompt chuyển động (tuỳ chọn)..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
            )}

            {(mode === 'Text to Image' || mode === 'Reference to Video') && (
              <div className="grok-block">
                <div className="grok-block-head">
                  <span className="grok-label">ẢNH THAM CHIẾU</span>
                  <span className="grok-count-badge">{refImages.length}</span>
                </div>
                <div className="grok-two-btn">
                  <button type="button" onClick={onPickRef}>
                    ☁ Chọn ảnh
                  </button>
                  <button type="button" onClick={() => setRefImages([])}>
                    Xóa hết
                  </button>
                </div>
                {refImages.length > 0 && (
                  <ul className="grok-file-list">
                    {refImages.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
                <textarea
                  className="grok-prompt"
                  placeholder={
                    mode === 'Text to Image'
                      ? 'Nhập mỗi dòng một prompt ảnh...'
                      : 'Nhập mỗi dòng một prompt video...'
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
            )}

            {mode === 'Video Extend' && (
              <div className="grok-block">
                <div className="grok-label">ẢNH NGUỒN (TUỲ CHỌN · SEGMENT ĐẦU DÙNG I2V)</div>
                <button type="button" className="grok-dashed-btn" onClick={onPickSource}>
                  {sourceImage ? `🖼 ${sourceImage}` : '📷 Chọn ảnh từ máy'}
                </button>
                {sourceImage && (
                  <button type="button" className="grok-linkish" onClick={() => setSourceImage(null)}>
                    Bỏ ảnh nguồn
                  </button>
                )}

                <div className="grok-progress-head">
                  <label className="grok-quick">
                    <span>QUICK</span>
                    <button
                      type="button"
                      className={`grok-switch ${quick ? 'on' : ''}`}
                      aria-pressed={quick}
                      onClick={() => setQuick((v) => !v)}
                    >
                      <span />
                    </button>
                  </label>
                  <span className="grok-muted">
                    {segmentCount}/{steps.length} · {totalSeconds}s
                  </span>
                </div>
                <p className="grok-hint">
                  Tối đa 30s mỗi chain. Với mode 10s, chỉ nên dùng tối đa 3 segment.
                </p>

                <div className="grok-steps">
                  {steps.map((s, idx) => (
                    <div key={s.id} className="grok-step">
                      <div className="grok-step-head">
                        <span>
                          {idx + 1} {s.kind}
                        </span>
                        <button type="button" title="Xóa bước" onClick={() => removeStep(s.id)}>
                          🗑
                        </button>
                      </div>
                      <input
                        value={s.prompt}
                        onChange={(e) => updateStep(s.id, e.target.value)}
                        placeholder={
                          s.kind === 'T2V' ? 'Prompt đoạn đầu tiên...' : 'Prompt tiếp nối...'
                        }
                      />
                    </div>
                  ))}
                </div>
                <button type="button" className="grok-add-step" onClick={addStep}>
                  + Thêm bước
                </button>
              </div>
            )}

            <button type="button" className="grok-primary" onClick={addToQueue}>
              <div>Thêm vào hàng đợi</div>
              <div className="grok-primary-sub">{queueSub}</div>
            </button>
          </aside>

          {/* MIDDLE */}
          <section className="grok-col grok-mid">
            <div className="grok-mid-head">
              <button type="button" className="grok-icon-btn sm" title="Thu gọn" onClick={() => flash('Hàng đợi')}>
                ←
              </button>
              <span className="grok-round-badge">{queue.length}</span>
            </div>
            <div className="grok-queue-body">
              {queue.length === 0 ? (
                <div className="grok-empty-dash">Chưa có item nào đang chờ xử lý.</div>
              ) : (
                <ul className="grok-queue-list">
                  {queue.map((q) => (
                    <li key={q.id}>
                      <div className="grok-queue-mode">{q.mode}</div>
                      <div className="grok-queue-prompt">{q.prompt}</div>
                      <div className="grok-queue-meta">
                        {q.profile}
                        {q.segments ? ` · ${q.segments} seg` : ''}
                      </div>
                      <button
                        type="button"
                        className="grok-queue-del"
                        onClick={() => setQueue((prev) => prev.filter((x) => x.id !== q.id))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" className="grok-primary alt" onClick={startGen}>
              <div>Bắt đầu gen</div>
              <div className="grok-primary-sub">{queue.length} jobs</div>
            </button>
          </section>

          {/* RIGHT */}
          <section className="grok-col grok-right">
            <div className="grok-right-head">
              <div className="grok-result-title">
                Kết quả <span className="grok-round-badge">{results.length}</span>
              </div>
              <div className="grok-toolbar">
                <button
                  type="button"
                  title="Chọn tất cả"
                  onClick={() => setSelectedResults(results.map((r) => r.id))}
                >
                  ▢
                </button>
                <button type="button" title="Làm mới" onClick={() => flash('Đã làm mới danh sách')}>
                  ↻
                </button>
                <button type="button" title="Retry lỗi" onClick={retryFailed}>
                  ⟳
                </button>
                <button type="button" className="danger" title="Xóa đã chọn" onClick={deleteSelectedResults}>
                  🗑
                </button>
                <button
                  type="button"
                  title="Tải xuống"
                  onClick={() => flash(selectedResults.length ? `Mock tải ${selectedResults.length} file` : 'Chọn kết quả để tải')}
                >
                  ⬇
                </button>
                <span className="grok-stat blue">{pendingCount}</span>
                <span className="grok-stat green">{doneCount}</span>
                <span className="grok-stat red">{errCount}</span>
              </div>
            </div>
            <div className="grok-results-body">
              {results.length === 0 ? (
                <div className="grok-empty-results">
                  <div className="grok-avatar" aria-hidden>
                    👤
                  </div>
                  <h3>Chưa có kết quả</h3>
                  <p>{emptyHint}</p>
                </div>
              ) : (
                <ul className="grok-result-list">
                  {results.map((r) => (
                    <li key={r.id} className={`st-${r.status}`}>
                      <input
                        type="checkbox"
                        checked={selectedResults.includes(r.id)}
                        onChange={() => toggleSelectResult(r.id)}
                      />
                      <div className="grok-result-main">
                        <div className="grok-result-prompt">{r.prompt}</div>
                        <div className="grok-result-meta">
                          {r.mode}
                          <span className={`grok-badge ${r.status}`}>
                            {r.status === 'pending' ? 'Đang chạy' : r.status === 'done' ? 'Xong' : 'Lỗi'}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="grok-profiles-page">
          <div className="grok-profiles-card">
            <div className="grok-profiles-head">
              <h2>
                Quản lý Profiles <span className="grok-pill-count">{profiles.length} profile</span>
              </h2>
              <div className="grok-profiles-actions">
                <button type="button" className="grok-outline-blue" onClick={testAll}>
                  Test all
                </button>
                <button type="button" className="grok-text-btn" onClick={() => selectAllProfiles(true)}>
                  Chọn tất cả
                </button>
                <button type="button" className="grok-text-btn" onClick={() => selectAllProfiles(false)}>
                  Bỏ chọn
                </button>
                <button type="button" className="grok-text-btn danger" onClick={deleteSelectedProfiles}>
                  Xóa đã chọn
                </button>
              </div>
            </div>
            <table className="grok-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={profiles.length > 0 && profiles.every((p) => p.selected)}
                      onChange={(e) => selectAllProfiles(e.target.checked)}
                    />
                  </th>
                  <th>TÀI KHOẢN</th>
                  <th>TRẠNG THÁI</th>
                  <th>ADD-ON</th>
                  <th>NGÀY TẠO</th>
                  <th>HÀNH ĐỘNG</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={p.selected}
                        onChange={() =>
                          setProfiles((prev) =>
                            prev.map((x) => (x.id === p.id ? { ...x, selected: !x.selected } : x)),
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="grok-acct-name">{p.name}</div>
                      <div className="grok-acct-slug">{p.slug}</div>
                    </td>
                    <td>
                      <span className={`grok-status-dot ${p.status === 'valid' ? 'ok' : p.status === 'testing' ? 'run' : 'bad'}`} />
                      {p.status === 'valid' ? 'Hợp lệ' : p.status === 'testing' ? 'Đang test' : 'Không hợp lệ'}
                    </td>
                    <td>
                      <span className="grok-addon">{p.addon}</span>
                    </td>
                    <td>{p.createdAt}</td>
                    <td className="grok-row-actions">
                      <button type="button" title="Sửa" onClick={() => flash(`Sửa ${p.name} (mock)`)}>
                        ✎
                      </button>
                      <button type="button" className="grok-btn-dark" onClick={() => relogin(p.id)}>
                        Re-login
                      </button>
                      <button type="button" className="grok-outline-blue" onClick={() => testProfile(p.id)}>
                        Test
                      </button>
                      <button type="button" className="grok-outline-red" onClick={() => deleteProfile(p.id)}>
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))}
                {!profiles.length && (
                  <tr>
                    <td colSpan={6} className="grok-empty-cell">
                      Chưa có profile. Bấm + Thêm profile.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {consoleOpen && (
        <div className="grok-console">
          <div className="grok-console-head">
            <span>Console</span>
            <button type="button" onClick={() => setConsoleOpen(false)}>
              ×
            </button>
          </div>
          <pre>{logs.join('\n')}</pre>
        </div>
      )}

      {toast && <div className="grok-toast">{toast}</div>}

      {addOpen && (
        <div className="grok-modal-backdrop" onClick={() => setAddOpen(false)}>
          <div className="grok-modal" onClick={(e) => e.stopPropagation()}>
            <div className="grok-modal-head">
              <h3>Thêm Profile</h3>
              <button type="button" onClick={() => setAddOpen(false)}>
                ×
              </button>
            </div>
            <div className="grok-modal-tabs">
              <button
                type="button"
                className={addTab === 'manual' ? 'on' : ''}
                onClick={() => setAddTab('manual')}
              >
                Thủ công
              </button>
              <button
                type="button"
                className={addTab === 'batch' ? 'on' : ''}
                onClick={() => setAddTab('batch')}
              >
                Auto Batch
              </button>
            </div>
            {addTab === 'manual' ? (
              <button type="button" className="grok-manual-card" onClick={addManualProfile}>
                <span className="grok-manual-plus">+</span>
                <span>
                  <strong>Mở Browser & Đăng nhập</strong>
                  <small>Script mở Chrome, bạn tự đăng nhập X.com / Grok.</small>
                </span>
              </button>
            ) : (
              <div className="grok-batch-box">
                <p className="grok-hint">Mỗi dòng một account (email|pass hoặc cookie) — chỉ UI mock, không login thật.</p>
                <textarea
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  placeholder="user1@mail.com|pass&#10;user2@mail.com|pass"
                />
                <button type="button" className="grok-btn-dark wide" onClick={addBatchProfiles}>
                  Thêm batch
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
