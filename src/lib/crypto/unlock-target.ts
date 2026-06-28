// Picks which stored ciphertext the master-password unlock should try to
// decrypt as its correctness check.
//
// Bug this fixes (2026-06-28): unlockSettings used to ALWAYS verify by decrypting
// the legacy V2.1 field `encryptedAnthropicKey`. But V2.2+ stores every API key
// in `llmConfigs[].encryptedKey`, and a configs-only install leaves
// `encryptedAnthropicKey` as '' — so `''.split('::')` → decrypt empty → throw →
// "Wrong master password" for EVERY password, even the correct one. The whole
// unlock path was broken for anyone who onboarded via the V2.2 config flow and
// never set a legacy Anthropic key.
//
// Fix: verify against whatever encrypted key actually exists — prefer a real
// llmConfig key, fall back to the legacy field, and return null when there's
// nothing encrypted yet (caller should then accept the derived key: there is no
// ciphertext it could decrypt wrongly, so the password can't be "wrong").
//
// Security is preserved: when a real ciphertext exists, a wrong password yields
// a wrong AES-GCM key and decryption still fails the auth tag → rejected.

import type { AppSettings } from '@/lib/db/types';

/** Encrypted payloads are stored as "ciphertext::iv"; a valid target contains "::". */
function isUsableCiphertext(s: string | undefined | null): s is string {
  return typeof s === 'string' && s.includes('::');
}

/**
 * Return EVERY "ciphertext::iv" the unlock check could decrypt, in priority
 * order: all usable llmConfigs keys (V2.2+ primary storage), then the legacy
 * encryptedAnthropicKey. Empty when nothing is encrypted yet.
 *
 * Why all of them, not just the first (2026-06-28): `addLLMConfig` derives the
 * AES key from whatever master password was typed AT ADD TIME, without checking
 * it matches existing configs — so two configs can be encrypted under DIFFERENT
 * passwords (same salt). Verifying only the first config then rejects the
 * (correct!) password for any other config. `unlockSettings` tries each target
 * and unlocks if the password decrypts ANY of them, so whichever config the
 * password belongs to (e.g. the one the user is actively using) unlocks the
 * session. A wrong password matches none → still rejected.
 */
export function collectUnlockVerificationTargets(
  settings: Pick<AppSettings, 'llmConfigs' | 'encryptedAnthropicKey'>,
): string[] {
  const targets: string[] = [];
  for (const c of settings.llmConfigs ?? []) {
    if (isUsableCiphertext(c.encryptedKey)) targets.push(c.encryptedKey);
  }
  if (isUsableCiphertext(settings.encryptedAnthropicKey)) targets.push(settings.encryptedAnthropicKey);
  return targets;
}
