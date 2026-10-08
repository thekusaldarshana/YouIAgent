# YouIAgent

YouIAgent is an experimental local pipeline that turns a public product website and public GitHub repository into a short, source-grounded HyperFrames film. A LangGraph state machine captures source material, prepares evidence, uses the locally authenticated Codex app-server or Claude Agent SDK to plan and compose the film, verifies claims, validates the composition, and renders an MP4.

Version: **0.1.0**.

## What is included

- A reproducible Node 22+ LangGraph pipeline.
- Public website and GitHub source capture with source containment checks.
- A source-quote claim gate using OpenRouter’s Jev Decisions API.
- A deterministic HyperFrames, FFmpeg, and FFprobe render worker.
- Modular brand, concept, motion, and render-review skills staged into each film job. A sampled contact sheet and an advisory visual-review report accompany the final film.
- A local web app for creating jobs, watching graph progress, and reviewing the MP4.
- A new score composed for each film by default, plus an optional four-track CC0 library, user-supplied licensed audio, and a no-music option.

Generated films, source captures, credentials, research logs, local job directories, and user-supplied music are excluded from version control. The four bundled CC0 tracks and their provenance are committed under `harness/media/`.

## Prerequisites

- Node.js 22 or newer.
- Git, FFmpeg, and FFprobe on `PATH`. Set `FFMPEG_BIN` and `FFPROBE_BIN` to override their locations.
- Codex CLI or Claude Code CLI available on `PATH`. Use **Connect** in the local web app, or run `codex login` or `claude auth login` in a terminal. YouIAgent uses the provider's local login; it does not store subscription tokens. Codex runs through its app-server protocol and Claude through the Claude Agent SDK.
- `OPENROUTER_API_KEY` for the semantic claim gate used by the default `product` profile. The `motion-studio` profile uses exact local source-quote validation and does not need this key.
- Public HTTP(S) website and public `github.com` repository URLs.

`CONTEXT_DEV_API_KEY` is optional. It adds an observed style guide when available; source capture continues without it.

## Run locally

```bash
cd harness
npm ci
npx hyperframes browser ensure
cd ..

export OPENROUTER_API_KEY=your_key
# Optional: use your own licensed tracks instead of the original-score default.
# export FILM_AUDIO_DIR=/absolute/path/to/licensed-audio
# Optional: use the bundled CC0 library instead of creating a score.
# export FILM_MUSIC_MODE=library
# Optional: omit background music. The web app offers this choice in its form.
# export FILM_MUSIC_MODE=silent
# Optional: a flat directory of licensed images, video, and audio to stage as local inputs.
export FILM_ASSET_DIR=/absolute/path/to/licensed-media

node harness/graph/run.mjs https://example.com https://github.com/owner/repository "Create a short product launch film."
```

For the local browser UI, run `npm run dev --prefix web` after installing the harness dependencies. Open `http://127.0.0.1:4174`, select Codex or Claude Code, and click **Connect** to start sign-in from the page. Codex displays its native browser sign-in link; Claude Code opens its subscription login. Use **Refresh connections** if you signed in outside the page. Web jobs use exact source-quote validation when `OPENROUTER_API_KEY` is absent. Failed jobs with saved checkpoints can be resumed from the same job page; the UI shows stage history, validation findings, and live activity. See [web/README.md](web/README.md) for the UI's current scope.

The default `FILM_MUSIC_MODE=original` asks the composition agent to write and render a new score specifically for the film. It uses local code and FFmpeg, with no additional music provider or music key. Set `FILM_MUSIC_MODE=library` to select from the bundled CC0 tracks; `FILM_AUDIO_DIR` supplies your own licensed MP3, M4A, OGG, or WAV catalog and selects library mode automatically in the CLI. Set `FILM_MUSIC_MODE=silent` to omit background music. The graph verifies the generated score's duration and audibility before rendering. If a composition omits its selected soundtrack, the graph adds it to the MP4 with short fades as a deterministic fallback.

## Square motion-studio run

`motion-studio` is a structural profile for a 27-second, 1440×1440 film: 120 BPM, 54 explicitly mapped beats, one deterministic 2D timeline, local media only, and exact source-quote validation. Supply the media you have rights to distribute through `FILM_ASSET_DIR`; the run creates a `film-inputs/CATALOG.md` in its job workspace for the planning and composition steps.

```bash
export FILM_PROFILE=motion-studio
export FILM_ASSET_DIR=/absolute/path/to/licensed-media
export FFMPEG_BIN="$HOME/supervenv/bin/ffmpeg"
export FFPROBE_BIN="$HOME/supervenv/bin/ffprobe"

node harness/graph/run.mjs https://example.com https://github.com/owner/repository "Create a square motion-studio launch film."
```

Copy [.env.example](.env.example) only if your shell or process manager loads environment files; YouIAgent itself reads credentials from the process environment and never reads a repository `.env` file.

The output is kept under `.youiagent/jobs/<uuid>/workspace/film-output/`. Each job includes the plan, composition, check records, render report, MP4, and JPEG poster. Inspect the rendered MP4 and listen to any selected audio before distributing it.

The graph's coordinator skill at `harness/skills/film-graph/` routes each stage to a focused skill under `harness/skills/`. After rendering, the review stage writes `visual-review.md` and `review/contact-sheet.jpg`. It records observed issues and whether the reviewer actually saw or heard the media; it does not certify artistic quality or automatically change the finished film.

Use `FILM_JOB_DIR`, `FILM_RESUME_PLAN=1`, and `FILM_RESUME_COMPOSITION=1` to resume an interrupted compatible job. See [the graph reference](harness/graph/README.md) for the state graph and resume requirements.

## Verify the checkout

```bash
npm run check --prefix harness
npm run check --prefix web
```

The tests are offline and use fixtures. They do not invoke Codex, OpenRouter, Context.dev, a browser render, or a creative model.

## License

YouIAgent source is licensed under [Apache License 2.0](LICENSE). Dependencies retain their own licenses. In particular, GSAP is distributed under its [standard license](https://gsap.com/standard-license/), and any audio or source media must have its own distribution rights.

## Status

This is an experimental local OSS release. It has a working end-to-end pipeline and automated checks, but a generated film still needs human review for factual accuracy, visual quality, accessibility, and media rights.
