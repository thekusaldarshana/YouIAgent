/* Small, story-neutral GSAP helpers for a HyperFrames composition.
 * Load after GSAP and before the composition's paused timeline is built.
 * These helpers animate children of .clip; HyperFrames owns clip visibility.
 */
(function (root) {
  'use strict';

  function finite(value, label) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
    return value;
  }

  function draw(timeline, path, { at, duration = 0.5, ease = 'power2.out' }) {
    finite(at, 'at'); finite(duration, 'duration');
    if (!path || typeof path.getTotalLength !== 'function') throw new Error('draw needs an SVG path');
    const sourceLength = path.getTotalLength();
    let length = sourceLength * 1.05;
    if (path.getAttribute?.('vector-effect') === 'non-scaling-stroke' && path.getScreenCTM?.() && path.getPointAtLength) {
      const matrix = path.getScreenCTM();
      let previous;
      length = 0;
      for (let index = 0; index <= 48; index++) {
        const point = path.getPointAtLength(sourceLength * index / 48);
        const current = [matrix.a * point.x + matrix.c * point.y, matrix.b * point.x + matrix.d * point.y];
        if (previous) length += Math.hypot(current[0] - previous[0], current[1] - previous[1]);
        previous = current;
      }
      length *= 1.2;
    }
    length = Math.ceil(length) + 2;
    timeline.set(path, { strokeDasharray: `${length} ${length + 40}`, strokeDashoffset: length + 20 }, 0);
    timeline.to(path, { strokeDashoffset: 0, duration, ease }, at);
    return at + duration;
  }

  function status(timeline, node, label, { at, duration = 0.34, rise = 16 }) {
    finite(at, 'at'); finite(duration, 'duration');
    if (!node || !label) throw new Error('status needs node and label');
    timeline.fromTo(node, { scale: 0.78, opacity: 0, transformOrigin: '50% 50%' },
      { scale: 1, opacity: 1, duration, ease: 'back.out(1.5)' }, at);
    timeline.fromTo(label, { y: rise, opacity: 0 },
      { y: 0, opacity: 1, duration: Math.min(duration, 0.28), ease: 'power2.out' }, at + duration * 0.55);
    return at + duration * 1.55;
  }

  function slideHandoff(timeline, outgoingInner, incomingInner,
    { at, duration = 0.55, distance = 70, direction = 'left' }) {
    finite(at, 'at'); finite(duration, 'duration');
    if (!outgoingInner || !incomingInner) throw new Error('slideHandoff needs inner scene elements');
    const sign = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
    if (!sign) throw new Error('direction must be left or right');
    timeline.to(outgoingInner, { x: sign * distance, opacity: 0, duration, ease: 'power2.inOut' }, at);
    timeline.fromTo(incomingInner, { x: -sign * distance, opacity: 0 },
      { x: 0, opacity: 1, duration, ease: 'power2.inOut' }, at);
    return at + duration;
  }

  function crossfadeHandoff(timeline, outgoingInner, incomingInner,
    { at, duration = 0.45, outgoingScale = 1.025, incomingScale = 0.975 }) {
    finite(at, 'at'); finite(duration, 'duration');
    if (!outgoingInner || !incomingInner) throw new Error('crossfadeHandoff needs inner scene elements');
    timeline.to(outgoingInner, { opacity: 0, scale: outgoingScale, duration, ease: 'power2.inOut' }, at);
    timeline.fromTo(incomingInner, { opacity: 0, scale: incomingScale },
      { opacity: 1, scale: 1, duration, ease: 'power2.inOut' }, at);
    return at + duration;
  }

  function revealText(timeline, element, { at, duration = 0.42, rise = 8 }) {
    finite(at, 'at'); finite(duration, 'duration');
    if (!element) throw new Error('revealText needs an element');
    timeline.fromTo(element, { clipPath: 'inset(0 100% 0 0)', y: rise, opacity: 0 },
      { clipPath: 'inset(0 0% 0 0)', y: 0, opacity: 1, duration, ease: 'power2.out' }, at);
    return at + duration;
  }

  function staggerReveal(timeline, elements, { at, gap = 0.16, duration = 0.38, rise = 18 }) {
    finite(at, 'at'); finite(gap, 'gap'); finite(duration, 'duration');
    const nodes = Array.from(elements || []);
    if (!nodes.length) throw new Error('staggerReveal needs at least one element');
    nodes.forEach((element, index) => {
      timeline.fromTo(element, { y: rise, opacity: 0, scale: 0.98 },
        { y: 0, opacity: 1, scale: 1, duration, ease: 'power2.out' }, at + index * gap);
    });
    return at + (nodes.length - 1) * gap + duration;
  }

  function musicEnvelope({ duration, gain = 0.3, fadeIn = 0, fadeOut = 1 }) {
    finite(duration, 'duration'); finite(gain, 'gain'); finite(fadeIn, 'fadeIn'); finite(fadeOut, 'fadeOut');
    if (duration <= 0 || fadeIn + fadeOut > duration || gain > 1) throw new Error('invalid music envelope');
    const points = [{ t: 0, v: fadeIn ? 0 : gain }];
    if (fadeIn) points.push({ t: fadeIn, v: gain });
    if (duration - fadeOut > fadeIn) points.push({ t: duration - fadeOut, v: gain });
    points.push({ t: duration, v: 0 });
    return JSON.stringify({ version: 1, lanes: [{ target: 'volume', points }] });
  }

  root.FilmMotion = Object.freeze({ draw, status, slideHandoff, crossfadeHandoff, revealText, staggerReveal, musicEnvelope });
})(typeof window === 'undefined' ? globalThis : window);
