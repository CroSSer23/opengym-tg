import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import Icon from '../components/Icon.jsx'
import { Button, Switch, TextField } from '../components/ui.jsx'

/* The operator's side of the Coach: is it on, can it reach a model, and what has it been
   doing. Like the rest of the admin dashboard this is deliberately English-only — it isn't
   part of the translated end-user surface.
 *
 * What it never shows: anybody's intake answers, payloads or proposals. An admin can enable
 * the feature and see that jobs ran; they cannot read what their users asked it. */

const rel = ts => {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}

export default function AdminCoach() {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api('/api/admin/coach').then(setD).catch(e => toast(e.message || 'Failed to load'))
  useEffect(() => { load() }, [])

  const patch = async body => {
    setBusy(true)
    try { await api('/api/admin/coach/config', { method: 'POST', body: JSON.stringify(body) }); await load() }
    catch (e) { toast(e.message) }
    setBusy(false)
  }
  const test = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/coach/test', { method: 'POST', body: '{}' })
      toast(r.ok ? 'Coach test passed ✅' : 'Test failed: ' + (r.error || 'unknown'))
      await load()
    } catch (e) { toast(e.message) }
    setBusy(false)
  }
  const disconnect = async () => {
    setBusy(true)
    try { await api('/api/admin/coach/auth/disconnect', { method: 'POST', body: '{}' }); toast('Disconnected'); await load() }
    catch (e) { toast(e.message) }
    setBusy(false)
  }

  if (!d) return <div className="card"><div className="muted small">Loading Coach status…</div></div>

  if (d.disabledByEnv) return <div className="card">
    <h2 style={{ margin: '0 0 6px' }}>AI Coach</h2>
    <div className="muted small">Force-disabled by <code>COACH_DISABLED</code> in the environment. Remove it to configure the Coach here.</div>
  </div>

  const meta = d.providers.find(p => p.id === d.provider) || {}
  const authed = d.auth?.state === 'connected' || d.auth?.state === 'not-required'
  const live = d.enabled && d.cli.ok && authed

  return <div className="card" style={{ borderColor: live ? 'var(--acc)' : undefined }}>
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>AI Coach</h2>
      <Switch checked={!!d.enabled} disabled={busy} onChange={v => patch({ enabled: v })} />
    </div>

    {!d.enabled && <div className="muted small">Off. Users see no Coach anywhere in the app.</div>}

    {d.enabled && <>
      <div className="tiles" style={{ textAlign: 'left', marginBottom: 10 }}>
        <div className="tile"><div className="l">CLI</div>
          <div className="v" style={{ fontSize: '.9rem', color: d.cli.ok ? 'var(--green)' : 'var(--red)' }}>{d.cli.ok ? 'found' : 'missing'}</div></div>
        <div className="tile"><div className="l">Sign-in</div>
          <div className="v" style={{ fontSize: '.9rem', color: authed ? 'var(--green)' : 'var(--red)' }}>{authLabel(d.auth)}</div></div>
        <div className="tile"><div className="l">Jobs today</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.jobsToday}</div></div>
        <div className="tile"><div className="l">Last run</div><div className="v" style={{ fontSize: '.85rem' }}>{rel(d.lastSuccess?.at)}</div></div>
      </div>

      {d.cli.version && <div className="dim small" style={{ marginBottom: 8 }}>{meta.label} · {d.cli.version}</div>}
      {!d.cli.ok && d.cli.error && <div className="small" style={{ color: 'var(--red)', marginBottom: 8 }}>{d.cli.error}</div>}

      {/* provider */}
      <h4 className="sec" style={{ marginTop: 4 }}>Provider</h4>
      <div className="row" style={{ flexWrap: 'wrap', gap: 7, marginBottom: 10 }}>
        {d.providers.map(p => <button key={p.id} className={'chip' + (p.id === d.provider ? ' on' : '')}
          disabled={busy} onClick={() => patch({ provider: p.id })}>{p.label}</button>)}
      </div>
      {d.provider === 'custom' && <div style={{ marginBottom: 10 }}>
        <div className="dim small" style={{ marginBottom: 6 }}>Command run per job — prompt on stdin, one JSON object on stdout. See api/coach/fixture-cli.mjs for a working example.</div>
        <TextField defaultValue={d.customCommand || ''} placeholder="/usr/local/bin/my-coach --json"
          onBlur={e => e.target.value !== (d.customCommand || '') && patch({ customCommand: e.target.value })} />
      </div>}

      {/* sign-in */}
      {(meta.oauth || meta.apiKey) && <>
        <h4 className="sec">Sign-in</h4>
        {d.auth?.state === 'connected' ? <>
          <div className="small muted" style={{ marginBottom: 8 }}>
            Connected{d.auth.account ? ' as ' + d.auth.account : ''} via {d.auth.type === 'oauth' ? 'browser sign-in' : 'API key'} · {rel(d.auth.connectedAt)}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" icon="check" disabled={busy} onClick={test}>Test the Coach</Button>
            <Button size="sm" danger disabled={busy} onClick={disconnect}>Disconnect</Button>
          </div>
        </> : <>
          {d.auth?.state === 'expired' && <div className="small" style={{ color: 'var(--red)', marginBottom: 8 }}>The sign-in expired — connect again.</div>}
          {d.auth?.state === 'unreadable' && <div className="small" style={{ color: 'var(--red)', marginBottom: 8 }}>
            The stored credential can't be decrypted — this usually means ./data was restored without its <code>secret</code> file. Connect again.
          </div>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {meta.oauth && <Button size="sm" variant="primary" icon="key" disabled={busy}
              onClick={() => openSheet(close => <ConnectSheet close={close} onDone={load} label={meta.label} />)}>Connect</Button>}
            {meta.apiKey && <Button size="sm" icon="lock" disabled={busy}
              onClick={() => openSheet(close => <ApiKeySheet close={close} onDone={load} label={meta.label} />)}>Use an API key</Button>}
          </div>
        </>}
      </>}

      {/* limits */}
      <h4 className="sec">Limits</h4>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <label className="small muted">Per user / day
          <input className="num" type="number" min="0" max="200" defaultValue={d.caps.perProfileDaily} style={{ width: 70, marginLeft: 8 }}
            onBlur={e => patch({ caps: { ...d.caps, perProfileDaily: +e.target.value } })} /></label>
        <label className="small muted">Whole instance / day
          <input className="num" type="number" min="0" max="5000" defaultValue={d.caps.instanceDaily} style={{ width: 70, marginLeft: 8 }}
            onBlur={e => patch({ caps: { ...d.caps, instanceDaily: +e.target.value } })} /></label>
      </div>
      <div className="dim small" style={{ marginBottom: 10 }}>0 = no limit. Every job is one session on your provider account.</div>

      <h4 className="sec">Model</h4>
      <TextField defaultValue={d.model || ''} placeholder="(the CLI's default)"
        onBlur={e => e.target.value !== (d.model || '') && patch({ model: e.target.value })} />

      {d.lastError && <>
        <h4 className="sec">Last failure</h4>
        <div className="small" style={{ color: 'var(--red)' }}>{d.lastError.errorClass}{d.lastError.detail ? ' — ' + d.lastError.detail : ''}</div>
        <div className="dim" style={{ fontSize: '.72rem' }}>{rel(d.lastError.at)}</div>
      </>}

      {!!d.recent?.length && <>
        <h4 className="sec">Recent jobs</h4>
        {d.recent.slice(0, 8).map((e, i) => <div key={i} className="row between" style={{ padding: '5px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small">{e.kind}{e.trigger === 'scheduled' ? ' · scheduled' : ''}</span>
          <span className="dim" style={{ fontSize: '.72rem' }}>
            <span style={{ color: e.outcome === 'failed' ? 'var(--red)' : e.outcome === 'ready' ? 'var(--acc)' : undefined }}>{e.outcome}</span>
            {e.ms ? ' · ' + Math.round(e.ms / 1000) + 's' : ''} · {rel(e.at)}
          </span>
        </div>)}
      </>}
    </>}
  </div>
}

const authLabel = a => ({
  connected: 'signed in', 'not-required': 'n/a', disconnected: 'needed', expired: 'expired', unreadable: 'unreadable'
}[a?.state] || '—')

/* ---------------------------------- connect ---------------------------------- */

// The provider's flow ends on a page that displays a one-time code rather than redirecting to
// this instance — a self-hosted domain can't be a registered redirect URI. So: open, approve,
// paste. One step more than a pure redirect, and no terminal anywhere.
function ConnectSheet({ close, onDone, label }) {
  const toast = useUI(s => s.toast)
  const [started, setStarted] = useState(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const begin = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/coach/auth/start', { method: 'POST', body: '{}' })
      setStarted(r)
      window.open(r.url, '_blank', 'noopener')
    } catch (e) { toast(e.message) }
    setBusy(false)
  }
  const finish = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/coach/auth/finish', { method: 'POST', body: JSON.stringify({ code: code.trim(), state: started.state }) })
      toast(r.test?.ok ? 'Connected ✅' : 'Connected, but the test failed: ' + (r.test?.error || ''))
      close(); onDone()
    } catch (e) { toast(e.message); setBusy(false) }
  }

  return <>
    <h3>Connect {label}</h3>
    {!started ? <>
      <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
        This opens {label} in a new tab. Sign in with the account that should pay for Coach usage — a subscription or an API account both work — and approve access.
      </div>
      <Button variant="primary" icon="key" disabled={busy} onClick={begin}>Open sign-in</Button>
    </> : <>
      <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
        After approving, the page shows a one-time code. Paste it here.
      </div>
      <TextField value={code} autoFocus placeholder="paste the code" onChange={e => setCode(e.target.value)} />
      <div style={{ height: 12 }} />
      <Button variant="primary" disabled={busy || !code.trim()} onClick={finish}>Finish connecting</Button>
      <div style={{ height: 8 }} />
      <Button disabled={busy} onClick={() => window.open(started.url, '_blank', 'noopener')}>Open the sign-in page again</Button>
    </>}
    <div style={{ height: 8 }} />
  </>
}

function ApiKeySheet({ close, onDone, label }) {
  const toast = useUI(s => s.toast)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/coach/auth/key', { method: 'POST', body: JSON.stringify({ key: key.trim() }) })
      toast(r.test?.ok ? 'Key saved ✅' : 'Saved, but the test failed: ' + (r.test?.error || ''))
      close(); onDone()
    } catch (e) { toast(e.message); setBusy(false) }
  }
  return <>
    <h3>{label} API key</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      Stored encrypted on this server and passed to the CLI only while a job runs. It is never shown again and never leaves the server.
    </div>
    <TextField value={key} autoFocus type="password" placeholder="sk-…" onChange={e => setKey(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !key.trim()} onClick={save}>Save key</Button>
    <div style={{ height: 8 }} />
  </>
}
