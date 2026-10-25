# Contributing

Open an issue before proposing a large workflow or provider change. Keep pull requests focused, include tests for behavior changes, and do not commit generated films, source captures, secrets, proprietary media, or local job state.

Run `npm ci`, then `npm run typecheck`, `npm run build`, and `npm test` before submitting a pull request (`npm run check` runs the last three). The source is strict TypeScript; avoid `any`, `@ts-ignore`, and non-null assertions, and parse anything read from disk, a child process, an agent, or the network as `unknown` before using it (schemas live in `shared/`).

Do not hand-edit `dist/` or a served `app.js`; the build generates them. A new file that the runtime reads but TypeScript does not emit (a skill, a track, a static asset) must be added to `scripts/asset-manifest.mjs`, or the build and its tests will fail. Saved jobs from earlier builds must keep loading, so do not change the shape of job files without a compatibility test.
