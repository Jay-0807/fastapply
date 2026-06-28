import { describe, expect, it } from 'vitest';
import { collectUnlockVerificationTargets } from './unlock-target';
import type { AppSettings, LLMConfig } from '@/lib/db/types';

// Build just enough of AppSettings for the collector (it only reads two fields).
function settings(
  llmConfigs: Array<Partial<LLMConfig>>,
  encryptedAnthropicKey = '',
): Pick<AppSettings, 'llmConfigs' | 'encryptedAnthropicKey'> {
  return { llmConfigs: llmConfigs as LLMConfig[], encryptedAnthropicKey };
}

describe('collectUnlockVerificationTargets — verify against EVERY stored key', () => {
  it('REGRESSION: configs-only install (legacy field empty) yields the llmConfig key', () => {
    // V2.2 user with a Claude config and no legacy encryptedAnthropicKey. Old
    // code tested only '' → always "Wrong password".
    const s = settings([{ encryptedKey: 'CT::IV' }], '');
    expect(collectUnlockVerificationTargets(s)).toEqual(['CT::IV']);
  });

  it('returns ALL usable config keys (configs can be under different passwords)', () => {
    // The real reason this exists: two configs encrypted with different master
    // passwords. Unlock must be able to try both so the correct one matches.
    const s = settings([{ encryptedKey: 'claude::iv1' }, { encryptedKey: 'kimi::iv2' }], '');
    expect(collectUnlockVerificationTargets(s)).toEqual(['claude::iv1', 'kimi::iv2']);
  });

  it('config keys come before the legacy key, in config order', () => {
    const s = settings([{ encryptedKey: 'cfg1::iv' }, { encryptedKey: 'cfg2::iv' }], 'legacy::iv');
    expect(collectUnlockVerificationTargets(s)).toEqual(['cfg1::iv', 'cfg2::iv', 'legacy::iv']);
  });

  it('skips configs whose key is missing/blank/malformed', () => {
    // 2nd config omits encryptedKey entirely (undefined at runtime); 3rd is blank.
    const s = settings([{ encryptedKey: 'good::iv' }, {}, { encryptedKey: '' }], 'garbage-no-sep');
    expect(collectUnlockVerificationTargets(s)).toEqual(['good::iv']);
  });

  it('includes the legacy key when no config key is usable', () => {
    const s = settings([{ encryptedKey: '' }], 'legacy::iv');
    expect(collectUnlockVerificationTargets(s)).toEqual(['legacy::iv']);
  });

  it('returns [] when nothing encrypted exists yet (caller then accepts any password)', () => {
    expect(collectUnlockVerificationTargets(settings([], ''))).toEqual([]);
    expect(collectUnlockVerificationTargets(settings([{ encryptedKey: '' }], ''))).toEqual([]);
  });

  it('treats a key without "::" as unusable (not a valid ciphertext::iv)', () => {
    expect(collectUnlockVerificationTargets(settings([{ encryptedKey: 'garbage' }], 'alsobad'))).toEqual([]);
  });
});
