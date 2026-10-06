import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = {};
vm.runInNewContext(readFileSync(new URL('./mechanics.js', import.meta.url), 'utf8'), context);
const { draw, status, slideHandoff, crossfadeHandoff, revealText, staggerReveal, musicEnvelope } = context.FilmMotion;
const events = [];
const timeline = Object.fromEntries(['set', 'to', 'fromTo'].map(method => [method, (...args) => { events.push([method, ...args]); return timeline; }]));
const path = { getTotalLength: () => 98 };
assert.equal(draw(timeline, path, { at: 3, duration: 0.6 }), 3.6);
assert.equal(events[0][2].strokeDashoffset, 125);
assert.equal(events[1][2].strokeDashoffset, 0);
assert.equal(events[1][3], 3);

const node = {}, label = {};
status(timeline, node, label, { at: 5 });
assert.equal(events[2][1], node);
assert.equal(events[3][1], label);
assert.ok(events[3][4] > 5);

const out = {}, incoming = {};
slideHandoff(timeline, out, incoming, { at: 7, direction: 'left' });
assert.equal(events[4][2].x, -70);
assert.equal(events[5][3].x, 0);
assert.equal(events[5][4], 7);

crossfadeHandoff(timeline, out, incoming, { at: 8 });
assert.equal(events[6][0], 'to');
assert.equal(events[7][4], 8);
revealText(timeline, label, { at: 9 });
assert.equal(events[8][2].clipPath, 'inset(0 100% 0 0)');
assert.equal(events[8][4], 9);
assert.equal(staggerReveal(timeline, [node, label], { at: 10, gap: 0.2, duration: 0.3 }), 10.5);
assert.equal(events[10][4], 10.2);

const envelope = JSON.parse(musicEnvelope({ duration: 21, fadeOut: 1.6 }));
assert.equal(envelope.lanes[0].target, 'volume');
assert.equal(envelope.lanes[0].points.at(-1).t, 21);
assert.equal(envelope.lanes[0].points.at(-1).v, 0);
assert.throws(() => musicEnvelope({ duration: 1, fadeOut: 2 }));
console.log('motion mechanics contracts pass');
