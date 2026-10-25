import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { binaryStatus, renderBinary } from '../../harness/graph/local-agent.js';

const fakeCodex = fileURLToPath(new URL('./fake-codex.js', import.meta.url));
const fakeHyperframes = fileURLToPath(new URL('./fake-hyperframes.js', import.meta.url));

export interface FakeToolchain {
  /** Environment overrides that put the fake `codex` first on PATH and select the fake HyperFrames. */
  env: Record<string, string>;
}

/** Why the offline pipeline cannot run here, or null when everything it needs is present. */
export async function toolchainSkipReason(): Promise<string | null> {
  if (process.platform === 'win32') return 'the fake codex shim is POSIX-only; Windows is validated separately';
  const [ffmpeg, ffprobe] = await Promise.all([binaryStatus(renderBinary('ffmpeg', process.env['FFMPEG_BIN'])), binaryStatus(renderBinary('ffprobe', process.env['FFPROBE_BIN']))]);
  // In CI a missing FFmpeg is a broken environment, not a reason to skip.
  return ffmpeg && ffprobe ? null : process.env['CI'] ? null : 'FFmpeg and FFprobe are not installed';
}

/** Creates a directory with a `codex` executable that runs the deterministic fake app-server. */
export async function createFakeToolchain(directory: string): Promise<FakeToolchain> {
  const bin = join(directory, 'bin');
  await mkdir(bin, { recursive: true });
  const shim = join(bin, 'codex');
  await writeFile(shim, `#!/bin/sh\nexec "${process.execPath}" "${fakeCodex}" "$@"\n`);
  await chmod(shim, 0o755);
  return {
    env: {
      PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
      YOUIAGENT_HYPERFRAMES_BIN: fakeHyperframes,
      OPENROUTER_API_KEY: '',
      FILM_CLAIM_MODE: 'exact',
      FILM_MODEL: 'fixture',
    },
  };
}
