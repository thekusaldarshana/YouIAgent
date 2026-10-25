import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { harnessAsset } from '../runtime/paths.js';

/** The compiled helper is a classic script, so it is loaded the way a composition loads it. */
interface FilmMotion {
  draw(timeline: object, path: object, options: object): number;
  status(timeline: object, node: object, label: object, options: object): number;
  slideHandoff(timeline: object, outgoing: object, incoming: object, options: object): number;
  crossfadeHandoff(timeline: object, outgoing: object, incoming: object, options: object): number;
  revealText(timeline: object, element: object, options: object): number;
  staggerReveal(timeline: object, elements: object[], options: object): number;
  musicEnvelope(options: object): string;
}

const context: { FilmMotion?: FilmMotion } = {};
vm.runInNewContext(readFileSync(harnessAsset('motion', 'mechanics.js'), 'utf8'), context);
const { draw, status, slideHandoff, crossfadeHandoff, revealText, staggerReveal, musicEnvelope } = context.FilmMotion as FilmMotion;

type Call = [method: string, ...args: unknown[]];
const events: Call[] = [];
const timeline = Object.fromEntries(['set', 'to', 'fromTo'].map((method) => [method, (...args: unknown[]) => { events.push([method, ...args]); return timeline; }]));
const at = (index: number): Call => events[index] as Call;
const vars = (index: number, position: number): Record<string, unknown> => at(index)[position] as Record<string, unknown>;

const path = { getTotalLength: () => 98 };
assert.equal(draw(timeline, path, { at: 3, duration: 0.6 }), 3.6);
assert.equal(vars(0, 2)['strokeDashoffset'], 125);
assert.equal(vars(1, 2)['strokeDashoffset'], 0);
assert.equal(at(1)[3], 3);
const node = {}, label = {};
status(timeline, node, label, { at: 5 });
assert.equal(at(2)[1], node);
assert.equal(at(3)[1], label);
assert.ok(Number(at(3)[4]) > 5);
const out = {}, incoming = {};
slideHandoff(timeline, out, incoming, { at: 7, direction: 'left' });
assert.equal(vars(4, 2)['x'], -70);
assert.equal(vars(5, 3)['x'], 0);
assert.equal(at(5)[4], 7);
crossfadeHandoff(timeline, out, incoming, { at: 8 });
assert.equal(at(6)[0], 'to');
assert.equal(at(7)[4], 8);
revealText(timeline, label, { at: 9 });
assert.equal(vars(8, 2)['clipPath'], 'inset(0 100% 0 0)');
assert.equal(at(8)[4], 9);
assert.equal(staggerReveal(timeline, [node, label], { at: 10, gap: 0.2, duration: 0.3 }), 10.5);
assert.equal(at(10)[4], 10.2);
const envelope = JSON.parse(musicEnvelope({ duration: 21, fadeOut: 1.6 })) as { lanes: { target: string; points: { t: number; v: number }[] }[] };
assert.equal(envelope.lanes[0]?.target, 'volume');
assert.equal(envelope.lanes[0]?.points.at(-1)?.t, 21);
assert.equal(envelope.lanes[0]?.points.at(-1)?.v, 0);
assert.throws(() => musicEnvelope({ duration: 1, fadeOut: 2 }));
console.log('motion mechanics contracts pass');
