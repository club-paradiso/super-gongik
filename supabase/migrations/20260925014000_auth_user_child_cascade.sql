-- Complete Auth-user cascade deletion without weakening direct-write guards.
--
-- After auth.users cascades into sync_accounts, the sync account in turn
-- cascades into sync_records and cloud_backups. Their RPC-only DELETE triggers
-- must allow that FK cleanup, but ordinary authenticated clients must still be
-- unable to delete rows directly.
--
-- During the legitimate FK cascade, the parent sync_accounts row has already
-- been deleted. A direct client DELETE still has a live parent row, so it is
-- rejected exactly as before.

create or replace function sync_private.require_rpc() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('super_gongik.sync_rpc', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE'
     and tg_table_schema = 'public'
     and tg_table_name in ('sync_records', 'cloud_backups')
     and not exists (
       select 1
       from public.sync_accounts a
       where a.user_id = old.user_id
     ) then
    return old;
  end if;

  raise exception 'direct writes are not allowed; use the sync functions'
    using errcode = '42501';
end;
$$;
