-- Pending invitations (S6-3 follow-up, found in user testing): admins could
-- only add members who had already signed in once. Now an invite to any email
-- is recorded, and the first time that person signs in their memberships
-- materialize automatically (claim_workspace_invites, called by the app).

create table workspace_invites (
  workspace_id uuid not null references workspaces on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'editor', 'viewer')),
  invited_by uuid not null references auth.users,
  invited_at timestamptz not null default now(),
  primary key (workspace_id, email)
);

alter table workspace_invites enable row level security;

create policy invites_select on workspace_invites for select
  using (private.workspace_role(workspace_id) is not null);

create policy invites_delete on workspace_invites for delete
  using (private.workspace_role(workspace_id) = 'admin');

-- inserts happen only inside add_workspace_member (security definer)

grant select, delete on workspace_invites to authenticated;

-- ---------------------------------------------------------------------------
-- add_workspace_member v2: unknown email → recorded invite (returns null)
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
  normalized text := lower(trim(member_email));
begin
  if private.workspace_role(ws) is distinct from 'admin' then
    raise exception 'only workspace admins can manage members' using errcode = '42501';
  end if;
  if member_role not in ('admin', 'editor', 'viewer') then
    raise exception 'invalid role %', member_role using errcode = '22023';
  end if;

  select id into target from auth.users where lower(email) = normalized;

  if target is null then
    insert into public.workspace_invites (workspace_id, email, role, invited_by)
    values (ws, normalized, member_role, uid)
    on conflict (workspace_id, email) do update set role = excluded.role;

    insert into public.audit_events (workspace_id, actor, event, subject_type, detail)
    values (ws, uid, 'member.invited', 'email', jsonb_build_object('role', member_role));
    return null;
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
-- claim_workspace_invites() → int — called after sign-in; converts any
-- invites for the caller's email into memberships.
-- ---------------------------------------------------------------------------

create or replace function public.claim_workspace_invites()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  claimer_email text;
  claimed int := 0;
  invite record;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select lower(email) into claimer_email from auth.users where id = uid;

  for invite in
    delete from public.workspace_invites
    where email = claimer_email
    returning workspace_id, role
  loop
    insert into public.workspace_members (workspace_id, user_id, role)
    values (invite.workspace_id, uid, invite.role)
    on conflict (workspace_id, user_id) do nothing;

    insert into public.audit_events (workspace_id, actor, event, subject_type, subject_id)
    values (invite.workspace_id, uid, 'member.joined', 'user', uid);

    claimed := claimed + 1;
  end loop;

  return claimed;
end;
$$;

revoke execute on function public.claim_workspace_invites() from public, anon;
grant execute on function public.claim_workspace_invites() to authenticated;
