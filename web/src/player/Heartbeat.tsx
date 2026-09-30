// Team Shape Heartbeat: a thin chart under the timeline showing each team's
// shape over the match (same x-axis as the timeline). Spikes point to moments
// worth watching; triangles mark detected "shape breakdowns". Click to jump.
import { useEffect, useMemo, useRef, useState } from 'react'
import { frameLabel } from '../data/loadMatch'
import type { MatchData } from '../data/types'
import { usePlayer } from '../store/player'
import { uiColors } from '../ui/colors'

const H = 64
const PAD_Y = 8
const TREND_S = 30 // display smoothing; hover still shows the exact 1 Hz value
const METRIC_ORDER = ['compactness', 'width', 'depth', 'line_height']
const HELP: Record<string, string> = {
  compactness: 'Area covered by the 10 outfield players, per player. A spike means the team suddenly spread out: a shape breakdown.',
  width: 'Distance between the widest outfield players, touchline to touchline.',
  depth: 'Distance from the deepest defender to the highest attacker.',
  line_height: 'How far the back four are from their own goal. Higher means a higher defensive line.',
}

export function Heartbeat() {
  const data = usePlayer((s) => s.data)!
  const frame = usePlayer((s) => Math.round(s.frame / 5) * 5) // redraw ~2x per second is plenty
  const [metricKey, setMetricKey] = useState('compactness')
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ x: number; i: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shape = data.shape

  const metric = shape?.metrics[metricKey]
  const breakdowns = useMemo(() => data.moments.filter((m) => m.source === 'shape'), [data])
  const trend = useMemo(
    () => (metric ? { home: rollingMean(metric.home, TREND_S), away: rollingMean(metric.away, TREND_S) } : null),
    [metric],
  )
  const range = useMemo((): [number, number] => (trend ? valueRange([...trend.home, ...trend.away]) : [0, 1]), [trend])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || !trend || !shape) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(ctx, data, trend, shape.step_frames, range, width, frame, metricKey === 'compactness' ? breakdowns : [])
  }, [data, trend, shape, range, width, frame, breakdowns, metricKey])

  if (!shape || !metric) return null

  const n = data.meta.n_frames
  const colors = uiColors(data.meta)
  const idxAt = (x: number) =>
    Math.max(0, Math.min(shape.n - 1, Math.round(((x / width) * (n - 1)) / shape.step_frames)))
  const localX = (e: React.PointerEvent) => e.clientX - canvasRef.current!.getBoundingClientRect().left
  const fmt = (v: number | null | undefined) => (v == null ? 'ball out of play' : `${v.toFixed(1)} ${metric.unit}`)

  return (
    <div className="rounded-md bg-white/[0.03] px-2 pt-1.5 pb-1 ring-1 ring-white/5">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-semibold text-slate-300">Team shape</span>
        <select
          value={metricKey}
          onChange={(e) => setMetricKey(e.target.value)}
          className="rounded bg-white/10 px-1.5 py-0.5 ring-1 ring-white/10 focus:outline-none"
          aria-label="Shape metric"
        >
          {METRIC_ORDER.filter((k) => shape.metrics[k]).map((k) => (
            <option key={k} value={k} className="bg-slate-900">{shape.metrics[k].label}</option>
          ))}
        </select>
        <span className="text-slate-500" title={HELP[metricKey]}>
          ⓘ {HELP[metricKey]}
        </span>
        <span className="ml-auto flex items-center gap-3 text-slate-400">
          <Legend color={colors.home} name={data.meta.home.short_name} />
          <Legend color={colors.away} name={data.meta.away.short_name} />
          {metricKey === 'compactness' && breakdowns.length > 0 && (
            <span className="flex items-center gap-1"><span className="text-amber-300">▼</span> breakdown</span>
          )}
        </span>
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="block w-full cursor-pointer"
          style={{ height: H }}
          onPointerDown={(e) => usePlayer.getState().seek(idxAt(localX(e)) * shape.step_frames)}
          onPointerMove={(e) => setHover({ x: localX(e), i: idxAt(localX(e)) })}
          onPointerLeave={() => setHover(null)}
          aria-label={`${metric.label} chart; click to jump to that moment`}
        />
        {hover && (
          <div
            className="pointer-events-none absolute bottom-full mb-1 w-52 -translate-x-1/2 rounded-md bg-slate-900/95 px-2.5 py-1.5 text-xs shadow-lg ring-1 ring-white/10"
            style={{ left: Math.max(104, Math.min(width - 104, hover.x)) }}
          >
            <div className="font-mono font-semibold">{frameLabel(data, hover.i * shape.step_frames)}</div>
            <div style={{ color: colors.home }}>{data.meta.home.short_name}: {fmt(metric.home[hover.i])}</div>
            <div style={{ color: colors.away }}>{data.meta.away.short_name}: {fmt(metric.away[hover.i])}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function Legend({ color, name }: { color: string; name: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-0.5 w-3" style={{ background: color }} /> {name}
    </span>
  )
}

/** Centred rolling mean over `win` samples, ignoring nulls (null if the window is mostly empty). */
function rollingMean(series: (number | null)[], win: number): (number | null)[] {
  const n = series.length
  const sum = new Float64Array(n + 1)
  const cnt = new Uint32Array(n + 1)
  series.forEach((v, i) => {
    sum[i + 1] = sum[i] + (v ?? 0)
    cnt[i + 1] = cnt[i] + (v == null ? 0 : 1)
  })
  const h = Math.floor(win / 2)
  return series.map((_, i) => {
    const a = Math.max(0, i - h)
    const b = Math.min(n, i + h + 1)
    const c = cnt[b] - cnt[a]
    return c * 4 >= b - a ? (sum[b] - sum[a]) / c : null
  })
}

/** 2nd-98th percentile, so one outlier doesn't flatten the chart. */
function valueRange(values: (number | null)[]): [number, number] {
  const vals = values.filter((v): v is number => v != null).sort((a, b) => a - b)
  if (!vals.length) return [0, 1]
  const lo = vals[Math.floor(vals.length * 0.02)]
  const hi = vals[Math.floor(vals.length * 0.98)]
  return hi > lo ? [lo, hi] : [lo - 1, hi + 1]
}

function draw(
  ctx: CanvasRenderingContext2D,
  d: MatchData,
  m: { home: (number | null)[]; away: (number | null)[] },
  step: number,
  [lo, hi]: [number, number],
  w: number,
  frame: number,
  breakdowns: { anchor_frame: number; team_id: number | null }[],
) {
  const n = d.meta.n_frames
  const x = (f: number) => (f / (n - 1)) * w
  const y = (v: number) => {
    const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
    return H - PAD_Y - t * (H - 2 * PAD_Y)
  }
  const colors = uiColors(d.meta)
  ctx.clearRect(0, 0, w, H)

  // Guide lines at 25/50/75% of range.
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  for (const t of [0.25, 0.5, 0.75]) ctx.fillRect(0, Math.round(y(lo + t * (hi - lo))), w, 1)

  // Half-time divider.
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  for (const p of d.meta.periods.slice(1)) ctx.fillRect(x(p.start_frame) - 0.5, 0, 1, H)

  // One line per team; gaps where the ball is out of play.
  for (const [series, color] of [[m.away, colors.away], [m.home, colors.home]] as const) {
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let pen = false
    series.forEach((v, i) => {
      if (v == null) {
        pen = false
        return
      }
      const px = x(i * step)
      if (pen) ctx.lineTo(px, y(v))
      else ctx.moveTo(px, y(v))
      pen = true
    })
    ctx.stroke()
  }

  // Detected shape breakdowns.
  for (const b of breakdowns) {
    const bx = x(b.anchor_frame)
    ctx.fillStyle = b.team_id === d.meta.home.id ? colors.home : colors.away
    ctx.beginPath()
    ctx.moveTo(bx - 4, 0)
    ctx.lineTo(bx + 4, 0)
    ctx.lineTo(bx, 7)
    ctx.closePath()
    ctx.fill()
  }

  // Playhead.
  ctx.fillStyle = '#fff'
  ctx.fillRect(x(frame) - 1, 0, 2, H)
}
