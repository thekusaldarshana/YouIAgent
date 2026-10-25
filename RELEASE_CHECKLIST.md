# First public release checklist

The current checkout is an experimental local preview. Do not move the public `v0.1.0` tag until the release commit is final and checked.

## Completed in the working tree

- [x] The web header links to the GitHub repository with a star icon.
- [x] Website and repository inputs are individually optional; at least one is required.
- [x] GitHub URLs use existing local Git credentials, and local folders can be captured as filtered snapshots.
- [x] The web form opens a native folder chooser and uploads the selected files to local job staging.
- [x] An opt-in setup command installs this folder's pinned npm dependencies and builds it, then checks prerequisites, asks before installing system tools or a provider CLI, and asks before downloading the browser runtime.
- [x] `~/supervenv/bin/ffmpeg` and `ffprobe` are detected when present.
- [x] Remove the CLI commands that referred to a missing skill.
- [x] Add CI for typecheck, build, the compiled offline suites, and a read-only setup check on Linux.
- [x] Migrate the source to strict TypeScript that runs as compiled JavaScript from `dist/`, with one root dependency install, schema-validated trust boundaries, and compiled-server, graph, and saved-job tests. Validated on Linux only; see [the engineering plan](docs/engineering/TS_MIGRATION_PLAN.md) for results and remaining risks.

## Required before a broad public release

- [ ] Isolate agent and render execution from the host's private files and broad credentials. Test prompt injection from untrusted source material. Until this is done, limit use to sources the operator trusts.
- [ ] Complete a fresh-clone, real-provider run through capture, plan, score, render, review, and resume. Cover website-only, GitHub-only, local-folder-only, and both-source jobs. Test private GitHub access using a credential helper.
- [ ] Confirm the CI workflow passes on the final release commit.
- [ ] Verify setup, the build, and the tests on supported Linux, macOS, and Windows systems. The TypeScript build is validated on Linux only; macOS and Windows runs, including Windows executable and `.cmd` handling, are still pending. Provide a smooth Node.js bootstrap path and confirm that browser system libraries are installed or diagnosed.
- [ ] Before publishing, turn the private root package into an installable npm package with a CLI entry point, bundled web assets, a documented setup command for permitted system dependencies, and a tested `npm pack` plus clean-machine install. Review the package contents before publication.
- [ ] Freeze the release commit, write release notes, then update or replace the already-pushed `v0.1.0` tag as the final release step.

## Quality and usability gaps

- [ ] Add a browser-rendered screenshot to website capture for JavaScript-heavy sites.
- [ ] Harden public website fetching against DNS rebinding between the IP check and the actual fetch.
- [ ] Calibrate the semantic claim gate and make uncertainty obvious in the finished job review. Exact quote presence alone does not prove a claim.
- [ ] Add job cancellation and local job deletion or retention controls for long-running jobs and disk usage.
- [ ] Remove abandoned folder upload sessions after a timeout or server restart so incomplete uploads do not accumulate on disk.
- [ ] Give the security policy a specific private reporting channel.
