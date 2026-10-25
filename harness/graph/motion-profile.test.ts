import assert from 'node:assert/strict';
import test from 'node:test';
import { MOTION_STUDIO_PROFILE, motionPlanIssues, renderProfileIssues } from './motion-profile.js';

test('motion-studio requires an ordered 54-beat map and square output', () => {
  const beatMap = Array.from({ length: 54 }, (_, index) => ({ beat: index + 1, event: `beat ${index + 1}` }));
  assert.deepEqual(motionPlanIssues({ bpm: 120, beatMap }, MOTION_STUDIO_PROFILE), []);
  assert.match(motionPlanIssues({ bpm: 120, beatMap: beatMap.slice(1) }, MOTION_STUDIO_PROFILE).join(' '), /54 beats/);
  assert.deepEqual(renderProfileIssues({ durationSeconds: 27, video: { width: 1440, height: 1440 } }, MOTION_STUDIO_PROFILE), []);
  assert.match(renderProfileIssues({ durationSeconds: 20, video: { width: 1920, height: 1080 } }, MOTION_STUDIO_PROFILE).join(' '), /1440/);
});
