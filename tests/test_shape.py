import numpy as np
import orjson
import pytest
from scipy.spatial import ConvexHull

from ingest.detectors.shape import hull_area
from ingest.moments import MAX_CLIP_FRAMES
from ingest.pipeline import match_dir
from tests.test_ingest import MATCHES


def test_hull_area_matches_scipy():
    rng = np.random.default_rng(0)
    for _ in range(100):
        pts = rng.normal(size=(10, 2)) * 20
        assert hull_area(list(map(tuple, pts.tolist()))) == pytest.approx(ConvexHull(pts).volume)
    assert np.isnan(hull_area([(0, 0), (1, 1)]))
    assert hull_area([(0, 0), (4, 0), (4, 3), (0, 3), (2, 1)]) == pytest.approx(12)  # interior point ignored


@pytest.mark.skipif(not MATCHES, reason="no ingested match in cache")
@pytest.mark.parametrize("match_id", MATCHES)
def test_shape_series_plausible(match_id):
    d = match_dir(int(match_id))
    meta = orjson.loads((d / "meta.json").read_bytes())
    shape = orjson.loads((d / "shape.json").read_bytes())
    L, W = meta["pitch"]["length"], meta["pitch"]["width"]
    m = shape["metrics"]
    for side in ("home", "away"):
        width = np.array([v for v in m["width"][side] if v is not None])
        depth = np.array([v for v in m["depth"][side] if v is not None])
        line = np.array([v for v in m["line_height"][side] if v is not None])
        comp = np.array([v for v in m["compactness"][side] if v is not None])
        assert len(width) > shape["n"] * 0.3  # at least ~30% of the match is in play
        # Players can stand a few metres outside the lines (throw-ins, corners).
        assert 0 < width.min() and width.max() <= W + 10
        assert 0 < depth.min() and depth.max() <= L + 10
        assert -5 <= line.min() and line.max() <= L + 5
        assert comp.min() > 0 and 40 < np.median(comp) < 200  # m² per player


@pytest.mark.skipif(not MATCHES, reason="no ingested match in cache")
@pytest.mark.parametrize("match_id", MATCHES)
def test_moments_schema(match_id):
    d = match_dir(int(match_id))
    meta = orjson.loads((d / "meta.json").read_bytes())
    moments = orjson.loads((d / "moments.json").read_bytes())
    assert moments, "expected at least one moment"
    for mo in moments:
        assert {"source", "label", "anchor_frame", "start_frame", "end_frame", "tags"} <= mo.keys()
        assert 0 <= mo["start_frame"] <= mo["anchor_frame"] <= mo["end_frame"] < meta["n_frames"]
        assert mo["end_frame"] - mo["start_frame"] <= MAX_CLIP_FRAMES
