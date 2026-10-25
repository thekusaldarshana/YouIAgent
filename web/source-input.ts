import { isAbsolute, resolve } from 'node:path';
import { isDirectory } from '../shared/json.js';

export interface SourceRequest {
  websiteUrl?: unknown;
  repositoryUrl?: unknown;
}

export interface NormalizedSources {
  websiteUrl: string | null;
  repositoryUrl: string | null;
}

/** Validates the user's website and repository inputs. Anything from the browser or CLI is `unknown`. */
export async function normalizeSources({ websiteUrl, repositoryUrl }: SourceRequest, { allowRelativePath = false }: { allowRelativePath?: boolean } = {}): Promise<NormalizedSources> {
  const website = String(websiteUrl || '').trim();
  const repository = String(repositoryUrl || '').trim();
  if (!website && !repository) throw new Error('Enter a website URL or a GitHub repository URL or local folder.');
  let normalizedWebsite: string | null = null;
  if (website) {
    const url = new URL(website);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a website HTTP(S) URL without embedded credentials.');
    normalizedWebsite = url.href;
  }
  let normalizedRepository: string | null = null;
  if (repository) {
    if (/^https?:\/\//i.test(repository)) {
      const url = new URL(repository);
      const parts = url.pathname.split('/').filter(Boolean);
      const [owner, name] = parts;
      if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash || parts.length !== 2 || !owner || !name || !parts.every((part) => /^[\w.-]+$/.test(part))) {
        throw new Error('Use an HTTPS github.com/owner/repo URL without embedded credentials, or a local folder path.');
      }
      normalizedRepository = `https://github.com/${owner}/${name.replace(/\.git$/, '')}`;
    } else {
      if (!allowRelativePath && !isAbsolute(repository)) throw new Error('Use an absolute local folder path.');
      const path = resolve(repository);
      if (!await isDirectory(path)) throw new Error('The local repository folder does not exist or is not a directory.');
      normalizedRepository = path;
    }
  }
  return { websiteUrl: normalizedWebsite, repositoryUrl: normalizedRepository };
}
