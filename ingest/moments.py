"""The shared "moment" schema every detector outputs.

A moment is a clip-sized frame range plus a label, so any detector's output can
be browsed, turned into a clip or added to a highlight reel without the UI
knowing which detector produced it. Frames are array indices (frame - offset),
the same space as the binary files.
"""

from dataclasses import asdict, dataclass, field

from .config import FPS

MAX_CLIP_FRAMES = 10 * FPS


@dataclass
class Moment:
    source: str  # detector name, e.g. "shape", "runs", "press"
    label: str  # human-readable, shown in lists and title cards
    anchor_frame: int  # the key instant (shot, breakdown peak...)
    start_frame: int
    end_frame: int
    team_id: int | None = None
    player_ids: list[int] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    score: float | None = None  # detector-specific ranking value (higher = more notable)
    detail: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


def window(anchor: int, n_frames: int, before_s: float, after_s: float) -> tuple[int, int]:
    """Clip range around an anchor, clamped to the match and to 10 seconds."""
    start = max(0, anchor - round(before_s * FPS))
    end = min(n_frames - 1, anchor + round(after_s * FPS), start + MAX_CLIP_FRAMES)
    return start, end
