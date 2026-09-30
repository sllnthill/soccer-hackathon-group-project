"""End-to-end ingest for one match ID. Shared by the CLI and the API."""

import logging
import time
from pathlib import Path

import orjson

from . import config, sources
from .detectors import shape
from .events import load_events, load_phases
from .loader import build_meta, load_match_json, load_tracking
from .pack import PIPELINE_VERSION, write_match

log = logging.getLogger(__name__)


def match_dir(match_id: int) -> Path:
    return config.CACHE_DIR / "matches" / str(match_id)


def is_ingested(match_id: int) -> bool:
    meta = match_dir(match_id) / "meta.json"
    if not meta.is_file():
        return False
    return orjson.loads(meta.read_bytes()).get("pipeline_version") == PIPELINE_VERSION


def ingest_match(match_id: int, force: bool = False) -> dict:
    out = match_dir(match_id)
    if not force and is_ingested(match_id):
        return orjson.loads((out / "meta.json").read_bytes())

    t0 = time.perf_counter()
    match = load_match_json(sources.match_json(match_id))
    log.info("match %s: loading tracking", match_id)
    trk = load_tracking(sources.tracking(match_id), match)
    if trk.unknown_player_ids:
        log.warning("match %s: %d tracked ids not in roster", match_id, len(trk.unknown_player_ids))
    events = load_events(sources.dynamic_events(match_id))
    phases = load_phases(sources.phases_of_play(match_id))
    meta = build_meta(match, trk, config.FPS)
    shape_series, shape_moments = shape.compute(trk, meta, phases)
    moments = sorted((m.to_dict() for m in shape_moments), key=lambda m: m["anchor_frame"])
    meta = write_match(out, meta, trk, events, phases,
                       {"shape.json": shape_series, "moments.json": moments})
    log.info("match %s: ingested %d frames in %.1fs", match_id, trk.n_frames, time.perf_counter() - t0)
    return meta
