-- BL-001: encrypted artifact storage. Artifacts are AES-GCM-encrypted in the
-- browser BEFORE upload; Supabase only ever stores ciphertext plus metadata.
-- The encryption key is generated client-side and never reaches this
-- database — key loss means artifact loss, by design.

-- ---------------------------------------------------------------------------
-- Metadata rows (one per stored artifact)
-- ---------------------------------------------------------------------------

create table artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  name text not null,
  kind text not null check (kind in ('bprelease', 'uipath-export')),
  size_bytes bigint not null check (size_bytes >= 0),
  /** AES-GCM IV, base64 (public by design — uniqueness is what matters). */
  iv text not null,
  /** SHA-256 of the PLAINTEXT, for integrity verification after decrypt. */
  plaintext_sha256 text not null,
  uploaded_by uuid not null references auth.users,
  uploaded_at timestamptz not null default now()
);

alter table artifacts enable row level security;

create policy artifacts_select on artifacts for select
  using (private.workspace_role(workspace_id) is not null);

create policy artifacts_insert on artifacts for insert
  with check (
    private.workspace_role(workspace_id) in ('admin', 'editor')
    and uploaded_by = (select auth.uid())
    -- storage stays dark until the admin flips the switch
    and exists (
      select 1 from workspaces w
      where w.id = workspace_id and w.artifact_storage_enabled
    )
  );

create policy artifacts_delete on artifacts for delete
  using (private.workspace_role(workspace_id) = 'admin');

grant select, insert, delete on artifacts to authenticated;

create index artifacts_workspace_idx on artifacts (workspace_id, uploaded_at desc);

-- ---------------------------------------------------------------------------
-- Storage bucket (private) + object policies: path prefix = workspace id
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('artifacts', 'artifacts', false)
on conflict (id) do nothing;

create policy artifact_objects_select on storage.objects for select
  using (
    bucket_id = 'artifacts'
    and private.workspace_role(((storage.foldername(name))[1])::uuid) is not null
  );

create policy artifact_objects_insert on storage.objects for insert
  with check (
    bucket_id = 'artifacts'
    and private.workspace_role(((storage.foldername(name))[1])::uuid) in ('admin', 'editor')
  );

create policy artifact_objects_delete on storage.objects for delete
  using (
    bucket_id = 'artifacts'
    and private.workspace_role(((storage.foldername(name))[1])::uuid) = 'admin'
  );
