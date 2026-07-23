/**
 * BL-001 · Crypto round-trip + the ciphertext-only AC: what leaves through
 * the storage upload must contain no trace of the plaintext, and the
 * decrypt round-trip must be byte-perfect (with integrity verification).
 */
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import type { Supabase } from './supabaseClient';
import {
  decryptArtifact,
  encryptArtifact,
  generateArtifactKey,
  importArtifactKey,
  ivFromBase64,
  ivToBase64,
} from './artifactCrypto';
import { downloadArtifact, storeArtifact } from './artifacts';

beforeAll(() => {
  (globalThis as { crypto?: unknown }).crypto ??= webcrypto;
});

describe('artifactCrypto round-trip', () => {
  it('encrypt → decrypt is byte-perfect on a real corpus release', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const plaintext = new TextEncoder().encode(xml);
    const key = await importArtifactKey(await generateArtifactKey());

    const encrypted = await encryptArtifact(key, plaintext);
    const decrypted = await decryptArtifact(key, encrypted.iv, encrypted.ciphertext);
    expect(decrypted.length).toBe(plaintext.length);
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('ciphertext contains no plaintext markers (the network-inspector AC)', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const plaintext = new TextEncoder().encode(xml);
    const key = await importArtifactKey(await generateArtifactKey());
    const { ciphertext } = await encryptArtifact(key, plaintext);

    const asLatin1 = new TextDecoder('latin1').decode(ciphertext);
    for (const marker of ['<?xml', '<process', 'bpr:release', 'Invoice']) {
      expect(asLatin1, `ciphertext must not contain "${marker}"`).not.toContain(marker);
    }
    expect(ciphertext.byteLength).toBeGreaterThanOrEqual(plaintext.byteLength); // + GCM tag
  });

  it('wrong key fails closed; tampered ciphertext fails closed (GCM auth)', async () => {
    const plaintext = new TextEncoder().encode('secret payroll data');
    const key = await importArtifactKey(await generateArtifactKey());
    const wrongKey = await importArtifactKey(await generateArtifactKey());
    const { iv, ciphertext } = await encryptArtifact(key, plaintext);

    await expect(decryptArtifact(wrongKey, iv, ciphertext)).rejects.toThrow();

    const tampered = new Uint8Array(ciphertext.slice(0));
    tampered[0] = tampered[0]! ^ 0xff;
    await expect(decryptArtifact(key, iv, tampered.buffer)).rejects.toThrow();
  });

  it('keys are 32 bytes; malformed imports rejected', async () => {
    const key = await generateArtifactKey();
    expect(ivFromBase64(key).length).toBe(32);
    await expect(importArtifactKey('dG9vc2hvcnQ=')).rejects.toThrow(/32 bytes/);
  });

  it('iv base64 helpers round-trip', () => {
    const iv = new Uint8Array([1, 2, 3, 250, 251, 252, 0, 9, 8, 7, 6, 5]);
    expect(ivFromBase64(ivToBase64(iv))).toEqual(iv);
  });
});

describe('storeArtifact uploads ciphertext only', () => {
  it('the storage payload differs from plaintext and carries no XML', async () => {
    const { xml } = await loadSample('01-clean-and-simple');
    const plaintext = new TextEncoder().encode(xml);
    const key = await generateArtifactKey();

    let uploadedBlob: Blob | null = null;
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'art1', name: 'x.bprelease', kind: 'bprelease', size_bytes: plaintext.byteLength, uploaded_at: 'now' },
          error: null,
        }),
      })),
    }));
    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    const sb = {
      from: vi.fn((table: string) =>
        table === 'artifacts' ? { insert } : { insert: auditInsert },
      ),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn((_path: string, blob: Blob) => {
            uploadedBlob = blob;
            return Promise.resolve({ error: null });
          }),
        })),
      },
    } as unknown as Supabase;

    await storeArtifact(sb, 'ws1', 'me', key, {
      name: 'x.bprelease',
      kind: 'bprelease',
      plaintext,
    });

    expect(uploadedBlob).not.toBeNull();
    const uploadedBytes = new Uint8Array(await uploadedBlob!.arrayBuffer());
    const asText = new TextDecoder('latin1').decode(uploadedBytes);
    expect(asText).not.toContain('<?xml');
    expect(asText).not.toContain('<process');
    expect(Buffer.from(uploadedBytes).equals(Buffer.from(plaintext))).toBe(false);

    // metadata row carries iv + plaintext hash, never content
    const rowArg = (insert.mock.calls[0] as unknown as unknown[])[0] as Record<string, unknown>;
    expect(rowArg['iv']).toBeTypeOf('string');
    expect(rowArg['plaintext_sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rowArg)).not.toContain('<?xml');
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'artifact.stored' }),
    );
  });
});

describe('downloadArtifact round-trip with integrity check', () => {
  it('decrypts what storeArtifact produced; integrity mismatch fails closed', async () => {
    const plaintext = new TextEncoder().encode('<bpr:release>round trip</bpr:release>');
    const keyB64 = await generateArtifactKey();
    const key = await importArtifactKey(keyB64);
    const encrypted = await encryptArtifact(key, plaintext);

    const makeSb = (sha: string): Supabase =>
      ({
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { name: 'rt.bprelease', iv: ivToBase64(encrypted.iv), plaintext_sha256: sha },
                error: null,
              }),
            })),
          })),
        })),
        storage: {
          from: vi.fn(() => ({
            download: vi
              .fn()
              .mockResolvedValue({ data: new Blob([encrypted.ciphertext]), error: null }),
          })),
        },
      }) as unknown as Supabase;

    const result = await downloadArtifact(makeSb(encrypted.plaintextSha256), 'ws1', 'art1', keyB64);
    expect(new TextDecoder().decode(result.plaintext)).toContain('round trip');

    await expect(downloadArtifact(makeSb('0'.repeat(64)), 'ws1', 'art1', keyB64)).rejects.toThrow(
      /integrity/,
    );
  });
});
