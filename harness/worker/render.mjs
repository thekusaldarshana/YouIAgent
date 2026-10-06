#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { compositionFingerprint } from './fingerprint.mjs';
import { normalizeMusicOnlyOutput } from './audio-level.mjs';

const execFileAsync = promisify(execFile);
const hyperframesBin = fileURLToPath(new URL('../node_modules/.bin/hyperframes', import.meta.url));
const ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg';
const ffprobeBin = process.env.FFPROBE_BIN || 'ffprobe';

const args = process.argv.slice(2);
const validateOnly = args.includes('--validate-only');
const checkedReportArg = args.find((arg) => arg.startsWith('--checked-report='))?.slice('--checked-report='.length);
const [workspaceArg, handoffArg] = args.filter((arg) => arg !== '--validate-only' && !arg.startsWith('--checked-report='));
if (!workspaceArg) {
  console.error('Usage: node render.mjs <job-workspace> [render-handoff.json]');
  process.exit(2);
}

const workspace = resolve(workspaceArg);
const handoffPath = handoffArg ? resolve(handoffArg) : join(workspace, 'film-output', 'render-handoff.json');
const handoff = JSON.parse(await readFile(handoffPath, 'utf8'));

function withinWorkspace(value, label) {
  if (!value || isAbsolute(value) || value.split(/[\\/]/).includes('..')) throw new Error(`${label} must be a relative path inside the workspace.`);
  const path = resolve(workspace, value);
  if (!path.startsWith(`${workspace}/`)) throw new Error(`${label} escapes the workspace.`);
  return path;
}

const composition = withinWorkspace(handoff.composition, 'composition');
const output = withinWorkspace(handoff.output, 'output');
const poster = output.replace(/\.mp4$/i, '.jpg');
if (poster === output) throw new Error('output must end in .mp4');
if (!(await stat(join(composition, 'index.html')).catch(() => null))?.isFile()) throw new Error('Composition index.html is missing.');
if (!Number.isFinite(handoff.posterAtSeconds) || handoff.posterAtSeconds < 0) throw new Error('posterAtSeconds must be a nonnegative number.');
if (validateOnly) {
  console.log(JSON.stringify({ composition, output, poster, posterAtSeconds: handoff.posterAtSeconds, valid: true }, null, 2));
  process.exit(0);
}

async function run(name, args, cwd) {
  const start = Date.now();
  await new Promise((done, fail) => {
    const child = spawn(name, args, { cwd, stdio: 'inherit' });
    child.on('error', fail);
    child.on('exit', (code, signal) => code === 0 ? done() : fail(new Error(`${name} exited with ${signal || code}`)));
  });
  return (Date.now() - start) / 1000;
}

const timings = {};
let checkSkippedBecauseHashMatched = false;
if (checkedReportArg) {
  const attestation = JSON.parse(await readFile(resolve(checkedReportArg), 'utf8'));
  const hash = await compositionFingerprint(composition);
  if (attestation.passed !== true || attestation.composition !== handoff.composition || attestation.sha256 !== hash) {
    throw new Error('Composition changed after its HyperFrames check; refusing to skip validation.');
  }
  checkSkippedBecauseHashMatched = true;
  timings.checkSeconds = 0;
} else timings.checkSeconds = await run(hyperframesBin, ['check'], composition);
timings.renderSeconds = await run(hyperframesBin, ['render', '--quality', 'looks', '--output', output], composition);
const preLevelProbe = await execFileAsync(ffprobeBin, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', output]);
const hasRenderedAudio = JSON.parse(preLevelProbe.stdout).streams?.some((stream) => stream.codec_type === 'audio');
const audioLevel = hasRenderedAudio ? await normalizeMusicOnlyOutput(output, ffmpegBin) : null;
timings.posterSeconds = await run(ffmpegBin, ['-v', 'error', '-y', '-ss', String(handoff.posterAtSeconds), '-i', output, '-frames:v', '1', '-q:v', '2', poster], dirname(output));
const file = await stat(output);
if (!file.isFile() || file.size === 0) throw new Error('Render did not produce a nonempty MP4.');
if (!(await stat(poster).catch(() => null))?.isFile()) throw new Error('Poster extraction did not produce a JPEG.');
const { stdout } = await execFileAsync(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate', '-of', 'json', output]);
const media = JSON.parse(stdout);
if (!media.streams?.some((stream) => stream.codec_type === 'video') || Number(media.format?.duration) <= 0) {
  throw new Error('Rendered MP4 has no valid video stream or duration.');
}
const report = { output, poster, bytes: file.size, durationSeconds: Number(media.format.duration), video: media.streams.find((stream) => stream.codec_type === 'video'), hasAudio: media.streams.some((stream) => stream.codec_type === 'audio'), audioLevel, checkSkippedBecauseHashMatched, ...timings, finishedAt: new Date().toISOString() };
await writeFile(join(dirname(output), 'render-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
