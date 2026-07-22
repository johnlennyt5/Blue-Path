-- RLS policies (ARCHITECTURE §8.2) — S6-2.
-- Every policy derives access from workspace_members. Role model (§8.4):
--   admin  — workspace settings, membership, purge, artifact-storage flag
--   editor — create programs, sync analyses, update statuses, resolve findings
--   viewer — read-only
-- audit_events is insert-only for members: no update/delete policies exist,
-- and none may ever be added (immutability is the feature).

-- ---------------------------------------------------------------------------
-- Role helpers (security definer so policy checks bypass RLS on the
-- membership tables themselves — the standard fix for policy recursion).
-- ---------------------------------------------------------------------------

create schema if not exists private;

-- The caller's role in a workspace, or null if not a member.
create or replace function private.workspace_role(ws uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select role from public.workspace_members
  where workspace_id = ws and user_id = (select auth.uid())
$$;

-- The caller's role in the workspace owning a program.
create or replace function private.program_role(prog uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select private.workspace_role(p.workspace_id)
  from public.programs p
  where p.id = prog
$$;

-- The caller's role in the workspace owning a process.
create or replace function private.process_role(proc uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select private.program_role(pr.program_id)
  from public.processes pr
  where pr.id = proc
$$;

revoke all on all functions in schema private from public, anon;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Table grants. Local config no longer auto-exposes tables (see config.toml
-- note) and anon gets NOTHING — Workspace Mode is authenticated-only.
-- RLS below narrows what these grants actually allow.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on
  workspaces, workspace_members, programs, processes, findings, dependency_edges
to authenticated;
grant select, insert on audit_events to authenticated; -- never update/delete
grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------

create policy workspaces_select on workspaces for select
  using (private.workspace_role(id) is not null);

-- No insert policy: workspace creation happens via the S6-3 RPC, which also
-- bootstraps the creator's admin membership atomically.

create policy workspaces_update on workspaces for update
  using (private.workspace_role(id) = 'admin')
  with check (private.workspace_role(id) = 'admin');

create policy workspaces_delete on workspaces for delete
  using (private.workspace_role(id) = 'admin');

-- ---------------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------------

create policy members_select on workspace_members for select
  using (private.workspace_role(workspace_id) is not null);

create policy members_insert on workspace_members for insert
  with check (private.workspace_role(workspace_id) = 'admin');

create policy members_update on workspace_members for update
  using (private.workspace_role(workspace_id) = 'admin')
  with check (private.workspace_role(workspace_id) = 'admin');

create policy members_delete on workspace_members for delete
  using (private.workspace_role(workspace_id) = 'admin');

-- ---------------------------------------------------------------------------
-- programs
-- ---------------------------------------------------------------------------

create policy programs_select on programs for select
  using (private.workspace_role(workspace_id) is not null);

create policy programs_insert on programs for insert
  with check (
    private.workspace_role(workspace_id) in ('admin', 'editor')
    and created_by = (select auth.uid())
  );

create policy programs_update on programs for update
  using (private.workspace_role(workspace_id) in ('admin', 'editor'))
  with check (private.workspace_role(workspace_id) in ('admin', 'editor'));

create policy programs_delete on programs for delete
  using (private.workspace_role(workspace_id) = 'admin');

-- ---------------------------------------------------------------------------
-- processes
-- ---------------------------------------------------------------------------

create policy processes_select on processes for select
  using (private.program_role(program_id) is not null);

create policy processes_insert on processes for insert
  with check (private.program_role(program_id) in ('admin', 'editor'));

create policy processes_update on processes for update
  using (private.program_role(program_id) in ('admin', 'editor'))
  with check (private.program_role(program_id) in ('admin', 'editor'));

create policy processes_delete on processes for delete
  using (private.program_role(program_id) in ('admin', 'editor'));

-- ---------------------------------------------------------------------------
-- findings
-- ---------------------------------------------------------------------------

create policy findings_select on findings for select
  using (private.process_role(process_id) is not null);

create policy findings_insert on findings for insert
  with check (private.process_role(process_id) in ('admin', 'editor'));

create policy findings_update on findings for update
  using (private.process_role(process_id) in ('admin', 'editor'))
  with check (private.process_role(process_id) in ('admin', 'editor'));

create policy findings_delete on findings for delete
  using (private.process_role(process_id) in ('admin', 'editor'));

-- ---------------------------------------------------------------------------
-- audit_events — insert-only for members; immutable thereafter
-- ---------------------------------------------------------------------------

create policy audit_select on audit_events for select
  using (private.workspace_role(workspace_id) is not null);

create policy audit_insert on audit_events for insert
  with check (
    private.workspace_role(workspace_id) is not null
    and actor = (select auth.uid())
  );

-- Deliberately no update/delete policies (and only select/insert granted).

-- ---------------------------------------------------------------------------
-- dependency_edges
-- ---------------------------------------------------------------------------

create policy edges_select on dependency_edges for select
  using (private.program_role(program_id) is not null);

create policy edges_insert on dependency_edges for insert
  with check (private.program_role(program_id) in ('admin', 'editor'));

create policy edges_delete on dependency_edges for delete
  using (private.program_role(program_id) in ('admin', 'editor'));
