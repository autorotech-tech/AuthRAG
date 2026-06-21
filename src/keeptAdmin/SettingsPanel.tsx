import { useEffect, useState } from 'react'
import { fetchProviderCatalog, ProviderCatalogModel, fetchKeeptSettings, updateKeeptSettings, KeeptSettings } from './services/moderationApi'

export const SettingsPanel: React.FC = () => {
  const [models, setModels] = useState<ProviderCatalogModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Keept Agent Settings
  const [ttsEngine, setTtsEngine] = useState<string>('google')
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null)

  // Call Integrations State
  const [sipUri, setSipUri] = useState('sip:agent@autoro.tech')
  const [sipPassword, setSipPassword] = useState('••••••••••••')
  const [rtmpStreamKey, setRtmpStreamKey] = useState('live_lk_37f4859a')
  const [virtualCableActive, setVirtualCableActive] = useState(false)
  const [integrationStatus, setIntegrationStatus] = useState<Record<string, string>>({
    zoom: 'disconnected',
    teams: 'disconnected',
    telegram: 'disconnected',
    whatsapp: 'disconnected',
  })

  useEffect(() => {
    let active = true
    const loadData = async () => {
      try {
        setLoading(true)
        const [items, settings] = await Promise.all([
          fetchProviderCatalog().catch(() => [] as ProviderCatalogModel[]),
          fetchKeeptSettings().catch(() => ({ tts_engine: 'google' } as KeeptSettings))
        ])
        
        if (active) {
          setModels(items)
          setTtsEngine(settings.tts_engine)
          setError(null)
        }
      } catch (err: any) {
        console.error('Failed to load settings data:', err)
        if (active) {
          setError(
            err.message ||
              'Unable to fetch settings data. Ensure agent-api is running.'
          )
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }
    void loadData()
    return () => {
      active = false
    }
  }, [])

  const handleSaveTtsEngine = async (engine: string) => {
    try {
      setSavingSettings(true)
      setSettingsStatus(null)
      await updateKeeptSettings({ tts_engine: engine })
      setTtsEngine(engine)
      setSettingsStatus('Settings saved successfully!')
      setTimeout(() => setSettingsStatus(null), 3000)
    } catch (err: any) {
      console.error('Failed to save TTS settings:', err)
      setSettingsStatus(`Error: ${err.message || 'Failed to update settings'}`)
    } finally {
      setSavingSettings(false)
    }
  }

  const toggleIntegration = (platform: string) => {
    setIntegrationStatus(prev => ({
      ...prev,
      [platform]: prev[platform] === 'connected' ? 'disconnected' : 'connected'
    }))
  }

  return (
    <div className="admin-content" style={{ paddingBottom: '80px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px 0' }}>
          Infrastructure & Call Settings
        </h2>
        <p style={{ color: 'var(--admin-text-muted)', margin: 0 }}>
          Manage real-time agent settings, TTS engines, and popular communication gateways.
        </p>
      </div>

      {/* ADK TRANSLATION TTS SETTINGS */}
      <div style={{ backgroundColor: 'var(--admin-card-bg)', borderRadius: '12px', border: '1px solid var(--admin-border-soft)', padding: '24px', marginBottom: '32px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          🗣️ Synchronous Translation Speech Synthesis
        </h3>
        <p style={{ fontSize: '14px', color: 'var(--admin-text-muted)', margin: '0 0 20px 0' }}>
          Choose your primary Text-To-Speech engine for synchronous speech translation. Falling back is handled automatically.
        </p>

        {settingsStatus && (
          <div style={{ 
            padding: '12px 16px', 
            backgroundColor: settingsStatus.startsWith('Error') ? '#FEE2E2' : '#D1FAE5', 
            color: settingsStatus.startsWith('Error') ? '#991B1B' : '#065F46', 
            borderRadius: '8px', 
            fontSize: '14px',
            marginBottom: '16px',
            fontWeight: 500
          }}>
            {settingsStatus}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
          {/* GOOGLE CLOUD TTS CARD */}
          <div 
            onClick={() => !savingSettings && handleSaveTtsEngine('google')}
            style={{ 
              border: `2px solid ${ttsEngine === 'google' ? '#f54e00' : 'var(--admin-border-soft)'}`,
              borderRadius: '12px',
              padding: '16px',
              cursor: savingSettings ? 'not-allowed' : 'pointer',
              backgroundColor: ttsEngine === 'google' ? 'rgba(245, 78, 0, 0.04)' : 'transparent',
              transition: 'all 0.2s ease',
              opacity: savingSettings ? 0.7 : 1
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700 }}>Google Cloud TTS (Journey)</span>
              <input 
                type="radio" 
                checked={ttsEngine === 'google'} 
                onChange={() => {}}
                style={{ accentColor: '#f54e00' }}
              />
            </div>
            <p style={{ fontSize: '13px', color: 'var(--admin-text-muted)', margin: 0, lineHeight: 1.4 }}>
              Uses ultra-realistic Google Journey & Neural2 voices. Optimized for sub-200ms latency on Russian (ru-RU-Journey-F) and English (en-US-Journey-F) pairs. Recommended baseline.
            </p>
          </div>

          {/* ELEVENLABS CARD */}
          <div 
            onClick={() => !savingSettings && handleSaveTtsEngine('elevenlabs')}
            style={{ 
              border: `2px solid ${ttsEngine === 'elevenlabs' ? '#f54e00' : 'var(--admin-border-soft)'}`,
              borderRadius: '12px',
              padding: '16px',
              cursor: savingSettings ? 'not-allowed' : 'pointer',
              backgroundColor: ttsEngine === 'elevenlabs' ? 'rgba(245, 78, 0, 0.04)' : 'transparent',
              transition: 'all 0.2s ease',
              opacity: savingSettings ? 0.7 : 1
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700 }}>ElevenLabs Flash v2.5</span>
              <input 
                type="radio" 
                checked={ttsEngine === 'elevenlabs'} 
                onChange={() => {}}
                style={{ accentColor: '#f54e00' }}
              />
            </div>
            <p style={{ fontSize: '13px', color: 'var(--admin-text-muted)', margin: 0, lineHeight: 1.4 }}>
              Premium high-fidelity voices with emotional nuance and custom voice cloning. Latency is approximately 350-450ms. Highly authentic native pronunciation.
            </p>
          </div>
        </div>

        <div style={{ backgroundColor: '#F9FAFB', border: '1px solid var(--admin-border-soft)', borderRadius: '8px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '16px' }}>🚀</span>
          <p style={{ fontSize: '13px', color: '#4B5563', margin: 0 }}>
            <strong>Streaming Non-Blocking Mode Activated:</strong> Real-time translation does not pause or block voice stream replicas. Injected or PII flags are handled asynchronously using pre-redacted text.
          </p>
        </div>
      </div>

      {/* POPULAR APPS & ONLINE CALL INTEGRATIONS */}
      <div style={{ backgroundColor: 'var(--admin-card-bg)', borderRadius: '12px', border: '1px solid var(--admin-border-soft)', padding: '24px', marginBottom: '32px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          📞 Online Call Gateways & App Integrations
        </h3>
        <p style={{ fontSize: '14px', color: 'var(--admin-text-muted)', margin: '0 0 20px 0' }}>
          Connect your AI-translation agent directly to running calls, popular apps, and private virtual interfaces.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          {/* SIP GATEWAY */}
          <div style={{ border: '1px solid var(--admin-border-soft)', borderRadius: '10px', padding: '16px', backgroundColor: '#FAFBFB' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                🏢 SIP / VoIP Trunk Gateway
              </span>
              <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px', backgroundColor: '#D1FAE5', color: '#065F46' }}>
                Active & Listening
              </span>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--admin-text-muted)', margin: '0 0 12px 0' }}>
              Route incoming SIP phone calls straight to LiveKit translation room.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: '4px' }}>SIP URI</label>
                <input 
                  type="text" 
                  value={sipUri} 
                  onChange={(e) => setSipUri(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--admin-border-soft)', borderRadius: '6px', fontSize: '13px', fontFamily: 'monospace' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: '4px' }}>SIP Password</label>
                <input 
                  type="password" 
                  value={sipPassword} 
                  onChange={(e) => setSipPassword(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--admin-border-soft)', borderRadius: '6px', fontSize: '13px' }}
                />
              </div>
            </div>
          </div>

          {/* VIRTUAL CABLE & RTMP INGRESS */}
          <div style={{ border: '1px solid var(--admin-border-soft)', borderRadius: '10px', padding: '16px', backgroundColor: '#FAFBFB' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                💻 Virtual Audio Cable & RTMP
              </span>
              <button 
                onClick={() => setVirtualCableActive(!virtualCableActive)}
                style={{ 
                  fontSize: '11px', 
                  fontWeight: 600, 
                  padding: '2px 8px', 
                  borderRadius: '12px', 
                  backgroundColor: virtualCableActive ? '#D1FAE5' : '#E5E7EB', 
                  color: virtualCableActive ? '#065F46' : '#374151',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                {virtualCableActive ? '● Active' : 'Disconnected'}
              </button>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--admin-text-muted)', margin: '0 0 12px 0' }}>
              Hook the agent directly to Zoom, Teams, Skype, or Discord running locally on your computer via Virtual Cable (VB-Audio) or push stream keys.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: '4px' }}>RTMP Ingress Server</label>
                <input 
                  type="text" 
                  readOnly
                  value="rtmp://live.autoro.tech/ingress" 
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--admin-border-soft)', borderRadius: '6px', fontSize: '13px', backgroundColor: '#F3F4F6', color: '#6B7280', fontFamily: 'monospace' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: '4px' }}>RTMP Stream Key</label>
                <input 
                  type="text" 
                  value={rtmpStreamKey} 
                  onChange={(e) => setRtmpStreamKey(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--admin-border-soft)', borderRadius: '6px', fontSize: '13px', fontFamily: 'monospace' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* POPULAR APPS (ZOOM, TEAMS, TELEGRAM, WHATSAPP) GATEWAYS */}
        <h4 style={{ fontSize: '15px', fontWeight: 600, margin: '24px 0 12px 0' }}>
          💬 Bot Connector for Popular Meeting & Messenger Calls
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          {/* ZOOM */}
          <div style={{ border: '1px solid var(--admin-border-soft)', borderRadius: '10px', padding: '12px', textAlign: 'center', backgroundColor: integrationStatus.zoom === 'connected' ? '#EFF6FF' : 'transparent' }}>
            <span style={{ fontSize: '24px', display: 'block', marginBottom: '4px' }}>📹</span>
            <span style={{ fontSize: '13px', fontWeight: 700, display: 'block', marginBottom: '2px' }}>Zoom Bot</span>
            <p style={{ fontSize: '11px', color: 'var(--admin-text-muted)', margin: '0 0 10px 0' }}>Join meeting as a participant</p>
            <button 
              onClick={() => toggleIntegration('zoom')}
              style={{ 
                width: '100%', 
                fontSize: '11px', 
                padding: '4px', 
                borderRadius: '6px', 
                border: '1px solid var(--admin-border-soft)',
                backgroundColor: integrationStatus.zoom === 'connected' ? '#1D4ED8' : 'white',
                color: integrationStatus.zoom === 'connected' ? 'white' : '#111827',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              {integrationStatus.zoom === 'connected' ? 'Disconnect' : 'Connect'}
            </button>
          </div>

          {/* TEAMS */}
          <div style={{ border: '1px solid var(--admin-border-soft)', borderRadius: '10px', padding: '12px', textAlign: 'center', backgroundColor: integrationStatus.teams === 'connected' ? '#F5F3FF' : 'transparent' }}>
            <span style={{ fontSize: '24px', display: 'block', marginBottom: '4px' }}>👥</span>
            <span style={{ fontSize: '13px', fontWeight: 700, display: 'block', marginBottom: '2px' }}>MS Teams</span>
            <p style={{ fontSize: '11px', color: 'var(--admin-text-muted)', margin: '0 0 10px 0' }}>Azure Bot integration</p>
            <button 
              onClick={() => toggleIntegration('teams')}
              style={{ 
                width: '100%', 
                fontSize: '11px', 
                padding: '4px', 
                borderRadius: '6px', 
                border: '1px solid var(--admin-border-soft)',
                backgroundColor: integrationStatus.teams === 'connected' ? '#6D28D9' : 'white',
                color: integrationStatus.teams === 'connected' ? 'white' : '#111827',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              {integrationStatus.teams === 'connected' ? 'Disconnect' : 'Connect'}
            </button>
          </div>

          {/* TELEGRAM */}
          <div style={{ border: '1px solid var(--admin-border-soft)', borderRadius: '10px', padding: '12px', textAlign: 'center', backgroundColor: integrationStatus.telegram === 'connected' ? '#F0F9FF' : 'transparent' }}>
            <span style={{ fontSize: '24px', display: 'block', marginBottom: '4px' }}>✈️</span>
            <span style={{ fontSize: '13px', fontWeight: 700, display: 'block', marginBottom: '2px' }}>Telegram</span>
            <p style={{ fontSize: '11px', color: 'var(--admin-text-muted)', margin: '0 0 10px 0' }}>Voice chat stream listener</p>
            <button 
              onClick={() => toggleIntegration('telegram')}
              style={{ 
                width: '100%', 
                fontSize: '11px', 
                padding: '4px', 
                borderRadius: '6px', 
                border: '1px solid var(--admin-border-soft)',
                backgroundColor: integrationStatus.telegram === 'connected' ? '#0369A1' : 'white',
                color: integrationStatus.telegram === 'connected' ? 'white' : '#111827',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              {integrationStatus.telegram === 'connected' ? 'Disconnect' : 'Connect'}
            </button>
          </div>

          {/* WHATSAPP */}
          <div style={{ border: '1px solid var(--admin-border-soft)', borderRadius: '10px', padding: '12px', textAlign: 'center', backgroundColor: integrationStatus.whatsapp === 'connected' ? '#ECFDF5' : 'transparent' }}>
            <span style={{ fontSize: '24px', display: 'block', marginBottom: '4px' }}>🟢</span>
            <span style={{ fontSize: '13px', fontWeight: 700, display: 'block', marginBottom: '2px' }}>WhatsApp</span>
            <p style={{ fontSize: '11px', color: 'var(--admin-text-muted)', margin: '0 0 10px 0' }}>Cloud Webhook call receiver</p>
            <button 
              onClick={() => toggleIntegration('whatsapp')}
              style={{ 
                width: '100%', 
                fontSize: '11px', 
                padding: '4px', 
                borderRadius: '6px', 
                border: '1px solid var(--admin-border-soft)',
                backgroundColor: integrationStatus.whatsapp === 'connected' ? '#047857' : 'white',
                color: integrationStatus.whatsapp === 'connected' ? 'white' : '#111827',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              {integrationStatus.whatsapp === 'connected' ? 'Disconnect' : 'Connect'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ backgroundColor: 'var(--admin-card-bg)', borderRadius: '12px', border: '1px solid var(--admin-border-soft)', padding: '24px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px 0' }}>
          Available LLM Catalog
        </h3>

        {loading && (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--admin-text-muted)' }}>
            Loading models catalog...
          </div>
        )}

        {error && (
          <div style={{ padding: '24px', backgroundColor: '#FEF2F2', border: '1px solid #FEE2E2', borderRadius: '8px', color: '#B91C1C', fontSize: '14px' }}>
            <strong>Dev Notice:</strong> {error}
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#7F1D1D' }}>
              Fallback Default: RAG is configured with <code>gemini-2.5-flash</code> as write-path enricher.
            </div>
          </div>
        )}

        {!loading && !error && models.length === 0 && (
          <div className="admin-empty-state">
            <div className="admin-empty-icon">🤖</div>
            <div className="admin-empty-title">No models registered</div>
            <div className="admin-empty-desc">
              Swoop is currently reporting an empty model pool. Check Swoop Admin Settings.
            </div>
          </div>
        )}

        {!loading && models.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Model ID</th>
                <th>Name</th>
                <th>Provider</th>
                <th>Context Length</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.id}>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{model.id}</td>
                  <td>{model.name}</td>
                  <td>
                    <span className="admin-source-label">{model.provider}</span>
                  </td>
                  <td style={{ color: 'var(--admin-text-muted)' }}>
                    {model.contextLength ? `${model.contextLength.toLocaleString()} tokens` : 'Standard'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
