import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface WorkspacePathMessages {
  /** Thrown for absolute, empty, or `..`-containing input. */
  invalid: string;
  /** Thrown when the resolved path lands outside the workspace. */
  escapes: string;
}

/**
 * Resolves an untrusted relative path (from an agent's JSON or a plan claim) inside a job workspace.
 * Rejects absolute paths, `..` segments, and anything that resolves outside the workspace root.
 */
export function resolveInWorkspace(workspace: string, given: unknown, messages: WorkspacePathMessages): string {
  if (typeof given !== 'string' || !given || isAbsolute(given) || given.split(/[\\/]/).includes('..')) throw new Error(messages.invalid);
  const path = resolve(workspace, given);
  const remainder = relative(workspace, path);
  if (!remainder || remainder === '..' || remainder.startsWith(`..${sep}`) || isAbsolute(remainder)) throw new Error(messages.escapes);
  return path;
}
