-- Allow Supabase Auth account deletion to cascade into sync data.
--
-- sync_accounts.user_id references auth.users(id) ON DELETE CASCADE. The
-- original direct-write trigger also ran on DELETE, so an Auth user deletion
-- was incorrectly rejected with SQLSTATE 42501 when the FK cascade reached
-- sync_accounts.
--
-- Authenticated clients still cannot delete sync_accounts directly: there is
-- no DELETE grant and no DELETE RLS policy on that table. INSERT/UPDATE keep
-- the RPC-only guard because those operations must preserve generation and
-- account invariants.

drop trigger if exists sync_accounts_require_rpc on public.sync_accounts;

create trigger sync_accounts_require_rpc
  before insert or update on public.sync_accounts
  for each row execute function sync_private.require_rpc();
