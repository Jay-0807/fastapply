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
 * Return the "ciphertext::iv" string the unlock check should decrypt, or null
 * when no encrypted key is stored yet.
 *
 * Order: first usable llmConfigs key (V2.2+ primary storage) → legacy
 * encryptedAnthropicKey → null.
 */
export function pickUnlockVerificationTarget(
  settings: Pick<AppSettings, 'llmConfigs' | 'encryptedAnthropicKey'>,
): string | null {
  const fromConfig = settings.llmConfigs?.find((c) => isUsableCiphertext(c.encryptedKey))?.encryptedKey;
  if (isUsableCiphertext(fromConfig)) return fromConfig;
  if (isUsableCiphertext(settings.encryptedAnthropicKey)) return settings.encryptedAnthropicKey;
  return null;
}
