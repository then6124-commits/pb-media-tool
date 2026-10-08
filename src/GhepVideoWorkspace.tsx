import { useEffect, useRef, useState } from 'react'
import './ghep.css'

type Props = {
  onOpenSettings?: () => void
}

type LoadState = 'empty' | 'error' | 'loading' | 'ok'

type VideoItem = {
  id: number
  name: string
  dur: string
  selected: boolean
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

const DEMO_VIDEOS: VideoItem[] = [
  { id: 1, name: 'scene_01.mp4', dur: '0:08', selected: true },
  { id: 2, name: 'scene_02.mp4', dur: '0:10', selected: true },
  { id: 3, name: 'scene_03.mp4', dur: '0:07', selected: false },
]

export default function GhepVideoWorkspace({ onOpenSettings }: Props) {
  const [music, setMusic] = useState(() => loadStr(LS_MUSIC, ''))
  const [loopAudio, setLoopAudio] = useState(() => loadBool(LS_LOOP_AUDIO, true))
  const [loopVideo, setLoopVideo] = useState(() => loadBool(LS_LOOP_VIDEO, false))
  const [muteOrig, setMuteOrig] = useState(() => loadBool(LS_MUTE, true))
  const [vol, setVol] = useState(() => loadNum(LS_VOL, 100))
  const [targetSec, setTargetSec] = useState(() => loadNum(LS_TARGET, 60))
  const [folder, setFolder] = useState(() => loadStr(LS_FOLDER, 'K:\\Output\\Videos'))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loadState, setLoadState] = useState<LoadState>('error')
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const musicRef = useRef<HTMLInputElement>(null)
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

  function reload() {
    setLoadState('loading')
    setVideos([])
    window.setTimeout(() => {
      // Mock: folder empty / missing → error + empty (matches SuperVeo default)
      const ok = folder.trim().toLowerCase().includes('demo')
      if (ok) {
        setVideos(DEMO_VIDEOS.map((v) => ({ ...v })))
        setLoadState('ok')
        setToast('Đã tải danh sách video (mock).')
      } else {
        setVideos([])
        setLoadState('error')
        setToast('Không tải được thư mục video — kiểm tra Cài đặt.')
      }
    }, 450)
  }

  function pickMusic(file: File | null) {
    if (!file) return
    setMusic(file.name)
    setToast(`Đã chọn nhạc: ${file.name}`)
  }

  function clearMusic() {
    setMusic('')
    if (musicRef.current) musicRef.current.value = ''
  }

  function toggleAll(checked: boolean) {
    setVideos((prev) => prev.map((v) => ({ ...v, selected: checked })))
  }

  function mergeSelected() {
    const sel = videos.filter((v) => v.selected)
    if (sel.length === 0 || merging) return
    setMerging(true)
    setToast(`Đang ghép ${sel.length} clip (mock)…`)
    window.setTimeout(() => {
      setMerging(false)
      setToast(`Đã ghép xong ${sel.length} clip (mock UI).`)
    }, 1200)
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
          <div className="gv-crumb">Nối clip · nhạc nền · mock UI</div>
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
                <div className="gv-settings-hint">
                  Gõ đường dẫn có chữ <b>demo</b> rồi bấm Tải lại để xem danh sách mock.
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
          <button type="button" className="gv-btn primary" onClick={reload} disabled={loadState === 'loading'}>
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
              onClick={() => musicRef.current?.click()}
            >
              🎵 {music ? music : 'Chọn file nhạc'}
            </button>
            {music && (
              <button type="button" className="gv-icon-btn" title="Xóa nhạc" onClick={clearMusic}>
                ✕
              </button>
            )}
            <input
              ref={musicRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg"
              hidden
              onChange={(e) => pickMusic(e.target.files?.[0] || null)}
            />
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
                <span className="gv-muted">Video sẽ lặp đến khi đủ {targetSec}s (mock)</span>
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
          Không thể tải danh sách video. Vui lòng kiểm tra thư mục video và thử lại.
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
                    <th className="col-st">Trạng thái</th>
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
                      <td className="gv-name">🎬 {v.name}</td>
                      <td>{v.dur}</td>
                      <td>
                        <span className="gv-st ready">Sẵn</span>
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

      {toast && <div className="gv-toast">{toast}</div>}
    </div>
  )
}
