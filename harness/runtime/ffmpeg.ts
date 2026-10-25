import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ffprobeSchema, type FfprobeResult } from '../../shared/film.js';
import { parseJson } from '../../shared/json.js';

export const execFileAsync = promisify(execFile);

/** Runs ffprobe with `-show_entries` and validates its JSON, which is external tool output. */
export async function probeMedia(ffprobeBin: string, path: string, entries: string): Promise<FfprobeResult> {
  const { stdout } = await execFileAsync(ffprobeBin, ['-v', 'error', '-show_entries', entries, '-of', 'json', path]);
  return ffprobeSchema.parse(parseJson(stdout));
}

export function hasStream(media: FfprobeResult, codecType: 'audio' | 'video'): boolean {
  return media.streams?.some((stream) => stream.codec_type === codecType) ?? false;
}
