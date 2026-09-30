"""Team Shape Heartbeat: per-team shape metrics over the whole match.

Metrics (outfield players only, in the team's own attacking direction):
  width        max y - min y (m)
  depth        max x - min x, last defender to highest attacker (m)
  compactness  convex-hull area / players on the pitch (m² per player);
               per player so a red card doesn't distort it
  line_height  mean distance of the 4 deepest outfield players from their own goal (m)

Sampled at 5 Hz, smoothed over 2 s and stored at 1 Hz; only in-play frames
(inside a phase of play) count, so stoppages don't cause spikes.

"Shape breakdown" moments: the sharpest 3-second rises in compactness (a team
suddenly spread out), top 5% per team.
"""

import numpy as np

from ..config import FPS
from ..loader import MISSING, SCALE, Tracking
from ..moments import Moment, window

METRICS = {
    "compactness": {"label": "Compactness", "unit": "m² per player", "higher": "more spread out"},
    "width": {"label": "Width", "unit": "m", "higher": "wider"},
    "depth": {"label": "Depth", "unit": "m", "higher": "more stretched"},
    "line_height": {"label": "Defensive line height", "unit": "m from own goal", "higher": "higher line"},
}

SAMPLE_STEP = 2  # frames between raw samples (5 Hz at 10 fps)
OUT_STEP = FPS  # 1 Hz output
SMOOTH_S = 2.0
MIN_PLAYERS = 7  # skip frames where too few outfield players are tracked
BREAKDOWN_WINDOW_S = 3
BREAKDOWN_PERCENTILE = 95
BREAKDOWN_MIN_GAP_S = 20  # one moment per breakdown, not a burst
BREAKDOWN_MAX_PER_TEAM = 12


def in_play_mask(n_frames: int, phases: list[dict], frame_offset: int) -> np.ndarray:
    mask = np.zeros(n_frames, dtype=bool)
    for p in phases:
        a, b = p["frame_start"] - frame_offset, p["frame_end"] - frame_offset
        mask[max(0, a): min(n_frames, b + 1)] = True
    return mask


def attack_sign(meta: dict, n_frames: int, period: np.ndarray, side: str) -> np.ndarray:
    """+1 where this team attacks towards +x, -1 where towards -x, 0 unknown."""
    sign = np.zeros(n_frames, dtype=np.int8)
    for p in meta["periods"]:
        home_ltr = {"left_to_right": 1, "right_to_left": -1}.get(p["home_attacks"], 0)
        sign[period == p["period"]] = home_ltr if side == "home" else -home_ltr
    return sign


def hull_area(points: list[tuple[float, float]]) -> float:
    """Convex-hull area (Andrew's monotone chain + shoelace). Fast for the <=10
    points of one team; scipy's ConvexHull has too much per-call overhead here."""
    pts = sorted(points)
    if len(pts) < 3:
        return float("nan")

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    area = 0.0
    for i in range(len(hull)):
        x1, y1 = hull[i]
        x2, y2 = hull[(i + 1) % len(hull)]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2


def compute(trk: Tracking, meta: dict, phases: list[dict]) -> tuple[dict, list[Moment]]:
    n = trk.n_frames
    half_length = meta["pitch"]["length"] / 2
    play = in_play_mask(n, phases, meta["frame_offset"])
    sample_frames = np.arange(0, n, SAMPLE_STEP)
    out_frames = np.arange(0, n, OUT_STEP)  # multiples of SAMPLE_STEP, so exact sample indices
    half_win = SMOOTH_S * FPS / 2

    series: dict[str, dict[str, list]] = {m: {} for m in METRICS}
    breakdowns: list[Moment] = []

    for side in ("home", "away"):
        slots = [s["slot"] for s in meta["slots"] if s["team"] == side and not s["is_goalkeeper"]]
        sign = attack_sign(meta, n, trk.period, side)
        # [samples, players, 2] in metres, flipped so the team attacks +x; absent = NaN.
        pos = trk.positions[sample_frames][:, slots].astype(np.float64) / SCALE
        present = (trk.detected[sample_frames][:, slots] > 0) & (trk.positions[sample_frames][:, slots, 0] != MISSING)
        pos[~present] = np.nan
        pos *= sign[sample_frames][:, None, None]
        valid = play[sample_frames] & (sign[sample_frames] != 0) & (present.sum(axis=1) >= MIN_PLAYERS)
        pos[~valid] = np.nan
        x, y = pos[..., 0], pos[..., 1]

        with np.errstate(all="ignore"):
            raw = {
                "width": np.nanmax(y, axis=1) - np.nanmin(y, axis=1),
                "depth": np.nanmax(x, axis=1) - np.nanmin(x, axis=1),
                # NaNs sort last, so the first 4 are the deepest present players.
                "line_height": np.sort(x, axis=1)[:, :4].mean(axis=1) + half_length,
                "compactness": np.full(len(sample_frames), np.nan),
            }
        for k in np.flatnonzero(valid):
            pts = pos[k][present[k]]
            raw["compactness"][k] = hull_area(list(map(tuple, pts.tolist()))) / len(pts)

        # 2 s centred rolling mean, sampled at 1 Hz; null where mostly out of play.
        kernel = np.ones(2 * int(half_win // SAMPLE_STEP) + 1)
        idx = out_frames // SAMPLE_STEP
        for m in METRICS:
            ok = ~np.isnan(raw[m])
            total = np.convolve(np.nan_to_num(raw[m]), kernel, "same")
            count = np.convolve(ok.astype(float), kernel, "same")
            size = np.convolve(np.ones(len(ok)), kernel, "same")
            mean = np.where(count * 2 >= size, total / np.maximum(count, 1), np.nan)[idx]
            series[m][side] = [None if np.isnan(x) else round(float(x), 2) for x in mean]

        breakdowns += _breakdowns(series["compactness"][side], out_frames, n, meta[side]["id"],
                                  meta[side]["short_name"])

    shape = {
        "step_frames": OUT_STEP,
        "n": len(out_frames),
        "metrics": {m: {**info, "home": series[m]["home"], "away": series[m]["away"]}
                    for m, info in METRICS.items()},
    }
    return shape, breakdowns


def _breakdowns(values: list, frames: np.ndarray, n_frames: int, team_id: int, team_name: str) -> list[Moment]:
    v = np.array([np.nan if x is None else x for x in values], dtype=float)
    lag = BREAKDOWN_WINDOW_S  # samples are 1 s apart
    rise = np.full_like(v, np.nan)
    rise[lag:] = v[lag:] - v[:-lag]
    valid = rise[~np.isnan(rise)]
    if valid.size == 0:
        return []
    threshold = np.percentile(valid, BREAKDOWN_PERCENTILE)
    candidates = [i for i in np.argsort(-np.nan_to_num(rise, nan=-np.inf)) if rise[i] >= threshold and rise[i] > 0]

    chosen: list[int] = []
    for i in candidates:
        if all(abs(i - j) >= BREAKDOWN_MIN_GAP_S for j in chosen):
            chosen.append(int(i))
        if len(chosen) >= BREAKDOWN_MAX_PER_TEAM:
            break

    moments = []
    for i in sorted(chosen):
        anchor = int(frames[i])
        start, end = window(anchor, n_frames, before_s=6, after_s=4)
        moments.append(Moment(
            source="shape",
            label=f"{team_name} shape breaks: +{rise[i]:.0f} m² per player in 3 s",
            anchor_frame=anchor,
            start_frame=start,
            end_frame=end,
            team_id=team_id,
            tags=["shape breakdown", "defensive shape"],
            score=round(float(rise[i]), 2),
            detail={"compactness_before": round(float(v[i - lag]), 1), "compactness_after": round(float(v[i]), 1)},
        ))
    return moments
