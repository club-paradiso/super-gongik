import { handle } from "./handler.ts";

// Deployed with `supabase functions deploy delete-account`. The service-role
// key is provided by the Edge Function runtime, never by a client.
Deno.serve((request) =>
  handle(request, {
    SUPABASE_URL: Deno.env.get("SUPABASE_URL")!,
    SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY")!,
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  }),
);
