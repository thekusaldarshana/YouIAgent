import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createUploadStore, MAX_UPLOAD_BYTES, MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_FILES, uploadPath } from './uploads.js';

test('folder uploads preserve nested files and reject hidden or escaping paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'youiagent-upload-'));
  try {
    const uploads = createUploadStore(root);
    const session = await uploads.create('My Project');
    assert.deepEqual(await uploads.add(session.id, 'src/index.js', Buffer.from('export const ready = true;')), { files: 1, bytes: 26 });
    assert.equal(await readFile(join(root, session.id, 'src', 'index.js'), 'utf8'), 'export const ready = true;');
    for (const path of ['../secret', '.env', 'node_modules/dependency.js', 'src/../../secret', 'src\\secret']) {
      assert.throws(() => uploadPath(path));
    }
    assert.equal(uploads.take(session.id).name, 'My Project');
    assert.equal(uploads.get(session.id), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an abandoned folder upload can be removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'youiagent-upload-'));
  try {
    const uploads = createUploadStore(root);
    const session = await uploads.create('Draft');
    await uploads.add(session.id, 'README.md', Buffer.from('Draft'));
    assert.equal(await uploads.cancel(session.id), true);
    await assert.rejects(readFile(join(root, session.id, 'README.md')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('uploads enforce the file-count, per-file, and total-size limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'youiagent-upload-limits-'));
  try {
    const uploads = createUploadStore(root);
    const many = await uploads.create('Many');
    for (let index = 0; index < MAX_UPLOAD_FILES; index++) await uploads.add(many.id, `f${index}.txt`, Buffer.from('x'));
    await assert.rejects(uploads.add(many.id, 'one-too-many.txt', Buffer.from('x')), /exceeds 2,000 files or 100 MB/);

    const large = await uploads.create('Large');
    await assert.rejects(uploads.add(large.id, 'huge.bin', Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1)), /exceeds the 25 MB limit/);
    for (let index = 0; index < MAX_UPLOAD_BYTES / MAX_UPLOAD_FILE_BYTES; index++) await uploads.add(large.id, `part${index}.bin`, Buffer.alloc(MAX_UPLOAD_FILE_BYTES));
    await assert.rejects(uploads.add(large.id, 'over.txt', Buffer.from('x')), /exceeds 2,000 files or 100 MB/);

    assert.throws(() => uploads.take('00000000-0000-4000-8000-000000000000'), /no files/);
    assert.equal(await uploads.cancel('00000000-0000-4000-8000-000000000000'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
