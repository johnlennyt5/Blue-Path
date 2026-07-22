-- Friendly failure for stale sessions (found in user testing): after a local
-- `db reset`, browsers still hold valid JWTs for user ids that no longer
-- exist in auth.users. create_workspace then died with an FK violation on the
-- membership insert. Guard up front and say what to do.

create or replace function public.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = uid) then
    raise exception 'your session is stale (the local database was reset) — sign out and sign in again'
      using errcode = '28000';
  end if;
  if workspace_name is null or length(trim(workspace_name)) = 0 then
    raise exception 'workspace name is required' using errcode = '22023';
  end if;

  insert into public.workspaces (name)
  values (trim(workspace_name))
  returning id into new_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_id, uid, 'admin');

  insert into public.audit_events (workspace_id, actor, event, subject_type, subject_id)
  values (new_id, uid, 'workspace.created', 'workspace', new_id);

  return new_id;
end;
$$;
