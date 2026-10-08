#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { addAutomaticScore } from './auto-score.mjs';
import { normalizeMusicOnlyOutput } from './audio-level.mjs';

const execFileAsync = promisify(execFile);
const jobDir = process.argv[2] && resolve(process.argv[2]);
if (!jobDir) throw new Error('Usage: node score-existing.mjs <job-directory>');
const reportPath = join(jobDir, 'graph-report.json');
const graphReport = JSON.parse(await readFile(reportPath, 'utf8'));
const output = graphReport.render?.output;
if (!output || !(await stat(output).catch(() => null))?.isFile()) throw new Error('This job has no finished MP4.');
if (graphReport.render.hasAudio) throw new Error('This film already has an audio track.');
const workspace = join(jobDir, 'workspace');
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
const ffprobe = process.env.FFPROBE_BIN || 'ffprobe';
const automaticScore = await addAutomaticScore(output, workspace, ffmpeg);
const audioLevel = await normalizeMusicOnlyOutput(automaticScore.output, ffmpeg);
const { stdout } = await execFileAsync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', automaticScore.output]);
const media = JSON.parse(stdout);
if (!media.streams?.some((stream) => stream.codec_type === 'audio')) throw new Error('Soundtrack mux did not produce an audio stream.');
const render = { ...graphReport.render, output: automaticScore.output, bytes: (await stat(automaticScore.output)).size, durationSeconds: Number(media.format.duration), hasAudio: true, audioSource: automaticScore.source, automaticScore, audioLevel, finishedAt: new Date().toISOString() };
await writeFile(join(workspace, 'film-output', 'render-report.json'), JSON.stringify(render, null, 2));
await writeFile(reportPath, JSON.stringify({ ...graphReport, render }, null, 2));
console.log(JSON.stringify({ output: render.output, hasAudio: true, audioSource: render.audioSource, bytes: render.bytes }, null, 2));
