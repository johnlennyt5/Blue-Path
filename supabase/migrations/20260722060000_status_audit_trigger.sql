-- S6-5: status transitions are audited BY THE DATABASE, not by client
-- goodwill. Any UPDATE that changes processes.status writes a
-- 'status.changed' audit event (from → to, actor from the JWT), and
-- updated_at is touched automatically.

create or replace function private.log_process_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  if new.status is distinct from old.status then
    select p.workspace_id into ws from public.programs p where p.id = new.program_id;
    insert into public.audit_events (workspace_id, actor, event, subject_type, subject_id, detail)
    values (
      ws,
      (select auth.uid()),
      'status.changed',
      'process',
      new.id,
      jsonb_build_object('from', old.status, 'to', new.status, 'name', new.bp_name)
    );
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger processes_status_audit
before update on processes
for each row execute function private.log_process_status_change();
