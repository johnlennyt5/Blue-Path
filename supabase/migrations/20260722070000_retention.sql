-- S7-5: audit retention policy. Null = keep everything. The purge-workspace
-- Edge Function hard-deletes program data and prunes audit events older than
-- this many days (always preserving the purge event itself).

alter table workspaces
  add column retention_days int check (retention_days is null or retention_days >= 1);
