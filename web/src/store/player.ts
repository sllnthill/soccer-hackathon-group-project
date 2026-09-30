// Playback + clip-range state. The rAF loop and canvas read this store directly
// (getState/subscribe) so 60 fps updates don't re-render the React tree.
import { create } from 'zustand'
import type { MatchData } from '../data/types'

export const MAX_CLIP_SECONDS = 10
export const SPEEDS = [0.25, 0.5, 1, 2, 4]

export interface Notice {
  text: string
  kind: 'info' | 'warn'
  id: number
}

interface PlayerState {
  data: MatchData | null
  frame: number
  playing: boolean
  speed: number
  direction: 1 | -1
  inFrame: number | null
  outFrame: number | null
  /** When set, playback loops inside this range (clip view). */
  loop: { start: number; end: number } | null
  notice: Notice | null
  /** Team-shape chart under the timeline; off by default to keep first use simple. */
  showShape: boolean

  setData: (d: MatchData | null) => void
  seek: (f: number) => void
  step: (frames: number) => void
  play: (direction?: 1 | -1) => void
  pause: () => void
  togglePlay: () => void
  setSpeed: (s: number) => void
  shuttle: (direction: 1 | -1) => void
  markIn: (f?: number) => void
  markOut: (f?: number) => void
  setRange: (start: number, end: number) => void
  clearRange: () => void
  setLoop: (l: { start: number; end: number } | null) => void
  notify: (text: string, kind?: Notice['kind']) => void
  toggleShape: () => void
}

const SHAPE_KEY = 'clipper.showShape'
const readPref = (key: string) => {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

const maxFrames = (d: MatchData | null) => MAX_CLIP_SECONDS * (d?.meta.fps ?? 10)
const clampFrame = (d: MatchData | null, f: number) => (d ? Math.max(0, Math.min(d.meta.n_frames - 1, f)) : 0)

export const usePlayer = create<PlayerState>((set, get) => ({
  data: null,
  frame: 0,
  playing: false,
  speed: 1,
  direction: 1,
  inFrame: null,
  outFrame: null,
  loop: null,
  notice: null,
  showShape: readPref(SHAPE_KEY),

  setData: (data) =>
    set({ data, frame: data?.meta.periods[0]?.start_frame ?? 0, playing: false, speed: 1, direction: 1,
          inFrame: null, outFrame: null, loop: null }),
  seek: (f) => set({ frame: clampFrame(get().data, f) }),
  step: (frames) => set((s) => ({ playing: false, frame: clampFrame(s.data, Math.round(s.frame) + frames) })),
  play: (direction = 1) => set({ playing: true, direction }),
  pause: () => set({ playing: false }),
  togglePlay: () => set((s) => ({ playing: !s.playing, direction: s.playing ? s.direction : 1 })),
  setSpeed: (speed) => set({ speed }),

  // J/L like video editors: repeated presses in one direction speed up.
  shuttle: (direction) =>
    set((s) => {
      if (s.playing && s.direction === direction) {
        const next = SPEEDS.find((v) => v > s.speed) ?? s.speed
        return { speed: next }
      }
      return { playing: true, direction, speed: 1 }
    }),

  markIn: (f) => {
    const { data, frame, outFrame, notify } = get()
    const inF = Math.round(clampFrame(data, f ?? frame))
    let out = outFrame
    if (out != null && out <= inF) out = null
    if (out != null && out - inF > maxFrames(data)) {
      out = inF + maxFrames(data)
      notify(`Clips are limited to ${MAX_CLIP_SECONDS} seconds, so the Out point moved.`, 'warn')
    }
    set({ inFrame: inF, outFrame: out })
  },

  markOut: (f) => {
    const { data, frame, inFrame, notify } = get()
    let out = Math.round(clampFrame(data, f ?? frame))
    let inF = inFrame
    if (inF == null || inF >= out) {
      inF = Math.max(0, out - 5 * (data?.meta.fps ?? 10))
      if (inF === out) out = inF + 1
      notify('In point set 5 seconds before the Out point.')
    } else if (out - inF > maxFrames(data)) {
      out = inF + maxFrames(data)
      notify(`Clips are limited to ${MAX_CLIP_SECONDS} seconds, so the Out point was capped.`, 'warn')
    }
    set({ inFrame: inF, outFrame: out })
  },

  setRange: (start, end) => {
    const d = get().data
    const s = Math.round(clampFrame(d, start))
    const e = Math.round(clampFrame(d, Math.min(end, s + maxFrames(d))))
    set({ inFrame: s, outFrame: Math.max(e, s + 1) })
  },
  clearRange: () => set({ inFrame: null, outFrame: null }),
  setLoop: (loop) => set({ loop }),
  notify: (text, kind = 'info') => set({ notice: { text, kind, id: Date.now() } }),
  toggleShape: () =>
    set((s) => {
      try {
        localStorage.setItem(SHAPE_KEY, s.showShape ? '0' : '1')
      } catch {
        /* storage blocked: preference just isn't remembered */
      }
      return { showShape: !s.showShape }
    }),
}))
