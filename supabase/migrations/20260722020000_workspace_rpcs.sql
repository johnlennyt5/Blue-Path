-- Workspace lifecycle RPCs (S6-3).
-- Workspace INSERT has no RLS policy by design: creation must atomically
-- bootstrap the creator's admin membership, and member management needs an
-- email → user lookup that plain table grants can't expose safely. Both are
-- security-definer RPCs with explicit role checks instead.

-- ---------------------------------------------------------------------------
-- create_workspace(name) → uuid — creator becomes admin, audited.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- add_workspace_member(ws, email, role) → uuid — admin only; the invited
-- person must already have signed in once (magic link creates the account).
-- ---------------------------------------------------------------------------

create or replace function public.add_workspace_member(
  ws uuid,
  member_email text,
  member_role text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target uuid;
begin
  if private.workspace_role(ws) is distinct from 'admin' then
    raise exception 'only workspace admins can manage members' using errcode = '42501';
  end if;
  if member_role not in ('admin', 'editor', 'viewer') then
    raise exception 'invalid role %', member_role using errcode = '22023';
  end if;

  select id into target from auth.users where lower(email) = lower(trim(member_email));
  if target is null then
    raise exception 'no account for % — they must sign in once first', member_email
      using errcode = 'P0002';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, target, member_role);

  insert into public.audit_events (workspace_id, actor, event, subject_type, subject_id, detail)
  values (ws, uid, 'member.added', 'user', target,
          jsonb_build_object('role', member_role));

  return target;
end;
$$;

-- ---------------------------------------------------------------------------
-- list_workspace_members(ws) — members see who's in the workspace, with
-- emails (auth.users is not API-exposed; this is the only sanctioned window).
-- ---------------------------------------------------------------------------

create or replace function public.list_workspace_members(ws uuid)
returns table (user_id uuid, email text, role text)
language sql
security definer
set search_path = ''
stable
as $$
  select m.user_id, u.email::text, m.role
  from public.workspace_members m
  join auth.users u on u.id = m.user_id
  where m.workspace_id = ws
    and private.workspace_role(ws) is not null
  order by m.role, u.email;
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only. anon can execute nothing.
-- ---------------------------------------------------------------------------

revoke execute on function public.create_workspace(text) from public, anon;
revoke execute on function public.add_workspace_member(uuid, text, text) from public, anon;
revoke execute on function public.list_workspace_members(uuid) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.add_workspace_member(uuid, text, text) to authenticated;
grant execute on function public.list_workspace_members(uuid) to authenticated;
