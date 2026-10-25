#!/usr/bin/env node
/*
 * A deterministic stand-in for the HyperFrames CLI. `check` approves any composition that has an
 * index.html; `render` writes a tiny valid MP4 with the real FFmpeg so the rest of the pipeline
 * (probe, poster, loudness, contact sheet) runs for real.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const [command, ...args] = process.argv.slice(2);

if (command === 'check') {
  if (!existsSync(join(process.cwd(), 'index.html'))) {
    console.error('fake-hyperframes: composition has no index.html');
    process.exit(1);
  }
  console.log(JSON.stringify({ lint: { findings: [] }, contrast: { findings: [] } }));
} else if (command === 'render') {
  const output = args[args.indexOf('--output') + 1];
  if (!output) {
    console.error('fake-hyperframes: render needs --output');
    process.exit(2);
  }
  const ffmpeg = process.env['HYPERFRAMES_FFMPEG_PATH'] || 'ffmpeg';
  const result = spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=5:d=20', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', output], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else {
  console.error(`fake-hyperframes: unsupported command ${command ?? '(none)'}`);
  process.exit(2);
}
