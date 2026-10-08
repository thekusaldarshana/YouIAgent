#!/usr/bin/env node
import { resolve } from 'node:path';
import { runFilm } from './film-graph.mjs';
import { resolveFilmProfile } from './motion-profile.mjs';

const [websiteUrl, repositoryUrl, goal = 'Create a short product launch film.'] = process.argv.slice(2);
if (!websiteUrl || !repositoryUrl) {
  console.error('Usage: node harness/graph/run.mjs <website-url> <repository-url> [goal]');
  process.exit(2);
}
const profile = resolveFilmProfile(process.env.FILM_PROFILE);
const { jobDir, result } = await runFilm({ websiteUrl, repositoryUrl, goal, profile: profile.id, claimMode: process.env.FILM_CLAIM_MODE || profile.claimMode, audioDir: process.env.FILM_AUDIO_DIR ? resolve(process.env.FILM_AUDIO_DIR) : null, musicMode: process.env.FILM_MUSIC_MODE || 'auto', assetDir: process.env.FILM_ASSET_DIR ? resolve(process.env.FILM_ASSET_DIR) : null, model: process.env.FILM_MODEL || 'gpt-6-sol', effort: process.env.FILM_EFFORT || 'high', resumePlan: process.env.FILM_RESUME_PLAN === '1', resumeComposition: process.env.FILM_RESUME_COMPOSITION === '1' }, process.env.FILM_JOB_DIR ? { jobDir: resolve(process.env.FILM_JOB_DIR) } : {});
console.log(JSON.stringify({ jobDir, render: result.render, claimDecisions: result.plan?.evaluated }, null, 2));
