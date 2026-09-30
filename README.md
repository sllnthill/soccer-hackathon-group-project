# Tracking Clipper

Scrub, clip and share SkillCorner tracking data the way video analysts work with match video.
Works with any match in [SkillCorner open data](https://github.com/SkillCorner/opendata): pick a match ID and it is processed on demand.

> Work in progress. The full README (usage guide, screenshots, architecture, technical decisions) lands with the final build.

## Quick start (Docker)

```bash
docker compose up --build
# open http://localhost:8000
```

The image builds the frontend and serves it from FastAPI. Three matches (1959846, 2007721, 1996436; set in `PRELOAD_MATCHES` in `docker-compose.yml`) are processed at startup, so the first run takes a little while before they are ready. The demo match is 1959846 (Melbourne Victory 3–4 Western United).
Processed data and the SQLite clip library live in the `clipper-data` Docker volume, separate from your local `data/`.
Match files are downloaded from SkillCorner's GitHub unless a local clone is mounted (see below); the dataset is never stored in this repo.

## Local development

Requires [uv](https://docs.astral.sh/uv/) and Node 20+. Run the backend and frontend in two terminals.

```bash
# Terminal 1: backend
uv sync                                          # Python deps (Python 3.12)
uv run python -m ingest.cli --match 1959846      # process a match into data/matches/<id>/
uv run uvicorn api.main:app --reload             # API on :8000

# Terminal 2: frontend
cd web && npm install && npm run dev             # http://localhost:5173, proxies /api to :8000

uv run pytest                                    # tests
```

- Open **http://localhost:5173** while developing. FastAPI also serves the built frontend from `web/dist` on :8000, but that build only reflects your changes after `npm run build`.
- The ingest CLI accepts several matches (`--match 2007721 --match 1996436`) and skips ones already processed; add `--force` to re-process. Bumping `PIPELINE_VERSION` in `ingest/pack.py` re-processes cached matches automatically.
- To use another match, take any ID under `opendata/data/matches/`. Process it ahead of time with the CLI, or pick it in the app and it is processed on demand.

If a local clone of `SkillCorner/opendata` sits next to this folder (with `git lfs pull` run), files are read from it instead of downloaded. Docker mounts `../opendata` the same way (override with `OPENDATA_PATH`).

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENDATA_DIR` | `../opendata` | Local SkillCorner clone. Set it to an empty string to always download from GitHub |
| `OPENDATA_REPO` / `OPENDATA_REF` | `SkillCorner/opendata` / `master` | GitHub repo and branch to download from |
| `CLIPPER_CACHE_DIR` | `./data` | Where processed matches and `clipper.db` are stored |
| `PRELOAD_MATCHES` | none | Comma-separated match IDs to process when the API starts |
| `DATABASE_URL` | SQLite in the cache dir | Database for the clip library |

## Project layout

```
ingest/   Python: fetch a match, pack tracking into compact binary, slim events/phases
api/      FastAPI: match catalogue + on-demand ingest, processed files, clip library (SQLite)
web/      React + TypeScript + Vite: canvas pitch renderer, player, clipping UI
tests/    pytest: binary round-trip against raw JSONL, API + 10-second clip limit
```
