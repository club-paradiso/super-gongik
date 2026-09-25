-- Policy and function tests for supabase/migrations/*_cloud_sync.sql.
-- Run with supabase/tests/run-db-tests.sh (plain PostgreSQL + the auth shim)
-- or against a disposable local Supabase database. Every assertion raises on
-- failure; psql stops at the first error (ON_ERROR_STOP).
--
-- Payloads here are opaque JSON: the server never interprets domain fields
-- beyond `id` and `serviceProfileId`.

\set user_a '''00000000-0000-4000-8000-00000000000a'''
\set user_b '''00000000-0000-4000-8000-00000000000b'''
\set user_c '''00000000-0000-4000-8000-00000000000c'''

insert into auth.users (id, email) values
  (:user_a, 'a@example.test'),
  (:user_b, 'b@example.test'),
  (:user_c, 'c@example.test');

-- Run `statement`; require it to fail with `state` (SQLSTATE).
create function pg_temp.expect_error(statement text, state text, label text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate <> state then
      raise exception '%: expected SQLSTATE %, got % (%)', label, state, sqlstate, sqlerrm;
    end if;
    return;
  end;
  raise exception '%: expected SQLSTATE %, but it succeeded', label, state;
end;
$$;

-- Run `statement`; return how many rows it touched.
create function pg_temp.affected(statement text) returns integer
language plpgsql as $$
declare
  n integer;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end;
$$;

create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    false
  );
$$;

grant execute on all functions in schema pg_temp to anon, authenticated;

-- ── 1. Owner: ensure, push, idempotent retry, stale base, pull ─────────────
select pg_temp.act_as(:user_a);
set role authenticated;

do $$
declare
  acct jsonb;
  res jsonb;
  again jsonb;
  items jsonb := jsonb_build_array(
    jsonb_build_object(
      'collection', 'events', 'record_id', 'event-1', 'base_seq', null,
      'schema_version', 3,
      'payload', jsonb_build_object('id', 'event-1', 'serviceProfileId', 'profile-1', 'note', 'secret-a', 'revision', 1)
    ),
    -- Listed second on purpose: the profile is bound first regardless.
    jsonb_build_object(
      'collection', 'profile', 'record_id', 'profile-1', 'base_seq', null,
      'schema_version', 3,
      'payload', jsonb_build_object('id', 'profile-1', 'note', 'secret-a')
    )
  );
begin
  acct := public.sync_ensure_account();
  assert (acct ->> 'generation')::int = 1, 'new account starts at generation 1';
  assert (acct ->> 'last_seq')::int = 0, 'new account has no rows';
  assert public.sync_ensure_account() = acct, 'ensure is idempotent';

  res := public.sync_push(1, 'phone-a', items);
  assert res ->> 'kind' = 'OK', 'push accepted';
  assert res -> 'results' -> 0 ->> 'record_id' = 'profile-1', 'profile processed first';
  assert res -> 'results' -> 0 ->> 'status' = 'APPLIED', 'profile applied';
  assert (res -> 'results' -> 1 ->> 'seq')::int = 2, 'event got seq 2';
  assert res -> 'account' ->> 'profile_id' = 'profile-1', 'profile bound';

  -- The same request again (a retry after a lost response).
  again := public.sync_push(1, 'phone-a', items);
  assert again -> 'results' -> 1 ->> 'status' = 'UNCHANGED', 'retry is a no-op';
  assert (again -> 'results' -> 1 ->> 'seq')::int = 2, 'retry reports the existing seq';
  assert (again -> 'account' ->> 'last_seq')::int = 2, 'retry assigns no seq';

  -- Different content on a stale base is refused, not applied.
  res := public.sync_push(1, 'phone-a', jsonb_build_array(jsonb_build_object(
    'collection', 'events', 'record_id', 'event-1', 'base_seq', null,
    'schema_version', 3,
    'payload', jsonb_build_object('id', 'event-1', 'serviceProfileId', 'profile-1', 'note', 'other', 'revision', 2)
  )));
  assert res -> 'results' -> 0 ->> 'status' = 'STALE', 'absent-base write over an existing row is stale';
  res := public.sync_push(1, 'phone-a', jsonb_build_array(jsonb_build_object(
    'collection', 'events', 'record_id', 'event-1', 'base_seq', 1,
    'schema_version', 3,
    'payload', jsonb_build_object('id', 'event-1', 'serviceProfileId', 'profile-1', 'note', 'other', 'revision', 2)
  )));
  assert res -> 'results' -> 0 ->> 'status' = 'STALE', 'wrong base seq is stale';
  res := public.sync_push(1, 'phone-a', jsonb_build_array(jsonb_build_object(
    'collection', 'events', 'record_id', 'event-1', 'base_seq', 2,
    'schema_version', 3,
    'payload', jsonb_build_object('id', 'event-1', 'serviceProfileId', 'profile-1', 'note', 'edited', 'revision', 2)
  )));
  assert res -> 'results' -> 0 ->> 'status' = 'APPLIED', 'matching base applies';
  assert (res -> 'results' -> 0 ->> 'seq')::int = 3, 'new seq is 3';

  -- Pull: ordered by seq, paginated, consistent with the generation.
  res := public.sync_pull(1, 0, 1);
  assert res ->> 'kind' = 'OK', 'pull ok';
  assert jsonb_array_length(res -> 'rows') = 1, 'page size honoured';
  assert (res ->> 'has_more')::boolean, 'more rows reported';
  assert res -> 'rows' -> 0 ->> 'record_id' = 'profile-1', 'lowest seq first';
  res := public.sync_pull(1, 1, 10);
  assert jsonb_array_length(res -> 'rows') = 1, 'only rows after the cursor';
  assert res -> 'rows' -> 0 -> 'payload' ->> 'note' = 'edited', 'latest version';
  assert not (res ->> 'has_more')::boolean, 'no more rows';
end;
$$;

-- ── 2. Profile binding: another profile is refused and nothing is written ──
do $$
declare
  res jsonb;
begin
  res := public.sync_push(1, 'phone-a', jsonb_build_array(
    jsonb_build_object(
      'collection', 'events', 'record_id', 'event-9', 'base_seq', null,
      'schema_version', 3,
      'payload', jsonb_build_object('id', 'event-9', 'serviceProfileId', 'profile-1')
    ),
    jsonb_build_object(
      'collection', 'profile', 'record_id', 'profile-2', 'base_seq', null,
      'schema_version', 3,
      'payload', jsonb_build_object('id', 'profile-2')
    )
  ));
  assert res ->> 'kind' = 'PROFILE_MISMATCH', 'other profile refused';
  res := public.sync_push(1, 'phone-a', jsonb_build_array(jsonb_build_object(
    'collection', 'events', 'record_id', 'event-10', 'base_seq', null,
    'schema_version', 3,
    'payload', jsonb_build_object('id', 'event-10', 'serviceProfileId', 'profile-2')
  )));
  assert res ->> 'kind' = 'PROFILE_MISMATCH', 'record of another profile refused';
  assert (select count(*) from public.sync_records where record_id in ('event-9', 'event-10')) = 0,
    'nothing from a refused push was written';
  assert (select last_seq from public.sync_accounts) = 3, 'no seq consumed';
end;
$$;

-- ── 3. Malformed requests ──────────────────────────────────────────────────
select pg_temp.expect_error(
  $sql$ select public.sync_push(1, 'phone-a', '[{"collection":"events","record_id":"x","base_seq":null,"schema_version":3,"payload":{"id":"y","serviceProfileId":"profile-1"}}]') $sql$,
  '22023', 'payload id must match record id');
select pg_temp.expect_error(
  $sql$ select public.sync_push(1, 'phone-a', '{"not":"an array"}') $sql$,
  '22023', 'items must be an array');
select pg_temp.expect_error(
  $sql$ select public.sync_push(1, 'phone-a', (select jsonb_agg(jsonb_build_object('collection','events','record_id','e'||i,'base_seq',null,'schema_version',3,'payload',jsonb_build_object('id','e'||i,'serviceProfileId','profile-1'))) from generate_series(1, 501) i)) $sql$,
  '22023', 'at most 500 items per push');
select pg_temp.expect_error(
  $sql$ select public.sync_push(1, 'phone-a', '[{"collection":"secrets","record_id":"x","base_seq":null,"schema_version":3,"payload":{"id":"x","serviceProfileId":"profile-1"}}]') $sql$,
  '23514', 'unknown collection rejected by constraint');

-- ── 4. Direct table writes are refused even for the owner ──────────────────
select pg_temp.expect_error(
  $sql$ update public.sync_records set payload = '{"id":"event-1"}' where record_id = 'event-1' $sql$,
  '42501', 'owner cannot bypass the push function');
select pg_temp.expect_error(
  $sql$ delete from public.sync_records $sql$,
  '42501', 'owner cannot delete rows directly');
select pg_temp.expect_error(
  $sql$ update public.sync_accounts set generation = 1 $sql$,
  '42501', 'owner cannot rewrite the generation');
select pg_temp.expect_error(
  $sql$ delete from public.sync_accounts $sql$,
  '42501', 'owner cannot directly delete the sync account');

-- Backups: create, retention, immutability.
do $$
declare
  res jsonb;
begin
  for i in 1..12 loop
    res := public.backup_create(1, '{"backup":"secret-a"}', now(), 3, 2, null);
    assert res ->> 'kind' = 'OK', 'backup stored';
  end loop;
  assert (select count(*) from public.cloud_backups) = 10, 'newest 10 kept';
end;
$$;
select pg_temp.expect_error(
  $sql$ update public.cloud_backups set content = 'x' $sql$,
  '42501', 'backups are immutable');

reset role;

-- ── 5. Another user sees and changes nothing of user A ─────────────────────
select pg_temp.act_as(:user_b);
set role authenticated;

do $$
declare
  res jsonb;
begin
  assert (select count(*) from public.sync_records) = 0, 'B reads no rows of A';
  assert (select count(*) from public.sync_accounts) = 0, 'B reads no account of A';
  assert (select count(*) from public.cloud_backups) = 0, 'B reads no backup of A';
end;
$$;
select pg_temp.expect_error(
  $sql$ select public.sync_pull(1, 0, 100) $sql$,
  'P0002', 'B has no account yet: pull does not fall through to A');

do $$
declare
  res jsonb;
begin
  -- B's own account and data are separate; the same ids do not collide.
  perform public.sync_ensure_account();
  res := public.sync_push(1, 'phone-b', jsonb_build_array(
    jsonb_build_object(
      'collection', 'profile', 'record_id', 'profile-1', 'base_seq', null,
      'schema_version', 3,
      'payload', jsonb_build_object('id', 'profile-1', 'note', 'b-data')
    ),
    jsonb_build_object(
      'collection', 'events', 'record_id', 'event-1', 'base_seq', null,
      'schema_version', 3,
      'payload', jsonb_build_object('id', 'event-1', 'serviceProfileId', 'profile-1', 'note', 'b-data')
    )
  ));
  assert res -> 'results' -> 1 ->> 'status' = 'APPLIED', 'B writes its own copy';
  assert (res -> 'results' -> 1 ->> 'seq')::int = 2, 'seq is per account';
  res := public.sync_pull(1, 0, 100);
  assert jsonb_array_length(res -> 'rows') = 2, 'B pulls only its rows';
  assert position('secret-a' in res::text) = 0, 'no content of A in B''s pull';
end;
$$;

-- Even with the RPC flag set by hand, RLS confines B's statements to B.
select set_config('super_gongik.sync_rpc', 'on', false);
do $$
declare
  n integer;
begin
  n := pg_temp.affected(format(
    'update public.sync_records set payload = %L::jsonb where user_id = %L',
    '{"id":"event-1"}', '00000000-0000-4000-8000-00000000000a'));
  assert n = 0, 'B cannot update A''s rows';
  n := pg_temp.affected(format(
    'delete from public.sync_records where user_id = %L',
    '00000000-0000-4000-8000-00000000000a'));
  assert n = 0, 'B cannot delete A''s rows';
  n := pg_temp.affected(format(
    'update public.sync_accounts set generation = 99 where user_id = %L',
    '00000000-0000-4000-8000-00000000000a'));
  assert n = 0, 'B cannot change A''s generation';
  n := pg_temp.affected(format(
    'delete from public.cloud_backups where user_id = %L',
    '00000000-0000-4000-8000-00000000000a'));
  assert n = 0, 'B cannot delete A''s backups';
end;
$$;
select pg_temp.expect_error(
  $sql$ insert into public.sync_records (user_id, collection, record_id, seq, schema_version, payload, device_id)
        values ('00000000-0000-4000-8000-00000000000a', 'events', 'event-x', 99, 3, '{"id":"event-x"}', 'phone-b') $sql$,
  '42501', 'B cannot insert rows into A''s account');
select pg_temp.expect_error(
  $sql$ insert into public.cloud_backups (user_id, generation, exported_at, schema_version, format_version, byte_size, content)
        values ('00000000-0000-4000-8000-00000000000a', 1, now(), 3, 2, 1, 'x') $sql$,
  '42501', 'B cannot insert a backup into A''s account');
-- B's delete RPC with A's backup id deletes nothing.
reset role;
select set_config('test.backup_a', (select id::text from public.cloud_backups
  where user_id = '00000000-0000-4000-8000-00000000000a' limit 1), false);
set role authenticated;
select public.backup_delete(current_setting('test.backup_a')::uuid);
select set_config('super_gongik.sync_rpc', '', false);
reset role;

do $$
begin
  assert (select count(*) from public.cloud_backups
          where user_id = '00000000-0000-4000-8000-00000000000a') = 10,
    'A''s backups survived B''s attempts';
  assert (select payload ->> 'note' from public.sync_records
          where user_id = '00000000-0000-4000-8000-00000000000a'
            and record_id = 'event-1') = 'edited',
    'A''s row unchanged by B';
  assert (select generation from public.sync_accounts
          where user_id = '00000000-0000-4000-8000-00000000000a') = 1,
    'A''s generation unchanged by B';
end;
$$;

-- ── 6. Anonymous and claim-less callers get nothing ────────────────────────
set role anon;
select pg_temp.expect_error($sql$ select * from public.sync_records $sql$, '42501', 'anon cannot read rows');
select pg_temp.expect_error($sql$ select * from public.cloud_backups $sql$, '42501', 'anon cannot read backups');
select pg_temp.expect_error($sql$ select public.sync_pull(1, 0, 10) $sql$, '42501', 'anon cannot pull');
select pg_temp.expect_error($sql$ select public.sync_ensure_account() $sql$, '42501', 'anon cannot create an account');
reset role;

select set_config('request.jwt.claims', '', false);
set role authenticated;
select pg_temp.expect_error($sql$ select public.sync_ensure_account() $sql$, '28000', 'no subject claim, no access');
do $$
begin
  assert (select count(*) from public.sync_records) = 0, 'no claims: no rows visible';
end;
$$;
reset role;

-- ── 7. Cloud reset and stale devices ───────────────────────────────────────
select pg_temp.act_as(:user_a);
set role authenticated;
do $$
declare
  res jsonb;
begin
  res := public.sync_reset(2);
  assert res ->> 'kind' = 'GENERATION_MISMATCH', 'reset needs the current generation';
  res := public.sync_reset(1);
  assert res ->> 'kind' = 'OK', 'reset accepted';
  assert (res -> 'account' ->> 'generation')::int = 2, 'generation incremented';
  assert res -> 'account' ->> 'profile_id' is null, 'profile binding cleared';
  assert res -> 'account' ->> 'reset_at' is not null, 'reset time recorded';
  assert (select count(*) from public.sync_records) = 0, 'records deleted';
  assert (select count(*) from public.cloud_backups) = 0, 'backups deleted';

  -- A device still on generation 1 cannot push, pull or back up.
  res := public.sync_push(1, 'old-phone', jsonb_build_array(jsonb_build_object(
    'collection', 'profile', 'record_id', 'profile-1', 'base_seq', null,
    'schema_version', 3, 'payload', jsonb_build_object('id', 'profile-1')
  )));
  assert res ->> 'kind' = 'GENERATION_MISMATCH', 'stale push refused';
  assert (select count(*) from public.sync_records) = 0, 'stale push wrote nothing';
  res := public.sync_pull(1, 0, 10);
  assert res ->> 'kind' = 'GENERATION_MISMATCH', 'stale pull told to stop';
  res := public.backup_create(1, '{}', now(), 3, 2, null);
  assert res ->> 'kind' = 'GENERATION_MISMATCH', 'stale backup refused';

  -- The new generation starts empty and works; seq keeps increasing.
  res := public.sync_push(2, 'phone-a', jsonb_build_array(jsonb_build_object(
    'collection', 'profile', 'record_id', 'profile-3', 'base_seq', null,
    'schema_version', 3, 'payload', jsonb_build_object('id', 'profile-3')
  )));
  assert res ->> 'kind' = 'OK', 'current generation accepted';
  assert (res -> 'results' -> 0 ->> 'seq')::int > 3, 'seq never reused';
end;
$$;
reset role;

do $$
begin
  assert (select count(*) from public.sync_records
          where user_id = '00000000-0000-4000-8000-00000000000b') = 2,
    'A''s reset did not touch B';
end;
$$;

-- ── 8. Catalog checks ──────────────────────────────────────────────────────
do $$
begin
  assert (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
          where oid in ('public.sync_accounts'::regclass,
                        'public.sync_records'::regclass,
                        'public.cloud_backups'::regclass)),
    'RLS enabled and forced on every table';
  -- Every policy is exactly "own rows", for authenticated only. (UPDATE and
  -- DELETE are additionally confined by the SELECT policy, so a behavioural
  -- test alone could not catch a loosened UPDATE/DELETE policy.)
  assert (select count(*) from pg_policies
          where schemaname = 'public'
            and tablename in ('sync_accounts', 'sync_records', 'cloud_backups')) = 10,
    'exactly the expected policies exist';
  assert not exists (
    select from pg_policies
    where schemaname = 'public'
      and tablename in ('sync_accounts', 'sync_records', 'cloud_backups')
      and (roles <> '{authenticated}'
        or permissive <> 'PERMISSIVE'
        or coalesce(qual, '(user_id = ( SELECT auth.uid() AS uid))')
             <> '(user_id = ( SELECT auth.uid() AS uid))'
        or coalesce(with_check, '(user_id = ( SELECT auth.uid() AS uid))')
             <> '(user_id = ( SELECT auth.uid() AS uid))')
  ), 'every policy restricts to the caller''s own rows';
  assert not exists (
    select from pg_policies
    where schemaname = 'public' and tablename = 'cloud_backups' and cmd = 'UPDATE'
  ), 'no update policy on backups';
  assert not exists (
    select from information_schema.role_table_grants
    where grantee = 'anon'
      and table_name in ('sync_accounts', 'sync_records', 'cloud_backups')
  ), 'anon has no table privileges';
  assert not exists (
    select from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'sync_private') and p.prosecdef
  ), 'no SECURITY DEFINER functions';
  assert not exists (
    select from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('sync_ensure_account', 'sync_pull', 'sync_push',
                        'sync_reset', 'backup_create', 'backup_delete')
      and has_function_privilege('anon', p.oid, 'execute')
  ), 'anon cannot execute any sync function';
end;
$$;


-- ── 9. Auth user deletion cascades through all sync data ──────────────────
select pg_temp.act_as(:user_c);
set role authenticated;
do $
declare
  res jsonb;
begin
  perform public.sync_ensure_account();
  res := public.sync_push(1, 'phone-c', jsonb_build_array(
    jsonb_build_object(
      'collection', 'profile', 'record_id', 'profile-c', 'base_seq', null,
      'schema_version', 3,
      'payload', jsonb_build_object('id', 'profile-c')
    ),
    jsonb_build_object(
      'collection', 'events', 'record_id', 'event-c', 'base_seq', null,
      'schema_version', 3,
      'payload', jsonb_build_object(
        'id', 'event-c', 'serviceProfileId', 'profile-c', 'note', 'cascade-test'
      )
    )
  ));
  assert res ->> 'kind' = 'OK', 'C sync data created';
  res := public.backup_create(1, '{"backup":"cascade-test"}', now(), 3, 2, null);
  assert res ->> 'kind' = 'OK', 'C backup created';
  assert (select count(*) from public.sync_records) = 2, 'C sees its two sync rows';
  assert (select count(*) from public.cloud_backups) = 1, 'C sees its backup';
end;
$;
reset role;

-- This is the real Supabase account-deletion path: the FK on sync_accounts
-- cascades from auth.users, and then the sync account cascades to records and
-- backups. It must not require the app's RPC guard flag.
delete from auth.users where id = :user_c;

do $
begin
  assert not exists (
    select from auth.users
    where id = '00000000-0000-4000-8000-00000000000c'
  ), 'Auth user C deleted';
  assert not exists (
    select from public.sync_accounts
    where user_id = '00000000-0000-4000-8000-00000000000c'
  ), 'C sync account cascaded';
  assert not exists (
    select from public.sync_records
    where user_id = '00000000-0000-4000-8000-00000000000c'
  ), 'C sync records cascaded';
  assert not exists (
    select from public.cloud_backups
    where user_id = '00000000-0000-4000-8000-00000000000c'
  ), 'C cloud backups cascaded';
end;
$;

\echo 'cloud_sync.test.sql: all assertions passed'