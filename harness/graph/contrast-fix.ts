import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const contrastFindingSchema = z.looseObject({
  code: z.string().optional(),
  sourceFile: z.string().optional(),
  fg: z.string().optional(),
  suggestedColor: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
});

const checkOutputSchema = z.looseObject({
  contrast: z.looseObject({ findings: z.array(z.unknown()) }).optional(),
});

export interface ContrastFix {
  oldColor: string;
  newColor: string;
  selector: string | undefined;
  text: string | undefined;
}

function rgbHex(value: string | undefined): string | null {
  const match = /^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/.exec(value || '');
  if (!match) return null;
  const channels = match.slice(1).map(Number);
  if (channels.some((channel) => channel > 255)) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** Applies HyperFrames' suggested colour only where the failing literal appears exactly once in index.html. */
export async function fixUniqueContrastLiterals(composition: string, check: unknown): Promise<ContrastFix[]> {
  const parsed = checkOutputSchema.safeParse(check);
  const findings = parsed.success ? parsed.data.contrast?.findings ?? [] : [];
  const fixes: ContrastFix[] = [];
  for (const raw of findings) {
    const result = contrastFindingSchema.safeParse(raw);
    if (!result.success) continue;
    const finding = result.data;
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
