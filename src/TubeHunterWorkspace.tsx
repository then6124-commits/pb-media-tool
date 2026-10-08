import { useEffect, useMemo, useState } from 'react'
import './tube_hunter.css'

type PaneId = 'fast' | 'video' | 'channel' | 'subkw'
type HuntMode = 'keyword' | 'ai'

type Niche = {
  id: string
  title: string
  query: string
  icon: string
}

const LS_PANE = 'pb.tube.pane'
const LS_MODE = 'pb.tube.mode'
const LS_REGION = 'pb.tube.region'
const LS_QUERY = 'pb.tube.query'

const NAV: { id: PaneId; title: string; sub: string; icon: string }[] = [
  { id: 'fast', title: 'Săn Nhanh Siêu Tốc', sub: 'Top Kênh & Video Better', icon: '⚡' },
  { id: 'video', title: 'Tìm Video', sub: 'Video Đột Biến, High V/S', icon: '▶' },
  { id: 'channel', title: 'Tìm Kênh', sub: 'Chuẩn Ngách & Phân Tích', icon: '🏆' },
  { id: 'subkw', title: 'Từ Khóa Ngách Con', sub: 'YouTube Suggestions', icon: '🧭' },
]

const REGIONS = [
  { id: 'US', label: 'US - United States' },
  { id: 'VN', label: 'VN - Việt Nam' },
  { id: 'GB', label: 'GB - United Kingdom' },
  { id: 'CA', label: 'CA - Canada' },
  { id: 'AU', label: 'AU - Australia' },
  { id: 'IN', label: 'IN - India' },
  { id: 'DE', label: 'DE - Germany' },
  { id: 'JP', label: 'JP - Japan' },
]

const HOT_NICHES: Niche[] = [
  { id: 'finance', title: 'Tài Chính & Đầu Tư US', query: 'personal finance investing documentary', icon: '💰' },
  { id: 'psycho', title: 'Tâm Lý Học & Khắc Kỷ', query: 'dark psychology stoicism lessons', icon: '🧠' },
  { id: 'crime', title: 'Vụ Án Kỳ Bí Chưa Lời Giải', query: 'unsolved mystery crime documentary', icon: '🔍' },
  { id: 'biz', title: 'Đế Chế Thương Trường', query: 'business breakdown company failure', icon: '🏛️' },
  { id: 'science', title: '3D Khoa Học & Mô Phỏng', query: 'how things work 3d simulation', icon: '🔬' },
  { id: 'horror', title: 'Truyện Kinh Dị Rùng Rợn', query: 'scary horror animated stories', icon: '🕯️' },
]

const AI_SAMPLES = [
  { icon: '🔥', text: 'Kênh Faceless AI mới lập ≤ 3 tháng bão view', color: 'orange' },
  { icon: '💎', text: 'Ngách Tài chính & Đầu tư US RPM cao', color: 'blue' },
  { icon: '📚', text: 'Tóm tắt phim & Anime ngách nhỏ viral đột biến', color: 'purple' },
  { icon: '🧠', text: 'Tâm lý học hành vi & Triết lý khắc kỷ (Stoicism)', color: 'pink' },
  { icon: '🕵️', text: 'Vụ án kỳ bí & Lịch sử đen', color: 'yellow' },
]

const FILTERS = [
  { id: 'burst', label: 'Đột biến', value: 'Tất cả (≥ 0x)', icon: '🔥' },
  { id: 'time', label: 'Thời gian', value: '1 năm qua', icon: '📅' },
  { id: 'dur', label: 'Thời lượng', value: 'Mọi thời lượng', icon: '⏱' },
  { id: 'sample', label: 'Mẫu quét', value: '100 video', icon: '⚙️' },
]

function loadStr(key: string, fallback: string) {
  try {
    const raw = localStorage.getItem(key)
    if (raw != null) return JSON.parse(raw) as string
  } catch {
    /* ignore */
  }
  return fallback
}

function saveStr(key: string, val: string) {
  try {
    localStorage.setItem(key, JSON.stringify(val))
  } catch {
    /* ignore */
  }
}

export default function TubeHunterWorkspace() {
  const [pane, setPane] = useState<PaneId>(() => (loadStr(LS_PANE, 'fast') as PaneId) || 'fast')
  const [mode, setMode] = useState<HuntMode>(() => (loadStr(LS_MODE, 'keyword') as HuntMode) || 'keyword')
  const [region, setRegion] = useState(() => loadStr(LS_REGION, 'US'))
  const [query, setQuery] = useState(() => loadStr(LS_QUERY, ''))
  const [filterOpen, setFilterOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [results, setResults] = useState<
    { id: number; title: string; meta: string; tag: string; url: string; download?: boolean }[]
  >([])
  const [subSuggestions, setSubSuggestions] = useState<string[]>([])

  useEffect(() => { saveStr(LS_PANE, pane) }, [pane])
  useEffect(() => { saveStr(LS_MODE, mode) }, [mode])
  useEffect(() => { saveStr(LS_REGION, region) }, [region])
  useEffect(() => { saveStr(LS_QUERY, query) }, [query])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  const showModeToggle = pane === 'fast' || pane === 'video' || pane === 'channel'

  const placeholder = useMemo(() => {
    if (pane === 'subkw') return 'Nhập từ khóa hạt giống để khám phá các ngách con...'
    if (mode === 'ai') {
      return 'Nhập yêu cầu bằng tiếng Việt (VD: ngách Faceless AI mới lập ≤ 3 tháng bão view, ngách tài chính US RPM cao, tâm lý học bí ẩn)...'
    }
    if (pane === 'video') return 'Nhập ngách tìm video (VD: unsolved crime, dark psychology, stoicism)...'
    if (pane === 'channel') return 'Nhập tên ngách tìm kênh (VD: 3d animation, faceless finance)...'
    return 'Nhập từ khóa ngách (VD: dark psychology, personal finance, stoicism...) để săn nhanh...'
  }, [pane, mode])

  const primaryLabel = useMemo(() => {
    if (pane === 'subkw') return 'Khám Phá Ngách Con'
    if (mode === 'ai') return 'AI Săn Ngách'
    if (pane === 'video') return 'Tìm Video'
    if (pane === 'channel') return 'Tìm Kênh'
    return 'Săn Nhanh Siêu Tốc'
  }, [pane, mode])

  const primaryIcon = useMemo(() => {
    if (pane === 'subkw') return '🧭'
    if (mode === 'ai') return '✨'
    if (pane === 'video') return '🔥'
    if (pane === 'channel') return '🔍'
    return '⚡'
  }, [pane, mode])

  function flash(msg: string) {
    setToast(msg)
  }

  function applyNiche(n: Niche) {
    setQuery(n.query)
    flash(`Đã chọn ngách: ${n.title}`)
  }

  function applyAiSample(text: string) {
    setQuery(text)
    setMode('ai')
    flash('Đã dán gợi ý AI')
  }

  /** Số gọn kiểu YouTube: 1.2M, 480K. */
  function gon(n: number) {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
    if (n >= 1e3) return `${Math.round(n / 1e3)}K`
    return String(n)
  }
  function phut(s: number) {
    if (!s) return '—'
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const ss = s % 60
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
  }

  type TubeVideo = { id: string; title: string; url: string; channel: string; channel_url: string; views: number; duration: number }

  /** Dữ liệu YouTube THẬT qua cầu nối (yt-dlp + gợi ý tìm kiếm công khai). */
  async function runSearch(qIn?: string, paneIn?: PaneId) {
    const q = (qIn ?? query).trim()
    const p = paneIn ?? pane
    if (!q) {
      flash('Nhập từ khóa / yêu cầu trước')
      return
    }
    setScanning(true)
    try {
      if (p === 'subkw') {
        const r = await fetch(`/api/tube/suggest?q=${encodeURIComponent(q)}&gl=${region}`).then((x) => x.json())
        if (!r.ok) throw new Error(r.error || 'lỗi')
        setSubSuggestions(r.items)
        setResults([])
        return
      }
      const n = p === 'fast' ? 50 : 30
      const r = await fetch(`/api/tube/search?q=${encodeURIComponent(q)}&n=${n}`).then((x) => x.json())
      if (!r.ok) throw new Error(r.error || 'lỗi')
      const vids = (r.items as TubeVideo[]).filter((v) => v && v.id)
      setSubSuggestions([])
      if (p === 'channel') {
        const kenh = new Map<string, { name: string; url: string; views: number; n: number; top: number }>()
        for (const v of vids) {
          const k = v.channel_url || v.channel
          const c = kenh.get(k) || { name: v.channel, url: v.channel_url, views: 0, n: 0, top: 0 }
          c.views += v.views
          c.n += 1
          c.top = Math.max(c.top, v.views)
          kenh.set(k, c)
        }
        setResults(
          [...kenh.values()]
            .sort((a, b) => b.views - a.views)
            .map((c, i) => ({
              id: i + 1,
              title: c.name || '(không rõ kênh)',
              meta: `${c.n} video trong kết quả · tổng ${gon(c.views)} views · video cao nhất ${gon(c.top)}`,
              tag: i < 3 ? 'TOP' : `#${i + 1}`,
              url: c.url,
            })),
        )
      } else {
        const sorted = p === 'fast' ? [...vids].sort((a, b) => b.views - a.views) : vids
        const max = Math.max(1, ...sorted.map((v) => v.views))
        setResults(
          sorted.map((v, i) => ({
            id: i + 1,
            title: v.title,
            meta: `${gon(v.views)} views · ${phut(v.duration)} · ${v.channel}`,
            tag: v.views >= max * 0.5 ? 'HOT' : v.duration && v.duration <= 60 ? 'SHORT' : `#${i + 1}`,
            url: v.url,
            download: true,
          })),
        )
      }
      flash(`${primaryLabel}: ${vids.length} kết quả`)
    } catch (e) {
      flash(`Không tìm được: ${(e as Error).message}`)
    } finally {
      setScanning(false)
    }
  }

  async function taiVe(url: string) {
    try {
      const r = await fetch('/api/util/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }).then((x) => x.json())
      if (!r.ok) throw new Error(r.error || 'lỗi')
      flash('Đang tải về Videos\\PB_MEDIA\\Tai_ve…')
    } catch (e) {
      flash(`Không tải được: ${(e as Error).message}`)
    }
  }

  function resetFilters() {
    setFilterOpen(false)
    flash('Bộ lọc chưa áp dụng — kết quả đang xếp theo lượt xem')
  }

  function scanLink(label: string) {
    const p = pane === 'subkw' ? 'video' : pane
    setQuery(label)
    setPane(p)
    void runSearch(label, p)
  }

  return (
    <div className="th-root">
      <aside className="th-side">
        <div className="th-brand">
          <div className="th-brand-ico">🔥</div>
          <div>
            <div className="th-brand-row">
              <span className="th-brand-name">TUBE HUNTER</span>
              <span className="th-pro">PRO</span>
            </div>
            <div className="th-brand-sub">Săn Ngách & Video Đột Biến</div>
          </div>
        </div>

        <nav className="th-nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`th-nav-item ${pane === n.id ? 'on' : ''}`}
              onClick={() => {
                setPane(n.id)
                setResults([])
                setSubSuggestions([])
              }}
            >
              <span className="th-nav-ico">{n.icon}</span>
              <span className="th-nav-text">
                <b>{n.title}</b>
                <small>{n.sub}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="th-region">
          <div className="th-region-label">KHU VỰC MỤC TIÊU</div>
          <label className="th-region-select">
            <span>🌐</span>
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>
        </div>
      </aside>

      <section className="th-main">
        {showModeToggle && (
          <div className="th-mode-row">
            <div className="th-mode-tabs">
              <button
                type="button"
                className={`th-mode ${mode === 'keyword' ? 'on' : ''}`}
                onClick={() => setMode('keyword')}
              >
                🔍 Tìm Từ Khóa Ngách
              </button>
              <button
                type="button"
                className={`th-mode ${mode === 'ai' ? 'on' : ''}`}
                onClick={() => setMode('ai')}
              >
                ✨ Săn Ngách Bằng AI
              </button>
            </div>
            <div className="th-mode-hint">
              {mode === 'ai'
                ? 'Nhập ngôn ngữ tự nhiên — AI tự phân tích, trích xuất bộ lọc & mở rộng ngách con'
                : 'Quét chính xác theo từ khóa YouTube & bộ lọc chỉ định'}
            </div>
          </div>
        )}

        <div className="th-search-row">
          <div className="th-search">
            <span className="th-search-ico">🔍</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
              placeholder={placeholder}
            />
            {(pane === 'video' || pane === 'channel') && mode === 'keyword' && (
              <button
                type="button"
                className="th-filter-btn"
                onClick={() => setFilterOpen((v) => !v)}
                title="Bộ lọc"
              >
                ⚙️ Bộ Lọc
                <span className="th-badge">4</span>
              </button>
            )}
          </div>
          <button
            type="button"
            className="th-primary"
            onClick={() => void runSearch()}
            disabled={scanning}
          >
            <span>{primaryIcon}</span> {scanning ? 'Đang quét…' : primaryLabel}
          </button>
        </div>

        {mode === 'ai' && showModeToggle ? (
          <div className="th-ai-samples">
            <span className="th-chips-label">Gợi ý mẫu AI:</span>
            {AI_SAMPLES.map((s) => (
              <button
                key={s.text}
                type="button"
                className={`th-ai-pill ${s.color}`}
                onClick={() => applyAiSample(s.text)}
              >
                <span>{s.icon}</span> {s.text}
              </button>
            ))}
          </div>
        ) : (
          <div className="th-hot-row">
            <span className="th-chips-label">Ngách hot:</span>
            {HOT_NICHES.map((n) => (
              <button
                key={n.id}
                type="button"
                className="th-hot-chip"
                onClick={() => applyNiche(n)}
              >
                <span>{n.icon}</span> {n.title}
              </button>
            ))}
          </div>
        )}

        {(pane === 'video' || pane === 'channel') && mode === 'keyword' && filterOpen && (
          <div className="th-filters">
            {FILTERS.map((f) => (
              <label key={f.id} className="th-filter">
                <span className="th-filter-ico">{f.icon}</span>
                <span className="th-filter-meta">
                  <small>{f.label}</small>
                  <b>{f.value}</b>
                </span>
                <span className="th-caret">▾</span>
              </label>
            ))}
            <button type="button" className="th-reset" onClick={resetFilters}>↺ Mặc định</button>
          </div>
        )}

        <div className="th-body">
          {scanning && (
            <div className="th-scanning">Đang quét YouTube · khu vực {region}…</div>
          )}

          {!scanning && results.length > 0 && pane !== 'subkw' && (
            <div className="th-results">
              <div className="th-results-head">
                <b>Kết quả ({results.length})</b>
                <button type="button" className="th-linkish" onClick={() => setResults([])}>Xóa</button>
              </div>
              {results.map((r) => (
                <div key={r.id} className="th-result-card">
                  <div className="th-result-thumb">{r.tag}</div>
                  <div className="th-result-body">
                    <b>{r.title}</b>
                    <small>{r.meta}</small>
                  </div>
                  {r.download && (
                    <button type="button" className="th-mini" onClick={() => void taiVe(r.url)}>⬇ Tải</button>
                  )}
                  <button
                    type="button"
                    className="th-mini"
                    disabled={!r.url}
                    onClick={() => r.url && window.open(r.url, '_blank', 'noopener')}
                  >
                    Mở
                  </button>
                </div>
              ))}
            </div>
          )}

          {!scanning && pane === 'subkw' && (
            <div className="th-subkw">
              <div className="th-subkw-head">
                <span className="th-subkw-ico">🧭</span>
                <div>
                  <b>YouTube Search Suggestions cho từ khóa: &apos;{query.trim() || 'Nhập từ khóa...'}&apos;</b>
                  <p>Các cụm từ khóa ngách con (Long-tail Sub-niches) mà người xem đang thực sự tìm kiếm trên YouTube. Bấm vào bất kỳ từ khóa nào để quét ngay Video Đột Biến!</p>
                </div>
              </div>
              {subSuggestions.length === 0 ? (
                <div className="th-empty-box">
                  Nhập từ khóa ở thanh trên và nhấn &apos;Khám Phá Từ Khóa&apos; để xem danh sách gợi ý.
                </div>
              ) : (
                <div className="th-sug-grid">
                  {subSuggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="th-sug"
                      onClick={() => {
                        setPane('video')
                        setQuery(s)
                        void runSearch(s, 'video')
                      }}
                    >
                      {s} <span>→</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!scanning && results.length === 0 && pane === 'fast' && (
            <div className="th-empty th-empty-fast">
              <div className="th-empty-ico red">⚡</div>
              <h2>Săn Nhanh Siêu Tốc: Kênh Mới & Video Bùng Nổ</h2>
              <p>
                Tự động săn lùng kênh non trẻ (≤ 6 tháng) và video bão view có tỷ lệ đột biến cao so với subs để nhận diện đúng ngách tiềm năng.
              </p>
              <div className="th-niche-grid">
                {HOT_NICHES.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className="th-niche-card"
                    onClick={() => applyNiche(n)}
                  >
                    <div className="th-niche-top">
                      <span>{n.icon}</span>
                      <b>{n.title}</b>
                      <em>→</em>
                    </div>
                    <small>&quot;{n.query}&quot;</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!scanning && results.length === 0 && (pane === 'video' || pane === 'channel') && (
            <div className="th-empty th-empty-discover">
              <div className={`th-empty-ico ${pane === 'video' ? 'flame' : 'trophy'}`}>
                {pane === 'video' ? '🔥' : '🏆'}
              </div>
              <h2>Khám Phá Video Đột Biến & Ngách Triệu View</h2>
              <p>
                Công cụ giúp cả người mới lẫn chuyên nghiệp tìm ngách dễ nhân bản và bóc tách công thức video thành công chỉ với 1 click.
              </p>
              <div className="th-feature-row">
                <div className="th-feature">
                  <div className="th-feature-top">
                    <span>💎</span>
                    <b>Săn Ngách Kim Cương</b>
                    <em className="tag blue">Chuẩn Vàng</em>
                  </div>
                  <p>Lọc kênh mới (≤ 6 tháng) có view cao để nhận diện ngách vàng.</p>
                  <button type="button" className="th-linkish" onClick={() => scanLink('personal finance')}>
                    Quét ngách &apos;Personal Finance&apos; →
                  </button>
                </div>
                <div className="th-feature">
                  <div className="th-feature-top">
                    <span>🔥</span>
                    <b>Săn Video Siêu Đột Biến</b>
                    <em className="tag red">≥ 10x Subs</em>
                  </div>
                  <p>Video view gấp 10–50 lần subscribers — dấu hiệu viral mạnh.</p>
                  <button type="button" className="th-linkish" onClick={() => scanLink('dark psychology')}>
                    Quét &apos;Dark Psychology&apos; →
                  </button>
                </div>
                <div className="th-feature">
                  <div className="th-feature-top">
                    <span>📈</span>
                    <b>Kênh Non Trẻ Bứt Phá</b>
                    <em className="tag green">≤ 6 Tháng</em>
                  </div>
                  <p>Kênh mới lập đã kiếm tốt — cơ hội clone ngách sớm.</p>
                  <button type="button" className="th-linkish" onClick={() => scanLink('unsolved mystery')}>
                    Quét &apos;Unsolved Mystery&apos; →
                  </button>
                </div>
              </div>
              <div className="th-foot-points">
                <span>⚡ Lọc chuẩn xác 100% tiếng Việt & Quốc tế</span>
                <span>🚀 Xếp hạng Vận tốc View & Bùng nổ 3s Hook</span>
                <span>📄 Bóc tách Transcript & Hook 1-click</span>
              </div>
            </div>
          )}
        </div>

        {toast && <div className="th-toast">{toast}</div>}
        <div className="th-footnote">Tìm qua yt-dlp (không cần API key) · tải video về Videos\\PB_MEDIA\\Tai_ve</div>
      </section>
    </div>
  )
}
