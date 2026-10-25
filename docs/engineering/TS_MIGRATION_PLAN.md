# TypeScript migration plan

Status: implemented in the working tree (uncommitted); see [Implementation record](#implementation-record). Owner: the implementing session. This plan covers the OSS `youiagent/` checkout only. It does not authorize publishing, moving `v0.1.0`, or modifying sibling research and test directories.

## Baseline and objective

- `git pull --ff-only origin main` on 2026-10-12 reported **Already up to date** at `fd31500`. The checkout contains uncommitted release work; preserve it. Check status again before editing.
- The runtime is Node 22+ ESM. `@langchain/langgraph` 1.4.18 is the JavaScript package; the graph in `harness/graph/film-graph.mjs` uses `StateGraph` and `Annotation`. There is no Python runtime to replace.
- Current source comprises 44 `.mjs` and two `.js` files under `harness/` and `web/`, plus root `setup.mjs`. The two browser/script assets are `web/public/app.js` and `harness/motion/mechanics.js`. Generated per-film `make-score.mjs` files are output artifacts, not application source.
- Preserve CLI behavior, local web routes, provider sign-in, optional website/repository/folder sources, native folder upload, checkpoint/resume format, claim gates, audio, render, and published artifact names. Keep generated jobs and credentials outside version control.
- Deliver strict, maintainable TypeScript source and a reproducible compiled JavaScript build. A production user must not need `tsx`, `ts-node`, TypeScript, or a source checkout at runtime. The root package remains `private: true` during this migration; npm publication is a later release task.

## Target design

1. **One dependency root.** Consolidate runtime dependencies and one lockfile at the repository root. Move the pinned dependencies from `harness/package.json` into root `package.json`; add pinned TypeScript, `@types/node`, and the chosen browser bundler as dev dependencies. Decide whether to retain `harness/` and `web/` manifests solely as documented workspaces or remove them; do not leave competing install paths. `npm ci` at the root must reproduce the build. Keep `engines.node >=22`.
2. **Node ESM build.** Use `tsc` with `module`/`moduleResolution: NodeNext`, `rootDir: .`, `outDir: dist`, `strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`, and `exactOptionalPropertyTypes: true`. Use `.js` suffixes in relative TypeScript imports so emitted ESM resolves directly in Node. Type-check first; emit with source maps. No runtime transpiler or path alias requiring a loader. `skipLibCheck` may be used for third-party declarations, not to suppress application errors. Pin compiler and bundler versions in the lockfile.
3. **Browser build.** Convert `web/public/app.js` to TypeScript source outside the served static directory and bundle it to `dist/web/public/app.js`; type-check with DOM libs. Keep the existing HTML/CSS and public asset URLs. Copy static files into `dist/web/public/` without copying an old hand-edited `app.js`. Avoid putting provider credentials or Node-only modules in this bundle.
4. **Runtime asset layout.** Preserve a `dist/harness/` and `dist/web/` tree so relative application imports remain straightforward. Copy `harness/skills/**`, `harness/media/**`, `harness/motion/README.md`, and needed web static assets. Compile the motion helper as an IIFE at `dist/harness/motion/mechanics.js` because compositions load it as a classic script. Compile the score kit as ESM and stage it into each film as `score-kit.mjs`, retaining the agent-facing contract. Keep generated `make-score.mjs` as generated JS.
5. **Resolve tools as packages, not source-adjacent folders.** The present code assumes `harness/node_modules` for HyperFrames and GSAP in `harness/cli.mjs`, `harness/graph/film-graph.mjs`, `harness/worker/render.mjs`, and `setup.mjs`. Centralize package/bin resolution from the root installation and use platform-correct executable paths. Test both source checkout and compiled `dist/` execution, including Windows path behavior. Do not rewrite arbitrary user `PATH` or assume a global HyperFrames install.
6. **Typed boundaries.** Introduce shared domain types for `FilmInput`, graph state, source manifest, plan/claim decisions, audio selection, render/review reports, job status/events, upload sessions, provider status, and web request/response payloads. The `StateGraph` state and node updates must be explicitly typed. Parse `JSON.parse`, HTTP bodies, environment strings, CLI arguments, provider/agent output, and checkpoint files as `unknown`, then validate or narrow them at the boundary. Add small runtime schemas where persisted or untrusted data crosses a process boundary. Retain backward compatibility with already saved jobs; version only when a real format change is necessary. Avoid blanket `any`, `@ts-ignore`, and non-null assertions used merely to silence errors.
7. **Bootstrap.** Setup must still run on a fresh clone before compiled output exists. Keep a minimal checked JavaScript bootstrap or a compiled-independent launcher that installs root npm dependencies, builds, and then invokes the typed setup implementation. Continue asking before installing system tools, provider CLIs, or the browser runtime. Node itself remains a documented prerequisite until npm packaging is designed.

## Execution sequence

| Phase | Work | Exit gate |
| --- | --- | --- |
| 0. Record baseline | Run current harness/web suites and setup check; note the uncommitted changes and record the current CLI and HTTP behavior. Do not reset, stash, or overwrite them. | Baseline captured; any pre-existing failure identified separately. |
| 1. Build skeleton | Consolidate the root lockfile, add compiler/bundler config and build scripts, asset copy with an explicit manifest, `dist/` ignore rules, and separate Node/DOM type checks. Establish `npm ci && npm run build`. | A fresh root install builds; emitted imports and copied assets resolve. |
| 2. Contracts and leaf modules | Define shared types and runtime boundary parsers; convert pure utilities, source input/capture, upload handling, profile, audio helpers, fingerprints, and their tests. Keep source behavior stable. | Converted tests run against compiled JS; strict checks pass for each migrated area. |
| 3. Graph and workers | Convert provider adapters, claim gate, graph state/nodes, CLI, renderer, review, and score kit. Replace hard-coded `node_modules` and source-path assumptions. Preserve checkpoint JSON and child process arguments. | Offline graph and render-worker tests pass from `dist/`; a saved-job fixture remains readable. |
| 4. Web and bootstrap | Convert web server, login, job state, UI TypeScript, and root setup implementation. Build the browser asset and copy static files. Keep the folder picker and localhost protections. | Compiled server smoke test serves all assets; upload and job-route tests pass. |
| 5. Verification and docs | Update README, developer commands, CI, release checklist, and dependency audit. Test clean install/build/check on Linux CI and a local fresh extraction; document macOS/Windows validation still pending if unavailable. | `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, `npm run setup:check`, and `git diff --check` pass. No tracked generated output or secrets. |

## Required integration tests

- Compile and run the graph's deterministic fixture through the same entry point used by the web server; confirm process exit code, output paths, stage ordering, and claim-gate result.
- Start the compiled local server from a clean `dist/`, fetch HTML/CSS/JS/icons, upload a nested local folder, reject traversal and oversized uploads, and confirm at least one source is required. Ensure the uploaded-folder job records a stable display name and resume path.
- Confirm a persisted job and checkpoint created by the current JavaScript build can be listed and resumed by the TypeScript build without rewriting its format.
- Verify the compiled renderer can resolve HyperFrames, GSAP, skills, music, motion helper, and score kit from the installed package tree. Include a deterministic fixture for the generated score script handoff; use a real provider/end-to-end film run as a separate release gate.
- Run both browser bundle syntax/smoke checks and Node tests. Add targeted tests for runtime validators and path/asset resolution; avoid tests that merely mirror types.

## Review gates and risks

- Review each phase as a small, behavior-preserving change. Keep type-only refactors separate from intentional validation or behavior changes, and document any such changes.
- TypeScript does not provide runtime validation or isolate agent execution. The existing security and real-provider release blockers remain open in `RELEASE_CHECKLIST.md`.
- The asset/layout conversion is the highest regression risk: `import.meta.url`, `harness/node_modules`, child-process script paths, browser assets, bundled MP3s, and skill copies all depend on runtime location.
- Do not turn on npm publishing, mutate the pushed `v0.1.0` tag, or claim first-release readiness as part of this migration. Npm package metadata, `bin`, `files`, `npm pack`, and permission-based install UX are the next packaging workstream after migration and security validation.

## Done when

The production entry points run from compiled JavaScript, application TypeScript passes strict checks, all offline suites pass from the build, original saved jobs remain usable, the browser UI and local folder picker work, setup still asks before machine-level installs, and the changed docs accurately describe installation and execution. Any platform or real-provider test not run is listed explicitly in the handoff.

## Implementation record

Implemented in the working tree on 2026-10-12 on top of `fd31500`, with the existing uncommitted release work preserved (a pre-migration copy of the diff and untracked files was saved outside the repository before editing). Nothing was committed, published, or tagged.

### Decisions beyond the plan

- **Toolchain.** TypeScript 5.9.3 (pinned; the LangChain typings target the 5.x line), esbuild 0.28.2 for the two browser bundles, `@types/node` 22, and zod 4.6.5 for runtime schemas. Strict flags from the plan are on, plus `noUnusedLocals/Parameters`, `verbatimModuleSyntax`, and `noEmitOnError`.
- **Layout.** Sources stay in `harness/` and `web/` (renamed in place to `.ts`); `shared/` holds schemas and wire types; `dist/` mirrors them. Three tsconfigs: Node (emit), browser client (DOM libs, no emit), and the checked-JS build scripts. The browser app moved to `web/client/app.ts`; the build refuses to run if a hand-written `web/public/app.js` reappears.
- **Source execution.** The runtime is compiled JavaScript only. Running `.ts` directly is not supported (imports use `.js` suffixes). "Source checkout" testing means a fresh clone built with `npm ci && npm run build`.
- **Tool resolution.** `harness/runtime/paths.ts` finds the package root and resolves HyperFrames, GSAP, the PATH shim directory, and bundled assets from the single root install and the compiled tree. `YOUIAGENT_HOME` relocates state and `YOUIAGENT_HYPERFRAMES_BIN` overrides the HyperFrames entry; both exist mainly so offline tests never touch real jobs or need a browser.
- **Score kit.** Compiled to ESM, staged as `score-kit.mjs` with its source-map pointer removed. It imports only `node:` built-ins, which a test enforces, because the generated score script runs under Node's permission model.
- **Bootstrap.** `setup.mjs` is plain checked JavaScript: it runs `npm ci` and the build for this folder without prompting (project-local only), then hands off to `dist/setup/main.js`, which asks before system tools, a provider CLI, or the browser download.
- **Intentional behavior changes.** Unhandled failures in the graph runner, render worker, and metrics script print one line instead of a stack trace (exit codes unchanged); `FILM_PROVIDER`, `FILM_CLAIM_MODE`, and `FILM_MUSIC_MODE` are validated up front; a non-object `plan-data.json` becomes a plan finding; boundary JSON is schema-validated and malformed files name themselves. Job file formats are unchanged.

### Results (Linux, Node 22.23.2, npm 12)

On a fresh extraction of the working tree with no prior `node_modules`: `npm ci`, `npm run typecheck`, `npm run build`, `npm test` (62 tests, 0 failures, 0 skipped), `npm run setup:check`, and `git diff --check` pass; `npm audit` reports 0 vulnerabilities. The baseline before migration was 18 harness and 9 web tests, all passing. The plan's integration tests are implemented: compiled graph entry end to end (stage order, exit code, outputs, claim gate), compiled server (assets, nested folder upload, traversal and oversize rejection, stable name and resume path, range requests), saved-job fixtures generated by the pre-migration build (listing, schema parsing, fingerprint and plan-cache-key compatibility, resume without rewriting), asset and score-kit permission contract, and runtime validators. The UI bundle was also loaded in headless Chrome against the compiled server.

### Independent review

A separate read-only review compared the new code with the reconstructed original. It found and these were fixed, each with a regression test: entry-point guards that exited silently when started through a symlinked path; resuming a pre-migration job at source preparation failing on its old `film-motion/mechanics.js`; and provider-response schemas (Jev, Context.dev, Codex JSON-RPC, login events) that were stricter than the original and could discard valid responses. Remaining differences it noted: `setup:check` no longer builds (it now fails with guidance instead), the JSON request-size limit counts bytes rather than characters, and `npm start` does not rebuild a stale `dist/` (`npm run dev` does).

### Not run, and remaining risks

- macOS and Windows were not run. The CI workflow has a non-blocking preview job for both, itself untested. Windows `.cmd` handling in setup and the `codex.exe`/script lookup are unverified; the end-to-end tests skip on Windows.
- No real provider, real HyperFrames render, or real browser-runtime download was exercised. End-to-end tests use a deterministic fake `codex` and fake HyperFrames CLI with real FFmpeg.
- The security and real-provider release blockers in `RELEASE_CHECKLIST.md` are unchanged. Types do not isolate agent execution.
- A clean build takes 30–120 seconds depending on load, mostly `tsc`.
- `harness/node_modules` from the old layout is now unused and left in place on the author's machine.
- npm packaging (`bin`, `files`, `npm pack`) is deliberately not started.
