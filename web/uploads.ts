import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export const MAX_UPLOAD_FILES = 2_000;
export const MAX_UPLOAD_BYTES = 100_000_000;
export const MAX_UPLOAD_FILE_BYTES = 25_000_000;

const excluded = /^(?:\.git|\.env(?:\..*)?|\.youiagent|node_modules|\.next|dist|build|coverage|venv|\.venv|__pycache__|secrets?|credentials?)$/i;

/** Splits a browser-supplied relative path, rejecting hidden, generated, escaping, or platform-specific segments. */
export function uploadPath(value: unknown): string[] {
  const parts = String(value || '').split('/');
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.') || excluded.test(part) || part.includes('\\') || part.includes(':') || part.includes('\0'))) {
    throw new Error('The selected folder contains an unsupported file path.');
  }
  return parts;
}

export interface UploadSession {
  id: string;
  directory: string;
  name: string;
  files: number;
  bytes: number;
}

export interface UploadStore {
  create(name: unknown): Promise<{ id: string; name: string }>;
  get(id: string): UploadSession | null;
  add(id: string, path: unknown, bytes: Buffer): Promise<{ files: number; bytes: number }>;
  take(id: string): UploadSession;
  cancel(id: string): Promise<boolean>;
}

export function createUploadStore(root: string): UploadStore {
  const sessions = new Map<string, UploadSession>();
  return {
    async create(name) {
      const id = randomUUID();
      const directory = join(root, id);
      await mkdir(directory, { recursive: true });
      const displayName = basename(String(name || 'Local folder')).slice(0, 100) || 'Local folder';
      sessions.set(id, { id, directory, name: displayName, files: 0, bytes: 0 });
      return { id, name: displayName };
    },
    get(id) { return sessions.get(id) || null; },
    async add(id, path, bytes) {
      const session = sessions.get(id);
      if (!session) throw new Error('Folder upload not found. Select the folder again.');
      const parts = uploadPath(path);
      if (bytes.length > MAX_UPLOAD_FILE_BYTES) throw new Error('A folder file exceeds the 25 MB limit.');
      if (session.files >= MAX_UPLOAD_FILES || session.bytes + bytes.length > MAX_UPLOAD_BYTES) throw new Error('Folder upload exceeds 2,000 files or 100 MB.');
      const destination = join(session.directory, ...parts);
      await mkdir(join(session.directory, ...parts.slice(0, -1)), { recursive: true });
      await writeFile(destination, bytes, { flag: 'wx' });
      session.files++;
      session.bytes += bytes.length;
      return { files: session.files, bytes: session.bytes };
    },
    take(id) {
      const session = sessions.get(id);
      if (!session || !session.files) throw new Error('The selected folder has no files to upload.');
      sessions.delete(id);
      return session;
    },
    async cancel(id) {
      const session = sessions.get(id);
      if (!session) return false;
      sessions.delete(id);
      await rm(session.directory, { recursive: true, force: true });
      return true;
    },
  };
}
