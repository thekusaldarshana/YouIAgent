import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const entry = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

interface Outcome { code: number; stderr: string }

async function runNode(script: string, args: string[]): Promise<Outcome> {
  try {
    const { stderr } = await execFileAsync(process.execPath, [entry(script), ...args], { timeout: 60_000 });
    return { code: 0, stderr };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    return { code: failure.code ?? -1, stderr: failure.stderr ?? '' };
  }
}

// These pin the exit codes and messages the pre-migration CLIs had, so wrappers and docs stay valid.
test('film-harness: usage errors exit 2 and job errors exit 1', async () => {
  assert.deepEqual(await runNode('../harness/cli.js', []), { code: 2, stderr: 'Usage: film-harness <analyze|prepare|stage-motion> <local-job-directory>\n' });
  assert.equal((await runNode('../harness/cli.js', ['bogus', '/tmp'])).code, 2);
  const missing = await runNode('../harness/cli.js', ['prepare', '/nonexistent/youiagent-job']);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /film-harness prepare: Job workspace is missing\./);
});

test('graph runner: usage exits 2, invalid sources exit 1 with a one-line message', async () => {
  assert.equal((await runNode('../harness/graph/run.js', [])).code, 2);
  const noSource = await runNode('../harness/graph/run.js', ['-', '-']);
  assert.equal(noSource.code, 1);
  assert.match(noSource.stderr, /^film: Enter a website URL or a GitHub repository URL or local folder\.\n$/);
  const missing = await runNode('../harness/graph/run.js', ['-', '/nonexistent/youiagent-source']);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /does not exist or is not a directory/);
});

test('render worker: missing arguments exit 2 with its usage line', async () => {
  const outcome = await runNode('../harness/worker/render.js', []);
  assert.equal(outcome.code, 2);
  assert.match(outcome.stderr, /Usage: node render\.js <job-workspace>/);
});

test('entry points still run when started through a symlinked install path', async () => {
  const { mkdtemp, rm, symlink } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  if (process.platform === 'win32') return;
  const scratch = await mkdtemp(join(tmpdir(), 'youiagent-symlink-'));
  try {
    const link = join(scratch, 'dist');
    await symlink(dirname(dirname(entry('../harness/cli.js'))), link);
    const { stderr } = await execFileAsync(process.execPath, [join(link, 'harness', 'cli.js')]).catch((error: { stderr?: string }) => ({ stderr: error.stderr ?? '' }));
    assert.match(stderr, /Usage: film-harness/, 'a symlinked path must not silently do nothing');
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
