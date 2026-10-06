import { execFile } from 'node:child_process';
import { rename } from 'node:fs/promises';
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
