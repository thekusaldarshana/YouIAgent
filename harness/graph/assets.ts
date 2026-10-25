import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { isDirectory } from '../../shared/json.js';

const MEDIA = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.m4a', '.mov', '.mp3', '.mp4', '.ogg', '.png', '.svg', '.wav', '.webm', '.webp']);

export async function stageInputAssets(workspace: string, assetDir: string | null | undefined = null): Promise<{ directory: string; files: string[] }> {
  const target = join(workspace, 'film-inputs');
  await mkdir(target, { recursive: true });
  const source = assetDir && await isDirectory(assetDir) ? assetDir : null;
  const entries = source ? await readdir(source, { withFileTypes: true }) : [];
  const files = entries.filter((entry) => entry.isFile() && MEDIA.has(extname(entry.name).toLowerCase())).map((entry) => entry.name).sort();
  if (source) for (const name of files) await copyFile(join(source, name), join(target, name));
  await writeFile(join(target, 'CATALOG.md'), [
    '# Local creative assets',
    '',
    'These files were supplied by the operator. Use only files that serve the story and whose distribution rights are clear.',
    '',
    ...(files.length ? files.map((name) => `- ${name}`) : ['- No local creative assets were supplied. Build graphics from source evidence and code.']),
    '',
  ].join('\n'));
  return { directory: target, files };
}
