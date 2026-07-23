/**
 * BL-001 · Client-side artifact encryption (AES-GCM-256 via Web Crypto).
 * The key is generated HERE, lives in the browser (shared between teammates
 * out-of-band as a base64 string), and never travels to Supabase. Losing the
 * key means losing the artifacts — stated in the UI, restated here.
 */

export interface EncryptedArtifact {
  /** 12-byte AES-GCM IV (public by design). */
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  /** SHA-256 of the plaintext, hex — integrity check after decrypt. */
  plaintextSha256: string;
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

export async function generateArtifactKey(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const raw = await crypto.subtle.exportKey('raw', key);
  return toBase64(new Uint8Array(raw));
}

export async function importArtifactKey(base64: string): Promise<CryptoKey> {
  const raw = fromBase64(base64.trim());
  if (raw.length !== 32) throw new Error('artifact key must be 32 bytes (AES-256)');
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function encryptArtifact(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<EncryptedArtifact> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext as BufferSource,
  );
  return { iv, ciphertext, plaintextSha256: await sha256Hex(plaintext) };
}

/** Throws on wrong key or tampered ciphertext (GCM authenticates). */
export async function decryptArtifact(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: ArrayBuffer,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}

export const ivToBase64 = toBase64;
export const ivFromBase64 = fromBase64;
