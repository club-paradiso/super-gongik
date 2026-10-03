import { handle, type Env } from "./handler.ts";

const env: Env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};
const USER = "00000000-0000-4000-8000-0000000000a1";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function fakeFetch(userStatus = 200, deleteStatus = 200) {
  const calls: Array<{ url: string; method: string; auth: string | null }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      auth: headers.get("Authorization"),
    });
    if (url.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: USER }), { status: userStatus });
    }
    return new Response(null, { status: deleteStatus });
  }) as typeof fetch;
  return { impl, calls };
}

const post = (headers: Record<string, string> = {}, body = "{}") =>
  new Request("https://fn/delete-account", { method: "POST", headers, body });

Deno.test("deletes exactly the caller with the service key", async () => {
  const { impl, calls } = fakeFetch();
  const response = await handle(
    post(
      { Authorization: "Bearer user-token" },
      JSON.stringify({ userId: "someone-else" }),
    ),
    env,
    impl,
  );
  equal(response.status, 200);
  equal(
    calls.map((c) => [c.method, c.url, c.auth]),
    [
      ["GET", "https://project.supabase.co/auth/v1/user", "Bearer user-token"],
      [
        "DELETE",
        `https://project.supabase.co/auth/v1/admin/users/${USER}`,
        "Bearer service",
      ],
    ],
  );
});

Deno.test(
  "refuses without a valid token and never calls the admin API",
  async () => {
    const missing = fakeFetch();
    equal((await handle(post(), env, missing.impl)).status, 401);
    equal(missing.calls.length, 0);
    const invalid = fakeFetch(401);
    equal(
      (await handle(post({ Authorization: "Bearer bad" }), env, invalid.impl))
        .status,
      401,
    );
    equal(invalid.calls.length, 1);
  },
);

Deno.test("reports a failed deletion and rejects other methods", async () => {
  equal(
    (
      await handle(
        post({ Authorization: "Bearer t" }),
        env,
        fakeFetch(200, 500).impl,
      )
    ).status,
    502,
  );
  equal(
    (
      await handle(
        new Request("https://fn", { method: "GET" }),
        env,
        fakeFetch().impl,
      )
    ).status,
    405,
  );
});
