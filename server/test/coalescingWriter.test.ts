import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CoalescingWriter } from '../src/db/coalescingWriter';

function setup(write = vi.fn()) {
  const pending: (() => void)[] = [];
  const onBackgroundError = vi.fn();
  const writer = new CoalescingWriter(write, (run) => pending.push(run), onBackgroundError);
  const runScheduled = () => pending.splice(0).forEach((run) => run());
  return { writer, write, pending, runScheduled, onBackgroundError };
}

describe('CoalescingWriter', () => {
  it('turns any number of markDirty calls into a single write (one PATCH used to cost fourteen)', () => {
    const { writer, write, runScheduled } = setup();
    for (let i = 0; i < 14; i++) writer.markDirty();
    expect(write).not.toHaveBeenCalled(); // nothing is written while work is still going on

    writer.flush();

    expect(write).toHaveBeenCalledTimes(1);
    runScheduled(); // the fallback that was scheduled finds nothing left to do
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('flush does nothing when nothing changed', () => {
    const { writer, write } = setup();
    writer.flush();
    expect(write).not.toHaveBeenCalled();
  });

  it('saves on the scheduled fallback when nobody flushes (work outside a request, e.g. a webhook delivery logging its result)', () => {
    const { writer, write, pending, runScheduled } = setup();
    writer.markDirty();
    writer.markDirty();
    expect(pending).toHaveLength(1); // scheduled once, not once per call

    runScheduled();

    expect(write).toHaveBeenCalledTimes(1);
    expect(writer.isDirty).toBe(false);
  });

  it('schedules again for changes made after a save', () => {
    const { writer, write, runScheduled } = setup();
    writer.markDirty();
    runScheduled();
    writer.markDirty();
    runScheduled();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('a failed write throws to the caller and stays dirty, so the next flush retries instead of silently losing data', () => {
    const write = vi.fn().mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const { writer } = setup(write);
    writer.markDirty();

    expect(() => writer.flush()).toThrow('disk full');
    expect(writer.isDirty).toBe(true);

    writer.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(writer.isDirty).toBe(false);
  });

  it('a failure in the background fallback is reported rather than crashing the process, and retried later', () => {
    const write = vi.fn().mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const { writer, runScheduled, onBackgroundError } = setup(write);
    writer.markDirty();

    expect(() => runScheduled()).not.toThrow();
    expect(onBackgroundError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }));

    writer.flush();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('works end to end with atomicWrite: many marks, one file write, no temp file left', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'workhorse-coalesce-'));
    try {
      const { atomicWrite } = await import('../src/db/core');
      const target = join(dir, 'state.db');
      let version = 0;
      const writer = new CoalescingWriter(() => atomicWrite(target, Buffer.from(`v${++version}`)), (run) => void run);
      writer.markDirty(); // scheduler here is a no-op stand-in that never runs, like "still inside a request"
      writer.markDirty();
      writer.markDirty();

      writer.flush();

      expect(readFileSync(target, 'utf8')).toBe('v1');
      expect(readdirSync(dir)).toEqual(['state.db']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
