import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const EXCLUDED = new Set(['snapshots', 'node_modules', '.hyperframes']);

export async function compositionFingerprint(root) {
  const hash = createHash('sha256');
  async function visit(dir, prefix = '') {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (EXCLUDED.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Composition contains a symlink: ${relative}`);
      if (entry.isDirectory()) await visit(path, relative);
      else if (entry.isFile() && !/\.(?:mp4|jpg|jpeg|png)$/i.test(entry.name)) {
        hash.update(relative).update('\0').update(await readFile(path)).update('\0');
      } else if (entry.isFile()) {
        // Published assets must affect the hash. Exclude only known generated snapshots.
        hash.update(relative).update('\0').update(await readFile(path)).update('\0');
      }
    }
  }
  await visit(root);
  return hash.digest('hex');
}
