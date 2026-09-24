-- SUPER GONGIK optional cloud sync (Issue #27). See docs/CLOUD_SYNC.md.
--
-- The database is transport and storage. Conflict decisions are made on the
-- device by the domain merge contract (revision / deviceId / supersedes /
-- deletedAt inside each payload). Nothing here compares timestamps or picks
-- a winner:
--   * seq          per-account, commit-ordered transport sequence: a pull
--                  cursor and a compare-and-set token for pushes.
--   * generation   account sync generation; bumped when the user deletes all
--                  cloud data, so stale devices cannot push automatically.
--   * *_at columns informational only.
--
-- Security: every row belongs to auth.uid(). RLS is enabled and forced on
-- every table; the browser holds only the public anon key and the user's own
-- session. All writes go through the SECURITY INVOKER functions below (so RLS
-- still applies inside them); a trigger refuses direct table writes.

create schema if not exists sync_private;
revoke all on schema sync_private from public;

-- ── Tables ─────────────────────────────────────────────────────────────────

create table public.sync_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  generation integer not null default 1 check (generation >= 1),
  last_seq bigint not null default 0 check (last_seq >= 0),
  -- Service profile id this account's records belong to (set by the first
  -- push that carries a profile; cleared by a reset).
  profile_id text check (profile_id is null or length(profile_id) between 1 and 200),
  created_at timestamptz not null default now(),
  reset_at timestamptz
);

create table public.sync_records (
  user_id uuid not null references public.sync_accounts (user_id) on delete cascade,
  collection text not null check (
    collection in (
      'profile',
      'events',
      'leaveAdjustments',
      'leaveSnapshots',
      'imports',
      'attendanceMonths',
      'compensationSnapshots'
    )
  ),
  record_id text not null check (length(record_id) between 1 and 200),
  seq bigint not null check (seq >= 1),
  schema_version integer not null check (schema_version between 2 and 1000),
  -- The record exactly as the app stores it. Validated again by every client
  -- before use; these checks only keep obviously broken rows out.
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and payload ->> 'id' = record_id
    and octet_length(payload::text) <= 262144
  ),
  -- Installation that wrote this row (transport provenance, not identity).
  device_id text not null check (length(device_id) between 1 and 200),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, collection, record_id)
);

create unique index sync_records_user_seq_idx on public.sync_records (user_id, seq);

create table public.cloud_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.sync_accounts (user_id) on delete cascade,
  generation integer not null check (generation >= 1),
  created_at timestamptz not null default now(),
  exported_at timestamptz not null,
  schema_version integer not null check (schema_version between 1 and 1000),
  format_version integer not null check (format_version between 1 and 1000),
  byte_size integer not null check (byte_size >= 0),
  digest text check (digest is null or digest ~ '^[0-9a-f]{64}$'),
  -- A complete backup file (format v2, integrity-checked by the client).
  content text not null check (octet_length(content) <= 10485760)
);

create index cloud_backups_user_created_idx
  on public.cloud_backups (user_id, created_at desc);

-- ── Row Level Security ─────────────────────────────────────────────────────

alter table public.sync_accounts enable row level security;
alter table public.sync_accounts force row level security;
alter table public.sync_records enable row level security;
alter table public.sync_records force row level security;
alter table public.cloud_backups enable row level security;
alter table public.cloud_backups force row level security;

create policy sync_accounts_select_own on public.sync_accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy sync_accounts_insert_own on public.sync_accounts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy sync_accounts_update_own on public.sync_accounts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy sync_records_select_own on public.sync_records
  for select to authenticated using (user_id = (select auth.uid()));
create policy sync_records_insert_own on public.sync_records
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy sync_records_update_own on public.sync_records
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy sync_records_delete_own on public.sync_records
  for delete to authenticated using (user_id = (select auth.uid()));

create policy cloud_backups_select_own on public.cloud_backups
  for select to authenticated using (user_id = (select auth.uid()));
create policy cloud_backups_insert_own on public.cloud_backups
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy cloud_backups_delete_own on public.cloud_backups
  for delete to authenticated using (user_id = (select auth.uid()));
-- No update policy: backups are immutable.

-- Supabase grants new public tables to anon/authenticated by default. Grant
-- only what the functions below need, and nothing to anon.
revoke all on public.sync_accounts from public, anon, authenticated;
revoke all on public.sync_records from public, anon, authenticated;
revoke all on public.cloud_backups from public, anon, authenticated;
grant select, insert, update on public.sync_accounts to authenticated;
grant select, insert, update, delete on public.sync_records to authenticated;
grant select, insert, delete on public.cloud_backups to authenticated;

-- ── Direct-write guard ─────────────────────────────────────────────────────
-- The RPCs set a transaction-local flag. A write without it (for example a
-- PostgREST PATCH on the table) is refused, so the generation and seq rules
-- cannot be bypassed even by the account owner's own client. Cross-user
-- isolation does not depend on this: RLS already confines every statement to
-- auth.uid().

create function sync_private.require_rpc() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('super_gongik.sync_rpc', true), '') <> 'on' then
    raise exception 'direct writes are not allowed; use the sync functions'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger sync_accounts_require_rpc
  before insert or update or delete on public.sync_accounts
  for each row execute function sync_private.require_rpc();
create trigger sync_records_require_rpc
  before insert or update or delete on public.sync_records
  for each row execute function sync_private.require_rpc();
create trigger cloud_backups_require_rpc
  before insert or update or delete on public.cloud_backups
  for each row execute function sync_private.require_rpc();

-- ── Helpers ────────────────────────────────────────────────────────────────

create function sync_private.current_user_id() returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return uid;
end;
$$;

create function sync_private.account_json(acct public.sync_accounts) returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'generation', acct.generation,
    'last_seq', acct.last_seq,
    'profile_id', acct.profile_id,
    'reset_at', acct.reset_at
  );
$$;

grant usage on schema sync_private to authenticated;
revoke all on all functions in schema sync_private from public, anon;
grant execute on function sync_private.current_user_id() to authenticated;
grant execute on function sync_private.account_json(public.sync_accounts) to authenticated;

-- ── RPCs (SECURITY INVOKER: RLS applies to every statement) ────────────────

create function public.sync_ensure_account() returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := sync_private.current_user_id();
  acct public.sync_accounts;
begin
  perform set_config('super_gongik.sync_rpc', 'on', true);
  insert into public.sync_accounts (user_id) values (uid)
    on conflict (user_id) do nothing;
  select * into strict acct from public.sync_accounts where user_id = uid;
  return sync_private.account_json(acct);
end;
$$;

create function public.sync_pull(
  p_generation integer,
  p_after_seq bigint,
  p_limit integer
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := sync_private.current_user_id();
  acct public.sync_accounts;
  page_size integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  found_rows jsonb;
  has_more boolean;
begin
  -- A share lock waits for any push/reset in flight and keeps new ones out
  -- while reading, so the page is consistent with the generation returned.
  select * into acct from public.sync_accounts where user_id = uid for share;
  if not found then
    raise exception 'sync account missing' using errcode = 'P0002';
  end if;
  if acct.generation <> p_generation then
    return jsonb_build_object(
      'kind', 'GENERATION_MISMATCH',
      'account', sync_private.account_json(acct)
    );
  end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'collection', r.collection,
        'record_id', r.record_id,
        'seq', r.seq,
        'schema_version', r.schema_version,
        'payload', r.payload
      )
      order by r.seq
    ),
    '[]'::jsonb
  )
  into found_rows
  from (
    select * from public.sync_records
    where user_id = uid and seq > coalesce(p_after_seq, 0)
    order by seq
    limit page_size + 1
  ) r;
  has_more := jsonb_array_length(found_rows) > page_size;
  if has_more then
    found_rows := found_rows - page_size;
  end if;
  return jsonb_build_object(
    'kind', 'OK',
    'account', sync_private.account_json(acct),
    'rows', found_rows,
    'has_more', has_more
  );
end;
$$;

create function public.sync_push(
  p_generation integer,
  p_device_id text,
  p_items jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := sync_private.current_user_id();
  acct public.sync_accounts;
  item jsonb;
  existing public.sync_records;
  bound_profile text;
  next_seq bigint;
  results jsonb := '[]'::jsonb;
  item_collection text;
  item_record text;
  item_base bigint;
  item_version integer;
  item_payload jsonb;
begin
  perform set_config('super_gongik.sync_rpc', 'on', true);
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) > 500
     or p_device_id is null
     or length(p_device_id) not between 1 and 200 then
    raise exception 'invalid push request' using errcode = '22023';
  end if;

  -- Serializes pushes, pulls and resets of one account: seq is assigned in
  -- commit order, which is what makes incremental pulls complete.
  select * into acct from public.sync_accounts where user_id = uid for update;
  if not found then
    raise exception 'sync account missing' using errcode = 'P0002';
  end if;
  if acct.generation <> p_generation then
    return jsonb_build_object(
      'kind', 'GENERATION_MISMATCH',
      'account', sync_private.account_json(acct)
    );
  end if;

  -- Pass 1: validate every item and the profile binding before any write.
  bound_profile := acct.profile_id;
  for item in
    select value from jsonb_array_elements(p_items) with ordinality
    order by (value ->> 'collection' = 'profile') desc, ordinality
  loop
    item_collection := item ->> 'collection';
    item_record := item ->> 'record_id';
    item_payload := item -> 'payload';
    if item_collection is null
       or item_record is null
       or jsonb_typeof(item_payload) is distinct from 'object'
       or item_payload ->> 'id' is distinct from item_record
       or (item ->> 'schema_version') is null then
      raise exception 'invalid push item' using errcode = '22023';
    end if;
    if item_collection = 'profile' then
      bound_profile := coalesce(bound_profile, item_record);
      if bound_profile <> item_record then
        return jsonb_build_object(
          'kind', 'PROFILE_MISMATCH',
          'account', sync_private.account_json(acct)
        );
      end if;
    elsif bound_profile is null
       or item_payload ->> 'serviceProfileId' is distinct from bound_profile then
      return jsonb_build_object(
        'kind', 'PROFILE_MISMATCH',
        'account', sync_private.account_json(acct)
      );
    end if;
  end loop;

  -- Pass 2: conditional, idempotent writes.
  next_seq := acct.last_seq;
  for item in
    select value from jsonb_array_elements(p_items) with ordinality
    order by (value ->> 'collection' = 'profile') desc, ordinality
  loop
    item_collection := item ->> 'collection';
    item_record := item ->> 'record_id';
    item_base := (item ->> 'base_seq')::bigint;
    item_version := (item ->> 'schema_version')::integer;
    item_payload := item -> 'payload';

    select * into existing from public.sync_records
      where user_id = uid
        and collection = item_collection
        and record_id = item_record;

    if found
       and existing.payload = item_payload
       and existing.schema_version = item_version then
      -- Already there (e.g. a retry after a lost response): nothing to do.
      results := results || jsonb_build_object(
        'collection', item_collection, 'record_id', item_record,
        'status', 'UNCHANGED', 'seq', existing.seq
      );
    elsif (found and existing.seq = item_base)
       or (not found and item_base is null) then
      next_seq := next_seq + 1;
      insert into public.sync_records as r (
        user_id, collection, record_id, seq, schema_version, payload, device_id
      ) values (
        uid, item_collection, item_record, next_seq, item_version,
        item_payload, p_device_id
      )
      on conflict (user_id, collection, record_id) do update set
        seq = excluded.seq,
        schema_version = excluded.schema_version,
        payload = excluded.payload,
        device_id = excluded.device_id,
        server_updated_at = now();
      results := results || jsonb_build_object(
        'collection', item_collection, 'record_id', item_record,
        'status', 'APPLIED', 'seq', next_seq
      );
    else
      -- Changed since the client's base: never overwrite; the client pulls
      -- and merges again.
      results := results || jsonb_build_object(
        'collection', item_collection, 'record_id', item_record,
        'status', 'STALE', 'seq', case when found then existing.seq end
      );
    end if;
  end loop;

  update public.sync_accounts
    set last_seq = next_seq, profile_id = bound_profile
    where user_id = uid
    returning * into acct;

  return jsonb_build_object(
    'kind', 'OK',
    'account', sync_private.account_json(acct),
    'results', results
  );
end;
$$;

create function public.sync_reset(p_expected_generation integer) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := sync_private.current_user_id();
  acct public.sync_accounts;
begin
  perform set_config('super_gongik.sync_rpc', 'on', true);
  select * into acct from public.sync_accounts where user_id = uid for update;
  if not found then
    raise exception 'sync account missing' using errcode = 'P0002';
  end if;
  if acct.generation <> p_expected_generation then
    return jsonb_build_object(
      'kind', 'GENERATION_MISMATCH',
      'account', sync_private.account_json(acct)
    );
  end if;
  delete from public.sync_records where user_id = uid;
  delete from public.cloud_backups where user_id = uid;
  update public.sync_accounts
    set generation = generation + 1, profile_id = null, reset_at = now()
    where user_id = uid
    returning * into acct;
  return jsonb_build_object(
    'kind', 'OK',
    'account', sync_private.account_json(acct)
  );
end;
$$;

create function public.backup_create(
  p_generation integer,
  p_content text,
  p_exported_at timestamptz,
  p_schema_version integer,
  p_format_version integer,
  p_digest text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := sync_private.current_user_id();
  acct public.sync_accounts;
  created public.cloud_backups;
begin
  perform set_config('super_gongik.sync_rpc', 'on', true);
  select * into acct from public.sync_accounts where user_id = uid for update;
  if not found then
    raise exception 'sync account missing' using errcode = 'P0002';
  end if;
  if acct.generation <> p_generation then
    return jsonb_build_object(
      'kind', 'GENERATION_MISMATCH',
      'account', sync_private.account_json(acct)
    );
  end if;
  insert into public.cloud_backups (
    user_id, generation, exported_at, schema_version, format_version,
    byte_size, digest, content
  ) values (
    uid, acct.generation, p_exported_at, p_schema_version, p_format_version,
    octet_length(p_content), p_digest, p_content
  )
  returning * into created;
  -- Retention: the newest 10 backups per account.
  delete from public.cloud_backups
    where user_id = uid
      and id not in (
        select id from public.cloud_backups
        where user_id = uid
        order by created_at desc, id desc
        limit 10
      );
  return jsonb_build_object(
    'kind', 'OK',
    'backup', jsonb_build_object(
      'id', created.id,
      'created_at', created.created_at,
      'exported_at', created.exported_at,
      'generation', created.generation,
      'schema_version', created.schema_version,
      'format_version', created.format_version,
      'byte_size', created.byte_size,
      'digest', created.digest
    )
  );
end;
$$;

create function public.backup_delete(p_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := sync_private.current_user_id();
begin
  perform set_config('super_gongik.sync_rpc', 'on', true);
  delete from public.cloud_backups where id = p_id and user_id = uid;
end;
$$;

revoke all on function public.sync_ensure_account() from public, anon;
revoke all on function public.sync_pull(integer, bigint, integer) from public, anon;
revoke all on function public.sync_push(integer, text, jsonb) from public, anon;
revoke all on function public.sync_reset(integer) from public, anon;
revoke all on function public.backup_create(integer, text, timestamptz, integer, integer, text) from public, anon;
revoke all on function public.backup_delete(uuid) from public, anon;
grant execute on function public.sync_ensure_account() to authenticated;
grant execute on function public.sync_pull(integer, bigint, integer) to authenticated;
grant execute on function public.sync_push(integer, text, jsonb) to authenticated;
grant execute on function public.sync_reset(integer) to authenticated;
grant execute on function public.backup_create(integer, text, timestamptz, integer, integer, text) to authenticated;
grant execute on function public.backup_delete(uuid) to authenticated;
