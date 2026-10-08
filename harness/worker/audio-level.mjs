import { execFile } from 'node:child_process';
import { rename, stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function parseEbur128(stderr) {
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const loudness = Number(summary.match(/Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/)?.[1]);
  const truePeak = Number(summary.match(/True peak:\s*Peak:\s*(-?[\d.]+) dBFS/)?.[1]);
  if (!Number.isFinite(loudness) || !Number.isFinite(truePeak)) throw new Error('Could not parse FFmpeg EBU R128 summary.');
  return { loudnessLufs: loudness, truePeakDbfs: truePeak };
}

export function musicGainDb(level) {
  // The target is for a music-only short. Preserve dynamics with linear gain.
  // Leave a peak margin; never boost by more than 12 dB automatically.
  if (level.loudnessLufs >= -20 && level.loudnessLufs <= -16 && level.truePeakDbfs <= -3) return 0;
  return Math.max(-12, Math.min(12, -18 - level.loudnessLufs, -3 - level.truePeakDbfs));
}

async function measure(ffmpegBin, path) {
  const { stderr } = await execFileAsync(ffmpegBin, ['-hide_banner', '-nostats', '-i', path, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { maxBuffer: 10 * 1024 * 1024 });
  return parseEbur128(stderr);
}

export async function normalizeMusicOnlyOutput(path, ffmpegBin = 'ffmpeg') {
  const before = await measure(ffmpegBin, path);
  const gainDb = musicGainDb(before);
  if (Math.abs(gainDb) < 0.1) return { before, after: before, gainDb: 0, normalized: false };
  const temp = path.replace(/\.mp4$/i, '.audio-level.tmp.mp4');
  await execFileAsync(ffmpegBin, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', path,
    '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-af', `volume=${gainDb.toFixed(2)}dB`, temp,
  ], { maxBuffer: 10 * 1024 * 1024 });
  const after = await measure(ffmpegBin, temp);
  if (after.truePeakDbfs > -2.5) throw new Error(`Normalized audio peak too high: ${after.truePeakDbfs} dBFS`);
  await rename(temp, path);
  return { before, after, gainDb, normalized: true };
}

export async function addMissingMusicBed(path, musicPath, durationSeconds, ffmpegBin = 'ffmpeg', ffprobeBin = 'ffprobe') {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 1) throw new Error('Rendered film duration is invalid for music fallback.');
  const temp = path.replace(/\.mp4$/i, '.music-bed.tmp.mp4');
  const fadeOut = Math.max(0, durationSeconds - 1.2);
  await execFileAsync(ffmpegBin, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-stream_loop', '-1', '-i', musicPath,
    '-map', '0:v:0', '-map', '1:a:0', '-t', String(durationSeconds), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-af', `afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOut.toFixed(3)}:d=1.2`, '-movflags', '+faststart', temp,
  ], { maxBuffer: 10 * 1024 * 1024 });
  const { stdout } = await execFileAsync(ffprobeBin, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', temp]);
  if (!JSON.parse(stdout).streams?.some((stream) => stream.codec_type === 'audio')) throw new Error('Music fallback did not produce an audio stream.');
  await rename(temp, path);
  const audioLevel = await normalizeMusicOnlyOutput(path, ffmpegBin);
  const finalProbe = await execFileAsync(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', path]);
  const media = JSON.parse(finalProbe.stdout);
  if (!media.streams?.some((stream) => stream.codec_type === 'audio')) throw new Error('Normalized music fallback has no audio stream.');
  return { audioLevel, durationSeconds: Number(media.format.duration), bytes: (await stat(path)).size };
}
