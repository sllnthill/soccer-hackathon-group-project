import { copyText, momentUrl } from '../data/api'
import { frameLabel } from '../data/loadMatch'
import { MAX_CLIP_SECONDS, SPEEDS, usePlayer } from '../store/player'
import { Back5Icon, CloseIcon, Fwd5Icon, LinkIcon, PauseIcon, PlayIcon, StepBackIcon, StepFwdIcon } from '../ui/icons'

const btn = 'rounded-md p-2 text-slate-200 hover:bg-white/10 active:bg-white/20 disabled:opacity-40'

export function Controls({ onHelp }: { onHelp: () => void }) {
  const data = usePlayer((s) => s.data)!
  const frame = usePlayer((s) => Math.round(s.frame))
  const playing = usePlayer((s) => s.playing)
  const direction = usePlayer((s) => s.direction)
  const speed = usePlayer((s) => s.speed)
  const inFrame = usePlayer((s) => s.inFrame)
  const outFrame = usePlayer((s) => s.outFrame)
  const showShape = usePlayer((s) => s.showShape)
  const { togglePlay, step, setSpeed, markIn, markOut, clearRange, notify, toggleShape } = usePlayer.getState()
  const fps = data.meta.fps

  const copyMoment = async () => {
    const url = momentUrl(data.meta.match_id, frame)
    if (await copyText(url)) notify('Link to this moment copied.')
    else notify(`Copy this link: ${url}`, 'warn')
  }

  const clipSeconds = inFrame != null && outFrame != null ? (outFrame - inFrame) / fps : null

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-0.5">
        <button className={btn} title="Back 5 s (Shift+←)" onClick={() => step(-5 * fps)}><Back5Icon /></button>
        <button className={btn} title="Back one frame (←)" onClick={() => step(-1)}><StepBackIcon /></button>
        <button
          className="mx-1 rounded-full bg-white p-2.5 text-slate-900 hover:bg-slate-200"
          title="Play / pause (Space)"
          onClick={togglePlay}
        >
          {playing ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6" />}
        </button>
        <button className={btn} title="Forward one frame (→)" onClick={() => step(1)}><StepFwdIcon /></button>
        <button className={btn} title="Forward 5 s (Shift+→)" onClick={() => step(5 * fps)}><Fwd5Icon /></button>
      </div>

      <div className="min-w-32 font-mono text-lg tabular-nums">
        {frameLabel(data, frame)}
        {playing && direction < 0 && <span className="ml-2 text-xs text-amber-300">◀ reverse</span>}
      </div>

      <div className="flex items-center rounded-md bg-white/5 p-0.5 text-sm" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`rounded px-2 py-1 ${s === speed ? 'bg-white/20 font-semibold' : 'text-slate-400 hover:text-white'}`}
            onClick={() => setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button
          className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
          title="Set clip start (I)"
          onClick={() => markIn()}
        >
          <span className="font-semibold text-yellow-300">In</span>{' '}
          <span className="font-mono">{inFrame != null ? frameLabel(data, inFrame) : '--'}</span>
        </button>
        <button
          className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
          title="Set clip end (O)"
          onClick={() => markOut()}
        >
          <span className="font-semibold text-yellow-300">Out</span>{' '}
          <span className="font-mono">{outFrame != null ? frameLabel(data, outFrame) : '--'}</span>
        </button>
        {clipSeconds != null && (
          <span
            className={`rounded px-2 py-1 font-mono text-sm ${clipSeconds >= MAX_CLIP_SECONDS ? 'bg-amber-500/20 text-amber-300' : 'bg-yellow-400/10 text-yellow-200'}`}
            title={`Clips can be up to ${MAX_CLIP_SECONDS} seconds`}
          >
            {clipSeconds.toFixed(1)} / {MAX_CLIP_SECONDS} s
          </span>
        )}
        {(inFrame != null || outFrame != null) && (
          <button className={btn} title="Clear In/Out (X)" onClick={clearRange}><CloseIcon className="h-4 w-4" /></button>
        )}
        {data.shape && (
          <button
            className={`rounded-md px-2.5 py-1.5 text-sm ${showShape ? 'bg-sky-400/20 text-sky-200 ring-1 ring-sky-400/40' : 'text-slate-300 hover:bg-white/10'}`}
            title="Show a chart of each team's shape (width, compactness…) under the timeline"
            aria-pressed={showShape}
            onClick={toggleShape}
          >
            Team shape
          </button>
        )}
        <button className={btn} title="Copy link to this moment" onClick={copyMoment}><LinkIcon /></button>
        <button className={`${btn} px-3 font-semibold`} title="Keyboard shortcuts (?)" onClick={onHelp}>?</button>
      </div>
    </div>
  )
}
