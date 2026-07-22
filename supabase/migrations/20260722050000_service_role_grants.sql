-- service_role grants (S6-3 follow-up). The no-auto-expose default means even
-- service_role gets nothing implicitly. Edge Functions (invite-member, later
-- llm-proxy) use service_role and bypass RLS — but still need plain grants.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Future tables created by migrations inherit the grant automatically.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
