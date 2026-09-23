import fs from 'fs';

/** Remove a skill-copy destination without following symlinks or Windows junctions. */
export function removeSkillDestinationSync(destination: string): void {
  // Node 24.12's rmSync follows the link to check existence, leaving dangling
  // links behind (nodejs/node#61020). A subsequent copy fails or aborts on macOS.
  // lstat also identifies Windows junctions as links; unlink removes the link
  // itself, preserving its target whether that target exists or not.
  const stat = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(destination);
  } else {
    fs.rmSync(destination, { recursive: true, force: true });
  }
}
