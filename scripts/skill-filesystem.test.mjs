// Dependency-free so the actual filesystem behavior runs on every CI OS,
// including the affected Node 24.12 runtime, without native addon installs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { removeSkillDestinationSync } from '../src/skill-filesystem.ts';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-skill-fs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

for (const type of ['file', 'dir', 'junction']) {
  for (const exists of [false, true]) {
    test(`replaces ${exists ? 'live' : 'dangling'} ${type} link and preserves its target`, (t) => {
      const root = fixture(t);
      const target = path.join(root, 'target');
      const dest = path.join(root, 'dest');
      const source = path.join(root, 'source');
      fs.mkdirSync(source);
      fs.writeFileSync(path.join(source, 'SKILL.md'), 'welcome');
      if (exists) {
        if (type === 'file') fs.writeFileSync(target, 'untouched');
        else {
          fs.mkdirSync(target);
          fs.writeFileSync(path.join(target, 'keep.txt'), 'untouched');
        }
      }
      // On Windows these exercise distinct reparse-point types; on POSIX
      // Node ignores type and creates ordinary symbolic links.
      fs.symlinkSync(target, dest, type);
      assert.equal(fs.lstatSync(dest).isSymbolicLink(), true);
      removeSkillDestinationSync(dest);
      assert.equal(fs.lstatSync(dest, { throwIfNoEntry: false }), undefined);
      fs.cpSync(source, dest, { recursive: true });
      assert.equal(fs.lstatSync(dest).isDirectory(), true);
      assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), 'welcome');

      // A respawn replaces the real directory created on the first spawn.
      fs.writeFileSync(path.join(source, 'SKILL.md'), 'updated');
      removeSkillDestinationSync(dest);
      fs.cpSync(source, dest, { recursive: true });
      assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), 'updated');
      if (exists) {
        const file = type === 'file' ? target : path.join(target, 'keep.txt');
        assert.equal(fs.readFileSync(file, 'utf8'), 'untouched');
        if (type !== 'file') assert.deepEqual(fs.readdirSync(target), ['keep.txt']);
      } else assert.equal(fs.existsSync(target), false);
    });
  }
}

test('handles absent paths and regular files', (t) => {
  const dest = path.join(fixture(t), 'dest');
  removeSkillDestinationSync(dest);
  fs.writeFileSync(dest, 'old');
  removeSkillDestinationSync(dest);
  assert.equal(fs.lstatSync(dest, { throwIfNoEntry: false }), undefined);
});

test('removes a stale directory containing links without touching their targets', (t) => {
  const root = fixture(t);
  const dest = path.join(root, 'dest');
  const target = path.join(root, 'target');
  fs.mkdirSync(dest);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'keep.txt'), 'untouched');
  fs.symlinkSync(target, path.join(dest, 'live'), 'junction');
  fs.symlinkSync(path.join(root, 'missing'), path.join(dest, 'dangling'), 'dir');
  removeSkillDestinationSync(dest);
  assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'untouched');
});
