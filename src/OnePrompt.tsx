import { useEffect, useState } from 'react'

/** Ô tick «Cả ô là 1 prompt»: bật thì toàn bộ nội dung ô nhập là MỘT prompt (giữ nguyên xuống dòng). */
export function useOnePrompt(key: string): [boolean, (v: boolean) => void] {
  const lsKey = `pb.oneprompt.${key}`
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(lsKey) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(lsKey, on ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [lsKey, on])
  return [on, setOn]
}

/** Dòng mã mở đầu một prompt: «001. @CHAR_04 | @BG_03. …» */
const DONG_MA = /^\s*\d{1,4}\s*[.)]\s*@[\w-]+/
/** Dòng kết thúc một khối prompt khi dán/nạp nguyên file kịch bản: hàng rào code, tiêu đề markdown, ghi chú. */
const HET_KHOI = /^\s*(```|#{1,6}\s|✅|⚠️|\*\*\[)/

/**
 * File kịch bản kiểu «### 001 — … / ```javascript {…} / ```text 001. @CHAR… (nhiều dòng) ```»:
 * mỗi prompt bắt đầu ở dòng «NNN. @mã» và kéo tới trước tiêu đề / khối code / dòng mã kế tiếp.
 * Mọi chữ khác (tiêu đề, JSON, ghi chú) bỏ đi. Trả null nếu văn bản không theo kiểu này
 * (không có prompt nào nhiều dòng) — khi đó vẫn tách mỗi dòng một prompt như cũ.
 */
export function extractPromptBlocks(text: string): string[] | null {
  const dong = text.split(/\r?\n/)
  const dau = dong.map((l, i) => (DONG_MA.test(l) ? i : -1)).filter((i) => i >= 0)
  if (!dau.length) return null
  const khoi: string[] = []
  let nhieuDong = false
  dau.forEach((s, k) => {
    const het = k + 1 < dau.length ? dau[k + 1] : dong.length
    const than: string[] = [dong[s].trim()]
    for (let i = s + 1; i < het; i++) {
      if (HET_KHOI.test(dong[i])) break
      than.push(dong[i].replace(/\s+$/, ''))
    }
    while (than.length > 1 && !than[than.length - 1].trim()) than.pop()
    if (than.filter((x) => x.trim()).length >= 3) nhieuDong = true
    khoi.push(than.join('\n'))
  })
  return nhieuDong ? khoi : null
}

/** Nạp / kéo thả file vào ô prompt: file kịch bản → chỉ giữ các khối prompt, cách nhau một dòng trống. */
export function cleanPromptFile(text: string): string {
  const khoi = extractPromptBlocks(text)
  return khoi ? khoi.join('\n\n') : text
}

/** Tách prompt: tick → cả ô là 1 prompt (chỉ bỏ khoảng trắng thừa ở đầu/cuối); không tick → mỗi dòng 1 prompt
 * (hoặc mỗi khối «NNN. @mã …» nhiều dòng là 1 prompt). */
export function splitPrompts(text: string, one: boolean): string[] {
  if (one) {
    const t = text.trim()
    return t ? [t] : []
  }
  const khoi = extractPromptBlocks(text)
  if (khoi) return khoi
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

export function OnePromptCheck({ on, setOn, className = '' }: { on: boolean; setOn: (v: boolean) => void; className?: string }) {
  return (
    <label
      className={`one-prompt${on ? ' on' : ''} ${className}`}
      title="Tick: toàn bộ nội dung trong ô là MỘT prompt và được gửi đi nguyên văn (kể cả xuống dòng). Bỏ tick: mỗi dòng là một prompt."
    >
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
      Cả ô là 1 prompt
    </label>
  )
}

/** Nút xoá nhanh nội dung ô prompt; bấm xong có «Hoàn tác» trong 6 giây phòng bấm nhầm. */
export function ClearPromptBtn({ value, setValue }: { value: string; setValue: (v: string) => void }) {
  const [undo, setUndo] = useState<string | null>(null)
  useEffect(() => {
    if (undo === null) return
    const t = window.setTimeout(() => setUndo(null), 6000)
    return () => window.clearTimeout(t)
  }, [undo])
  if (undo !== null) {
    return (
      <button
        type="button"
        className="clear-prompt undo"
        title="Lấy lại nội dung vừa xoá"
        onClick={() => {
          setValue(undo)
          setUndo(null)
        }}
      >
        ↶ Hoàn tác
      </button>
    )
  }
  return (
    <button
      type="button"
      className="clear-prompt"
      disabled={!value.trim()}
      title="Xoá toàn bộ nội dung ô prompt"
      onClick={() => {
        setUndo(value)
        setValue('')
      }}
    >
      ✕ Xoá prompt
    </button>
  )
}
