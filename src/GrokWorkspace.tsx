import { OnePromptCheck, splitPrompts, useOnePrompt } from './OnePrompt'
import { useEffect, useMemo, useState } from 'react'
import { api, baseName, type BridgeJob, dirName, errText, fileUrl, openFolder, pickFiles as pickPaths, pickFolder, useJobs } from './bridge'

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
  image?: string
  refs?: string[]
  steps?: string[]
}

type ResultItem = {
  id: number
  prompt: string
  status: 'pending' | 'done' | 'error'
  mode: GrokMode
  path?: string
  err?: string
  src?: QueueItem
}

type JobItem = { id: number; status: 'cho' | 'dang_chay' | 'xong' | 'loi'; path: string; msg: string }

type ProfileRow = {
  id: number
  name: string
  slug: string
  status: 'valid' | 'invalid' | 'testing' | 'untested'
  addon: string
  createdAt: string
  selected: boolean
}

type BridgeProfile = { id: number; name: string; slug: string; status: ProfileRow['status']; created: string }

function toRows(ds: BridgeProfile[], prev: ProfileRow[]): ProfileRow[] {
  return ds.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    addon: 'xAI API',
    createdAt: p.created,
    selected: prev.find((x) => x.id === p.id)?.selected || false,
  }))
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

function loadTheme(): 'light' | 'dark' {
  try {
    const v = localStorage.getItem(LS_THEME)
    if (v === 'dark' || v === 'light') return v
  } catch {
    /* ignore */
  }
  return 'light'
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
  const [profileId, setProfileId] = useState(0)
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
  const [onePrompt, setOnePrompt] = useOnePrompt('grok')
  const [midCollapsed, setMidCollapsed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [manualName, setManualName] = useState('')
  const [manualKey, setManualKey] = useState('')
  const [jobIds, setJobIds] = useState<string[]>([])
  const jobs = useJobs(['grok'])
  const [addOpen, setAddOpen] = useState(false)
  const [addTab, setAddTab] = useState<'manual' | 'batch'>('manual')
  const [batchText, setBatchText] = useState('')
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [logs, setLogs] = useState<string[]>(['Grok Studio sẵn sàng — xAI API'])

  useEffect(() => {
    try {
      localStorage.setItem(LS_THEME, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  async function profileAction(body: Record<string, unknown>) {
    try {
      const r = await api<{ profiles: BridgeProfile[] }>('/api/grok/profiles', body)
      setProfiles((prev) => toRows(r.profiles, prev))
      if (r.profiles.length && !r.profiles.some((p) => p.id === profileId)) setProfileId(r.profiles[0].id)
      return true
    } catch (e) {
      flash(errText(e))
      return false
    }
  }

  useEffect(() => {
    void profileAction({})
    // chỉ nạp một lần
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tiến độ việc nền → danh sách kết quả
  useEffect(() => {
    const mine = jobs.filter((j) => jobIds.includes(j.id))
    if (!mine.length) return
    const items = mine.flatMap((j) => ((j as BridgeJob & { items?: JobItem[] }).items || []))
    if (!items.length) return
    setResults((prev) =>
      prev.map((r) => {
        const it = items.find((x) => x.id === r.id)
        if (!it) return r
        const status = it.status === 'xong' ? 'done' : it.status === 'loi' ? 'error' : 'pending'
        return { ...r, status, path: it.path || r.path, err: it.msg || undefined }
      }),
    )
  }, [jobs, jobIds])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  const activeProfile = profiles.find((p) => p.id === profileId) || profiles[0]
  const profileName = activeProfile?.name || '(chưa có profile)'

  const promptLines = useMemo(() => splitPrompts(prompt, onePrompt), [prompt, onePrompt])

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

  async function choose(multi: boolean): Promise<string[]> {
    try {
      return await pickPaths('anh', multi)
    } catch (e) {
      flash(errText(e))
      return []
    }
  }

  async function onPickImages() {
    const paths = await choose(true)
    if (!paths.length) return
    setImages((prev) => [...prev, ...paths])
    flash(`Đã chọn ${paths.length} ảnh`)
  }

  async function onPickFolder() {
    try {
      const dir = await pickFolder()
      if (!dir) return
      const r = await api<{ items: { path: string }[] }>('/api/mini/list-images', { folder: dir })
      setImages((prev) => [...prev, ...r.items.map((x) => x.path)])
      flash(`Đã thêm ${r.items.length} ảnh từ thư mục`)
    } catch (e) {
      flash(errText(e))
    }
  }

  async function onPickRef() {
    const paths = await choose(true)
    if (!paths.length) return
    setRefImages((prev) => [...prev, ...paths])
    flash(`Đã thêm ${paths.length} ảnh tham chiếu`)
  }

  async function onPickSource() {
    const [p] = await choose(false)
    if (!p) return
    setSourceImage(p)
    flash(`Ảnh nguồn: ${baseName(p)}`)
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
        steps: filled.map((s) => s.prompt.trim()),
        image: sourceImage || undefined,
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
        prompt: `${baseName(img)}: ${lines[i % lines.length]}`,
        profile: profileName,
        image: img,
      }))
      setQueue((q) => [...q, ...items])
      flash(`Đã thêm ${items.length} job ảnh→video`)
      return
    }

    if (!promptLines.length) {
      flash('Nhập ít nhất 1 dòng prompt')
      return
    }
    if (mode === 'Reference to Video' && !refImages.length) {
      flash('Reference to Video cần ít nhất 1 ảnh tham chiếu')
      return
    }
    const items = promptLines.map((line, i) => ({
      id: Date.now() + i,
      mode,
      prompt: line,
      profile: profileName,
      refs: mode === 'Reference to Video' ? refImages : undefined,
    }))
    setQueue((q) => [...q, ...items])
    flash(`Đã thêm ${items.length} prompt vào hàng đợi`)
  }

  async function sendBatch(batch: QueueItem[]) {
    // Gom theo mode — mỗi mode một việc nền
    const modes = Array.from(new Set(batch.map((q) => q.mode)))
    for (const m of modes) {
      const part = batch.filter((q) => q.mode === m)
      try {
        const r = await api<{ id: string }>('/api/grok/run', {
          mode: m,
          profile_id: profileId,
          ratio,
          duration,
          parallel: threads,
          items: part.map((q) => ({
            id: q.id,
            prompt: q.prompt.replace(/^[^:]*\.(png|jpe?g|webp): /i, ''),
            image: q.image,
            refs: q.refs,
            steps: q.steps,
          })),
        })
        setJobIds((prev) => [...prev, r.id])
        log(`Gửi ${part.length} việc ${m} → xAI`)
      } catch (e) {
        const msg = errText(e)
        setResults((prev) => prev.map((x) => (part.some((q) => q.id === x.id) ? { ...x, status: 'error', err: msg } : x)))
        flash(msg)
      }
    }
  }

  function startGen() {
    if (!queue.length) {
      flash('Hàng đợi trống')
      return
    }
    if (!profiles.length) {
      flash('Chưa có profile — thêm xAI API key ở tab Profiles')
      return
    }
    const batch = [...queue]
    setQueue([])
    setResults((r) => [
      ...batch.map((q) => ({ id: q.id, prompt: q.prompt, status: 'pending' as const, mode: q.mode, src: q })),
      ...r,
    ])
    void sendBatch(batch)
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

  async function downloadSelected() {
    const paths = results
      .filter((x) => (selectedResults.length ? selectedResults.includes(x.id) : true) && x.path)
      .map((x) => x.path!)
    if (!paths.length) {
      flash(selectedResults.length ? 'Các kết quả đã chọn chưa có file' : 'Chưa có file nào để tải')
      return
    }
    try {
      const dest = await pickFolder()
      if (!dest) return
      const r = await api<{ n: number }>('/api/util/copy-files', { paths, dest })
      flash(`Đã chép ${r.n} file → ${dest}`)
    } catch (e) {
      flash(errText(e))
    }
  }

  function retryFailed() {
    const failed = results.filter((r) => r.status === 'error' && r.src)
    if (!failed.length) {
      flash('Không có job lỗi')
      return
    }
    setResults((r) => r.map((x) => (failed.some((f) => f.id === x.id) ? { ...x, status: 'pending', err: undefined } : x)))
    void sendBatch(failed.map((f) => f.src!))
  }

  function testProfile(id: number) {
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'testing' } : p)))
    void profileAction({ action: 'test', ids: [id] })
  }

  function testAll() {
    setProfiles((prev) => prev.map((p) => ({ ...p, status: 'testing' })))
    void profileAction({ action: 'test' })
  }

  function renameProfile(p: ProfileRow) {
    const name = window.prompt('Tên profile', p.name)
    if (name && name.trim()) void profileAction({ action: 'rename', id: p.id, name: name.trim() })
  }

  function deleteProfile(id: number) {
    void profileAction({ action: 'delete', ids: [id] })
  }

  function selectAllProfiles(on: boolean) {
    setProfiles((prev) => prev.map((p) => ({ ...p, selected: on })))
  }

  function deleteSelectedProfiles() {
    const ids = profiles.filter((p) => p.selected).map((p) => p.id)
    if (!ids.length) {
      flash('Chưa chọn profile')
      return
    }
    void profileAction({ action: 'delete', ids })
  }

  async function addManualProfile() {
    if (!manualKey.trim()) {
      flash('Dán xAI API key (console.x.ai)')
      return
    }
    if (await profileAction({ action: 'add', keys: `${manualName.trim()}|${manualKey.trim()}` })) {
      setManualKey('')
      setManualName('')
      setAddOpen(false)
      flash('Đã thêm profile — bấm Test để kiểm tra key')
    }
  }

  async function addBatchProfiles() {
    if (!batchText.trim()) {
      flash('Dán danh sách key (mỗi dòng: tên|key hoặc chỉ key)')
      return
    }
    if (await profileAction({ action: 'add', keys: batchText })) {
      setBatchText('')
      setAddOpen(false)
      flash('Đã thêm profile')
    }
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
        <div className={`grok-studio${midCollapsed ? ' mid-collapsed' : ''}`}>
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

            <div className="one-prompt-row">
              <OnePromptCheck on={onePrompt} setOn={setOnePrompt} />
            </div>
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
                  <button type="button" onClick={() => void onPickImages()}>
                    ☁ Chọn ảnh
                  </button>
                  <button type="button" onClick={() => void onPickFolder()}>
                    📁 Chọn folder
                  </button>
                </div>
                {images.length > 0 && (
                  <ul className="grok-file-list">
                    {images.map((n) => (
                      <li key={n} title={n}>
                        {baseName(n)}
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
                {mode === 'Reference to Video' && (
                  <>
                <div className="grok-block-head">
                  <span className="grok-label">ẢNH THAM CHIẾU (TỐI ĐA 7)</span>
                  <span className="grok-count-badge">{refImages.length}</span>
                </div>
                <div className="grok-two-btn">
                  <button type="button" onClick={() => void onPickRef()}>
                    ☁ Chọn ảnh
                  </button>
                  <button type="button" onClick={() => setRefImages([])}>
                    Xóa hết
                  </button>
                </div>
                {refImages.length > 0 && (
                  <ul className="grok-file-list">
                    {refImages.map((n) => (
                      <li key={n} title={n}>
                        {baseName(n)}
                      </li>
                    ))}
                  </ul>
                )}
                  </>
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
                <button type="button" className="grok-dashed-btn" onClick={() => void onPickSource()}>
                  {sourceImage ? `🖼 ${baseName(sourceImage)}` : '📷 Chọn ảnh từ máy'}
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
              <button
                type="button"
                className="grok-icon-btn sm"
                title={midCollapsed ? 'Mở hàng đợi' : 'Thu gọn hàng đợi'}
                onClick={() => setMidCollapsed((v) => !v)}
              >
                {midCollapsed ? '→' : '←'}
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
                  title="Chép file đã chọn (hoặc tất cả) sang thư mục khác"
                  onClick={() => void downloadSelected()}
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
                          <span className={`grok-badge ${r.status}`} title={r.err}>
                            {r.status === 'pending' ? 'Đang chạy' : r.status === 'done' ? 'Xong' : 'Lỗi'}
                          </span>
                          {r.path && (
                            <button type="button" className="grok-linkish" onClick={() => openFolder(dirName(r.path!))}>
                              📂
                            </button>
                          )}
                        </div>
                        {r.err && <div className="grok-result-err">{r.err}</div>}
                      </div>
                      {r.path &&
                        (/\.png$|\.jpe?g$|\.webp$/i.test(r.path) ? (
                          <img className="grok-result-media" src={fileUrl(r.path)} alt="" />
                        ) : (
                          <video className="grok-result-media" src={fileUrl(r.path)} controls preload="metadata" />
                        ))}
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
                      <span className={`grok-status-dot ${p.status === 'valid' ? 'ok' : p.status === 'invalid' ? 'bad' : 'run'}`} />
                      {p.status === 'valid'
                        ? 'Hợp lệ'
                        : p.status === 'testing'
                          ? 'Đang test'
                          : p.status === 'untested'
                            ? 'Chưa test'
                            : 'Không hợp lệ'}
                    </td>
                    <td>
                      <span className="grok-addon">{p.addon}</span>
                    </td>
                    <td>{p.createdAt}</td>
                    <td className="grok-row-actions">
                      <button type="button" title="Đổi tên" onClick={() => renameProfile(p)}>
                        ✎
                      </button>
                      <button type="button" className="grok-btn-dark" onClick={() => setProfileId(p.id)}>
                        {profileId === p.id ? '✓ Đang dùng' : 'Dùng'}
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
                      Chưa có profile. Bấm + Thêm profile và dán xAI API key (console.x.ai).
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
              <div className="grok-batch-box">
                <p className="grok-hint">Mỗi profile là một xAI API key — tạo ở console.x.ai › API Keys.</p>
                <input
                  className="grok-key-input"
                  placeholder="Tên profile (tuỳ chọn)"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                />
                <input
                  className="grok-key-input"
                  type="password"
                  placeholder="xai-…"
                  value={manualKey}
                  onChange={(e) => setManualKey(e.target.value)}
                />
                <button type="button" className="grok-btn-dark wide" onClick={() => void addManualProfile()}>
                  Thêm profile
                </button>
              </div>
            ) : (
              <div className="grok-batch-box">
                <p className="grok-hint">Mỗi dòng một key: «tên|xai-…» hoặc chỉ «xai-…».</p>
                <textarea
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  placeholder="Main|xai-…&#10;xai-…"
                />
                <button type="button" className="grok-btn-dark wide" onClick={() => void addBatchProfiles()}>
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
