// Encrypts API keys using a user-supplied master password.
// Implements ADR-005: PBKDF2-derived AES-GCM, session-cached key in memory only.
//
// Threat model: if someone steals chrome.storage.local bytes off the disk, they
// see only ciphertext. They still need the master password to recover keys.

const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string;          // base64
  salt: string;        // base64 (also stored once on AppSettings for shared salt)
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  // Allocate on a fresh ArrayBuffer (not SharedArrayBuffer) so Web Crypto APIs
  // accept the resulting view directly.
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function deriveKey(password: string, saltB64: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  // extractable: true so we can serialize it into chrome.storage.session and
  // restore it after a service-worker restart. Without this the user would have
  // to re-enter their master password every 5 minutes — the SW idle limit.
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: ITERATIONS,
      salt: base64ToBytes(saltB64),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export function newSalt(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

export async function encryptString(plaintext: string, key: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return {
    ciphertext: bytesToBase64(new Uint8Array(ct)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptString(ciphertextB64: string, ivB64: string, key: CryptoKey): Promise<string> {
  const ct = base64ToBytes(ciphertextB64);
  const iv = base64ToBytes(ivB64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ---- Session-level key cache ----
//
// In MV3, the service worker is killed after ~5 min of idleness, which wipes
// any in-memory state. To avoid forcing the user to re-enter their master
// password every few minutes, we mirror the derived key into
// `chrome.storage.session` — that storage area is RAM-only, partitioned per
// browser session, and gets cleared automatically when the browser closes.
// It's the closest thing Chrome offers to "persists across SW restarts but
// not across browser restarts."

let sessionKey: CryptoKey | null = null;
const SESSION_STORAGE_KEY = 'applyforge:sessionKey';

export function setSessionKey(key: CryptoKey | null): void {
  sessionKey = key;
  // Fire-and-forget persist. Failures here are non-fatal — worst case the user
  // re-unlocks after the next SW restart.
  void persistSessionKey(key);
}

async function persistSessionKey(key: CryptoKey | null): Promise<void> {
  try {
    if (key === null) {
      await chrome.storage.session.remove(SESSION_STORAGE_KEY);
      return;
    }
    const raw = await crypto.subtle.exportKey('raw', key);
    const b64 = bytesToBase64(new Uint8Array(raw));
    await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: b64 });
  } catch {
    // chrome.storage.session may be unavailable in old Chrome; ignore.
  }
}

/**
 * Try to repopulate the in-memory `sessionKey` from chrome.storage.session.
 * Idempotent: if `sessionKey` is already set we do nothing.
 * Call this at SW startup AND lazily at the top of any function that needs
 * a key, so the very first request after a SW restart still succeeds.
 */
export async function restoreSessionKey(): Promise<void> {
  if (sessionKey) return;
  try {
    const stored = (await chrome.storage.session.get(SESSION_STORAGE_KEY)) as Record<string, string>;
    const b64 = stored[SESSION_STORAGE_KEY];
    if (!b64) return;
    const raw = base64ToBytes(b64);
    sessionKey = await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
  } catch {
    // Stored value missing or malformed — fall through, caller will see null.
  }
}

export function getSessionKey(): CryptoKey | null {
  return sessionKey;
}

export const SECURE_STORAGE_CONFIG = { ITERATIONS, SALT_BYTES, IV_BYTES };
