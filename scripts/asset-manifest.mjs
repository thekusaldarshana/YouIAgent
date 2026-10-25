// @ts-check
/*
 * The explicit list of everything the runtime reads that TypeScript does not emit. The build copies
 * exactly these paths, and the build verifier and tests check the result, so a new asset that is not
 * listed here fails loudly instead of being silently absent from dist/.
 */

/** Skills staged into every job's workspace. Must match GRAPH_SKILLS in harness/graph/film-graph.ts. */
export const SKILLS = ['film-graph', 'film-brand', 'film-concept', 'film-motion', 'film-review'];

/**
 * @typedef {{ from: string, to: string, exclude?: readonly string[] }} CopyRule
 * @type {readonly CopyRule[]}
 */
export const STATIC_COPIES = [
  // Served as-is. app.js is bundled from web/client, so a hand-edited copy must never ship.
  { from: 'web/public', to: 'dist/web/public', exclude: ['app.js', 'app.js.map'] },
  ...SKILLS.map((name) => ({ from: `harness/skills/${name}`, to: `dist/harness/skills/${name}` })),
  { from: 'harness/media', to: 'dist/harness/media' },
  { from: 'harness/motion/README.md', to: 'dist/harness/motion/README.md' },
];

/**
 * @typedef {{ entry: string, out: string, format: 'esm' | 'iife', target: string, sourcemap: boolean, legalComments: 'none' | 'inline' }} Bundle
 * @type {readonly Bundle[]}
 */
export const BUNDLES = [
  // The studio UI: an ES module loaded by index.html.
  { entry: 'web/client/app.ts', out: 'dist/web/public/app.js', format: 'esm', target: 'es2022', sourcemap: true, legalComments: 'none' },
  // Loaded by generated compositions as a classic <script>, so it must be an IIFE with no module syntax.
  { entry: 'harness/motion/mechanics.ts', out: 'dist/harness/motion/mechanics.js', format: 'iife', target: 'es2020', sourcemap: false, legalComments: 'inline' },
];

/** Entry points and assets whose absence means the build is unusable. */
export const REQUIRED_OUTPUTS = [
  'dist/web/server.js',
  'dist/web/public/index.html',
  'dist/web/public/app.js',
  'dist/web/public/styles.css',
  'dist/harness/graph/run.js',
  'dist/harness/graph/score-kit.js',
  'dist/harness/worker/render.js',
  'dist/harness/cli.js',
  'dist/harness/motion/mechanics.js',
  'dist/harness/motion/README.md',
  'dist/setup/main.js',
  ...SKILLS.map((name) => `dist/harness/skills/${name}/SKILL.md`),
  'dist/harness/media/music/airy.mp3',
  'dist/harness/media/music/urgent.mp3',
  'dist/harness/media/music/magic-space.mp3',
  'dist/harness/media/music/party-sector.mp3',
];
