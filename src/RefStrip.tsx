import { useState } from 'react'
import { Ico } from './SettingsPanes'

export type RefItem = { id: number; name: string; tag: string; path: string }

/** Mã ảnh đọc từ tên file — cùng luật với bridge (pb_bridge.ma_cua_anh):
 *  CHAR_01_O4_lily.png → CHAR_01_O4 · GUEST_01_joe.png → GUEST_01 · không có mã → cả tên file. */
export function maAnh(name: string): string {
  const goc = name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  const m = /(?<![A-Za-z0-9])[A-Za-z]{2,12}_\d{1,3}(?:_[A-Za-z]{1,3}\d{1,3})*(?![0-9])/.exec(goc)
  return (m ? m[0] : goc).toUpperCase()
}

const fileUrl = (p: string) => `/api/file?path=${encodeURIComponent(p)}`

/**
 * Khung «Ảnh Tham Chiếu» kiểu tool cũ: + Thêm / − Xóa (đã chọn) / Xóa hết, dải thẻ ảnh có
 * số thứ tự, ✎ đổi tên file, 🗑 bỏ, + gắn @MÃ vào prompt, bấm ảnh để phóng to.
 */
export function RefStrip({
  refs,
  setRefs,
  onAdd,
  onFiles,
  onInsert,
  flash,
}: {
  refs: RefItem[]
  setRefs: (fn: (prev: RefItem[]) => RefItem[]) => void
  onAdd: () => void
  onFiles: (files: File[]) => void
  onInsert: (tag: string) => void
  flash: (msg: string) => void
}) {
  const [chon, setChon] = useState<number[]>([])
  const [phongTo, setPhongTo] = useState<RefItem | null>(null)
  const [keo, setKeo] = useState(false)

  const doiTen = async (r: RefItem) => {
    const cu = r.name.replace(/\.[^.]+$/, '')
    const moi = window.prompt('Tên file mới (vd CHAR_01_O4_lily) — mã lấy từ tên file:', cu)
    if (!moi || moi.trim() === cu) return
    try {
      const res = await fetch('/api/refs/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: r.path, name: moi.trim() }),
      })
      const j = (await res.json()) as { ok: boolean; path?: string; name?: string; tag?: string; error?: string }
      if (!j.ok || !j.path) throw new Error(j.error || 'không đổi được tên')
      setRefs((prev) => prev.map((x) => (x.id === r.id ? { ...x, path: j.path!, name: j.name!, tag: j.tag! } : x)))
      flash(`Đã đổi tên → @${maAnh(j.name!)}`)
    } catch (e) {
      flash(`Không đổi được tên: ${(e as Error).message}`)
    }
  }

  return (
    <div
      className={`rs-box${keo ? ' drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setKeo(true)
      }}
      onDragLeave={() => setKeo(false)}
      onDrop={(e) => {
        e.preventDefault()
        setKeo(false)
        const fs = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'))
        if (fs.length) onFiles(fs)
      }}
    >
      <div className="rs-head">
        <Ico n="image" size={16} />
        <strong>Ảnh Tham Chiếu</strong>
        <span className="rs-count">({refs.length} ảnh)</span>
        <span className="rs-hint">bấm ảnh để phóng to · trên thẻ: ✎ đổi tên file · 🗑 bỏ · + gắn vào prompt (@MÃ)</span>
      </div>
      <div className="rs-actions">
        <button type="button" className="rs-btn add" onClick={onAdd}>
          + Thêm
        </button>
        <button
          type="button"
          className="rs-btn"
          disabled={!chon.length}
          onClick={() => {
            setRefs((prev) => prev.filter((x) => !chon.includes(x.id)))
            setChon([])
          }}
        >
          − Xóa{chon.length ? ` (${chon.length})` : ''}
        </button>
        <button
          type="button"
          className="rs-btn danger"
          disabled={!refs.length}
          onClick={() => {
            if (window.confirm(`Bỏ hết ${refs.length} ảnh tham chiếu khỏi danh sách?`)) {
              setRefs(() => [])
              setChon([])
            }
          }}
        >
          Xóa hết
        </button>
      </div>
      {refs.length === 0 ? (
        <div className="rs-empty" onClick={onAdd}>
          Chưa có ảnh — bấm <b>+ Thêm</b> hoặc kéo thả ảnh vào đây. Đặt tên file theo mã (vd <code>CHAR_01_O4_lily.png</code>)
          để prompt gọi <code>@CHAR_01_O4</code>.
        </div>
      ) : (
        <div className="rs-strip">
          {refs.map((r, i) => {
            const ma = maAnh(r.name || r.path)
            const on = chon.includes(r.id)
            return (
              <div key={r.id} className={`rs-card${on ? ' on' : ''}`} title={r.name}>
                <div className="rs-card-top">
                  <button
                    type="button"
                    className="rs-num"
                    title="Chọn để xoá"
                    onClick={() => setChon((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]))}
                  >
                    {i + 1}
                  </button>
                  <span className="grow" />
                  <button type="button" title="Đổi tên file" onClick={() => void doiTen(r)}>
                    <Ico n="pencil" size={13} />
                  </button>
                  <button type="button" title="Bỏ ảnh này" onClick={() => setRefs((p) => p.filter((x) => x.id !== r.id))}>
                    <Ico n="trash" size={13} />
                  </button>
                  <button type="button" title={`Gắn @${ma} vào prompt`} onClick={() => onInsert(`@${ma}`)}>
                    +
                  </button>
                </div>
                <img src={fileUrl(r.path)} alt={ma} loading="lazy" onClick={() => setPhongTo(r)} />
                <div className="rs-tag">@{ma}</div>
              </div>
            )
          })}
        </div>
      )}
      {phongTo && (
        <div className="rs-zoom" onClick={() => setPhongTo(null)}>
          <img src={fileUrl(phongTo.path)} alt="" />
          <div className="rs-zoom-cap">
            @{maAnh(phongTo.name || phongTo.path)} · {phongTo.name}
          </div>
        </div>
      )}
    </div>
  )
}
