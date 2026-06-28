import { describe, expect, it } from 'vitest';
import { pickUnlockVerificationTarget } from './unlock-target';
import type { AppSettings, LLMConfig } from '@/lib/db/types';

// Build just enough of AppSettings for the picker (it only reads two fields).
function settings(
  llmConfigs: Array<Partial<LLMConfig>>,
  encryptedAnthropicKey = '',
): Pick<AppSettings, 'llmConfigs' | 'encryptedAnthropicKey'> {
  return { llmConfigs: llmConfigs as LLMConfig[], encryptedAnthropicKey };
}

describe('pickUnlockVerificationTarget — verify against a key that actually exists', () => {
  it('REGRESSION: configs-only install (legacy field empty) verifies against the llmConfig key', () => {
    // This is the exact broken case: a V2.2 user with a Claude config and no
    // legacy encryptedAnthropicKey. Old code tested '' → always "Wrong password".
    const s = settings([{ encryptedKey: 'CT::IV' }], '');
    expect(pickUnlockVerificationTarget(s)).toBe('CT::IV');
  });

  it('prefers the first usable llmConfig key over the legacy field', () => {
    const s = settings([{ encryptedKey: 'cfg::iv' }], 'legacy::iv');
    expect(pickUnlockVerificationTarget(s)).toBe('cfg::iv');
  });

  it('skips configs whose key is missing/blank and uses the first usable one', () => {
    // 2nd config omits encryptedKey entirely (reads as undefined at runtime).
    const s = settings([{ encryptedKey: '' }, {}, { encryptedKey: 'good::iv' }]);
    expect(pickUnlockVerificationTarget(s)).toBe('good::iv');
  });

  it('falls back to the legacy encryptedAnthropicKey when no config key is usable', () => {
    const s = settings([{ encryptedKey: '' }], 'legacy::iv');
    expect(pickUnlockVerificationTarget(s)).toBe('legacy::iv');
  });

  it('returns null when nothing encrypted exists yet (no false "wrong password")', () => {
    expect(pickUnlockVerificationTarget(settings([], ''))).toBeNull();
    expect(pickUnlockVerificationTarget(settings([{ encryptedKey: '' }], ''))).toBeNull();
  });

  it('treats a malformed key without "::" as unusable (not a valid ciphertext::iv)', () => {
    // A string without the "::" separator can't be decrypted as our payload —
    // don't pick it (would have thrown and masqueraded as a wrong password).
    expect(pickUnlockVerificationTarget(settings([{ encryptedKey: 'garbage' }], 'alsobad'))).toBeNull();
  });
});
