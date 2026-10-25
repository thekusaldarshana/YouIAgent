import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { z } from 'zod';
import { stageAudioCatalog, stageSelectedAudio, validateOriginalScore } from '../harness/graph/audio.js';
import { GRAPH_SKILLS } from '../harness/graph/film-graph.js';
import { renderBinary } from '../harness/graph/local-agent.js';
import { harnessAsset, packageRoot } from '../harness/runtime/paths.js';
import { withTempDir } from './helpers.js';
import { toolchainSkipReason } from './support/toolchain.js';

const execFileAsync = promisify(execFile);
const root = packageRoot();

const manifestSchema = z.object({
  SKILLS: z.array(z.string()),
  REQUIRED_OUTPUTS: z.array(z.string()),
  STATIC_COPIES: z.array(z.object({ from: z.string(), to: z.string(), exclude: z.array(z.string()).optional() })),
});
const manifest = manifestSchema.parse(await import(pathToFileURL(join(root, 'scripts', 'asset-manifest.mjs')).href));

async function listFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await listFiles(path));
    else found.push(relative(directory, path));
  }
  return found;
}

test('the asset manifest matches what the graph stages and what the build produced', async () => {
  assert.deepEqual([...manifest.SKILLS].sort(), [...GRAPH_SKILLS].sort(), 'build copies exactly the skills the graph stages');
  for (const output of manifest.REQUIRED_OUTPUTS) assert.ok((await stat(join(root, output)).catch(() => null))?.isFile(), `${output} must be in dist/`);
  const publicFiles = (await listFiles(join(root, 'web', 'public'))).filter((name) => name !== 'app.js');
  const builtFiles = await listFiles(join(root, 'dist', 'web', 'public'));
  for (const name of publicFiles) assert.ok(builtFiles.includes(name), `${name} is served from dist/web/public`);
  await assert.rejects(stat(join(root, 'web', 'public', 'app.js')), 'the served bundle is generated, never hand-edited source');
});

test('the browser bundle is browser-only and carries no secrets or Node imports', async () => {
  const bundle = await readFile(join(root, 'dist', 'web', 'public', 'app.js'), 'utf8');
  assert.doesNotMatch(bundle, /from\s*["']node:/);
  assert.doesNotMatch(bundle, /require\(["']node:/);
  assert.doesNotMatch(bundle, /OPENROUTER|CONTEXT_DEV|AI_GATEWAY|API_KEY/i);
  assert.match(bundle, /source-form/);
});

test('the motion helper is a classic script compositions can load, not an ES module', async () => {
  const source = await readFile(harnessAsset('motion', 'mechanics.js'), 'utf8');
  assert.doesNotMatch(source, /^\s*(?:import|export)\s/m);
  const context: { FilmMotion?: object } = {};
  vm.runInNewContext(source, context);
  assert.deepEqual(Object.keys(context.FilmMotion ?? {}).sort(), ['crossfadeHandoff', 'draw', 'musicEnvelope', 'revealText', 'slideHandoff', 'staggerReveal', 'status']);
  const readme = await readFile(harnessAsset('motion', 'README.md'), 'utf8');
  assert.match(readme, /mechanics/i);
});

test('the score kit uses only Node built-ins, so the permission-restricted score script can import it', async () => {
  const source = await readFile(harnessAsset('graph', 'score-kit.js'), 'utf8');
  const specifiers = [...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0);
  for (const specifier of specifiers) assert.match(specifier ?? '', /^node:/, 'any other import would fail under --permission');
});

test('the staged score kit and a generated make-score.mjs produce a valid WAV under Node permissions', async (t) => {
  await withTempDir('youiagent-score-', async (workspace) => {
    await stageAudioCatalog(workspace, null, 'original');
    const staged = await stageSelectedAudio(workspace, null, 'original');
    const composition = join(workspace, 'film-output', 'composition');
    const kit = await readFile(join(composition, 'score-kit.mjs'), 'utf8');
    assert.match(kit, /export class Score/);
    assert.doesNotMatch(kit, /sourceMappingURL/, 'the staged kit must not point at a source map that is not shipped');

    // The same contract the generated script follows: import from ./score-kit.mjs, write only under assets/music.
    await writeFile(join(composition, 'make-score.mjs'), [
      "import { fileURLToPath } from 'node:url';",
      "import { Score, midiToHz } from './score-kit.mjs';",
      'const score = new Score({ duration: 18, seed: 11 });',
      'score.tone({ at: 0, length: 17, frequency: midiToHz(57), shape: "soft-saw", gain: 0.12 });',
      'score.kick({ at: 1 });',
      "await score.writeWav(fileURLToPath(new URL('./assets/music/original-score.wav', import.meta.url)));",
    ].join('\n'));
    await mkdir(join(composition, 'assets', 'music'), { recursive: true });
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    const permissionFlag = major > 22 || (major === 22 && minor >= 13) ? '--permission' : '--experimental-permission';
    await execFileAsync(process.execPath, [permissionFlag, `--allow-fs-read=${composition}`, `--allow-fs-write=${join(composition, 'assets', 'music')}`, join(composition, 'make-score.mjs')], { cwd: composition, env: { PATH: process.env['PATH'] ?? '' } });
    const wav = await readFile(staged.destination ?? '');
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    assert.equal(wav.readUInt32LE(24), 44_100);

    if (await toolchainSkipReason()) { t.diagnostic('ffprobe unavailable; WAV validated by header only'); return; }
    const report = await validateOriginalScore(workspace, 18, renderBinary('ffprobe', process.env['FFPROBE_BIN']), renderBinary('ffmpeg', process.env['FFMPEG_BIN']));
    assert.ok(report.durationSeconds >= 17.9 && report.durationSeconds <= 20);
    assert.ok(report.loudnessLufs > -45);
  });
});
