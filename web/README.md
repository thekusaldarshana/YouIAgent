# YouIAgent local web app

This is the local UI for the current LangGraph film pipeline. It accepts a **public website and public GitHub repository**, launches `harness/graph/run.mjs` as a child process, shows graph stage progress, and serves the finished MP4, poster, and source record. It binds to `127.0.0.1` only. It is not a hosted SaaS, account system, payment system, or secure multi-user job service.

## Run

From the repository root:

```sh
npm ci --prefix harness
npx --prefix harness hyperframes browser ensure
npm run dev --prefix web
```

Open `http://127.0.0.1:4174`. Choose Codex or Claude Code, then click **Connect** below the selector. Codex returns a sign-in link; Claude Code opens its subscription login in a browser. The page shows progress and offers a cancel button. You can also sign in externally with `codex login` or `claude auth login` and click **Refresh connections**. YouIAgent reuses that local login through Codex app-server or the Claude Agent SDK, without copying subscription credentials. Choose a model and soundtrack mode in the form; the default creates a new score, with a bundled CC0 library and silence as alternatives. The app also needs Node 22+, Git, FFmpeg, and FFprobe described in the root README. `CONTEXT_DEV_API_KEY`, `FILM_MODEL`, `FILM_EFFORT`, `FILM_PROFILE`, `FILM_AUDIO_DIR`, `FILM_ASSET_DIR`, `FFMPEG_BIN`, and `FFPROBE_BIN` may be set in the server process environment. Set `FILM_AUDIO_DIR` to use your own licensed tracks in library mode. Without `OPENROUTER_API_KEY`, web jobs use exact source-quote validation. With that key, they use the semantic claim gate unless `FILM_CLAIM_MODE` overrides it. The provider login covers planning and composition; it does not provide FFmpeg or the optional OpenRouter service.

Open that address **in a browser on the same device running the server**. The GitHub repository URL is source code, not the running app. The local server binds to `127.0.0.1` and deliberately does not accept connections from other devices. If the terminal does not print `YouIAgent local web app: http://127.0.0.1:4174`, check the terminal error and whether another process already owns port 4174. A cloned device has no previous job files; remove an old `?job=<uuid>` query from the URL to start at the homepage.

Jobs and output live in `.youiagent/jobs/<uuid>/`. A job URL has `?job=<uuid>` and can be reopened after the server restarts. Failed or interrupted jobs with a completed source capture show **Resume from checkpoint**. The server reuses completed source, plan, and composition artifacts when present, then reruns their deterministic gates before continuing. A resumed attempt keeps the same job URL and writes separate `web-run-<attempt>` logs. If no complete source checkpoint exists, start a new film.

The **Past creations** section on the homepage lists saved local jobs, including finished films and resumable runs. Finished films show a poster and MP4 download. The list is rebuilt from `.youiagent/jobs/` when the app starts, so restarting the app does not erase it.

## Limits

- The two source URLs are required because the current LangGraph CLI requires both. The older feasibility UI accepted either one, but that was a different workflow.
- The server starts the local graph and renders on the same machine. It is not suitable for exposure to the public internet without authentication, durable worker dispatch, sandboxing, quotas, and credential isolation.
- Existing archived feasibility docs and the older Brag subprocess runner stay on this computer but are outside this release; the committed app uses the current graph.

Run `npm run check --prefix web` for the web source and job-state tests.
