-- S6-2 · pgTAP RLS isolation suite. Run with `supabase test db`.
-- Proves the §8.2 contract: access derives from workspace_members, cross-
-- workspace access is denied, role gates hold, and audit_events is immutable.
-- Everything runs in one rolled-back transaction — the local DB is untouched.

begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres — bypasses RLS)
-- ---------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin1@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'editor1@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'viewer1@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'admin2@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'stranger@test.local', now(), now());

insert into workspaces (id, name) values
  ('20000000-0000-4000-8000-000000000001', 'WS One'),
  ('20000000-0000-4000-8000-000000000002', 'WS Two');

insert into workspace_members (workspace_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'admin'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'editor'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'viewer'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004', 'admin');

insert into programs (id, workspace_id, name, created_by) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Program One', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Program Two', '10000000-0000-4000-8000-000000000004');

insert into processes (id, program_id, bp_name, source_hash) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Proc One', 'hash-one'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'Proc Two', 'hash-two');

insert into findings (id, process_id, rule_id, severity, category, location_path, message) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'SEC-001', 'critical', 'security', 'p/one', 'finding one'),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'SEC-001', 'critical', 'security', 'p/two', 'finding two');

insert into audit_events (workspace_id, actor, event) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'process.analyzed'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004', 'process.analyzed');

insert into dependency_edges (program_id, from_name, from_type, to_name, to_type) values
  ('30000000-0000-4000-8000-000000000001', 'Proc One', 'process', 'VBO One', 'object'),
  ('30000000-0000-4000-8000-000000000002', 'Proc Two', 'process', 'VBO Two', 'object');

-- Impersonation helper: SET LOCAL role + JWT claims, like PostgREST does.
create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Read isolation
-- ---------------------------------------------------------------------------

select pg_temp.login('10000000-0000-4000-8000-000000000001'); -- ws1 admin

select results_eq('select name from workspaces order by name', array['WS One'],
  'ws1 admin sees only WS One');
select is((select count(*) from processes), 1::bigint,
  'ws1 admin sees only ws1 processes');
select is((select count(*) from findings), 1::bigint,
  'ws1 admin sees only ws1 findings');
select is((select count(*) from audit_events), 1::bigint,
  'ws1 admin sees only ws1 audit events');
select is((select count(*) from dependency_edges), 1::bigint,
  'ws1 admin sees only ws1 dependency edges');
select is((select count(*) from workspace_members), 3::bigint,
  'ws1 admin sees only ws1 memberships');

reset role;
select pg_temp.login('10000000-0000-4000-8000-000000000004'); -- ws2 admin

select results_eq('select name from workspaces order by name', array['WS Two'],
  'ws2 admin sees only WS Two');
select results_eq('select bp_name from processes', array['Proc Two'],
  'ws2 admin sees only ws2 processes');

reset role;
select pg_temp.login('10000000-0000-4000-8000-000000000005'); -- member of nothing

select is((select count(*) from workspaces), 0::bigint, 'non-member sees no workspaces');
select is((select count(*) from processes), 0::bigint, 'non-member sees no processes');
select is((select count(*) from findings), 0::bigint, 'non-member sees no findings');

-- ---------------------------------------------------------------------------
-- Write role gates
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.login('10000000-0000-4000-8000-000000000002'); -- ws1 editor

select lives_ok(
  $$insert into programs (workspace_id, name, created_by)
    values ('20000000-0000-4000-8000-000000000001', 'Editor Program', '10000000-0000-4000-8000-000000000002')$$,
  'editor can create a program in their workspace');

select throws_ok(
  $$insert into programs (workspace_id, name, created_by)
    values ('20000000-0000-4000-8000-000000000002', 'Sneaky', '10000000-0000-4000-8000-000000000002')$$,
  '42501', null,
  'editor cannot create a program in another workspace');

update processes set status = 'converted' where id = '40000000-0000-4000-8000-000000000001';
select is(
  (select status from processes where id = '40000000-0000-4000-8000-000000000001'),
  'converted',
  'editor can update a process status in their workspace');

select is(
  (select detail from audit_events
   where event = 'status.changed'
     and subject_id = '40000000-0000-4000-8000-000000000001'
     and actor = '10000000-0000-4000-8000-000000000002'),
  '{"to": "converted", "from": "analyzed", "name": "Proc One"}'::jsonb,
  'the DATABASE logs the status transition to audit_events (S6-5 AC)');

update findings set resolved = true where id = '50000000-0000-4000-8000-000000000001';
select is(
  (select resolved from findings where id = '50000000-0000-4000-8000-000000000001'),
  true,
  'editor can resolve findings in their workspace');

select throws_ok(
  $$insert into workspace_members (workspace_id, user_id, role)
    values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', 'viewer')$$,
  '42501', null,
  'editor cannot manage membership (admin only)');

reset role;
select pg_temp.login('10000000-0000-4000-8000-000000000003'); -- ws1 viewer

select throws_ok(
  $$insert into programs (workspace_id, name, created_by)
    values ('20000000-0000-4000-8000-000000000001', 'Viewer Program', '10000000-0000-4000-8000-000000000003')$$,
  '42501', null,
  'viewer cannot create programs');

update processes set status = 'blocked' where id = '40000000-0000-4000-8000-000000000001';
select is(
  (select status from processes where id = '40000000-0000-4000-8000-000000000001'),
  'converted',
  'viewer update touches zero rows (read-only)');

update workspaces set artifact_storage_enabled = true where id = '20000000-0000-4000-8000-000000000001';
select is(
  (select artifact_storage_enabled from workspaces where id = '20000000-0000-4000-8000-000000000001'),
  false,
  'viewer cannot flip the artifact-storage flag (admin only)');

-- ---------------------------------------------------------------------------
-- Audit immutability — even the workspace admin cannot rewrite history
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.login('10000000-0000-4000-8000-000000000001'); -- ws1 admin

select lives_ok(
  $$insert into audit_events (workspace_id, actor, event)
    values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'status.changed')$$,
  'member can append audit events');

select throws_ok(
  $$insert into audit_events (workspace_id, actor, event)
    values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'status.changed')$$,
  '42501', null,
  'audit actor must be the caller (no impersonation)');

select throws_ok(
  $$update audit_events set event = 'rewritten' where workspace_id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'audit events cannot be updated — not even by the admin');

select throws_ok(
  $$delete from audit_events where workspace_id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'audit events cannot be deleted — not even by the admin');

-- ---------------------------------------------------------------------------
-- anon gets nothing at all
-- ---------------------------------------------------------------------------

reset role;
set local role anon;

select throws_ok('select * from workspaces', '42501', null,
  'anon has no table access whatsoever');

reset role;
select * from finish();
rollback;
