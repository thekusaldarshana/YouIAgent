import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function makeContactSheet(video, durationSeconds, output, ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg') {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('A positive render duration is required for review.');
  await mkdir(dirname(output), { recursive: true });
  const fps = Math.min(1, 20 / durationSeconds);
  await execFileAsync(ffmpeg, ['-v', 'error', '-y', '-i', video, '-vf', `fps=${fps},scale=320:-1,tile=5x4`, '-frames:v', '1', output], { timeout: 120_000 });
  if (!(await stat(output).catch(() => null))?.isFile()) throw new Error('Contact sheet was not created.');
  return { path: output, sampleIntervalSeconds: 1 / fps };
}

export async function reviewRenderedFilm(state, agent) {
  const outputDir = join(state.workspace, 'film-output');
  const reportPath = join(outputDir, 'visual-review.md');
  const sheet = join(outputDir, 'review', 'contact-sheet.jpg');
  const video = state.render?.output;
  await mkdir(outputDir, { recursive: true });
  try {
    if (!video || !(await stat(video).catch(() => null))?.isFile()) throw new Error('Rendered video is unavailable.');
    const contact = await makeContactSheet(video, state.render.durationSeconds, sheet);
    const prompt = `Read .agents/skills/film-graph/SKILL.md and .agents/skills/film-review/SKILL.md. Review only the rendered film. Inspect film-output/review/contact-sheet.jpg as an image; sample spacing is about ${contact.sampleIntervalSeconds.toFixed(2)} seconds, left to right and top to bottom. Inspect the MP4 at ${relative(state.workspace, video).replaceAll('\\', '/')} at normal speed and listen if your tools allow it. Read film-output/film-plan.md and the render report. Write film-output/visual-review.md with the specified sections and an honest verdict. If you cannot see the image or play the film, say so. Do not change the composition, plan, or MP4.`;
    await agent(state.workspace, state.jobDir, 'review', prompt, state.input.model, state.input.effort, state.input.provider);
    const report = await readFile(reportPath, 'utf8');
    if (!/inspected/i.test(report) || !/verdict/i.test(report)) throw new Error('Review report omitted inspected media or verdict.');
    return { status: /\bunreviewed\b/i.test(report.match(/##\s*Verdict[\s\S]*/i)?.[0] || '') ? 'unreviewed' : 'reported', report: reportPath, contactSheet: sheet };
  } catch (error) {
    await writeFile(reportPath, `# Visual review\n\n## Inspected\n\nReview could not be completed.\n\n## Verdict\n\nunreviewed: ${error.message}\n`);
    return { status: 'unreviewed', report: reportPath, contactSheet: (await stat(sheet).catch(() => null))?.isFile() ? sheet : null, reason: error.message };
  }
}
