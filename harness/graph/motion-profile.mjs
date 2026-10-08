export const PRODUCT_PROFILE = Object.freeze({
  id: 'product',
  duration: { min: 15, max: 25 },
  claimMode: 'semantic',
  planningInstructions: 'Create a source-specific product launch film with readable holds and a clear story.',
  compositionInstructions: 'Use the captured product design as the visual system.',
});

export const MOTION_STUDIO_PROFILE = Object.freeze({
  id: 'motion-studio',
  duration: { min: 27, max: 31 },
  claimMode: 'exact',
  target: { width: 1440, height: 1440, fps: 30 },
  bpm: 120,
  beatCount: 54,
  planningInstructions: [
    'Design a 1440×1440 motion-studio launch film at 120 BPM with 54 explicitly mapped beats.',
    'Make it feel like one continuous 2D take: carry a small set of forms, typography, and image masks across scene boundaries through transformations, camera moves, pushes, masks, and shape changes.',
    'Use a cursor only when it explains a direct interaction. Avoid fades, blur-ins, 3D flips, particles, generic gradients, and static holds longer than one beat.',
    'Use only local files from film-inputs/ and the selected local music. When no music is supplied, the renderer creates an original instrumental score; align the beat map with that music arc.',
  ].join(' '),
  compositionInstructions: [
    'Build a square 1440×1440 HyperFrames composition with one seek-safe timeline. Compute state from time; avoid CSS transitions, timers, and accumulated animation state.',
    'Put at least one purposeful visual change on every beat from plan-data.json. Preserve continuity by transforming existing geometry before introducing a new scene.',
    'Use the local asset catalog and source evidence. Do not fetch remote media, use external CDNs, or imitate the reference film’s brand, photos, or copy.',
  ].join(' '),
});

export function resolveFilmProfile(value = 'product') {
  if (!value || value === 'product') return PRODUCT_PROFILE;
  if (value === 'motion-studio') return MOTION_STUDIO_PROFILE;
  throw new Error(`Unknown film profile: ${value}. Use product or motion-studio.`);
}

export function motionPlanIssues(data, profile) {
  const issues = [];
  if (profile.id !== 'motion-studio') return issues;
  if (Number(data.bpm) !== profile.bpm) issues.push(`bpm must be ${profile.bpm} for the motion-studio profile.`);
  if (!Array.isArray(data.beatMap) || data.beatMap.length !== profile.beatCount) {
    issues.push(`beatMap must contain exactly ${profile.beatCount} beats.`);
    return issues;
  }
  const expected = Array.from({ length: profile.beatCount }, (_, index) => index + 1);
  if (data.beatMap.some((item, index) => Number(item?.beat) !== expected[index] || !String(item?.event || '').trim())) {
    issues.push('beatMap entries must be ordered { beat: 1..54, event: nonempty string }.');
  }
  return issues;
}

export function renderProfileIssues(render, profile) {
  if (profile.id !== 'motion-studio') return [];
  const video = render?.video || {};
  const issues = [];
  if (Number(video.width) !== profile.target.width || Number(video.height) !== profile.target.height) {
    issues.push(`Rendered video must be ${profile.target.width}×${profile.target.height}; got ${video.width || 'unknown'}×${video.height || 'unknown'}.`);
  }
  if (Math.abs(Number(render.durationSeconds) - 27) > 2) issues.push(`Rendered duration must be about 27 seconds for ${profile.beatCount} beats at ${profile.bpm} BPM.`);
  return issues;
}
