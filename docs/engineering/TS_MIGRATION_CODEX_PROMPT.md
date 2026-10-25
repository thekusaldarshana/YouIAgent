# Prompt for a separate Codex migration session

Copy the text below into a new Codex session after the current session is finished. Run it in `/home/thekusaldarshana/Remeinium/Repositories/vid/youiagent`.

---

Migrate the YouIAgent OSS repository to production-grade TypeScript according to `docs/engineering/TS_MIGRATION_PLAN.md`. Implement the plan, not just another proposal. The repository root is this `youiagent/` folder; sibling directories contain local research and tests and are out of scope.

First inspect `git status`, the plan, `RELEASE_CHECKLIST.md`, package manifests, imports, and current tests. A previous session ran `git pull --ff-only origin main` on 2026-10-12 and it was already up to date at `fd31500`. There are substantial uncommitted release changes from that session. Preserve them exactly; do not reset, clean, stash, overwrite, or discard them. If upstream changes appear, integrate safely before migration.

Use the pinned JavaScript `@langchain/langgraph` package with TypeScript types. Do not switch to Python or redesign the film workflow. Build server and graph code to Node 22 ESM JavaScript, bundle the browser app, and copy all runtime assets. Consolidate dependencies at the root, use strict typing and runtime validation at trust/persistence boundaries, and maintain compatibility with existing job/checkpoint JSON. Explicitly address `harness/node_modules`, `import.meta.url`, child process entry paths, HyperFrames, GSAP, skills, bundled audio, `mechanics.js`, and the generated film's `score-kit.mjs`/`make-score.mjs` contract. Keep a fresh-clone setup command that asks before machine-level installs.

Work in reviewable phases, running targeted checks after each. Finish the migration and run the complete gates from the plan, including a compiled server smoke test and a clean install/build check. Update CI and user/developer docs. Do not publish an npm package, change a release tag, or claim release readiness. Report changes, tests, any tests you could not run, and remaining risks. If a concrete blocker requires user input, finish all independent work first and ask one concise question.
