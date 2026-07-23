/**
 * BL-001 · Encrypted artifact storage API. Everything that leaves the
 * browser is ciphertext + metadata (name, sizes, IV, plaintext hash). The
 * key never appears in any call here — it stays in artifactCrypto/localStorage.
 */
import type { Supabase } from './supabaseClient';
import {
  decryptArtifact,
  encryptArtifact,
  importArtifactKey,
  ivFromBase64,
  ivToBase64,
  sha256Hex,
} from './artifactCrypto';

export type ArtifactKind = 'bprelease' | 'uipath-export';

export interface ArtifactRow {
  id: string;
  name: string;
  kind: ArtifactKind;
  sizeBytes: number;
  uploadedAt: string;
}

const KEY_STORAGE_PREFIX = 'prismshift-artifact-key-';

/** Browser-local key custody, per workspace. Never synced anywhere. */
export const artifactKeyStore = {
  get: (workspaceId: string): string | null =>
    localStorage.getItem(KEY_STORAGE_PREFIX + workspaceId),
  set: (workspaceId: string, keyBase64: string): void =>
    localStorage.setItem(KEY_STORAGE_PREFIX + workspaceId, keyBase64),
  clear: (workspaceId: string): void =>
    localStorage.removeItem(KEY_STORAGE_PREFIX + workspaceId),
};

export async function listArtifacts(
  sb: Supabase,
  workspaceId: string,
): Promise<ArtifactRow[]> {
  const { data, error } = await sb
    .from('artifacts')
    .select('id, name, kind, size_bytes, uploaded_at')
    .eq('workspace_id', workspaceId)
    .order('uploaded_at', { ascending: false });
  if (error !== null) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as ArtifactKind,
    sizeBytes: Number(row.size_bytes),
    uploadedAt: row.uploaded_at,
  }));
}

export async function storeArtifact(
  sb: Supabase,
  workspaceId: string,
  userId: string,
  keyBase64: string,
  artifact: { name: string; kind: ArtifactKind; plaintext: Uint8Array },
): Promise<ArtifactRow> {
  const key = await importArtifactKey(keyBase64);
  const encrypted = await encryptArtifact(key, artifact.plaintext);

  const { data: row, error: rowError } = await sb
    .from('artifacts')
    .insert({
      workspace_id: workspaceId,
      name: artifact.name,
      kind: artifact.kind,
      size_bytes: artifact.plaintext.byteLength,
      iv: ivToBase64(encrypted.iv),
      plaintext_sha256: encrypted.plaintextSha256,
      uploaded_by: userId,
    })
    .select('id, name, kind, size_bytes, uploaded_at')
    .single();
  if (rowError !== null) throw new Error(rowError.message);

  const { error: uploadError } = await sb.storage
    .from('artifacts')
    .upload(`${workspaceId}/${row.id}`, new Blob([encrypted.ciphertext]), {
      contentType: 'application/octet-stream',
    });
  if (uploadError !== null) {
    await sb.from('artifacts').delete().eq('id', row.id); // no orphan rows
    throw new Error(uploadError.message);
  }

  const audit = await sb.from('audit_events').insert({
    workspace_id: workspaceId,
    actor: userId,
    event: 'artifact.stored',
    subject_type: 'artifact',
    subject_id: row.id,
    detail: { name: artifact.name, kind: artifact.kind, bytes: artifact.plaintext.byteLength },
  });
  if (audit.error !== null) throw new Error(audit.error.message);

  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ArtifactKind,
    sizeBytes: Number(row.size_bytes),
    uploadedAt: row.uploaded_at,
  };
}

export async function downloadArtifact(
  sb: Supabase,
  workspaceId: string,
  artifactId: string,
  keyBase64: string,
): Promise<{ name: string; plaintext: Uint8Array }> {
  const { data: row, error: rowError } = await sb
    .from('artifacts')
    .select('name, iv, plaintext_sha256')
    .eq('id', artifactId)
    .single();
  if (rowError !== null) throw new Error(rowError.message);

  const { data: blob, error: downloadError } = await sb.storage
    .from('artifacts')
    .download(`${workspaceId}/${artifactId}`);
  if (downloadError !== null || blob === null) {
    throw new Error(downloadError?.message ?? 'download failed');
  }

  const key = await importArtifactKey(keyBase64);
  let plaintext: Uint8Array;
  try {
    plaintext = await decryptArtifact(key, ivFromBase64(row.iv), await blob.arrayBuffer());
  } catch {
    throw new Error('decryption failed — wrong artifact key for this workspace?');
  }
  if ((await sha256Hex(plaintext)) !== row.plaintext_sha256) {
    throw new Error('integrity check failed after decrypt');
  }
  return { name: row.name, plaintext };
}

export async function removeArtifact(
  sb: Supabase,
  workspaceId: string,
  userId: string,
  artifactId: string,
): Promise<void> {
  const { error: storageError } = await sb.storage
    .from('artifacts')
    .remove([`${workspaceId}/${artifactId}`]);
  if (storageError !== null) throw new Error(storageError.message);
  const { data, error } = await sb
    .from('artifacts')
    .delete()
    .eq('id', artifactId)
    .select('id');
  if (error !== null) throw new Error(error.message);
  if (data === null || data.length === 0) {
    throw new Error('artifact not deleted — only workspace admins can delete');
  }
  const audit = await sb.from('audit_events').insert({
    workspace_id: workspaceId,
    actor: userId,
    event: 'artifact.deleted',
    subject_type: 'artifact',
    subject_id: artifactId,
  });
  if (audit.error !== null) throw new Error(audit.error.message);
}
