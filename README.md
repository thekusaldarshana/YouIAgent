# YouIAgent

YouIAgent is an experimental local pipeline that turns a public product website and public GitHub repository into a short, source-grounded HyperFrames film. A LangGraph state machine captures source material, prepares evidence, asks a locally authenticated Codex CLI to plan and compose the film, verifies claims, validates the composition, and renders an MP4.

Version: **0.1.0**.

## What is included

- A reproducible Node 22+ LangGraph pipeline.
- Public website and GitHub source capture with source containment checks.
- A source-quote claim gate using OpenRouter’s Jev Decisions API.
- A deterministic HyperFrames, FFmpeg, and FFprobe render worker.
- A local web app for creating jobs, watching graph progress, and reviewing the MP4.
- Four bundled CC0 soundtracks selected to fit the story, with an explicit silence option and support for user-supplied licensed audio and media.

Generated films, source captures, credentials, research logs, local job directories, and user-supplied music are excluded from version control. The four bundled CC0 tracks and their provenance are committed under `harness/media/`.

## Prerequisites

- Node.js 22 or newer.
- Git, FFmpeg, and FFprobe on `PATH`. Set `FFMPEG_BIN` and `FFPROBE_BIN` to override their locations.
- A signed-in [Codex CLI](https://developers.openai.com/codex/cli/) available as `codex`. The graph invokes it for planning and composition.
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
# Optional: use your own tracks instead of the bundled CC0 soundtrack library.
export FILM_AUDIO_DIR=/absolute/path/to/licensed-audio
# Optional: omit background music. The web app offers this choice in its form.
# export FILM_MUSIC_MODE=silent
# Optional: a flat directory of licensed images, video, and audio to stage as local inputs.
export FILM_ASSET_DIR=/absolute/path/to/licensed-media

node harness/graph/run.mjs https://example.com https://github.com/owner/repository "Create a short product launch film."
```

For the local browser UI, run `npm run dev --prefix web` after installing the harness dependencies and setting the same environment variables. Open `http://127.0.0.1:4174`. See [web/README.md](web/README.md) for the UI's current scope.

The default `FILM_MUSIC_MODE=auto` selects one of the bundled CC0 tracks, so a fresh clone needs no audio setup. `FILM_AUDIO_DIR` replaces that catalog with your licensed MP3, M4A, OGG, or WAV files. Set `FILM_MUSIC_MODE=silent` only when you want no background music. If a composition accidentally omits its chosen soundtrack, the graph adds the selected track to the MP4 with short fades as a deterministic fallback.

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
