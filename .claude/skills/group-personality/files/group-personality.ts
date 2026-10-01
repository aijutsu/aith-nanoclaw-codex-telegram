import fs from 'fs';
import path from 'path';

import { log } from './log.js';

/**
 * Per-group voice, tone and language preferences, composed into the project
 * document right after the persona. Kept apart from `instructions.prepend.md`
 * so "talk like X" or "reply in Malay" never edits the file holding the
 * group's standing rules: the agent rewrites this one freely, the persona
 * stays as the operator wrote it.
 */
export const PERSONALITY_FILE = 'personality.md';

/**
 * Omitted, not truncated, above this. It is agent-authored and never
 * droppable, so without a bound it could push real instructions past a
 * provider's project-doc cap (Codex cuts the tail silently). A voice fits in
 * a few hundred bytes; 4 KB is generous.
 */
export const PERSONALITY_MAX_BYTES = 4096;

/** Read a group's personality without following symlinks; null when absent, empty or oversized. */
export function readGroupPersonality(groupDir: string): string | null {
  const file = path.join(groupDir, PERSONALITY_FILE);
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return null;
    if (stat.size > PERSONALITY_MAX_BYTES) {
      log.warn('Group personality file over its size limit; omitting it', {
        file,
        bytes: stat.size,
        maxBytes: PERSONALITY_MAX_BYTES,
      });
      return null;
    }
    const content = fs.readFileSync(fd, 'utf-8').trim();
    return content || null;
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') return null;
    log.warn('Could not read group personality; omitting it', {
      file,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
