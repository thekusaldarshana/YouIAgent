# Motion mechanics v0

These are small runtime operations, **not scenes or story templates**. The agent chooses the film's story, timing, visual system, and audio. Load `mechanics.js` after GSAP and before registering the HyperFrames composition's single paused timeline:

```html
<script src="assets/vendor/gsap.min.js"></script>
<script src="film-motion/mechanics.js"></script>
<script>
  const tl = gsap.timeline({ paused: true });
  FilmMotion.draw(tl, document.querySelector('#underline-path'), { at: 1.2, duration: 0.45 });
  FilmMotion.status(tl, document.querySelector('#status-icon'), document.querySelector('#status-label'), { at: 2.4 });
  FilmMotion.slideHandoff(tl, document.querySelector('#scene-a .inner'), document.querySelector('#scene-b .inner'), { at: 3.8, direction: 'left' });
  window.__timelines.main = tl;
</script>
```

Both scenes remain ordinary timed `.clip` elements. The handoff targets children, since HyperFrames owns clip visibility. For a music track, set `data-automation` to the output of `FilmMotion.musicEnvelope({duration: 21, gain: 0.3, fadeOut: 1.6})`; HTML attribute values need escaping if inserted as source text. The function returns HyperFrames volume-lane JSON. Source the music separately and check its license.

`draw(tl, path, {at, duration?, ease?})` prepares a path's dash and schedules a seek-safe reveal. `status(tl, node, label, {at, duration?, rise?})` reveals an object and its label. `slideHandoff(tl, outgoingInner, incomingInner, {at, duration?, distance?, direction?})` slides between two inner elements; direction is `left` or `right`. All times use composition seconds. These helpers call GSAP on the caller's timeline and register no independent timeline.

`crossfadeHandoff(tl, outgoingInner, incomingInner, {at, duration?, outgoingScale?, incomingScale?})` fades and gently reframes two inner elements while HyperFrames owns their clips. `revealText(tl, element, {at, duration?, rise?})` performs a seek-safe masked text reveal. `staggerReveal(tl, elements, {at, gap?, duration?, rise?})` gives cards or records ordered entrances without choosing their layout or copy. These are optional operations, not a scene generator.

This first library is intentionally small. The Social SDK baseline also used path-following motion and music-reactive bobbing; those need separate tests for seek safety before becoming shared primitives. The current helpers have contract tests, but have **not yet been used to create a new film**.
