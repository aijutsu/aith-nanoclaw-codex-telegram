import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  NOTION_HOST,
  findNotionSecret,
  findNotionSecrets,
  formatSecrets,
  isValidNotionToken,
  onecliCandidates,
  secretRows,
  type OneCliSecret,
} from './notion-connection.js';

const CODEX: OneCliSecret = {
  id: 'sec-1',
  name: 'Codex',
  type: 'openai',
  typeLabel: 'OpenAI',
  hostPattern: 'chatgpt.com',
  createdAt: '2026-09-16T04:16:05.744Z',
};
const NOTION: OneCliSecret = {
  id: 'sec-2',
  name: 'Notion',
  type: 'generic',
  typeLabel: 'Generic',
  hostPattern: NOTION_HOST,
  injectionConfig: { headerName: 'Authorization', valueFormat: 'Bearer {value}' },
  createdAt: '2026-09-23T13:45:00.000Z',
};

describe('token validation', () => {
  it('accepts current and legacy Notion prefixes', () => {
    expect(isValidNotionToken('ntn_1234567890abcdef')).toBe(true);
    expect(isValidNotionToken('secret_1234567890abcdef')).toBe(true);
  });

  // Catching this before the call means the user gets a useful message instead
  // of a 401 from Notion hours later, once something finally uses the vault.
  it('rejects anything that is not a Notion integration token', () => {
    expect(isValidNotionToken('sk-proj-abcdefghijklmnop')).toBe(false);
    expect(isValidNotionToken('ntn_')).toBe(false);
    expect(isValidNotionToken('')).toBe(false);
  });
});

describe('secret lookup', () => {
  it('unwraps the {hint, data} envelope and the bare-object form', () => {
    expect(secretRows({ hint: 'x', data: [CODEX, NOTION] })).toHaveLength(2);
    expect(secretRows(CODEX)).toEqual([CODEX]);
    expect(secretRows(null)).toEqual([]);
  });

  // Matching on host is what makes `add` idempotent: a second run rotates the
  // existing secret instead of creating a duplicate that shadows it.
  it('finds the Notion secret by host, whatever it was named', () => {
    expect(findNotionSecret([CODEX, { ...NOTION, name: 'my notion key' }])?.id).toBe('sec-2');
  });

  it('falls back to the name when the host pattern differs', () => {
    expect(findNotionSecret([CODEX, { ...NOTION, hostPattern: 'notion.so' }])?.id).toBe('sec-2');
  });

  it('returns undefined when Notion is not connected', () => {
    expect(findNotionSecret([CODEX])).toBeUndefined();
  });
});

describe('findNotionSecrets (the removal lookup)', () => {
  // Removal must see every match. Returning just the first would delete one
  // and silently leave the others injecting on the same host.
  it('returns every secret bound to the Notion host', () => {
    const second = { ...NOTION, id: 'sec-3', name: 'Notion (old)' };
    expect(findNotionSecrets([CODEX, NOTION, second]).map((r) => r.id)).toEqual(['sec-2', 'sec-3']);
  });

  // Host is the strong signal; the name fallback must not widen a host match.
  it('prefers host matches and ignores the name fallback when any host matches', () => {
    const decoy = { ...CODEX, id: 'sec-9', name: 'Notion' };
    expect(findNotionSecrets([decoy, NOTION]).map((r) => r.id)).toEqual(['sec-2']);
  });

  it('falls back to the name only when nothing matches the host', () => {
    const decoy = { ...CODEX, id: 'sec-9', name: 'Notion' };
    expect(findNotionSecrets([decoy]).map((r) => r.id)).toEqual(['sec-9']);
  });

  it('returns an empty list when Notion is not connected', () => {
    expect(findNotionSecrets([CODEX])).toEqual([]);
  });
});

describe('formatSecrets', () => {
  // The whole point of the list command: it must never become a way to read
  // a credential back out.
  it('never renders a value even if the API grows a field carrying one', () => {
    const leaky = { ...NOTION, value: 'ntn_SUPERSECRET', token: 'ntn_ALSO_SECRET' } as OneCliSecret;
    const out = formatSecrets([leaky]);
    expect(out).not.toContain('ntn_SUPERSECRET');
    expect(out).not.toContain('ntn_ALSO_SECRET');
    expect(out).toContain('Notion');
    expect(out).toContain(NOTION_HOST);
  });

  it('shows which header a secret injects', () => {
    expect(formatSecrets([NOTION])).toContain('Authorization header');
  });

  // The id is what `remove --id` consumes, so it has to be visible and exact.
  it('renders the id so an ambiguous removal can be disambiguated', () => {
    const out = formatSecrets([NOTION]);
    expect(out).toContain('ID');
    expect(out).toContain('sec-2');
  });

  it('says so plainly when the vault is empty', () => {
    expect(formatSecrets([])).toBe('No secrets in the OneCLI vault yet.');
  });
});

describe('onecliCandidates', () => {
  it('prefers an explicit ONECLI_BIN over everything else', () => {
    const got = onecliCandidates('linux', { ONECLI_BIN: '/opt/custom/onecli', PATH: '/usr/bin' }, '/home/u');
    expect(got[0]).toBe('/opt/custom/onecli');
  });

  it('scans PATH with the platform separator and finds the usual install dir', () => {
    const got = onecliCandidates('linux', { PATH: '/usr/bin:/usr/local/bin' }, '/home/u');
    expect(got).toContain(path.join('/usr/bin', 'onecli'));
    expect(got).toContain(path.join('/home/u', '.local', 'bin', 'onecli'));
  });

  // Windows: semicolon-delimited PATH and a .exe suffix, or nothing resolves.
  it('uses .exe and ; on win32', () => {
    const got = onecliCandidates('win32', { PATH: 'C:\\bin;C:\\tools', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u');
    expect(got).toContain(path.join('C:\\bin', 'onecli.exe'));
    expect(got).toContain(path.join('C:\\tools', 'onecli.exe'));
    expect(got.some((p) => p.endsWith(path.join('AppData\\Local', 'onecli', 'onecli.exe')))).toBe(true);
    expect(got.every((p) => p.endsWith('.exe'))).toBe(true);
  });

  it('does not throw on a missing PATH', () => {
    expect(() => onecliCandidates('darwin', {}, os.homedir())).not.toThrow();
  });
});
