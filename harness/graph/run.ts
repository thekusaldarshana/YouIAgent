#!/usr/bin/env node
import { resolve } from 'node:path';
import { claimModeSchema, musicModeSchema, providerSchema, type FilmInput } from '../../shared/film.js';
import { errorMessage } from '../../shared/json.js';
import { normalizeSources } from '../../web/source-input.js';
import { runFilm } from './film-graph.js';
import { isEntryPoint } from '../runtime/paths.js';
import { resolveFilmProfile } from './motion-profile.js';

const USAGE = 'Usage: node dist/harness/graph/run.js <website-url|-> <github-url|local-folder|-> [goal]';

/** Parses an environment value against a schema, naming the variable when it is invalid. */
function fromEnv<T>(name: string, value: string, parse: (value: string) => { success: true; data: T } | { success: false }, choices: string): T {
  const parsed = parse(value);
  if (!parsed.success) throw new Error(`${name} must be ${choices}; got "${value}".`);
  return parsed.data;
}

export function filmInputFromEnvironment(goal: string, env: NodeJS.ProcessEnv): Omit<FilmInput, 'websiteUrl' | 'repositoryUrl'> {
  const profile = resolveFilmProfile(env['FILM_PROFILE']);
  const provider = fromEnv('FILM_PROVIDER', env['FILM_PROVIDER'] || 'codex', (value) => providerSchema.safeParse(value), 'codex or claude');
  const claimMode = fromEnv('FILM_CLAIM_MODE', env['FILM_CLAIM_MODE'] || (env['OPENROUTER_API_KEY'] ? profile.claimMode : 'exact'), (value) => claimModeSchema.safeParse(value), 'exact or semantic');
  const audioDir = env['FILM_AUDIO_DIR'] ? resolve(env['FILM_AUDIO_DIR']) : null;
  const requestedMusic = env['FILM_MUSIC_MODE'] || (audioDir ? 'library' : 'original');
  const musicMode = fromEnv('FILM_MUSIC_MODE', requestedMusic === 'auto' ? 'library' : requestedMusic, (value) => musicModeSchema.safeParse(value), 'original, library, or silent');
  return {
    goal, profile: profile.id, claimMode, audioDir, musicMode,
    assetDir: env['FILM_ASSET_DIR'] ? resolve(env['FILM_ASSET_DIR']) : null,
    provider, model: env['FILM_MODEL'] || (provider === 'codex' ? 'gpt-6-sol' : ''), effort: env['FILM_EFFORT'] || 'high',
    resumePlan: env['FILM_RESUME_PLAN'] === '1', resumeComposition: env['FILM_RESUME_COMPOSITION'] === '1',
  };
}

/** CLI entry shared with the web server, which spawns this file as a child process for each film. */
export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [websiteArg, repositoryArg, goal = 'Create a short product launch film.'] = argv;
  if (!websiteArg || !repositoryArg) {
    console.error(USAGE);
    return 2;
  }
  try {
    const { websiteUrl, repositoryUrl } = await normalizeSources({ websiteUrl: websiteArg === '-' ? '' : websiteArg, repositoryUrl: repositoryArg === '-' ? '' : repositoryArg }, { allowRelativePath: true });
    const input: FilmInput = { websiteUrl, repositoryUrl, ...filmInputFromEnvironment(goal, env) };
    const { jobDir, result } = await runFilm(input, env['FILM_JOB_DIR'] ? { jobDir: resolve(env['FILM_JOB_DIR']) } : {});
    console.log(JSON.stringify({ jobDir, render: result.render, claimDecisions: result.plan?.evaluated }, null, 2));
    return 0;
  } catch (error) {
    console.error(`film: ${errorMessage(error)}`);
    return 1;
  }
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
