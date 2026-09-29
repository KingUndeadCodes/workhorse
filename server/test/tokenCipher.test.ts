import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from '../src/crypto/tokenCipher';

describe('tokenCipher', () => {
  it('round-trips a token through encrypt/decrypt', () => {
    const plaintext = 'ghp_thisIsNotARealToken1234567890';
    const encrypted = encryptToken(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it('produces a different ciphertext each call (random IV)', () => {
    const plaintext = 'same-token-value';
    expect(encryptToken(plaintext)).not.toBe(encryptToken(plaintext));
  });

  it('passes a pre-encryption plaintext value through unchanged', () => {
    // A token stored before this module existed has no "gcm1:" prefix — decrypting it must
    // return it as-is rather than throwing, so an existing GitRepoLink keeps working.
    expect(decryptToken('some-legacy-plaintext-token')).toBe('some-legacy-plaintext-token');
  });

  it('throws on a tampered ciphertext instead of returning garbage', () => {
    const encrypted = encryptToken('a-real-token');
    const tampered = encrypted.slice(0, -4) + 'AAAA';
    expect(() => decryptToken(tampered)).toThrow();
  });
});
