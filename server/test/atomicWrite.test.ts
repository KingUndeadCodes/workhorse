import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// db/core is mocked for every test file (see setup.ts), but the mock spreads the real module, so the real
// atomicWrite is reachable here.
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'workhorse-atomic-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function atomicWrite() {
  return (await import('../src/db/core')).atomicWrite;
}

describe('atomicWrite (database persistence)', () => {
  it('writes the file, creating missing parent directories', async () => {
    const target = join(dir, 'nested', 'state.db');
    (await atomicWrite())(target, Buffer.from('v1'));
    expect(readFileSync(target, 'utf8')).toBe('v1');
  });

  it('replaces an existing file and leaves no temp file behind', async () => {
    const target = join(dir, 'state.db');
    writeFileSync(target, 'old');
    (await atomicWrite())(target, Buffer.from('new'));
    expect(readFileSync(target, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['state.db']);
  });

  it('when the write cannot complete, the previous file is untouched and no temp file is left (a crash must not truncate the database)', async () => {
    const target = join(dir, 'state.db');
    mkdirSync(target); // renaming a file over a directory fails — stands in for any failure after the temp file is written
    writeFileSync(join(target, 'keep'), 'precious');

    const write = await atomicWrite();
    expect(() => write(target, Buffer.from('new'))).toThrow();

    expect(readFileSync(join(target, 'keep'), 'utf8')).toBe('precious');
    expect(readdirSync(dir)).toEqual(['state.db']);
    expect(existsSync(`${target}.${process.pid}.tmp`)).toBe(false);
  });
});
