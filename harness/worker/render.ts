#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { checkedCompositionSchema, renderHandoffSchema } from '../../shared/film.js';
import { errorMessage, isFile, readJsonWith } from '../../shared/json.js';
import { renderBinary } from '../graph/local-agent.js';
import { hasStream, probeMedia } from '../runtime/ffmpeg.js';
import { isEntryPoint, hyperframesBin } from '../runtime/paths.js';
import { resolveInWorkspace } from '../runtime/workspace-path.js';
import { normalizeMusicOnlyOutput } from './audio-level.js';
import { compositionFingerprint } from './fingerprint.js';

export interface RenderArguments {
  workspace: string;
  handoffPath: string | undefined;
  validateOnly: boolean;
  checkedReport: string | undefined;
}

export function parseRenderArguments(args: string[]): RenderArguments | null {
  const checkedPrefix = '--checked-report=';
  const [workspace, handoffPath] = args.filter((arg) => arg !== '--validate-only' && !arg.startsWith(checkedPrefix));
  if (!workspace) return null;
  return {
    workspace,
    handoffPath,
    validateOnly: args.includes('--validate-only'),
    checkedReport: args.find((arg) => arg.startsWith(checkedPrefix))?.slice(checkedPrefix.length),
  };
}

async function runInherited(name: string, args: string[], cwd: string): Promise<number> {
  const start = Date.now();
  await new Promise<void>((done, fail) => {
    const child = spawn(name, args, { cwd, stdio: 'inherit' });
    child.on('error', fail);
    child.on('exit', (code, signal) => code === 0 ? done() : fail(new Error(`${name} exited with ${signal || code}`)));
  });
  return (Date.now() - start) / 1000;
}

export async function render({ workspace: workspaceArg, handoffPath: handoffArg, validateOnly, checkedReport }: RenderArguments): Promise<void> {
  const workspace = resolve(workspaceArg);
  const handoffPath = handoffArg ? resolve(handoffArg) : join(workspace, 'film-output', 'render-handoff.json');
  const handoff = await readJsonWith(handoffPath, renderHandoffSchema, 'render-handoff.json');
  const inside = (value: string, label: string): string => resolveInWorkspace(workspace, value, {
    invalid: `${label} must be a relative path inside the workspace.`,
    escapes: `${label} escapes the workspace.`,
  });
  const composition = inside(handoff.composition, 'composition');
  const output = inside(handoff.output, 'output');
  const poster = output.replace(/\.mp4$/i, '.jpg');
  if (poster === output) throw new Error('output must end in .mp4');
  if (!await isFile(join(composition, 'index.html'))) throw new Error('Composition index.html is missing.');
  if (!Number.isFinite(handoff.posterAtSeconds) || handoff.posterAtSeconds < 0) throw new Error('posterAtSeconds must be a nonnegative number.');
  if (validateOnly) {
    console.log(JSON.stringify({ composition, output, poster, posterAtSeconds: handoff.posterAtSeconds, valid: true }, null, 2));
    return;
  }
  const ffmpegBin = renderBinary('ffmpeg', process.env['FFMPEG_BIN']);
  const ffprobeBin = renderBinary('ffprobe', process.env['FFPROBE_BIN']);
  const hyperframes = hyperframesBin();
  const timings: { checkSeconds?: number; renderSeconds?: number; posterSeconds?: number } = {};
  let checkSkippedBecauseHashMatched = false;
  if (checkedReport) {
    const attestation = await readJsonWith(resolve(checkedReport), checkedCompositionSchema, 'checked-composition.json');
    const hash = await compositionFingerprint(composition);
    if (attestation.passed !== true || attestation.composition.replaceAll('\\', '/') !== handoff.composition.replaceAll('\\', '/') || attestation.sha256 !== hash) {
      throw new Error('Composition changed after its HyperFrames check; refusing to skip validation.');
    }
    checkSkippedBecauseHashMatched = true;
    timings.checkSeconds = 0;
  } else timings.checkSeconds = await runInherited(process.execPath, [hyperframes, 'check'], composition);
  timings.renderSeconds = await runInherited(process.execPath, [hyperframes, 'render', '--quality', 'looks', '--output', output], composition);
  const hasRenderedAudio = hasStream(await probeMedia(ffprobeBin, output, 'stream=codec_type'), 'audio');
  const audioLevel = hasRenderedAudio ? await normalizeMusicOnlyOutput(output, ffmpegBin) : null;
  timings.posterSeconds = await runInherited(ffmpegBin, ['-v', 'error', '-y', '-ss', String(handoff.posterAtSeconds), '-i', output, '-frames:v', '1', '-q:v', '2', poster], dirname(output));
  const file = await stat(output);
  if (!file.isFile() || file.size === 0) throw new Error('Render did not produce a nonempty MP4.');
  if (!await isFile(poster)) throw new Error('Poster extraction did not produce a JPEG.');
  const media = await probeMedia(ffprobeBin, output, 'format=duration:stream=codec_type,width,height,avg_frame_rate');
  if (!hasStream(media, 'video') || Number(media.format?.duration) <= 0) {
    throw new Error('Rendered MP4 has no valid video stream or duration.');
  }
  const report = { output, poster, bytes: file.size, durationSeconds: Number(media.format?.duration), video: media.streams?.find((stream) => stream.codec_type === 'video'), hasAudio: hasStream(media, 'audio'), audioLevel, checkSkippedBecauseHashMatched, ...timings, finishedAt: new Date().toISOString() };
  await writeFile(join(dirname(output), 'render-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

async function main(argv: string[]): Promise<void> {
  const options = parseRenderArguments(argv);
  if (!options) {
    console.error('Usage: node render.js <job-workspace> [render-handoff.json] [--checked-report=<file>] [--validate-only]');
    process.exitCode = 2;
    return;
  }
  await render(options);
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`render: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
