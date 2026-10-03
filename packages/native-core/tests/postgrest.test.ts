import { describe, expect, it } from "vitest";

import {
  createPostgrestClient,
  type HttpRequest,
  type HttpResponse,
} from "../src/postgrest";

/**
 * The native PostgREST client must build the same requests supabase-js
 * builds for the sync transport and map responses the way postgrest-js
 * does, because `createSupabaseTransport` categorizes errors from them.
 * (The full scenarios run against PostgREST + RLS in CI with
 * SUPER_GONGIK_IT_CLIENT=native.)
 */
function recorder(response: HttpResponse) {
  const requests: HttpRequest[] = [];
  const client = createPostgrestClient({
    url: "https://project.supabase.co/",
    anonKey: "anon-key",
    http: async (request) => {
      requests.push(request);
      return response;
    },
  }) as unknown as {
    rpc(
      name: string,
      args: object,
    ): {
      setHeader(k: string, v: string): unknown;
    } & PromiseLike<{ data: unknown; error: unknown; status: number }>;
    from(table: string): {
      select(columns: string): {
        order(
          c: string,
          o: object,
        ): PromiseLike<{ data: unknown }> & {
          setHeader(k: string, v: string): unknown;
        };
        eq(
          c: string,
          v: string,
        ): {
          single(): PromiseLike<{
            data: unknown;
            error: unknown;
            status: number;
          }>;
        };
      };
    };
  };
  return { client, requests };
}

describe("native PostgREST client", () => {
  it("posts RPC arguments with the publishable key and overridable auth", async () => {
    const { client, requests } = recorder({
      status: 200,
      body: '{"generation":1}',
    });
    const builder = client.rpc("sync_pull", {
      p_generation: 1,
      p_after_seq: 0,
    });
    builder.setHeader("Authorization", "Bearer user-token");
    const result = await builder;
    expect(result).toEqual({
      data: { generation: 1 },
      error: null,
      status: 200,
    });
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://project.supabase.co/rest/v1/rpc/sync_pull",
      body: '{"p_generation":1,"p_after_seq":0}',
      timeoutMs: 20_000,
    });
    expect(requests[0]!.headers).toMatchObject({
      apikey: "anon-key",
      Authorization: "Bearer user-token",
      "Content-Type": "application/json",
    });
  });

  it("builds list and single-row selects like supabase-js", async () => {
    const list = recorder({ status: 200, body: "[]" });
    await list.client
      .from("cloud_backups")
      .select("id, created_at")
      .order("created_at", { ascending: false });
    expect(list.requests[0]!.url).toBe(
      "https://project.supabase.co/rest/v1/cloud_backups?select=id%2Ccreated_at&order=created_at.desc",
    );

    const single = recorder({
      status: 406,
      body: '{"code":"PGRST116","message":"JSON object requested, multiple (or no) rows returned"}',
    });
    const missing = await single.client
      .from("cloud_backups")
      .select("content")
      .eq("id", "a b")
      .single();
    expect(single.requests[0]!.url).toContain("id=eq.a%20b");
    expect(single.requests[0]!.headers.Accept).toBe(
      "application/vnd.pgrst.object+json",
    );
    expect(missing.status).toBe(406);
    expect(missing.error).toMatchObject({ code: "PGRST116" });
  });

  it("maps empty bodies, errors and network failures like postgrest-js", async () => {
    expect(
      await recorder({ status: 204, body: "" }).client.rpc("backup_delete", {}),
    ).toEqual({
      data: null,
      error: null,
      status: 204,
    });
    const denied = await recorder({
      status: 401,
      body: '{"code":"PGRST301","message":"JWT expired"}',
    }).client.rpc("sync_pull", {});
    expect(denied.error).toMatchObject({ code: "PGRST301" });
    expect(denied.status).toBe(401);
    const offline = await recorder({ status: 0, body: "" }).client.rpc(
      "sync_pull",
      {},
    );
    expect(offline.status).toBe(0);
    expect(offline.error).not.toBeNull();
  });
});
