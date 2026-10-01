import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanoclaw-group-personality-test';
const REPO_ROOT = process.cwd();

vi.mock('./log.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import { ensureContainerConfig } from './db/container-configs.js';
import { closeDb, createAgentGroup, initTestDb, runMigrations } from './db/index.js';
import { PERSONA_PREPEND_FILE } from './group-persona.js';
import { PERSONALITY_FILE, PERSONALITY_MAX_BYTES, readGroupPersonality } from './group-personality.js';
import { log } from './log.js';
import { composeGroupProjectDoc } from './project-doc-compose.js';
import type { AgentGroup } from './types.js';

const groupDir = path.join(TEST_ROOT, 'voice-group');
const writeIn = (name: string, text: string): void => fs.writeFileSync(path.join(groupDir, name), text);

const ag = {
  id: 'ag-voice',
  name: 'voice-group',
  folder: 'voice-group',
  agent_provider: null,
  created_at: new Date().toISOString(),
} as AgentGroup;

async function compose(): Promise<string> {
  await composeGroupProjectDoc(ag, groupDir, { fileName: 'AGENTS.md' });
  return fs.readFileSync(path.join(groupDir, 'AGENTS.md'), 'utf-8');
}

beforeEach(async () => {
  vi.clearAllMocks();
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(groupDir, { recursive: true });
  // Same fixture shape as project-doc-compose.test.ts: the composer resolves
  // the base document from cwd.
  const sourceRoot = path.join(TEST_ROOT, 'source');
  fs.mkdirSync(path.join(sourceRoot, 'container', 'skills'), { recursive: true });
  for (const entry of ['CLAUDE.md', 'agent-runner']) {
    fs.symlinkSync(path.join(REPO_ROOT, 'container', entry), path.join(sourceRoot, 'container', entry));
  }
  process.chdir(sourceRoot);
  await runMigrations(await initTestDb());
  await createAgentGroup(ag);
  await ensureContainerConfig(ag.id);
});

afterEach(async () => {
  process.chdir(REPO_ROOT);
  await closeDb();
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('readGroupPersonality', () => {
  it('returns null when the file is absent', () => {
    expect(readGroupPersonality(groupDir)).toBeNull();
  });

  it('omits, rather than truncates, a file over the size limit', () => {
    writeIn(PERSONALITY_FILE, 'x'.repeat(PERSONALITY_MAX_BYTES + 1));

    expect(readGroupPersonality(groupDir)).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('size limit'), expect.anything());
  });

  it('does not follow a symlink planted at the personality path', () => {
    const secret = path.join(TEST_ROOT, 'secret.txt');
    fs.writeFileSync(secret, 'host secret');
    fs.symlinkSync(secret, path.join(groupDir, PERSONALITY_FILE));

    expect(readGroupPersonality(groupDir)).toBeNull();
  });
});

describe('composeGroupProjectDoc personality section', () => {
  it('sits right after the persona and before the runtime contract', async () => {
    writeIn(PERSONA_PREPEND_FILE, 'You are Louis.');
    writeIn(PERSONALITY_FILE, 'Speak in a cheerful Singlish voice.');

    const doc = await compose();

    const persona = doc.indexOf('# Persona');
    const personality = doc.indexOf('# Personality');
    expect(persona).toBeGreaterThan(-1);
    expect(personality).toBeGreaterThan(persona);
    expect(personality).toBeLessThan(doc.indexOf('# NanoClaw Runtime Contract'));
    expect(doc).toContain('Speak in a cheerful Singlish voice.');
  });

  it('leaves the persona untouched when the personality changes', async () => {
    writeIn(PERSONA_PREPEND_FILE, 'You are Louis.');
    writeIn(PERSONALITY_FILE, 'first voice');
    await compose();

    writeIn(PERSONALITY_FILE, 'second voice');
    const doc = await compose();

    expect(fs.readFileSync(path.join(groupDir, PERSONA_PREPEND_FILE), 'utf-8')).toBe('You are Louis.');
    expect(doc).toContain('second voice');
    expect(doc).not.toContain('first voice');
  });

  it('adds no section when there is no personality file', async () => {
    writeIn(PERSONA_PREPEND_FILE, 'You are Louis.');

    expect(await compose()).not.toContain('# Personality');
  });
});
