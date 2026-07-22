-- Local development seed (S6-1). Demo data only — mirrors corpus sample #2
-- ("realistic mid-size") so the dashboard has something real-shaped to show.
-- Never applied to hosted environments; `supabase db reset` loads it locally.

-- A confirmed local test user (magic-link login works against local auth).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'demo@prismshift.local',
  crypt('demo-password', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{}'
);

insert into workspaces (id, name) values
  ('b0000000-0000-4000-8000-000000000001', 'PrismShift Demo');

insert into workspace_members (workspace_id, user_id, role) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'admin');

insert into programs (id, workspace_id, name, created_by) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'Invoice Processing Estate', 'a0000000-0000-4000-8000-000000000001');

insert into processes (id, program_id, bp_name, source_hash, bp_version, stage_count, score, grade, status, effort_hours_est) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'Invoice Dispatcher', 'seed-hash-dispatcher-0000000000000000000000000000000000000001',
   '6.10.1', 24, 61, 'D', 'converted', 3.5),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
   'Invoice Performer', 'seed-hash-performer-00000000000000000000000000000000000000002',
   '6.10.1', 31, 55, 'F', 'analyzed', 5.0);

insert into findings (process_id, rule_id, severity, category, location_path, message) values
  ('d0000000-0000-4000-8000-000000000001', 'SEC-001', 'critical', 'security',
   'process/Invoice Dispatcher/Main Page/Get Credentials', 'Hard-coded credential in stage input'),
  ('d0000000-0000-4000-8000-000000000001', 'REL-002', 'high', 'reliability',
   'process/Invoice Dispatcher/Main Page/Add To Queue', 'No retry handling around queue write'),
  ('d0000000-0000-4000-8000-000000000002', 'MNT-001', 'medium', 'maintainability',
   'process/Invoice Performer/Process Item', 'Page exceeds recommended stage count');

insert into dependency_edges (program_id, from_name, from_type, to_name, to_type) values
  ('c0000000-0000-4000-8000-000000000001', 'Invoice Dispatcher', 'process', 'Invoice Entry VBO', 'object'),
  ('c0000000-0000-4000-8000-000000000001', 'Invoice Performer', 'process', 'Invoice Entry VBO', 'object'),
  ('c0000000-0000-4000-8000-000000000001', 'Invoice Dispatcher', 'process', 'Invoices Queue', 'queue'),
  ('c0000000-0000-4000-8000-000000000001', 'Invoice Performer', 'process', 'Invoices Queue', 'queue');

insert into audit_events (workspace_id, actor, event, subject_type, subject_id, detail) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'process.analyzed', 'process', 'd0000000-0000-4000-8000-000000000001', '{"grade":"D","score":61}'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'process.converted', 'process', 'd0000000-0000-4000-8000-000000000001', '{"coveragePct":100}');
