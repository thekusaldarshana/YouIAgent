import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { audioCatalogSchema, type AudioCatalog, type LoudnessReading, type MusicMode, type StagedAudio } from '../../shared/film.js';
import { isDirectory, readJsonWith } from '../../shared/json.js';
import { hasStream, probeMedia } from '../runtime/ffmpeg.js';
import { harnessAsset } from '../runtime/paths.js';
import { measureLoudness } from '../worker/audio-level.js';

const AUDIO_EXTENSION = /\.(?:mp3|m4a|ogg|wav)$/i;
const BUNDLED_DIR = harnessAsset('media', 'music');
/** The compiled score kit, staged into each original-score film under its agent-facing name. */
const SCORE_KIT = harnessAsset('graph', 'score-kit.js');

interface BundledTrack { title: string; character: string; author: string; license: string; sourceUrl: string }

const BUNDLED: Record<string, BundledTrack> = {
  'airy.mp3': { title: 'Airy', character: 'Spacious and restrained; suited to a quiet, thoughtful reveal.', author: 'SRG774', license: 'CC0', sourceUrl: 'https://opengameart.org/content/dark-sci-fi-audio-pack' },
  'urgent.mp3': { title: 'Urgent', character: 'Driving and tense; suited to fast, high-stakes movement.', author: 'SRG774', license: 'CC0', sourceUrl: 'https://opengameart.org/content/dark-sci-fi-audio-pack' },
  'magic-space.mp3': { title: 'Magic Space', character: 'Bright electronic plucks and pads; suited to an optimistic technology story.', author: 'CodeManu', license: 'CC0', sourceUrl: 'https://opengameart.org/content/magic-space' },
  'party-sector.mp3': { title: 'Party Sector', character: 'Playful, energetic electronic groove; suited to a confident launch.', author: 'Joth', license: 'CC0', sourceUrl: 'https://opengameart.org/content/party-sector' },
};

type CatalogTrack = AudioCatalog['tracks'][number];

function idFor(file: string): string {
  return basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseMusicMode(mode: string): MusicMode {
  const selected = mode === 'auto' ? 'library' : mode;
  if (selected !== 'original' && selected !== 'library' && selected !== 'silent') throw new Error(`Unknown music mode: ${mode}`);
  return selected;
}

export async function stageAudioCatalog(workspace: string, audioDir: string | null | undefined = null, mode: string = 'original'): Promise<{ tracks: string[] }> {
  const selectedMode = parseMusicMode(mode);
  const target = join(workspace, 'film-audio');
  await mkdir(target, { recursive: true });
  if (selectedMode === 'library' && audioDir && !await isDirectory(audioDir)) throw new Error(`FILM_AUDIO_DIR is not a directory: ${audioDir}`);
  const sourceKind: AudioCatalog['sourceKind'] = selectedMode === 'silent' ? 'none' : selectedMode === 'original' ? 'original' : audioDir ? 'user' : 'bundled';
  const directory = sourceKind === 'bundled' ? BUNDLED_DIR : sourceKind === 'user' ? audioDir ?? null : null;
  const entries = directory ? await readdir(directory, { withFileTypes: true }) : [];
  const tracks: CatalogTrack[] = sourceKind === 'original'
    ? [{ id: 'original', file: 'original-score.wav', title: 'Original score', character: 'Write a new score for this film from its own story, cuts, and motion.' }]
    : entries.filter((entry) => entry.isFile() && AUDIO_EXTENSION.test(entry.name) && (sourceKind !== 'bundled' || BUNDLED[entry.name])).map((entry): CatalogTrack => {
      const bundled = sourceKind === 'bundled' ? BUNDLED[entry.name] : undefined;
      return {
        id: idFor(entry.name), file: entry.name,
        ...(bundled ?? { title: basename(entry.name, extname(entry.name)), character: 'User-supplied track; listen and choose for this story.' }),
      };
    }).filter((track) => track.id).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(tracks.map((track) => track.id)).size !== tracks.length) throw new Error('Audio filenames produce duplicate catalog IDs. Rename one file.');
  if (sourceKind !== 'none' && !tracks.length) throw new Error(`No supported music files found in ${directory}. Add an MP3, M4A, OGG, or WAV file, or choose Silence.`);
  await writeFile(join(target, 'catalog.json'), JSON.stringify({ sourceKind, tracks }, null, 2));
  const lines = ['# Music for this film', '', sourceKind === 'none' ? 'The user chose no music. Set `musicChoice` to `none`.' : sourceKind === 'original' ? 'Set `musicChoice` to `original`. Plan a new musical arc and story-specific SFX; the composition stage must create the score from scratch as a local WAV file.' : 'Choose exactly one track ID in `plan-data.json`. The user requested library music; `none` is not a valid choice.', 'The final film needs a listening review.', '', ...(tracks.length ? tracks.map((track) => `- ${track.id}: ${track.title}. ${track.character}${track.author ? ` CC0 by ${track.author}; ${track.sourceUrl}` : sourceKind === 'user' ? ' Confirm you have distribution rights.' : ''}`) : ['- No music selected.']), ''];
  await writeFile(join(target, 'CATALOG.md'), lines.join('\n'));
  return { tracks: tracks.map((track) => track.id) };
}

/** Copies the compiled score kit into the film, dropping the source-map pointer to a file that is not shipped. */
async function stageScoreKit(destination: string): Promise<void> {
  const source = await readFile(SCORE_KIT, 'utf8');
  await writeFile(destination, source.replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n'));
}

export async function stageSelectedAudio(workspace: string, audioDir: string | null | undefined, choice: string): Promise<StagedAudio> {
  const catalog = await readJsonWith(join(workspace, 'film-audio', 'catalog.json'), audioCatalogSchema, 'film-audio/catalog.json');
  if (choice === 'none') {
    if (catalog.sourceKind !== 'none') throw new Error('A soundtrack was requested but the plan selected silence.');
    await writeFile(join(workspace, 'film-audio', 'SELECTED.md'), '# Music selection\n\nDeliberate silence. Add SFX only when the plan calls for them.\n');
    return { choice, source: null };
  }
  const track = catalog.tracks.find((item) => item.id === choice);
  if (!track) throw new Error(`Unknown music choice: ${choice}`);
  if (catalog.sourceKind === 'original') {
    const destination = join(workspace, 'film-output', 'composition', 'assets', 'music', 'original-score.wav');
    await mkdir(join(workspace, 'film-output', 'composition', 'assets', 'music'), { recursive: true });
    await stageScoreKit(join(workspace, 'film-output', 'composition', 'score-kit.mjs'));
    await writeFile(join(workspace, 'film-audio', 'SELECTED.md'), '# Original score\n\nCompose a new soundtrack for this film. Write `film-output/composition/make-score.mjs`, importing `{ Score, midiToHz }` from `./score-kit.mjs` if useful. The graph will run the script to create `film-output/composition/assets/music/original-score.wav`; do not run it in your CLI session. The kit supplies sound primitives only; your script must arrange a new motif, sections, and story-specific cues from `film-plan.md`. This must be a real, non-silent WAV long enough for the film. No external provider, downloaded track, reused bed, or credential is required. Reference the resulting WAV in the HyperFrames composition. The graph validates the file and will add it to the MP4 if the composition omits the audio track.\n');
    return { choice, title: 'Original score', author: null, license: null, sourceUrl: null, source: null, destination };
  }
  const musicDirectory = catalog.sourceKind === 'bundled' ? BUNDLED_DIR : audioDir;
  if (!musicDirectory) throw new Error('The music directory for this film is no longer available.');
  const musicSource = join(musicDirectory, track.file);
  const assets = join(workspace, 'film-output', 'composition', 'assets');
  await mkdir(join(assets, 'music'), { recursive: true });
  await copyFile(musicSource, join(assets, 'music', track.file));
  await writeFile(join(workspace, 'film-audio', 'SELECTED.md'), `# Music selection\n\nChoice: ${choice}\nCharacter: ${track.character}\nFile: film-output/composition/assets/music/${track.file}\n${track.sourceUrl ? `Source: ${track.sourceUrl}\nAuthor: ${track.author}\nLicense: ${track.license}\n` : 'User-supplied audio: verify its distribution rights.\n'}\nListen to the final mix before distributing the film.\n`);
  return { choice, title: track.title, author: track.author || null, license: track.license || null, sourceUrl: track.sourceUrl || null, source: musicSource, destination: join(assets, 'music', track.file) };
}

export interface OriginalScoreReport extends LoudnessReading {
  path: string;
  durationSeconds: number;
  bytes: number;
}

export async function validateOriginalScore(workspace: string, expectedDuration: number, ffprobeBin = 'ffprobe', ffmpegBin = 'ffmpeg'): Promise<OriginalScoreReport> {
  const path = join(workspace, 'film-output', 'composition', 'assets', 'music', 'original-score.wav');
  const file = await stat(path).catch(() => null);
  if (!file?.isFile() || file.size < 100_000) throw new Error('Original score is missing or empty: create composition/assets/music/original-score.wav.');
  const media = await probeMedia(ffprobeBin, path, 'format=duration:stream=codec_type,channels,sample_rate');
  const duration = Number(media.format?.duration);
  if (!hasStream(media, 'audio') || !Number.isFinite(duration) || duration < expectedDuration - 0.1 || duration > expectedDuration + 2) throw new Error(`Original score must cover the ${expectedDuration}s film; got ${duration || 'unreadable'}s.`);
  const measured = await measureLoudness(ffmpegBin, path);
  if (measured.loudnessLufs < -45) throw new Error('Original score is effectively silent. Add audible music and cues.');
  return { path, durationSeconds: duration, bytes: file.size, ...measured };
}
