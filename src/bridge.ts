// Gọi cầu nối Python (scripts/pb_bridge.py) — Vite chuyển /api/* sang 127.0.0.1:1431.
// Dùng chung cho các tab mới nối thật (MiniApp, Ghép Video, InVideo, Voice…).
import { useEffect, useState } from 'react'

export async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    path,
    body === undefined
      ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
  const j = (await r.json().catch(() => ({}))) as T & { ok?: boolean; error?: string }
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

export function errText(e: unknown) {
  const m = e instanceof Error ? e.message : String(e)
  return /Failed to fetch|NetworkError/i.test(m) ? 'Cầu nối (pb_bridge.py) chưa chạy' : m
}

export function baseName(p: string) {
  return p.split(/[\\/]/).pop() || p
}

export function dirName(p: string) {
  return p.replace(/[\\/][^\\/]*$/, '')
}

/** Đường dẫn để <video>/<audio>/<img> phát file do cầu nối tạo ra. */
export const fileUrl = (p: string) => `/api/file?path=${encodeURIComponent(p)}`

export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** Hộp thoại chọn file của Windows (qua cầu nối). kind: video | anh | chu | audio | '' */
export async function pickFiles(kind: string, multi = true): Promise<string[]> {
  const r = await api<{ paths: string[] }>('/api/pick-files', { kind })
  return multi ? r.paths : r.paths.slice(0, 1)
}

export async function pickFolder(start = ''): Promise<string> {
  const r = await api<{ path: string }>('/api/pick-folder', { start })
  return r.path
}

export function openFolder(path: string) {
  void api('/api/open-folder', { path }).catch(() => {})
}

export type BridgeJob = {
  id: string
  loai: string
  nguon: string
  status: 'dang_chay' | 'xong' | 'loi'
  msg: string
  out_path: string
  out_dir?: string
  t?: number
}

/** Việc nền — hỏi /api/util/jobs 1.5s một lần, lọc theo `loai`. */
export function useJobs(loai: string[]) {
  const [jobs, setJobs] = useState<BridgeJob[]>([])
  const key = loai.join(',')
  useEffect(() => {
    let dead = false
    const want = key.split(',')
    async function tick() {
      try {
        const r = await api<{ jobs: BridgeJob[] }>('/api/util/jobs')
        if (!dead) setJobs(r.jobs.filter((j) => want.includes(j.loai)))
      } catch {
        /* cầu nối tắt */
      }
    }
    void tick()
    const t = window.setInterval(tick, 1500)
    return () => {
      dead = true
      window.clearInterval(t)
    }
  }, [key])
  return jobs
}

/** Chờ một việc nền xong (dùng khi cần kết quả để làm bước tiếp). */
export async function waitJob(id: string, onMsg?: (msg: string) => void): Promise<BridgeJob> {
  for (;;) {
    const r = await api<{ jobs: BridgeJob[] }>('/api/util/jobs')
    const j = r.jobs.find((x) => x.id === id)
    if (!j) throw new Error('Mất việc ' + id)
    if (j.status !== 'dang_chay') {
      if (j.status === 'loi') throw new Error(j.msg || 'Lỗi')
      return j
    }
    onMsg?.(j.msg)
    await new Promise((ok) => window.setTimeout(ok, 1200))
  }
}
