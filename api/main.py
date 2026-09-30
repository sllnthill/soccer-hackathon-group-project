"""FastAPI app: match catalogue + on-demand ingest, processed files, clip library,
and (in production) the built React app."""

import logging
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import orjson
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from ingest import sources
from ingest.pipeline import ingest_match, is_ingested, match_dir

from .db import get_session, init_db
from .models import Clip, ClipCreate, ClipUpdate, _check_range

log = logging.getLogger("api")
WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
SERVED_FILES = {"meta.json", "events.json", "phases.json", "shape.json", "moments.json", "positions.bin", "detected.bin",
                "ball_z.bin", "clock.bin", "period.bin", "possession.bin", "possession_slot.bin"}

# In-memory ingest status; the files on disk are the source of truth once done.
_status: dict[int, dict] = {}
_status_lock = threading.Lock()


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.basicConfig(level=logging.INFO)
    init_db()
    # e.g. PRELOAD_MATCHES=1959846,2007721 so a fresh deploy has a match ready.
    preload = [int(m) for m in os.environ.get("PRELOAD_MATCHES", "").split(",") if m.strip()]
    for match_id in preload:
        if not is_ingested(match_id):
            with _status_lock:
                _status[match_id] = {"state": "processing"}
            threading.Thread(target=_run_ingest, args=(match_id, False), daemon=True).start()
    yield


app = FastAPI(title="Tracking Clipper", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.get("/api/health")
def health():
    return {"ok": True}


# ---------- matches ----------

def _match_status(match_id: int) -> dict:
    with _status_lock:
        if match_id in _status and _status[match_id]["state"] != "ready":
            return dict(_status[match_id])
    return {"state": "ready" if is_ingested(match_id) else "not_ingested"}


@app.get("/api/matches")
def list_matches():
    try:
        index = orjson.loads(sources.matches_index().read_bytes())
    except sources.SourceError as e:
        raise HTTPException(502, str(e))
    return [
        {
            "id": m["id"],
            "date_time": m.get("date_time"),
            "home": m["home_team"]["short_name"],
            "away": m["away_team"]["short_name"],
            **_match_status(m["id"]),
        }
        for m in sorted(index, key=lambda m: m.get("date_time") or "", reverse=True)
    ]


def _run_ingest(match_id: int, force: bool) -> None:
    try:
        ingest_match(match_id, force=force)
        state = {"state": "ready"}
    except Exception as e:  # surfaced to the UI via /status
        log.exception("ingest failed for %s", match_id)
        state = {"state": "error", "error": str(e)}
    with _status_lock:
        _status[match_id] = state


@app.post("/api/matches/{match_id}/ingest", status_code=202)
def ingest(match_id: int, background: BackgroundTasks, force: bool = False):
    with _status_lock:
        if _status.get(match_id, {}).get("state") == "processing":
            return _status[match_id]
        if not force and is_ingested(match_id):
            return {"state": "ready"}
        _status[match_id] = {"state": "processing",
                             "started_at": datetime.now(timezone.utc).isoformat()}
    background.add_task(_run_ingest, match_id, force)
    return _status[match_id]


@app.get("/api/matches/{match_id}/status")
def ingest_status(match_id: int):
    return _match_status(match_id)


@app.get("/api/matches/{match_id}/files/{name}")
def match_file(match_id: int, name: str):
    if name not in SERVED_FILES:
        raise HTTPException(404, "unknown file")
    path = match_dir(match_id) / name
    if not path.is_file():
        raise HTTPException(404, "match not ingested")
    media = "application/json" if name.endswith(".json") else "application/octet-stream"
    return FileResponse(path, media_type=media, headers={"Cache-Control": "public, max-age=3600"})


# ---------- clips ----------

@app.post("/api/clips", response_model=Clip, status_code=201)
def create_clip(body: ClipCreate, session: Session = Depends(get_session)):
    if not is_ingested(body.match_id):
        raise HTTPException(400, "match not ingested")
    clip = Clip.model_validate(body)
    session.add(clip)
    session.commit()
    session.refresh(clip)
    return clip


@app.get("/api/clips", response_model=list[Clip])
def list_clips(match_id: int | None = None, tag: str | None = None,
               session: Session = Depends(get_session)):
    q = select(Clip).order_by(Clip.created_at.desc())
    if match_id is not None:
        q = q.where(Clip.match_id == match_id)
    clips = session.exec(q).all()
    return [c for c in clips if tag in c.tags] if tag else clips


@app.get("/api/clips/{clip_id}", response_model=Clip)
def get_clip(clip_id: str, session: Session = Depends(get_session)):
    clip = session.get(Clip, clip_id)
    if not clip:
        raise HTTPException(404, "clip not found")
    return clip


@app.patch("/api/clips/{clip_id}", response_model=Clip)
def update_clip(clip_id: str, body: ClipUpdate, session: Session = Depends(get_session)):
    clip = get_clip(clip_id, session)
    changes = body.model_dump(exclude_unset=True)
    try:
        _check_range(changes.get("start_frame", clip.start_frame), changes.get("end_frame", clip.end_frame))
    except ValueError as e:
        raise HTTPException(422, str(e))
    for k, v in changes.items():
        setattr(clip, k, v)
    session.add(clip)
    session.commit()
    session.refresh(clip)
    return clip


@app.delete("/api/clips/{clip_id}", status_code=204)
def delete_clip(clip_id: str, session: Session = Depends(get_session)):
    session.delete(get_clip(clip_id, session))
    session.commit()


# ---------- built frontend (production) ----------

if WEB_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        # Share links like /m/1959846/c/abc123 are client-side routes.
        if path.startswith("api/"):
            raise HTTPException(404, "not found")
        file = WEB_DIST / path
        if path and file.is_file() and WEB_DIST in file.resolve().parents:
            return FileResponse(file)
        return FileResponse(WEB_DIST / "index.html")
