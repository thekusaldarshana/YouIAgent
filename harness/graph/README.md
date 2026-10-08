# Local LangGraph film prototype

This is a working LangGraph.js `StateGraph`, not a simulated flow. Run with Node 22 and the pinned dependencies in `harness/package-lock.json`.

The pipeline has been exercised against a real public product source and render. The saved trial artifacts and internal research notes are deliberately excluded from the OSS distribution.

```bash
cd harness && npm ci
node graph/run.mjs https://example.com https://github.com/owner/repo
```

The local test uses GPT-6 Sol through the signed-in Codex CLI. Set `FILM_MODEL` and `FILM_EFFORT` to change that adapter. The default asks the composition agent to create a new score for each film. Set `FILM_MUSIC_MODE=library` for the bundled CC0 tracks, `FILM_AUDIO_DIR` for your own licensed tracks, or `FILM_MUSIC_MODE=silent` for no background music. Supply a flat directory of licensed images, videos, and audio through `FILM_ASSET_DIR` to stage them in the job's `film-inputs/` catalog.

Set `FILM_PROFILE=motion-studio` for the square 27-second profile. It requires a 1440×1440 render at 30 fps, a 120 BPM plan with 54 ordered beat events, and local exact source-quote validation; it therefore runs without an `OPENROUTER_API_KEY`. Provide `FFMPEG_BIN` and `FFPROBE_BIN` when FFmpeg is outside `PATH` (for example, under `~/supervenv/bin`).

## Nodes and branches

`capture` → `prepare` → `createPlan` → `planGate` → `stageAudio` → `compose` → `checkComposition` → `renderFilm`.

- `capture` fetches public HTML/CSS, shallow-clones the repository, records the commit and captured-source hash, and obtains a fresh Context.dev styleguide. No local design cache is used by default.
- `prepare` creates the compact evidence pack, stages the pinned runtime and motion helpers, installs the graph-specific creative skill in the job workspace, and catalogs optional local media inputs.
- `createPlan` is the first model call. It invents the story, writes the beat plan, source-cited claims, exact source excerpts, and a music choice.
- `planGate` verifies durations, source path containment, and exact excerpt presence. The default profile adds Jev support probabilities: only a near-certain contradiction blocks during this uncalibrated trial, while medium-confidence decisions are recorded for review. The motion-studio profile accepts only exact local source quotes. A failing plan gets at most one targeted model repair. On resume, a passing gate is reused only when the plan, cited source-file bytes, site capture hash, and repository commit match.
- `stageAudio` records the planned original score path or copies a selected library track. In original mode, the composition agent writes `make-score.mjs`; `checkComposition` runs that script with Node file permissions limited to the composition and validates the generated WAV before rendering.
- `compose` is the second model call. It writes a unique HyperFrames composition and handoff. It does not run HyperFrames.
- `checkComposition` runs the HyperFrames gate in code. A failure gets at most two targeted model repairs, each followed by the same gate.
- `renderFilm` invokes the deterministic worker for MP4, music loudness correction, poster and FFprobe verification. New runs pass a check attestation keyed to the composition and frozen asset bytes; the worker skips its duplicate HyperFrames check only when that hash still matches. A standalone worker run without an attestation retains its own check.

Events, model JSONL, Jev decisions, node output and the MP4 stay under `.youiagent/jobs/<uuid>/`. `node harness/graph/metrics.mjs <job-dir>` writes `graph-metrics.json` with node times, observable Codex steps, token totals, Jev usage, Context.dev credits, and render data. A token-price calculation is only an API base-rate estimate, not a subscription charge or hosted unit cost.

## Resume after local failure

For the **same captured source and plan**, resume without recapturing or calling the planner:

```bash
FILM_JOB_DIR=/absolute/path/to/job FILM_RESUME_PLAN=1 FILM_RESUME_COMPOSITION=1 \
node harness/graph/run.mjs https://example.com https://github.com/owner/repo
```

Set `FILM_RESUME_COMPOSITION=1` only when the composition and render handoff are already on disk and you intend to keep them; otherwise the graph runs composition again. It checks that the source URL and repository URL match the job. Re-capture into a new job when either source changes. Do not treat a later repository commit on the same URL as matching the old capture unless the goal is to reproduce that pinned earlier version.

## Remaining quality work

The graph produces a film, but one completed creative run cannot prove quality or efficiency. It currently lacks a deterministic browser screenshot in source capture, automated visual review of snapshot contact sheets, an artistic listening gate for music, and exact per-model API billing. The hash-based worker check skip was verified in a same-composition real local render. Keep the creative plan and composition model-driven until a less costly path matches them in blind reviews.
