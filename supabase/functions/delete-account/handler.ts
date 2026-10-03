/**
 * In-app account deletion (App Store guideline 5.1.1(v)).
 *
 * The caller proves who they are with their own access token; the function
 * deletes exactly that user with the service-role key, which lives only in
 * the Edge Function environment. Deleting the auth user cascades every
 * cloud row (sync_accounts → sync_records, cloud_backups:
 * migrations 20260925012500/20260925014000). Nothing on any device is
 * touched.
 */
export type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handle(
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "POST")
    return reply(405, { error: "method_not_allowed" });
  const authorization = request.headers.get("Authorization") ?? "";
  if (!/^Bearer \S+$/.test(authorization))
    return reply(401, { error: "missing_token" });

  // Who is calling? Ask Auth with the caller's own token.
  const userResponse = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization },
  });
  if (userResponse.status !== 200)
    return reply(401, { error: "invalid_token" });
  const user = (await userResponse.json()) as { id?: unknown };
  if (typeof user.id !== "string" || !/^[0-9a-f-]{36}$/i.test(user.id)) {
    return reply(401, { error: "invalid_token" });
  }

  // Delete exactly that user. The id never comes from the request body.
  const deletion = await fetchImpl(
    `${env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`,
    {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (deletion.status !== 200 && deletion.status !== 204) {
    return reply(502, { error: "delete_failed" });
  }
  return reply(200, { deleted: true });
}
