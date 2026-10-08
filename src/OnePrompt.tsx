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

/** Tách prompt: tick → cả ô là 1 prompt (chỉ bỏ khoảng trắng thừa ở đầu/cuối); không tick → mỗi dòng 1 prompt. */
export function splitPrompts(text: string, one: boolean): string[] {
  if (one) {
    const t = text.trim()
    return t ? [t] : []
  }
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
