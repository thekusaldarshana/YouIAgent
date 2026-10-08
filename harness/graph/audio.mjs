import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const AUDIO_EXTENSION = /\.(?:mp3|m4a|ogg|wav)$/i;

function idFor(file) {
  return basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function stageAudioCatalog(workspace, audioDir = null) {
  const target = join(workspace, 'film-audio');
  await mkdir(target, { recursive: true });
  const entries = audioDir && (await stat(audioDir).catch(() => null))?.isDirectory()
    ? await readdir(audioDir, { withFileTypes: true }) : [];
  const tracks = entries.filter((entry) => entry.isFile() && AUDIO_EXTENSION.test(entry.name)).map((entry) => ({
    id: idFor(entry.name), file: entry.name,
  })).filter((track) => track.id).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(tracks.map((track) => track.id)).size !== tracks.length) throw new Error('Audio filenames produce duplicate catalog IDs. Rename one file.');
  await writeFile(join(target, 'catalog.json'), JSON.stringify({ source: audioDir ? 'user-supplied directory' : 'none', tracks }, null, 2));
  const lines = ['# Available local music for this film', '', 'Choose one ID in `plan-data.json`, or `none` to have the renderer compose an original local instrumental score.', 'Use only audio you are licensed to copy and distribute. The final film needs a listening review.', '', ...(tracks.length ? tracks.map((track) => `- ${track.id}: ${track.file}`) : ['- No local tracks were supplied; choose `none` for the automatic original score.']), ''];
  await writeFile(join(target, 'CATALOG.md'), lines.join('\n'));
  return { tracks: tracks.map((track) => track.id) };
}

export async function stageSelectedAudio(workspace, audioDir, choice) {
  if (choice === 'none') {
    await writeFile(join(workspace, 'film-audio', 'SELECTED.md'), '# Music selection\n\nThe renderer will compose an original instrumental score from the film plan and scene timings. Leave the composition audio lane empty.\n');
    return { choice, source: null };
  }
  const catalog = JSON.parse(await readFile(join(workspace, 'film-audio', 'catalog.json'), 'utf8'));
  const track = catalog.tracks.find((item) => item.id === choice);
  if (!track) throw new Error(`Unknown music choice: ${choice}`);
  if (!audioDir) throw new Error('FILM_AUDIO_DIR is required for a non-silent music choice.');
  const musicSource = join(audioDir, track.file);
  const assets = join(workspace, 'film-output', 'composition', 'assets');
  await mkdir(join(assets, 'music'), { recursive: true });
  await copyFile(musicSource, join(assets, 'music', track.file));
  await writeFile(join(workspace, 'film-audio', 'SELECTED.md'), `# Music selection\n\nChoice: ${choice}\nFile: film-output/composition/assets/music/${track.file}\n\nVerify its licensing before distributing the film.\n`);
  return { choice, source: musicSource, destination: join(assets, 'music', track.file) };
}
