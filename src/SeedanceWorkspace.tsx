import { ClearPromptBtn, PastePromptBtn, OnePromptCheck, splitPrompts, useOnePrompt } from './OnePrompt'
import { useEffect, useState } from 'react'
import { api, baseName, type BridgeJob, dirName, errText, fileUrl, openFolder, pickFiles, useJobs } from './bridge'
import './mini.css'

// Seedance (ByteDance) qua BytePlus ModelArk — cầu nối gọi /contents/generations/tasks.

type SdMode = 't2v' | 'i2v'
type SdItem = { id: number; prompt: string; first?: string; last?: string }
type SdResult = SdItem & { status: 'cho' | 'dang_chay' | 'xong' | 'loi'; path?: string; msg?: string }
type SdCfg = { has_key: boolean; key_mask: string; base: string; model: string }
type JobItem = { id: number; status: SdResult['status']; path: string; msg: string }

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const DURATIONS = ['5s', '10s']
const RESOLUTIONS = ['480p', '720p', '1080p']
const MODELS = [
  'seedance-1-0-pro-250528',
  'seedance-1-0-pro-fast-251015',
  'seedance-1-0-lite-t2v-250428',
  'seedance-1-0-lite-i2v-250428',
]

function loadStr(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function saveStr(key: string, val: string) {
  try {
    localStorage.setItem(key, val)
  } catch {
    /* ignore */
  }
}

export default function SeedanceWorkspace() {
  const [onePrompt, setOnePrompt] = useOnePrompt('seedance')
  const [cfg, setCfg] = useState<SdCfg | null>(null)
  const [cfgOpen, setCfgOpen] = useState(false)
  const [keyIn, setKeyIn] = useState('')
  const [baseIn, setBaseIn] = useState('')
  const [model, setModel] = useState(() => loadStr('pb.sd.model', MODELS[0]))
  const [mode, setMode] = useState<SdMode>(() => (loadStr('pb.sd.mode', 't2v') === 'i2v' ? 'i2v' : 't2v'))
  const [ratio, setRatio] = useState(() => loadStr('pb.sd.ratio', '16:9'))
  const [duration, setDuration] = useState(() => loadStr('pb.sd.dur', '5s'))
  const [resolution, setResolution] = useState(() => loadStr('pb.sd.res', '720p'))
  const [parallel, setParallel] = useState(() => Number(loadStr('pb.sd.par', '2')))
  const [audio, setAudio] = useState(() => loadStr('pb.sd.audio', '0') === '1')
  const [prompts, setPrompts] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [lastFrame, setLastFrame] = useState('')
  const [results, setResults] = useState<SdResult[]>([])
  const [jobIds, setJobIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const jobs = useJobs(['seedance'])

  useEffect(() => {
    saveStr('pb.sd.model', model)
    saveStr('pb.sd.mode', mode)
    saveStr('pb.sd.ratio', ratio)
    saveStr('pb.sd.dur', duration)
    saveStr('pb.sd.res', resolution)
    saveStr('pb.sd.par', String(parallel))
    saveStr('pb.sd.audio', audio ? '1' : '0')
  }, [model, mode, ratio, duration, resolution, parallel, audio])

  useEffect(() => {
    api<SdCfg>('/api/seedance/config', {})
      .then((c) => {
        setCfg(c)
        setBaseIn(c.base)
        if (!c.has_key) setCfgOpen(true)
      })
      .catch((e) => setErr(errText(e)))
  }, [])

  // Tiến độ việc nền → danh sách kết quả
  useEffect(() => {
    const items = jobs
      .filter((j) => jobIds.includes(j.id))
      .flatMap((j) => (j as BridgeJob & { items?: JobItem[] }).items || [])
    if (!items.length) return
    setResults((prev) =>
      prev.map((r) => {
        const it = items.find((x) => x.id === r.id)
        return it ? { ...r, status: it.status, path: it.path || r.path, msg: it.msg } : r
      }),
    )
  }, [jobs, jobIds])

  async function saveCfg() {
    try {
      const c = await api<SdCfg>('/api/seedance/config', { set: { key: keyIn, base: baseIn, model } })
      setCfg(c)
      setKeyIn('')
      setCfgOpen(false)
    } catch (e) {
      setErr(errText(e))
    }
  }

  async function chooseImages() {
    try {
      const ps = await pickFiles('anh', true)
      if (ps.length) setImages((prev) => [...prev, ...ps])
    } catch (e) {
      setErr(errText(e))
    }
  }

  async function chooseLast() {
    try {
      const [p] = await pickFiles('anh', false)
      if (p) setLastFrame(p)
    } catch (e) {
      setErr(errText(e))
    }
  }

  const lines = splitPrompts(prompts, onePrompt)

  function buildItems(): SdItem[] {
    const base = Date.now()
    if (mode === 'i2v') {
      return images.map((img, i) => ({
        id: base + i,
        prompt: lines.length ? lines[i % lines.length] : '',
        first: img,
        last: images.length === 1 ? lastFrame || undefined : undefined,
      }))
    }
    return lines.map((p, i) => ({ id: base + i, prompt: p }))
  }

  async function send(items: SdItem[]) {
    setBusy(true)
    setErr('')
    try {
      const r = await api<{ id: string }>('/api/seedance/run', {
        model,
        ratio,
        duration,
        resolution,
        parallel,
        audio,
        items,
      })
      setJobIds((prev) => [...prev, r.id])
    } catch (e) {
      const m = errText(e)
      setErr(m)
      setResults((prev) => prev.map((x) => (items.some((i) => i.id === x.id) ? { ...x, status: 'loi', msg: m } : x)))
    } finally {
      setBusy(false)
    }
  }

  function start() {
    const items = buildItems()
    if (!items.length) {
      setErr(mode === 'i2v' ? 'Chọn ảnh khung đầu trước' : 'Nhập prompt, mỗi dòng một video')
      return
    }
    setResults((prev) => [...items.map((i) => ({ ...i, status: 'cho' as const })), ...prev])
    void send(items)
  }

  function retryFailed() {
    const failed = results.filter((r) => r.status === 'loi')
    if (!failed.length) return
    setResults((prev) => prev.map((r) => (r.status === 'loi' ? { ...r, status: 'cho', msg: '' } : r)))
    void send(failed.map(({ id, prompt, first, last }) => ({ id, prompt, first, last })))
  }

  const nDone = results.filter((r) => r.status === 'xong').length
  const nErr = results.filter((r) => r.status === 'loi').length
  const nRun = results.length - nDone - nErr

  return (
    <div className="ma-root">
      <div className="ma-tool">
        <header className="ma-tool-top">
          <div className="ma-tool-head grow">
            <div className="ma-title-row">
              <span className="ma-title-ico">🌱</span>
              <h1>Seedance</h1>
              <span className="ma-badge green">BytePlus ModelArk</span>
            </div>
            <div className="ma-sub">
              {cfg?.has_key ? `Key ${cfg.key_mask} · ${cfg.base}` : 'Chưa có API key — bấm ⚙ Cấu hình API'}
            </div>
          </div>
          <button type="button" className="ma-btn ghost" onClick={() => setCfgOpen((v) => !v)}>
            ⚙ Cấu hình API
          </button>
        </header>

        <div className="va-step1">
          {cfgOpen && (
            <section className="va-card">
              <div className="va-card-title">API ModelArk</div>
              <div className="ma-muted">
                Tạo key ở console BytePlus › ModelArk › API Keys, và bật model Seedance trong Model activation.
              </div>
              <input
                className="ma-input"
                type="password"
                placeholder={cfg?.has_key ? `Đã lưu ${cfg.key_mask} — dán key mới để thay` : 'API key…'}
                value={keyIn}
                onChange={(e) => setKeyIn(e.target.value)}
              />
              <input
                className="ma-input"
                placeholder="Base URL"
                value={baseIn}
                onChange={(e) => setBaseIn(e.target.value)}
              />
              <div className="ma-row">
                <button type="button" className="ma-btn primary" onClick={() => void saveCfg()}>
                  Lưu
                </button>
                <span className="ma-muted">Base URL vùng khác: đổi «ap-southeast» theo region của tài khoản.</span>
              </div>
            </section>
          )}

          <section className="va-card">
            <div className="va-cfg">
              <div className="va-cfg-left">
                <div className="rw-label">Chế độ</div>
                <div className="va-seg">
                  <button type="button" className={`va-pill ${mode === 't2v' ? 'on' : ''}`} onClick={() => setMode('t2v')}>
                    Text → Video
                  </button>
                  <button type="button" className={`va-pill ${mode === 'i2v' ? 'on' : ''}`} onClick={() => setMode('i2v')}>
                    Ảnh → Video
                  </button>
                </div>
                <div className="rw-label">Model</div>
                <select className="ma-input" value={model} onChange={(e) => setModel(e.target.value)}>
                  {MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  className="ma-input"
                  placeholder="…hoặc gõ model ID khác (vd. Seedance 2.0)"
                  value={MODELS.includes(model) ? '' : model}
                  onChange={(e) => setModel(e.target.value.trim() || MODELS[0])}
                />
              </div>
              <div className="va-cfg-right">
                {mode === 't2v' && (
                  <>
                    <div className="rw-label">Tỷ lệ khung</div>
                    <div className="va-seg">
                      {RATIOS.map((r) => (
                        <button key={r} type="button" className={`va-pill ${ratio === r ? 'on' : ''}`} onClick={() => setRatio(r)}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div className="rw-label">Thời lượng · Độ phân giải</div>
                <div className="va-seg">
                  {DURATIONS.map((d) => (
                    <button key={d} type="button" className={`va-pill ${duration === d ? 'on' : ''}`} onClick={() => setDuration(d)}>
                      {d}
                    </button>
                  ))}
                  {RESOLUTIONS.map((r) => (
                    <button key={r} type="button" className={`va-pill ${resolution === r ? 'on' : ''}`} onClick={() => setResolution(r)}>
                      {r}
                    </button>
                  ))}
                </div>
                <div className="ma-row">
                  <span className="ma-muted">Luồng song song</span>
                  <input
                    className="ma-num"
                    type="number"
                    min={1}
                    max={6}
                    value={parallel}
                    onChange={(e) => setParallel(Math.min(6, Math.max(1, Number(e.target.value) || 1)))}
                  />
                  <label className="ma-muted">
                    <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /> Tạo âm thanh
                    (model hỗ trợ)
                  </label>
                </div>
              </div>
            </div>
          </section>

          {mode === 'i2v' && (
            <section className="va-card">
              <div className="va-card-title">Ảnh khung đầu ({images.length})</div>
              <div className="ma-row">
                <button type="button" className="ma-btn primary" onClick={() => void chooseImages()}>
                  🖼 Chọn ảnh
                </button>
                {images.length > 0 && (
                  <button type="button" className="ma-link" onClick={() => setImages([])}>
                    Xoá hết
                  </button>
                )}
                {images.length === 1 && (
                  <>
                    <button type="button" className="ma-btn ghost" onClick={() => void chooseLast()}>
                      🏁 Khung cuối (tuỳ chọn)
                    </button>
                    {lastFrame && (
                      <span className="ma-muted">
                        {baseName(lastFrame)}{' '}
                        <button type="button" className="ma-link" onClick={() => setLastFrame('')}>
                          Bỏ
                        </button>
                      </span>
                    )}
                  </>
                )}
              </div>
              {images.length > 0 && <div className="ma-muted">{images.map(baseName).join(' · ')}</div>}
            </section>
          )}

          <section className="va-card">
            <div className="va-card-title">
              {mode === 't2v' ? 'Prompt — mỗi dòng một video' : 'Prompt chuyển động — dòng i dùng cho ảnh i (lặp lại nếu ít dòng hơn)'}
              <span className="prompt-tools">
                <PastePromptBtn value={prompts} setValue={setPrompts} />
                <ClearPromptBtn value={prompts} setValue={setPrompts} />
                <OnePromptCheck on={onePrompt} setOn={setOnePrompt} />
              </span>
            </div>
            <textarea
              className="rw-textarea sp"
              value={prompts}
              onChange={(e) => setPrompts(e.target.value)}
              placeholder={mode === 't2v' ? 'A red fox runs through snowy forest at dawn, tracking shot…' : 'Camera slowly pushes in, hair moves in the wind…'}
            />
          </section>

          <footer className="va-foot">
            <div className="ma-err">{err}</div>
            <button type="button" className="ma-btn gold" disabled={busy || !cfg?.has_key} onClick={start}>
              {busy ? 'Đang gửi…' : `▶ Tạo ${mode === 'i2v' ? images.length : lines.length} video`}
            </button>
          </footer>

          {results.length > 0 && (
            <section className="ma-jobs">
              <div className="va-list-head">
                <div className="rw-label">
                  KẾT QUẢ · ⏳ {nRun} · ✅ {nDone} · ❌ {nErr}
                </div>
                <div className="va-list-acts">
                  {nErr > 0 && (
                    <button type="button" className="ma-btn ghost" onClick={retryFailed}>
                      ↻ Chạy lại lỗi
                    </button>
                  )}
                  <button type="button" className="ma-btn ghost" onClick={() => setResults((r) => r.filter((x) => x.status !== 'xong' && x.status !== 'loi'))}>
                    Dọn danh sách
                  </button>
                </div>
              </div>
              {results.map((r) => (
                <div key={r.id} className={`ma-job ${r.status}`}>
                  <span className="ma-job-dot" />
                  <div className="ma-job-main">
                    <div className="ma-job-name">{r.prompt || (r.first ? baseName(r.first) : '')}</div>
                    <div className="ma-muted sm">
                      {r.status === 'xong' ? '✅ Xong' : r.status === 'loi' ? `❌ ${r.msg}` : r.status === 'dang_chay' ? '⏳ Đang tạo…' : '⏸ Chờ'}
                    </div>
                    {r.path && <video className="sd-video" src={fileUrl(r.path)} controls preload="metadata" />}
                  </div>
                  {r.path && (
                    <button type="button" className="ma-btn ghost" onClick={() => openFolder(dirName(r.path!))}>
                      📂
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
