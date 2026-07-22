-- S6-3 · pgTAP suite for workspace lifecycle RPCs. Run with `supabase test db`.
-- Proves: create_workspace bootstraps creator-as-admin atomically (with audit),
-- member management is admin-only, unknown emails fail cleanly, anon can
-- execute nothing.

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'founder@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'teammate@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'thirdwheel@test.local', now(), now());

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- create_workspace
-- ---------------------------------------------------------------------------

select pg_temp.login('60000000-0000-4000-8000-000000000001');

create temporary table t_ws as
  select public.create_workspace('  Founder Space  ') as id;

select is((select name from workspaces where id = (select id from t_ws)),
  'Founder Space', 'create_workspace inserts the trimmed workspace');

select is(
  (select role from workspace_members
   where workspace_id = (select id from t_ws)
     and user_id = '60000000-0000-4000-8000-000000000001'),
  'admin', 'creator is bootstrapped as admin');

select is(
  (select count(*) from audit_events
   where workspace_id = (select id from t_ws) and event = 'workspace.created'),
  1::bigint, 'creation is audited');

select throws_ok(
  $$select public.create_workspace('   ')$$,
  '22023', null, 'blank workspace name is rejected');

-- ---------------------------------------------------------------------------
-- add_workspace_member + list_workspace_members
-- ---------------------------------------------------------------------------

select is(
  (select public.add_workspace_member((select id from t_ws), 'TEAMMATE@test.local', 'editor')),
  '60000000-0000-4000-8000-000000000002'::uuid,
  'admin adds a member by email (case-insensitive)');

select is(
  (select role from workspace_members
   where workspace_id = (select id from t_ws)
     and user_id = '60000000-0000-4000-8000-000000000002'),
  'editor', 'added member has the requested role');

select is(
  (select public.add_workspace_member((select id from t_ws), 'Newbie@test.local', 'viewer')),
  null, 'unknown email records a pending invite (returns null)');

select is(
  (select role from workspace_invites
   where workspace_id = (select id from t_ws) and email = 'newbie@test.local'),
  'viewer', 'invite row stored with normalized email + role');

select throws_ok(
  format($$select public.add_workspace_member('%s', 'thirdwheel@test.local', 'owner')$$,
         (select id from t_ws)),
  '22023', null, 'invalid role is rejected');

select is(
  (select count(*) from public.list_workspace_members((select id from t_ws))),
  2::bigint, 'members can list the roster (with emails)');

-- Editor (not admin) cannot manage members.
reset role;
select pg_temp.login('60000000-0000-4000-8000-000000000002');

select throws_ok(
  format($$select public.add_workspace_member('%s', 'thirdwheel@test.local', 'viewer')$$,
         (select id from t_ws)),
  '42501', null, 'editor cannot add members (admin only)');

-- ---------------------------------------------------------------------------
-- invite claiming: first sign-in materializes memberships
-- ---------------------------------------------------------------------------

reset role;
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'newbie@test.local', now(), now());

select pg_temp.login('60000000-0000-4000-8000-000000000009');

select is((select public.claim_workspace_invites()), 1,
  'new user claims their pending invite on first sign-in');

select is(
  (select role from workspace_members
   where workspace_id = (select id from t_ws)
     and user_id = '60000000-0000-4000-8000-000000000009'),
  'viewer', 'claimed invite created the membership with the invited role');

select is(
  (select count(*) from workspace_invites
   where email = 'newbie@test.local'), 0::bigint,
  'claimed invite is consumed');

select is((select public.claim_workspace_invites()), 0,
  'claiming again is a no-op');

-- ---------------------------------------------------------------------------
-- stale session (JWT for a user id that no longer exists) fails helpfully
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.login('99999999-0000-4000-8000-000000000000'); -- no such user

select throws_ok(
  $$select public.create_workspace('Ghost Space')$$,
  '28000', null, 'stale session gets a sign-out-and-back-in error, not an FK violation');

-- ---------------------------------------------------------------------------
-- anon can execute nothing
-- ---------------------------------------------------------------------------

reset role;
set local role anon;

select throws_ok(
  $$select public.create_workspace('Anon Space')$$,
  '42501', null, 'anon cannot execute create_workspace');

reset role;
select * from finish();
rollback;
