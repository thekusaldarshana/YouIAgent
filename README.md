# YouIAgent

YouIAgent is an experimental local pipeline that turns a product website, GitHub repository, or local project folder into a short, source-grounded HyperFrames film. A LangGraph state machine captures source material, prepares evidence, uses the locally authenticated Codex app-server or Claude Agent SDK to plan and compose the film, verifies claims, validates the composition, and renders an MP4.

Version: **0.1.0**.

## What is included

- A reproducible Node 22+ LangGraph pipeline.
- Website, GitHub repository, and local folder source capture. Supply at least one source.
- A source-quote claim gate using OpenRouter’s Jev Decisions API.
- A deterministic HyperFrames, FFmpeg, and FFprobe render worker.
- Modular brand, concept, motion, and render-review skills staged into each film job. A sampled contact sheet and an advisory visual-review report accompany the final film.
- A local web app for creating jobs, watching graph progress, and reviewing the MP4.
- A new score composed for each film by default, plus an optional four-track CC0 library, user-supplied licensed audio, and a no-music option.

Generated films, source captures, credentials, research logs, local job directories, and user-supplied music are excluded from version control. The four bundled CC0 tracks and their provenance are committed under `harness/media/`.

## Prerequisites

- Node.js 22 or newer and npm. The interactive setup command checks and offers to install the remaining tools with permission.
- Git, FFmpeg, and FFprobe. Setup checks them and can install missing tools through apt, Homebrew, or WinGet when available. Set `FFMPEG_BIN` and `FFPROBE_BIN` for custom locations; `~/supervenv/bin` is detected automatically.
- Codex CLI or Claude Code CLI. Setup offers to install one if neither exists. Use **Connect** in the local web app, or run `codex login` or `claude auth login` in a terminal. YouIAgent uses the provider's local login; it does not store subscription tokens. Codex runs through its app-server protocol and Claude through the Claude Agent SDK.
- `OPENROUTER_API_KEY` is optional for the semantic claim gate. Without it, CLI and web jobs use exact local source-quote validation.
- An HTTP(S) website URL, a `github.com` repository URL, or a local folder. Supply at least one. The web app can open the native folder chooser. Private GitHub repositories work when Git on this computer already has access through a credential helper; do not put tokens in a URL.

`CONTEXT_DEV_API_KEY` is optional. It adds an observed style guide when available; source capture continues without it.

## Run locally

```bash
npm run setup

# Optional: use the semantic claim gate.
# export OPENROUTER_API_KEY=your_key
# Optional: use your own licensed tracks instead of the original-score default.
# export FILM_AUDIO_DIR=/absolute/path/to/licensed-audio
# Optional: use the bundled CC0 library instead of creating a score.
# export FILM_MUSIC_MODE=library
# Optional: omit background music. The web app offers this choice in its form.
# export FILM_MUSIC_MODE=silent
# Optional: a flat directory of licensed images, video, and audio to stage as local inputs.
# export FILM_ASSET_DIR=/absolute/path/to/licensed-media

npm run film -- https://example.com https://github.com/owner/repository "Create a short product launch film."
```

Setup runs on a fresh clone. It installs this folder's pinned dependencies (`npm ci`) and builds the TypeScript sources, then checks the machine, asks before installing missing system tools or a provider CLI, and asks before downloading the browser runtime. Only the project-local install and build run without a prompt; nothing machine-level does. It does not sign in for you. Run `npm run setup:check` for a read-only prerequisite check (it needs the dependencies installed and the project built, and never installs or builds anything). Node.js itself must be installed first because npm runs the setup command. On systems without apt, Homebrew, or WinGet, install Git and FFmpeg with your preferred package manager and rerun setup. [Codex installation guidance](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) and [Claude Code installation guidance](https://code.claude.com/docs/en/getting-started) describe their CLI packages.

Use `-` to omit a source in the CLI: `npm run film -- https://example.com -` for a website alone, or `npm run film -- - /absolute/path/to/project` for a local folder alone. Relative local paths also work in the CLI and resolve from the current directory. To use a private GitHub repository, first make sure `git clone https://github.com/owner/repository.git` works with your configured Git credentials. The local folder snapshot excludes hidden files, dependency and build directories, symlinks, and common secret directories; it is limited to 2,000 files and 100 MB. Its contents and any private GitHub checkout stay in the ignored local job directory, but selected source excerpts are sent to the connected generation provider.

For the local browser UI, run `npm start` after setup (it serves the compiled build; `npm run dev` rebuilds first). Open `http://127.0.0.1:4174`, provide a website or GitHub repository, enter a local folder path, or click **Choose local folder** to select one in the native file chooser. Select Codex or Claude Code and click **Connect** to start sign-in from the page. Codex displays its native browser sign-in link; Claude Code opens its subscription login. Use **Refresh connections** if you signed in outside the page. Web jobs use exact source-quote validation when `OPENROUTER_API_KEY` is absent. Failed jobs with saved checkpoints can be resumed from the same job page; the UI shows stage history, validation findings, and live activity. See [web/README.md](web/README.md) for the UI's current scope.

The default `FILM_MUSIC_MODE=original` asks the composition agent to write and render a new score specifically for the film. It uses local code and FFmpeg, with no additional music provider or music key. Set `FILM_MUSIC_MODE=library` to select from the bundled CC0 tracks; `FILM_AUDIO_DIR` supplies your own licensed MP3, M4A, OGG, or WAV catalog and selects library mode automatically in the CLI. Set `FILM_MUSIC_MODE=silent` to omit background music. The graph verifies the generated score's duration and audibility before rendering. If a composition omits its selected soundtrack, the graph adds it to the MP4 with short fades as a deterministic fallback.

## Square motion-studio run

`motion-studio` is a structural profile for a 27-second, 1440×1440 film: 120 BPM, 54 explicitly mapped beats, one deterministic 2D timeline, local media only, and exact source-quote validation. Supply the media you have rights to distribute through `FILM_ASSET_DIR`; the run creates a `film-inputs/CATALOG.md` in its job workspace for the planning and composition steps.

```bash
export FILM_PROFILE=motion-studio
export FILM_ASSET_DIR=/absolute/path/to/licensed-media
export FFMPEG_BIN="$HOME/supervenv/bin/ffmpeg"
export FFPROBE_BIN="$HOME/supervenv/bin/ffprobe"

npm run film -- https://example.com https://github.com/owner/repository "Create a square motion-studio launch film."
```

Copy [.env.example](.env.example) only if your shell or process manager loads environment files; YouIAgent itself reads credentials from the process environment and never reads a repository `.env` file.

The output is kept under `.youiagent/jobs/<uuid>/workspace/film-output/`. Each job includes the plan, composition, check records, render report, MP4, and JPEG poster. Inspect the rendered MP4 and listen to any selected audio before distributing it.

The graph's coordinator skill at `harness/skills/film-graph/` routes each stage to a focused skill under `harness/skills/`. After rendering, the review stage writes `visual-review.md` and `review/contact-sheet.jpg`. It records observed issues and whether the reviewer actually saw or heard the media; it does not certify artistic quality or automatically change the finished film.

Use `FILM_JOB_DIR`, `FILM_RESUME_PLAN=1`, and `FILM_RESUME_COMPOSITION=1` to resume an interrupted compatible job. See [the graph reference](harness/graph/README.md) for the state graph and resume requirements.

## Develop and verify

YouIAgent is TypeScript (strict, Node 22 ESM). Production runs only compiled JavaScript from `dist/`; no `tsx`, `ts-node`, or TypeScript is needed at runtime.

```bash
npm ci               # one lockfile, one node_modules, at the repository root
npm run typecheck    # strict type-check: Node code, the browser client (DOM libs), and the build scripts
npm run build        # compile to dist/, bundle the browser app, copy skills, music and static assets
npm test             # run the compiled tests (fails if dist/ is missing or older than the sources)
npm run setup:check  # read-only prerequisite check
```

`npm run check` runs the typecheck, build, and tests in order. The generated `dist/` directory is ignored by Git. Edit `web/client/app.ts`, never a served `app.js`; the build owns that file.

| Path | Contents |
| --- | --- |
| `harness/` | The LangGraph film graph, provider adapters, render worker, score kit, motion helper, skills, and bundled music. |
| `web/` | The local server and its job and upload logic. `web/client/` is the browser app; `web/public/` holds static HTML, CSS, and icons. |
| `shared/` | Domain schemas and wire types shared by the graph, the server, and the browser. |
| `setup/`, `setup.mjs` | The typed setup and the plain-JavaScript bootstrap that runs before anything is built. |
| `test/` | Integration tests and the saved-job fixtures generated by the pre-migration build. |
| `scripts/` | The build, the test runner, and the explicit asset manifest. |

The tests are offline. Most are unit tests; the integration tests run the compiled graph and server end to end against a deterministic stand-in for `codex` and for the HyperFrames CLI, with real FFmpeg. They do not call a model provider, OpenRouter, Context.dev, or a browser render. They need FFmpeg and FFprobe; without them the end-to-end tests are skipped locally with a message, and fail when `CI` is set.

Two environment variables are mainly for development and tests: `YOUIAGENT_HOME` relocates the `.youiagent` jobs and uploads folder, and `YOUIAGENT_HYPERFRAMES_BIN` points at a different HyperFrames entry script.

## License

YouIAgent source is licensed under [Apache License 2.0](LICENSE). Dependencies retain their own licenses. In particular, GSAP is distributed under its [standard license](https://gsap.com/standard-license/), and any audio or source media must have its own distribution rights.

## Status

This is an experimental local OSS release. It has a working end-to-end pipeline and automated checks, but a generated film still needs human review for factual accuracy, visual quality, accessibility, and media rights.
