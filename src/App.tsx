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
        <p>Không tìm thấy tab này.</p>
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
          <InVideoWorkspace onOpenSettings={() => { setTop('settings'); setSettingsPane('api') }} />
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
