"""Write a processed match to data/matches/{id}/ as flat binary + JSON files.

Binary layout (little-endian, frame-major) is described in meta.json under
"files" so the frontend never hard-codes shapes.
"""

from pathlib import Path

import orjson

from .loader import MISSING, SCALE, Tracking

# Bump when the output format changes; cached matches are then re-processed.
PIPELINE_VERSION = 3


def _write_json(path: Path, obj) -> None:
    path.write_bytes(orjson.dumps(obj, option=orjson.OPT_SERIALIZE_NUMPY))


def write_match(out_dir: Path, meta: dict, trk: Tracking, events: list, phases: list,
                extra_json: dict[str, object] | None = None) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    arrays = {
        "positions.bin": (trk.positions, "int16", [trk.n_frames, meta["n_slots"], 2]),
        "detected.bin": (trk.detected, "uint8", [trk.n_frames, meta["n_slots"]]),
        "ball_z.bin": (trk.ball_z, "int16", [trk.n_frames]),
        "clock.bin": (trk.clock, "float32", [trk.n_frames]),
        "period.bin": (trk.period, "int8", [trk.n_frames]),
        "possession.bin": (trk.possession, "int8", [trk.n_frames]),
        "possession_slot.bin": (trk.possession_slot, "int16", [trk.n_frames]),
    }
    for name, (arr, _, _) in arrays.items():
        (out_dir / name).write_bytes(arr.astype(arr.dtype.newbyteorder("<"), copy=False).tobytes())

    meta = {
        **meta,
        "pipeline_version": PIPELINE_VERSION,
        "encoding": {"position_scale": SCALE, "missing": int(MISSING),
                     "detected": {"not_present": 0, "extrapolated": 1, "detected": 2},
                     "possession": {"none": 0, "home": 1, "away": 2}},
        "files": {name: {"dtype": dt, "shape": shape} for name, (_, dt, shape) in arrays.items()},
    }
    _write_json(out_dir / "meta.json", meta)
    _write_json(out_dir / "events.json", events)
    _write_json(out_dir / "phases.json", phases)
    for name, obj in (extra_json or {}).items():
        _write_json(out_dir / name, obj)
    return meta
