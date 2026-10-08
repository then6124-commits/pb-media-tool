import { useState } from 'react'
import './App.css'
import Veo3Workspace from './Veo3Workspace'
import GrokWorkspace from './GrokWorkspace'
import VidsWorkspace from './VidsWorkspace'
import MuseWorkspace from './MuseWorkspace'
import FlowWorkspace from './FlowWorkspace'
import TaoAnhWorkspace from './TaoAnhWorkspace'
import InVideoWorkspace from './InVideoWorkspace'
import CreatorWorkspace from './CreatorWorkspace'
import VoiceWorkspace from './VoiceWorkspace'
import TubeHunterWorkspace from './TubeHunterWorkspace'
import MiniAppWorkspace from './MiniAppWorkspace'
import SeedanceWorkspace from './SeedanceWorkspace'
import {
  SETTINGS_NAV,
  SettingsAdvanced,
  SettingsChrome,
  SettingsDownload,
  SettingsImage,
  SettingsUser,
  SettingsVersion,
  Ico,
  type SettingsPane,
} from './SettingsPanes'
import GhepVideoWorkspace from './GhepVideoWorkspace'
import SettingsTaiKhoan from './SettingsTaiKhoan'

type TopTab = 'veo3' | 'grok' | 'seedance' | 'vids' | 'muse' | 'flow' | 'invideo' | 'anh' | 'creator' | 'voice' | 'ghep' | 'tube' | 'mini' | 'settings'




const TOP_TABS: { id: TopTab; label: string; badge?: string; badgeCls?: string }[] = [
  { id: 'veo3', label: 'Veo3' },
  { id: 'grok', label: 'Grok' },
  { id: 'seedance', label: 'Seedance', badge: 'BETA', badgeCls: 'beta' },
  { id: 'vids', label: 'Vids', badge: 'NEW', badgeCls: 'new' },
  { id: 'muse', label: 'Muse', badge: 'NEW', badgeCls: 'new' },
  { id: 'flow', label: 'Flow', badge: 'NEW', badgeCls: 'new' },
  { id: 'invideo', label: 'InVideo', badge: 'V2', badgeCls: 'v2' },
  { id: 'anh', label: 'Tạo Ảnh', badge: 'VIP', badgeCls: 'vip' },
  { id: 'creator', label: 'Creator' },
  { id: 'voice', label: 'Voice', badge: 'NEW', badgeCls: 'new' },
  { id: 'ghep', label: 'Ghép Video' },
  { id: 'tube', label: 'Tube Hunter', badge: 'BETA', badgeCls: 'beta' },
  { id: 'mini', label: 'MiniApp' },
  { id: 'settings', label: 'Cài đặt' },
]





type MockField = { label: string; value: string; kind?: 'select' | 'text' | 'check' }
type MockRow = { id: number; name: string; meta: string; status: string; statusCls: string }

function ModuleWorkspace({
  title,
  crumb,
  note,
  fields,
  rows,
  primaryLabel = 'Bắt đầu',
  secondaryLabel = 'Làm mới',
}: {
  title: string
  crumb: string
  note: string
  fields: MockField[]
  rows: MockRow[]
  primaryLabel?: string
  secondaryLabel?: string
}) {
  const [running, setRunning] = useState(false)

  return (
    <div className="muse-wrap module-wrap">
      <header className="muse-top">
        <div className="top-left">
          <h1>{title}</h1>
          <span className="crumb">{crumb}</span>
        </div>
        <div className="top-right">
          <span className="pill status online">
            <i className="dot" />
            Mock sẵn sàng
          </span>
        </div>
      </header>

      <main className="muse-content">
        <section className="card controls">
          <div className="module-note">{note}</div>
          <div className="toolbar module-fields">
            {fields.map((f) =>
              f.kind === 'check' ? (
                <label key={f.label} className="check">
                  <input type="checkbox" defaultChecked={f.value === '1'} readOnly />
                  {f.label}
                </label>
              ) : (
                <div key={f.label} className="tool-group">
                  <label>{f.label}</label>
                  {f.kind === 'select' ? (
                    <select className="select" defaultValue={f.value}>
                      <option>{f.value}</option>
                    </select>
                  ) : (
                    <input className="input" defaultValue={f.value} readOnly />
                  )}
                </div>
              ),
            )}
          </div>
          <textarea
            className="prompt"
            placeholder="Khu vực nhập liệu mock — sẽ nối backend sau…"
            defaultValue=""
            readOnly
          />
        </section>

        <section className="card table-card">
          <div className="table-head">
            <h2>Danh sách mock</h2>
            <div className="table-meta">
              <span>{rows.length} mục</span>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>Tên</th>
                  <th>Chi tiết</th>
                  <th style={{ width: 120 }}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.name}</td>
                    <td className="clip">{r.meta}</td>
                    <td>
                      <span className={`tag ${r.statusCls}`}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="bottombar">
        <p className="hint">Placeholder · chưa nối API thật</p>
        <div className="bottom-actions">
          <button type="button" className="btn">
            {secondaryLabel}
          </button>
          {!running ? (
            <button type="button" className="btn primary" onClick={() => setRunning(true)}>
              {primaryLabel}
            </button>
          ) : (
            <button type="button" className="btn danger" onClick={() => setRunning(false)}>
              Dừng
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}





function SettingsView({ pane }: { pane: SettingsPane }) {
  switch (pane) {
    case 'user':
      return <SettingsUser />
    case 'api':
      // Bản THẬT: sổ tài khoản tool cũ qua cầu nối, giao diện Cookie / Account kiểu SuperVeo
      return <SettingsTaiKhoan />
    case 'download':
      return <SettingsDownload />
    case 'image':
      return <SettingsImage />
    case 'advanced':
      return <SettingsAdvanced />
    case 'chrome':
      return <SettingsChrome />
    case 'version':
      return <SettingsVersion />
  }
}


function PlaceholderWorkspace({ title }: { title: string }) {
  return (
    <div className="placeholder-wrap">
      <div className="placeholder-card">
        <div className="placeholder-ico">◇</div>
        <h2>{title}</h2>
        <p>Mock tab — UI học layout SuperVeo, chưa nối backend.</p>
      </div>
    </div>
  )
}

export default function App() {
  const [top, setTop] = useState<TopTab>('veo3')
  const [settingsPane, setSettingsPane] = useState<SettingsPane>('api')

  return (
    <div className="shell">
      <header className="top-nav">
        <div className="top-nav-left">
          <button
            type="button"
            className="brand-mark"
            title="Veo3"
            onClick={() => setTop('veo3')}
          >
            <span className="brand-play" aria-hidden />
          </button>
          {TOP_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`top-tab ${top === t.id ? 'active' : ''} ${t.id === 'veo3' ? 'tab-veo' : ''} ${t.id === 'grok' ? 'tab-grok' : ''} ${t.id === 'muse' ? 'tab-muse' : ''} ${t.id === 'flow' ? 'tab-flow' : ''} ${t.id === 'invideo' ? 'tab-invideo' : ''} ${t.id === 'creator' ? 'tab-creator' : ''} ${t.id === 'voice' ? 'tab-voice' : ''} ${t.id === 'tube' ? 'tab-tube' : ''} ${t.id === 'ghep' ? 'tab-ghep' : ''} ${t.id === 'mini' ? 'tab-mini' : ''}`}
              onClick={() => setTop(t.id)}
            >
              <span>{t.label}</span>
              {t.badge && <span className={`badge ${t.badgeCls || ''}`}>{t.badge}</span>}
            </button>
          ))}
        </div>
        <div className="top-nav-right">
          <span className="ver">v0.1.0</span>
        </div>
      </header>

      <div className="body">
        {top === 'settings' ? (
          <>
            <aside className="settings-side sv2-side">
              {SETTINGS_NAV.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`side-item ${settingsPane === s.id ? 'active' : ''}`}
                  onClick={() => setSettingsPane(s.id)}
                >
                  <Ico n={s.icon} size={15} />
                  {s.label}
                </button>
              ))}
            </aside>
            <div className="settings-main sv2-main">
              <SettingsView pane={settingsPane} />
            </div>
          </>
        ) : top === 'veo3' ? (
          <Veo3Workspace />
        ) : top === 'grok' ? (
          <GrokWorkspace />
        ) : top === 'vids' ? (
          <VidsWorkspace onOpenSettings={() => { setTop('settings'); setSettingsPane('api') }} />
        ) : top === 'muse' ? (
          <MuseWorkspace />
        ) : top === 'flow' ? (
          <FlowWorkspace />
        ) : top === 'invideo' ? (
          <InVideoWorkspace />
        ) : top === 'voice' ? (
          <VoiceWorkspace onOpenSettings={() => { setTop('settings'); setSettingsPane('advanced') }} />
        ) : top === 'ghep' ? (
          <GhepVideoWorkspace onOpenSettings={() => { setTop('settings'); setSettingsPane('download') }} />
        ) : top === 'anh' ? (
          <TaoAnhWorkspace />
        ) : top === 'creator' ? (
          <CreatorWorkspace />
        ) : top === 'tube' ? (
          <TubeHunterWorkspace />
        ) : top === 'mini' ? (
          <MiniAppWorkspace />
        ) : top === 'seedance' ? (
          <SeedanceWorkspace />
        ) : (
          <PlaceholderWorkspace
            title={TOP_TABS.find((t) => t.id === top)?.label || top}
          />
        )}
      </div>
    </div>
  )
}
