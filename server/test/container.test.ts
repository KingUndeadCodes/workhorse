import { describe, expect, it, vi } from 'vitest';
import { registerSafely } from '../src/container';

describe('registerSafely', () => {
  it('runs the registration when it succeeds, without logging anything', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const register = vi.fn();

    registerSafely('a working provider', register);

    expect(register).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('catches a throwing registration and logs it, instead of propagating', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const register = vi.fn(() => {
      throw new Error('boom');
    });

    expect(() => registerSafely('a broken provider', register)).not.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('a broken provider'), 'boom');
    errorSpy.mockRestore();
  });

  it('does not stop a later registration from running after an earlier one throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = vi.fn();

    registerSafely('first (throws)', () => {
      throw new Error('first failed');
    });
    registerSafely('second (fine)', second);

    expect(second).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
