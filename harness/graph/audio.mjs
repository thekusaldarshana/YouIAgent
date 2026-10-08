import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDIO_EXTENSION = /\.(?:mp3|m4a|ogg|wav)$/i;
const BUNDLED_DIR = fileURLToPath(new URL('../media/music/', import.meta.url));
const BUNDLED = {
  'airy.mp3': { title: 'Airy', character: 'Spacious and restrained; suited to a quiet, thoughtful reveal.', author: 'SRG774', license: 'CC0', sourceUrl: 'https://opengameart.org/content/dark-sci-fi-audio-pack' },
  'urgent.mp3': { title: 'Urgent', character: 'Driving and tense; suited to fast, high-stakes movement.', author: 'SRG774', license: 'CC0', sourceUrl: 'https://opengameart.org/content/dark-sci-fi-audio-pack' },
  'magic-space.mp3': { title: 'Magic Space', character: 'Bright electronic plucks and pads; suited to an optimistic technology story.', author: 'CodeManu', license: 'CC0', sourceUrl: 'https://opengameart.org/content/magic-space' },
  'party-sector.mp3': { title: 'Party Sector', character: 'Playful, energetic electronic groove; suited to a confident launch.', author: 'Joth', license: 'CC0', sourceUrl: 'https://opengameart.org/content/party-sector' },
};

function idFor(file) {
  return basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function stageAudioCatalog(workspace, audioDir = null, mode = 'auto') {
  if (!['auto', 'silent'].includes(mode)) throw new Error(`Unknown music mode: ${mode}`);
  const target = join(workspace, 'film-audio');
  await mkdir(target, { recursive: true });
  if (mode === 'auto' && audioDir && !(await stat(audioDir).catch(() => null))?.isDirectory()) throw new Error(`FILM_AUDIO_DIR is not a directory: ${audioDir}`);
  const sourceKind = mode === 'silent' ? 'none' : audioDir ? 'user' : 'bundled';
  const directory = sourceKind === 'bundled' ? BUNDLED_DIR : sourceKind === 'user' ? audioDir : null;
  const entries = directory ? await readdir(directory, { withFileTypes: true }) : [];
  const tracks = entries.filter((entry) => entry.isFile() && AUDIO_EXTENSION.test(entry.name) && (sourceKind !== 'bundled' || BUNDLED[entry.name])).map((entry) => ({
    id: idFor(entry.name), file: entry.name, ...(sourceKind === 'bundled' ? BUNDLED[entry.name] : { title: basename(entry.name, extname(entry.name)), character: 'User-supplied track; listen and choose for this story.' }),
  })).filter((track) => track.id).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(tracks.map((track) => track.id)).size !== tracks.length) throw new Error('Audio filenames produce duplicate catalog IDs. Rename one file.');
  if (sourceKind !== 'none' && !tracks.length) throw new Error(`No supported music files found in ${directory}. Add an MP3, M4A, OGG, or WAV file, or choose Silence.`);
  await writeFile(join(target, 'catalog.json'), JSON.stringify({ sourceKind, tracks }, null, 2));
  const lines = ['# Available local music for this film', '', sourceKind === 'none' ? 'The user chose silence. Set `musicChoice` to `none`.' : 'Choose exactly one track ID in `plan-data.json`. The user requested a soundtrack; `none` is not a valid choice.', 'Choose for this story, not by list position. The final film needs a listening review.', '', ...(tracks.length ? tracks.map((track) => `- ${track.id}: ${track.title}. ${track.character}${track.author ? ` CC0 by ${track.author}; ${track.sourceUrl}` : ' Confirm you have distribution rights.'}`) : ['- Silence selected.']), ''];
  await writeFile(join(target, 'CATALOG.md'), lines.join('\n'));
  return { tracks: tracks.map((track) => track.id) };
}

export async function stageSelectedAudio(workspace, audioDir, choice) {
  const catalog = JSON.parse(await readFile(join(workspace, 'film-audio', 'catalog.json'), 'utf8'));
  if (choice === 'none') {
    if (catalog.sourceKind !== 'none') throw new Error('A soundtrack was requested but the plan selected silence.');
    await writeFile(join(workspace, 'film-audio', 'SELECTED.md'), '# Music selection\n\nDeliberate silence. Add SFX only when the plan calls for them.\n');
    return { choice, source: null };
  }
  const track = catalog.tracks.find((item) => item.id === choice);
  if (!track) throw new Error(`Unknown music choice: ${choice}`);
  const musicSource = join(catalog.sourceKind === 'bundled' ? BUNDLED_DIR : audioDir, track.file);
  const assets = join(workspace, 'film-output', 'composition', 'assets');
  await mkdir(join(assets, 'music'), { recursive: true });
  await copyFile(musicSource, join(assets, 'music', track.file));
  await writeFile(join(workspace, 'film-audio', 'SELECTED.md'), `# Music selection\n\nChoice: ${choice}\nCharacter: ${track.character}\nFile: film-output/composition/assets/music/${track.file}\n${track.sourceUrl ? `Source: ${track.sourceUrl}\nAuthor: ${track.author}\nLicense: ${track.license}\n` : 'User-supplied audio: verify its distribution rights.\n'}\nListen to the final mix before distributing the film.\n`);
  return { choice, title: track.title, author: track.author || null, license: track.license || null, sourceUrl: track.sourceUrl || null, source: musicSource, destination: join(assets, 'music', track.file) };
}
