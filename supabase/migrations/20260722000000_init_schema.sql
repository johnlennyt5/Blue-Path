-- PrismShift metadata schema (ARCHITECTURE §8.1) — S6-1.
-- METADATA ONLY: no BP XML, no generated XAML, no source content of any kind
-- is ever stored here. That invariant is what makes Workspace Mode viable for
-- regulated estates (§1.1); every column below is derived metadata.

-- workspaces & membership --------------------------------------------------

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  artifact_storage_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid references workspaces on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('admin', 'editor', 'viewer')),
  primary key (workspace_id, user_id)
);

-- a migration program (e.g. "Retail Ops BP Estate") --------------------------

create table programs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  name text not null,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now()
);

-- one row per BP process analyzed (no content, metadata only) ----------------

create table processes (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs on delete cascade,
  bp_name text not null,
  source_hash text not null, -- SHA-256 of source XML (dedup/audit)
  bp_version text,
  stage_count int,
  score int,
  grade text,
  status text not null default 'analyzed'
    check (status in ('analyzed', 'converted', 'validating', 'validated', 'deployed', 'blocked')),
  effort_hours_est numeric,
  updated_at timestamptz not null default now(),
  unique (program_id, source_hash)
);

-- findings summary (rule id + location path + message; no source content) ----

create table findings (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references processes on delete cascade,
  rule_id text not null,
  severity text not null,
  category text not null,
  location_path text not null,
  message text not null,
  resolved boolean not null default false,
  resolved_by uuid references auth.users,
  resolved_at timestamptz
);

-- immutable audit log --------------------------------------------------------

create table audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references workspaces on delete cascade,
  actor uuid references auth.users,
  event text not null, -- 'process.analyzed','process.converted','export.downloaded',...
  subject_type text,
  subject_id uuid,
  detail jsonb,
  at timestamptz not null default now()
);

-- program-level dependency graph (names only, no content) --------------------

create table dependency_edges (
  program_id uuid not null references programs on delete cascade,
  from_name text not null,
  from_type text not null,
  to_name text not null,
  to_type text not null,
  primary key (program_id, from_name, from_type, to_name, to_type)
);

-- Query-path indexes (FKs are not auto-indexed in Postgres) ------------------

create index workspace_members_user_idx on workspace_members (user_id);
create index programs_workspace_idx on programs (workspace_id);
create index processes_program_idx on processes (program_id);
create index findings_process_idx on findings (process_id);
create index findings_unresolved_idx on findings (process_id) where not resolved;
create index audit_events_workspace_at_idx on audit_events (workspace_id, at desc);

-- RLS is enabled here so no table is ever exposed unprotected, even for one
-- deploy between S6-1 and S6-2. Policies (the "allow" side) land in S6-2 —
-- until then, enabled-RLS-with-no-policies means deny-all for anon/authenticated.

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table programs enable row level security;
alter table processes enable row level security;
alter table findings enable row level security;
alter table audit_events enable row level security;
alter table dependency_edges enable row level security;
