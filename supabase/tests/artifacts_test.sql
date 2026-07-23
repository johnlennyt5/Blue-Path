-- BL-001 · pgTAP: cross-workspace isolation of artifact rows (the AC),
-- role gates, the storage-enabled precondition, and storage.objects policies.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'art-admin1@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'art-viewer1@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'art-admin2@test.local', now(), now());

insert into workspaces (id, name, artifact_storage_enabled) values
  ('80000000-0000-4000-8000-000000000001', 'Art WS One', true),
  ('80000000-0000-4000-8000-000000000002', 'Art WS Two', true),
  ('80000000-0000-4000-8000-000000000003', 'Art WS Dark', false);

insert into workspace_members (workspace_id, user_id, role) values
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'admin'),
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'viewer'),
  ('80000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000003', 'admin'),
  ('80000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000001', 'admin');

insert into artifacts (id, workspace_id, name, kind, size_bytes, iv, plaintext_sha256, uploaded_by) values
  ('90000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 'estate.bprelease', 'bprelease', 1024, 'aXY=', 'abc123', '70000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000002', 'other.bprelease', 'bprelease', 2048, 'aXY=', 'def456', '70000000-0000-4000-8000-000000000003');

insert into storage.objects (bucket_id, name) values
  ('artifacts', '80000000-0000-4000-8000-000000000001/90000000-0000-4000-8000-000000000001'),
  ('artifacts', '80000000-0000-4000-8000-000000000002/90000000-0000-4000-8000-000000000002');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Isolation (the AC)
-- ---------------------------------------------------------------------------

select pg_temp.login('70000000-0000-4000-8000-000000000001'); -- ws1 admin

select results_eq('select name from artifacts', array['estate.bprelease'],
  'ws1 admin sees only ws1 artifact rows');
select is(
  (select count(*) from artifacts where workspace_id = '80000000-0000-4000-8000-000000000002'),
  0::bigint, 'cross-workspace artifact rows are invisible');
select is(
  (select count(*) from storage.objects where bucket_id = 'artifacts'),
  1::bigint, 'ws1 admin sees only ws1 storage objects');

reset role;
select pg_temp.login('70000000-0000-4000-8000-000000000003'); -- ws2 admin
select results_eq('select name from artifacts', array['other.bprelease'],
  'ws2 admin sees only ws2 artifact rows');

-- ---------------------------------------------------------------------------
-- Role + flag gates
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.login('70000000-0000-4000-8000-000000000002'); -- ws1 viewer

select is((select count(*) from artifacts), 1::bigint, 'viewer can list artifacts');
select throws_ok(
  $$insert into artifacts (workspace_id, name, kind, size_bytes, iv, plaintext_sha256, uploaded_by)
    values ('80000000-0000-4000-8000-000000000001', 'v.bprelease', 'bprelease', 1, 'aXY=', 'x', '70000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'viewer cannot store artifacts');

reset role;
select pg_temp.login('70000000-0000-4000-8000-000000000001'); -- ws1 admin

select lives_ok(
  $$insert into artifacts (workspace_id, name, kind, size_bytes, iv, plaintext_sha256, uploaded_by)
    values ('80000000-0000-4000-8000-000000000001', 'more.bprelease', 'bprelease', 1, 'aXY=', 'y', '70000000-0000-4000-8000-000000000001')$$,
  'admin can store artifacts when the flag is on');

select throws_ok(
  $$insert into artifacts (workspace_id, name, kind, size_bytes, iv, plaintext_sha256, uploaded_by)
    values ('80000000-0000-4000-8000-000000000003', 'dark.bprelease', 'bprelease', 1, 'aXY=', 'z', '70000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'flag OFF → even the admin cannot store (storage stays dark)');

select throws_ok(
  $$insert into artifacts (workspace_id, name, kind, size_bytes, iv, plaintext_sha256, uploaded_by)
    values ('80000000-0000-4000-8000-000000000001', 'spoof.bprelease', 'bprelease', 1, 'aXY=', 'w', '70000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'uploaded_by must be the caller');

-- storage.objects write gates
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('artifacts', '80000000-0000-4000-8000-000000000001/new-object')$$,
  'admin can write storage objects under their workspace prefix');

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('artifacts', '80000000-0000-4000-8000-000000000002/sneaky-object')$$,
  '42501', null, 'cannot write into another workspace''s storage prefix');

reset role;
set local role anon;
select throws_ok('select * from artifacts', '42501', null, 'anon has no artifact access');

reset role;
select * from finish();
rollback;
