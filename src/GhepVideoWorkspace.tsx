import { useEffect, useRef, useState } from 'react'
import { api, baseName, errText, fileUrl, openFolder, pickFiles, pickFolder, useJobs } from './bridge'
import './ghep.css'

type Props = {
  onOpenSettings?: () => void
}

type LoadState = 'empty' | 'error' | 'loading' | 'ok'

type VideoItem = {
  id: number
  path: string
  name: string
  dur: number
  w: number
  h: number
  selected: boolean
}

function fmtDur(sec: number) {
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const LS_MUSIC = 'pb.ghep.music'
const LS_LOOP_AUDIO = 'pb.ghep.loopAudio'
const LS_LOOP_VIDEO = 'pb.ghep.loopVideo'
const LS_MUTE = 'pb.ghep.muteOrig'
const LS_VOL = 'pb.ghep.vol'
const LS_TARGET = 'pb.ghep.targetSec'
const LS_FOLDER = 'pb.ghep.folder'

function loadStr(key: string, fallback: string) {
  try {
    const v = localStorage.getItem(key)
    if (v != null && v !== '') return v
  } catch {
    /* ignore */
  }
  return fallback
}

function loadBool(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key)
    if (v === '1') return true
    if (v === '0') return false
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

export default function GhepVideoWorkspace({ onOpenSettings }: Props) {
  const [music, setMusic] = useState(() => loadStr(LS_MUSIC, ''))
  const [loopAudio, setLoopAudio] = useState(() => loadBool(LS_LOOP_AUDIO, true))
  const [loopVideo, setLoopVideo] = useState(() => loadBool(LS_LOOP_VIDEO, false))
  const [muteOrig, setMuteOrig] = useState(() => loadBool(LS_MUTE, true))
  const [vol, setVol] = useState(() => loadNum(LS_VOL, 100))
  const [targetSec, setTargetSec] = useState(() => loadNum(LS_TARGET, 60))
  const [folder, setFolder] = useState(() => loadStr(LS_FOLDER, ''))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loadState, setLoadState] = useState<LoadState>('empty')
  const [loadErr, setLoadErr] = useState('')
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const jobs = useJobs(['ghep'])
  const lastJob = jobs[0]
  const settingsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(LS_MUSIC, music)
      localStorage.setItem(LS_LOOP_AUDIO, loopAudio ? '1' : '0')
      localStorage.setItem(LS_LOOP_VIDEO, loopVideo ? '1' : '0')
      localStorage.setItem(LS_MUTE, muteOrig ? '1' : '0')
      localStorage.setItem(LS_VOL, String(vol))
      localStorage.setItem(LS_TARGET, String(targetSec))
      localStorage.setItem(LS_FOLDER, folder)
    } catch {
      /* ignore */
    }
  }, [music, loopAudio, loopVideo, muteOrig, vol, targetSec, folder])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!settingsRef.current) return
      if (!settingsRef.current.contains(e.target as Node)) setSettingsOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  async function reload(dir = folder) {
    if (!dir.trim()) {
      setLoadState('empty')
      setSettingsOpen(true)
      return
    }
    setLoadState('loading')
    setLoadErr('')
    setVideos([])
    try {
      const r = await api<{ items: { path: string; name: string; dur: number; w: number; h: number }[] }>(
        '/api/ghep/list',
        { folder: dir.trim() },
      )
      setVideos(r.items.map((v, i) => ({ ...v, id: i + 1, selected: true })))
      setLoadState(r.items.length ? 'ok' : 'empty')
      if (r.items.length) setToast(`Đã tải ${r.items.length} video.`)
    } catch (e) {
      setLoadErr(errText(e))
      setLoadState('error')
    }
  }

  useEffect(() => {
    if (folder.trim()) void reload(folder)
    // chỉ quét một lần lúc mở tab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function chooseFolder() {
    try {
      const p = await pickFolder(folder)
      if (!p) return
      setFolder(p)
      setSettingsOpen(false)
      void reload(p)
    } catch (e) {
      setToast(errText(e))
    }
  }

  async function chooseMusic() {
    try {
      const [p] = await pickFiles('audio', false)
      if (!p) return
      setMusic(p)
      setToast(`Đã chọn nhạc: ${baseName(p)}`)
    } catch (e) {
      setToast(errText(e))
    }
  }

  function clearMusic() {
    setMusic('')
  }

  function toggleAll(checked: boolean) {
    setVideos((prev) => prev.map((v) => ({ ...v, selected: checked })))
  }

  function move(id: number, d: -1 | 1) {
    setVideos((prev) => {
      const i = prev.findIndex((v) => v.id === id)
      const j = i + d
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function mergeSelected() {
    const sel = videos.filter((v) => v.selected)
    if (sel.length === 0 || merging) return
    setMerging(true)
    try {
      await api('/api/ghep/merge', {
        paths: sel.map((v) => v.path),
        music,
        loopAudio,
        muteOrig,
        vol,
        loopVideo,
        targetSec,
        out_dir: folder ? `${folder.replace(/[\\/]+$/, '')}\\Ghep` : '',
      })
      setToast(`Đang ghép ${sel.length} clip…`)
    } catch (e) {
      setToast(errText(e))
    } finally {
      setMerging(false)
    }
  }

  const allChecked = videos.length > 0 && videos.every((v) => v.selected)
  const selectedCount = videos.filter((v) => v.selected).length

  return (
    <div className="gv-root">
      <header className="gv-top">
        <div className="gv-top-left">
          <div className="gv-title">
            <span className="gv-title-ico" aria-hidden>
              ▦
            </span>
            Ghép Video
          </div>
          <div className="gv-crumb">Nối clip · nhạc nền · lặp video (ffmpeg)</div>
        </div>
        <div className="gv-top-actions">
          <div className="gv-settings-wrap" ref={settingsRef}>
            <button
              type="button"
              className={`gv-btn ${settingsOpen ? 'on' : ''}`}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              ⚙ Cài đặt
              <span className="gv-caret">▾</span>
            </button>
            {settingsOpen && (
              <div className="gv-settings-menu">
                <div className="gv-settings-label">Thư mục video đầu vào</div>
                <div className="gv-folder-row">
                  <input
                    className="gv-folder-input"
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                    placeholder="K:\Output\Videos"
                  />
                </div>
                <button type="button" className="gv-btn block" onClick={() => void chooseFolder()}>
                  📁 Chọn thư mục…
                </button>
                <div className="gv-settings-hint">
                  Quét mọi video (.mp4 .mov .mkv .webm…) trong thư mục, xếp theo tên. Video ghép lưu vào
                  thư mục con <b>Ghep</b>.
                </div>
                <button
                  type="button"
                  className="gv-btn block"
                  onClick={() => {
                    setSettingsOpen(false)
                    onOpenSettings?.()
                  }}
                >
                  Mở tab Cài đặt ứng dụng
                </button>
              </div>
            )}
          </div>
          <button type="button" className="gv-btn primary" onClick={() => void reload()} disabled={loadState === 'loading'}>
            {loadState === 'loading' ? '… Đang tải' : '↻ Tải lại'}
          </button>
        </div>
      </header>

      <section className="gv-cfg">
        <div className="gv-cfg-col">
          <div className="gv-cfg-head">
            <span className="gv-cfg-ico">♪</span>
            Audio Settings
          </div>

          <label className="gv-field-label">Thêm nhạc nền:</label>
          <div className="gv-music-row">
            <button
              type="button"
              className="gv-music-btn"
              onClick={() => void chooseMusic()}
              title={music}
            >
              🎵 {music ? baseName(music) : 'Chọn file nhạc'}
            </button>
            {music && (
              <button type="button" className="gv-icon-btn" title="Xóa nhạc" onClick={clearMusic}>
                ✕
              </button>
            )}
          </div>

          <label className="gv-check">
            <input
              type="checkbox"
              checked={loopAudio}
              onChange={(e) => setLoopAudio(e.target.checked)}
            />
            <span>
              Loop audio <em>(lặp audio theo độ dài video)</em>
            </span>
          </label>

          {music && (
            <>
              <label className="gv-check">
                <input
                  type="checkbox"
                  checked={muteOrig}
                  onChange={(e) => setMuteOrig(e.target.checked)}
                />
                <span>
                  Tắt tiếng video gốc <em>(chỉ giữ nhạc nền)</em>
                </span>
              </label>
              <div className="gv-vol">
                <div className="gv-vol-lab">
                  <span>Âm lượng nhạc nền</span>
                  <span className="gv-vol-val">{vol}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={vol}
                  onChange={(e) => setVol(Number(e.target.value))}
                />
              </div>
            </>
          )}

          <div className="gv-tips">
            <div className="gv-tips-ico">💡</div>
            <div className="gv-tips-body">
              <div>
                <b>Gợi ý:</b> Bạn có thể thêm nhạc nền và điều chỉnh độ dài video theo ý muốn
              </div>
              <div>
                <b>Loop Audio:</b> Nhạc sẽ lặp lại cho đủ độ dài video
              </div>
              <div>
                <b>Tắt tiếng video gốc:</b> Chỉ giữ nhạc nền, loại bỏ âm thanh gốc
              </div>
              <div>
                <b>Âm lượng nhạc nền:</b> Điều chỉnh từ 0% đến 200%
              </div>
              <div>
                <b>Loop Video:</b> Video sẽ lặp lại để đạt thời gian mong muốn
              </div>
            </div>
          </div>
        </div>

        <div className="gv-cfg-col">
          <div className="gv-cfg-head">
            <span className="gv-cfg-ico">↻</span>
            Video Loop Settings
          </div>

          <label className="gv-check">
            <input
              type="checkbox"
              checked={loopVideo}
              onChange={(e) => setLoopVideo(e.target.checked)}
            />
            <span>
              Loop video <em>(lặp video theo thời gian tùy chỉnh)</em>
            </span>
          </label>

          {loopVideo && (
            <div className="gv-target">
              <label className="gv-field-label">Thời lượng mục tiêu (giây)</label>
              <div className="gv-target-row">
                <input
                  type="number"
                  min={1}
                  max={3600}
                  value={targetSec}
                  onChange={(e) => setTargetSec(Math.max(1, Number(e.target.value) || 1))}
                  className="gv-num"
                />
                <span className="gv-muted">Video sẽ lặp đến khi đủ {targetSec}s</span>
              </div>
            </div>
          )}

          <div className="gv-folder-card">
            <div className="gv-field-label">Thư mục đang quét</div>
            <div className="gv-folder-path" title={folder}>
              📁 {folder || '(chưa đặt)'}
            </div>
          </div>
        </div>
      </section>

      {loadState === 'error' && (
        <div className="gv-error">
          Không thể tải danh sách video: {loadErr || 'kiểm tra thư mục video và thử lại.'}
        </div>
      )}

      <section className="gv-list">
        {loadState === 'loading' ? (
          <div className="gv-empty">
            <div className="gv-empty-ico">⏳</div>
            <div className="gv-empty-title">Đang tải thư mục…</div>
          </div>
        ) : loadState === 'ok' && videos.length > 0 ? (
          <>
            <div className="gv-list-head">
              <div className="gv-list-title">
                <label className="gv-check tight">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                  <span>
                    Danh sách video ({videos.length})
                  </span>
                </label>
              </div>
              <div className="gv-list-actions">
                <span className="gv-muted">
                  Tổng {fmtDur(videos.filter((v) => v.selected).reduce((t, v) => t + v.dur, 0))}
                </span>
                <button
                  type="button"
                  className="gv-btn primary"
                  disabled={selectedCount === 0 || merging}
                  onClick={mergeSelected}
                >
                  {merging ? '… Đang ghép' : `▶ Ghép đã chọn (${selectedCount})`}
                </button>
              </div>
            </div>
            <div className="gv-table-wrap">
              <table className="gv-table">
                <thead>
                  <tr>
                    <th className="col-check" />
                    <th className="col-num">#</th>
                    <th>Tên file</th>
                    <th className="col-dur">Độ dài</th>
                    <th className="col-st">Khung</th>
                    <th className="col-st" />
                  </tr>
                </thead>
                <tbody>
                  {videos.map((v, i) => (
                    <tr key={v.id} className={v.selected ? 'sel' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={v.selected}
                          onChange={(e) =>
                            setVideos((prev) =>
                              prev.map((x) =>
                                x.id === v.id ? { ...x, selected: e.target.checked } : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>{i + 1}</td>
                      <td className="gv-name" title={v.path}>🎬 {v.name}</td>
                      <td>{fmtDur(v.dur)}</td>
                      <td>
                        <span className="gv-st ready">
                          {v.w}×{v.h}
                        </span>
                      </td>
                      <td>
                        <button type="button" className="gv-icon-btn" title="Lên" onClick={() => move(v.id, -1)}>
                          ↑
                        </button>
                        <button type="button" className="gv-icon-btn" title="Xuống" onClick={() => move(v.id, 1)}>
                          ↓
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="gv-empty">
            <div className="gv-empty-ico">🎞️</div>
            <div className="gv-empty-title">Không có video nào trong thư mục</div>
            <div className="gv-empty-desc">
              Vui lòng tạo video hoặc kiểm tra cấu hình thư mục
            </div>
            <div className="gv-empty-sub">
              Không thể tải thư mục hoặc thư mục trống. Kiểm tra đường dẫn trong Cài đặt.
            </div>
            <button
              type="button"
              className="gv-btn"
              onClick={() => {
                setSettingsOpen(true)
              }}
            >
              ⚙ Mở Cài đặt thư mục
            </button>
          </div>
        )}
      </section>

      {lastJob && (
        <section className="gv-result">
          <div className="gv-list-head">
            <div className="gv-list-title">
              {lastJob.status === 'dang_chay' ? '⏳' : lastJob.status === 'xong' ? '✅' : '❌'} Ghép gần nhất ·{' '}
              {lastJob.msg || 'Đang chạy…'}
            </div>
            {lastJob.status === 'xong' && lastJob.out_path && (
              <div className="gv-list-actions">
                <span className="gv-muted">{baseName(lastJob.out_path)}</span>
                <button type="button" className="gv-btn" onClick={() => openFolder(lastJob.out_dir || '')}>
                  📂 Mở thư mục
                </button>
              </div>
            )}
          </div>
          {lastJob.status === 'xong' && lastJob.out_path && (
            <video className="gv-preview" src={fileUrl(lastJob.out_path)} controls />
          )}
        </section>
      )}

      {toast && <div className="gv-toast">{toast}</div>}
    </div>
  )
}
