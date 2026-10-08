# YouIAgent local web app

This is the local UI for the current LangGraph film pipeline. It accepts a **public website and public GitHub repository**, launches `harness/graph/run.mjs` as a child process, shows graph stage progress, and serves the finished MP4, poster, and source record. It binds to `127.0.0.1` only. It is not a hosted SaaS, account system, payment system, or secure multi-user job service.

## Run

From the repository root:

```sh
npm ci --prefix harness
npx --prefix harness hyperframes browser ensure
export OPENROUTER_API_KEY=your_key
npm run dev --prefix web
```

Open `http://127.0.0.1:4174`. The app uses the locally authenticated Codex CLI, Node 22+, Git, FFmpeg, and FFprobe described in the root README. `CONTEXT_DEV_API_KEY`, `FILM_MODEL`, `FILM_EFFORT`, `FILM_PROFILE`, `FILM_AUDIO_DIR`, `FILM_ASSET_DIR`, `FFMPEG_BIN`, and `FFPROBE_BIN` may be set in the server process environment. For `FILM_PROFILE=motion-studio`, the exact claim gate does not require OpenRouter.

Jobs and output live in `.youiagent/jobs/<uuid>/`. A job URL has `?job=<uuid>` and can be reopened after the server restarts. A job interrupted by a server restart is reported as interrupted; resume that job through the CLI with the documented `FILM_JOB_DIR` options. The web app currently starts new jobs only.

## Limits

- The two source URLs are required because the current LangGraph CLI requires both. The older feasibility UI accepted either one, but that was a different workflow.
- The server starts the local graph and renders on the same machine. It is not suitable for exposure to the public internet without authentication, durable worker dispatch, sandboxing, quotas, and credential isolation.
- Existing archived feasibility docs and the older Brag subprocess runner stay on this computer but are outside this release; the committed app uses the current graph.

Run `npm run check --prefix web` for the web source and job-state tests.
