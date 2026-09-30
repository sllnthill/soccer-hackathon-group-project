// Main screen. Routes:
//   /m/:matchId            full match (optional ?f=<frame> to open at a moment)
//   /m/:matchId/c/:clipId  shared clip: opens straight into a looping clip
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ClipPanel } from '../clips/ClipPanel'
import { api, clipUrl, copyText } from '../data/api'
import { frameLabel, loadMatch } from '../data/loadMatch'
import { ExportMenu } from '../export/ExportMenu'
import type { Clip } from '../data/types'
import { PitchCanvas } from '../pitch/PitchCanvas'
import { Controls } from '../player/Controls'
import { Heartbeat } from '../player/Heartbeat'
import { Timeline } from '../player/Timeline'
import { usePlayback } from '../player/usePlayback'
import { useShortcuts } from '../player/useShortcuts'
import { usePlayer } from '../store/player'
import { LinkIcon } from '../ui/icons'
import { ShortcutHelp } from '../ui/ShortcutHelp'
import { Toast } from '../ui/Toast'
import { uiColors } from '../ui/colors'
import { MatchPicker } from './MatchPicker'

async function loadOrIngest(matchId: number, onStatus: (s: string) => void) {
  try {
    return await loadMatch(matchId)
  } catch {
    // Not processed yet (e.g. a shared link on a fresh deploy): process it now.
    onStatus('Preparing match data for first use… (about 20 seconds)')
    let { state } = await api.ingest(matchId)
    while (state === 'processing') {
      await new Promise((r) => setTimeout(r, 1500))
      const s = await api.status(matchId)
      if (s.state === 'error') throw new Error(s.error ?? 'Processing failed')
      state = s.state
    }
    return loadMatch(matchId)
  }
}

export function Workspace() {
  const params = useParams()
  const matchId = Number(params.matchId)
  const clipId = params.clipId
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const data = usePlayer((s) => s.data)
  const showShape = usePlayer((s) => s.showShape)
  const [status, setStatus] = useState('Loading match…')
  const [error, setError] = useState<string | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [activeClip, setActiveClip] = useState<Clip | null>(null)
  const [help, setHelp] = useState(false)
  const openHelp = useCallback(() => setHelp(true), [])

  usePlayback()
  useShortcuts(openHelp)

  // Load match data whenever the match changes.
  useEffect(() => {
    let cancelled = false
    const s = usePlayer.getState()
    s.setData(null)
    setError(null)
    setStatus('Loading match…')
    loadOrIngest(matchId, setStatus)
      .then((d) => {
        if (cancelled) return
        usePlayer.getState().setData(d)
        const f = Number(search.get('f'))
        if (search.get('f') && Number.isFinite(f)) usePlayer.getState().seek(f)
      })
      .catch((e) => !cancelled && setError(String(e.message)))
    api.clips(matchId).then((c) => !cancelled && setClips(c)).catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ?f only applies on first load
  }, [matchId])

  // Enter / leave clip view when the route's clip changes.
  useEffect(() => {
    if (!data || data.meta.match_id !== matchId) return
    const s = usePlayer.getState()
    if (!clipId) {
      setActiveClip(null)
      s.setLoop(null)
      return
    }
    api.clip(clipId)
      .then((c) => {
        if (c.match_id !== matchId) return navigate(`/m/${c.match_id}/c/${c.id}`, { replace: true })
        setActiveClip(c)
        s.clearRange()
        s.setLoop({ start: c.start_frame, end: c.end_frame })
        s.seek(c.start_frame)
        s.play()
      })
      .catch(() => s.notify('That clip no longer exists.', 'warn'))
  }, [clipId, data, matchId, navigate])

  if (error)
    return (
      <Shell matchId={matchId}>
        <p className="p-8 text-red-300">Could not load match {matchId}: {error}</p>
      </Shell>
    )
  if (!data || data.meta.match_id !== matchId)
    return (
      <Shell matchId={matchId}>
        <p className="animate-pulse p-8 text-slate-400">{status}</p>
      </Shell>
    )

  const { meta } = data
  return (
    <Shell matchId={matchId}>
      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex min-h-0 min-w-0 flex-col gap-3">
          <Scoreline />
          {activeClip && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-cyan-400/10 px-3 py-2 text-sm ring-1 ring-cyan-400/40">
              <span className="font-semibold text-cyan-200">▶ Clip: {activeClip.title}</span>
              <span className="font-mono text-cyan-100/80">
                {frameLabel(data, activeClip.start_frame)} · {((activeClip.end_frame - activeClip.start_frame) / meta.fps).toFixed(1)} s · looping
              </span>
              {activeClip.tags.map((t) => <span key={t} className="rounded bg-white/10 px-1.5 text-xs">{t}</span>)}
              <div className="ml-auto flex gap-2">
                <button className="flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 hover:bg-white/15"
                  onClick={async () => {
                    const ok = await copyText(clipUrl(activeClip))
                    usePlayer.getState().notify(ok ? 'Clip link copied.' : `Copy this link: ${clipUrl(activeClip)}`)
                  }}>
                  <LinkIcon className="h-4 w-4" /> Share
                </button>
                <ExportMenu clip={activeClip} />
                <button className="rounded-md bg-white/10 px-2.5 py-1 hover:bg-white/15" onClick={() => navigate(`/m/${matchId}`)}>
                  Watch full match
                </button>
              </div>
              {activeClip.notes && <p className="w-full text-cyan-50/80">{activeClip.notes}</p>}
            </div>
          )}
          <PitchCanvas key={matchId} />
          <Timeline />
          {showShape && <Heartbeat />}
          <Controls onHelp={openHelp} />
        </section>
        <ClipPanel
          clips={clips}
          activeClipId={activeClip?.id}
          onSaved={(c) => {
            setClips((cs) => [c, ...cs])
            usePlayer.getState().clearRange()
          }}
          onDeleted={(id) => {
            setClips((cs) => cs.filter((c) => c.id !== id))
            if (id === activeClip?.id) navigate(`/m/${matchId}`)
          }}
          onPlay={(c) => navigate(`/m/${matchId}/c/${c.id}`)}
        />
      </div>
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </Shell>
  )
}

function Scoreline() {
  const meta = usePlayer((s) => s.data!.meta)
  const colors = uiColors(meta)
  const dot = (c: string) => <span className="inline-block h-3 w-3 rounded-full ring-1 ring-white/40" style={{ background: c }} />
  return (
    <div className="flex items-center justify-center gap-3 text-lg font-semibold">
      {dot(colors.home)}
      <span>{meta.home.name}</span>
      <span className="rounded bg-white/10 px-2 font-mono">{meta.home.score} – {meta.away.score}</span>
      <span>{meta.away.name}</span>
      {dot(colors.away)}
    </div>
  )
}

function Shell({ matchId, children }: { matchId: number; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-[1500px] flex-col gap-4 p-4 lg:h-full">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">
          Tracking <span className="text-yellow-300">Clipper</span>
        </h1>
        <MatchPicker current={matchId} />
      </header>
      {children}
      <Toast />
    </div>
  )
}
