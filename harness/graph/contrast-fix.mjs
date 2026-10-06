import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function rgbHex(value) {
  const match = /^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/.exec(value || '');
  if (!match) return null;
  const channels = match.slice(1).map(Number);
  if (channels.some((channel) => channel > 255)) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export async function fixUniqueContrastLiterals(composition, check) {
  const findings = check?.contrast?.findings || [];
  const fixes = [];
  for (const finding of findings) {
    if (finding.code !== 'contrast_aa_failure' || finding.sourceFile !== 'index.html') continue;
    const oldColor = rgbHex(finding.fg);
    const newColor = rgbHex(finding.suggestedColor);
    if (!oldColor || !newColor || oldColor === newColor) continue;
    const path = join(composition, 'index.html');
    const content = await readFile(path, 'utf8');
    const matches = content.match(new RegExp(oldColor, 'gi')) || [];
    if (matches.length !== 1) continue;
    await writeFile(path, content.replace(new RegExp(oldColor, 'i'), newColor));
    fixes.push({ oldColor, newColor, selector: finding.selector, text: finding.text });
  }
  return fixes;
}
