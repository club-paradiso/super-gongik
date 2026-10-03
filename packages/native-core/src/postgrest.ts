import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The few supabase-js query-builder calls `createSupabaseTransport`
 * (apps/web/src/lib/sync/supabase-transport.ts) makes, implemented over the
 * native host's HTTP so the web transport — its request shapes, response
 * schemas, error categories and account pinning — runs unchanged on iOS.
 *
 * Response handling follows @supabase/postgrest-js 2.x `processResponse`:
 * 2xx with an empty body → data null; 2xx JSON → data; non-2xx → error is the
 * parsed PostgREST error body (code/message); a failed request → status 0.
 */
export type HttpRequest = {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
};

/** status 0 means the request never got an HTTP response. */
export type HttpResponse = { status: number; body: string };

export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

type Result = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  status: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;

class Builder implements PromiseLike<Result> {
  private readonly headers: Record<string, string>;
  private query: string[] = [];
  private timeoutMs = DEFAULT_TIMEOUT_MS;

  constructor(
    private readonly http: HttpClient,
    private readonly url: string,
    private readonly method: "GET" | "POST",
    private readonly body: string | null,
    baseHeaders: Record<string, string>,
  ) {
    this.headers = { ...baseHeaders };
  }

  setHeader(name: string, value: string) {
    this.headers[name] = value;
    return this;
  }

  abortSignal(signal: { timeoutMs?: number } | undefined) {
    if (signal?.timeoutMs) this.timeoutMs = signal.timeoutMs;
    return this;
  }

  select(columns: string) {
    this.query.push(
      `select=${encodeURIComponent(columns.replace(/\s+/g, ""))}`,
    );
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.query.push(
      `order=${encodeURIComponent(column)}.${options.ascending === false ? "desc" : "asc"}`,
    );
    return this;
  }

  eq(column: string, value: string | number) {
    this.query.push(
      `${encodeURIComponent(column)}=eq.${encodeURIComponent(String(value))}`,
    );
    return this;
  }

  single() {
    this.headers.Accept = "application/vnd.pgrst.object+json";
    return this;
  }

  private async execute(): Promise<Result> {
    const url = this.query.length
      ? `${this.url}?${this.query.join("&")}`
      : this.url;
    const response = await this.http({
      method: this.method,
      url,
      headers: this.headers,
      body: this.body,
      timeoutMs: this.timeoutMs,
    });
    if (response.status === 0) {
      return {
        data: null,
        error: { code: "", message: "FetchError" },
        status: 0,
      };
    }
    if (response.status >= 200 && response.status < 300) {
      if (response.body === "")
        return { data: null, error: null, status: response.status };
      try {
        return {
          data: JSON.parse(response.body),
          error: null,
          status: response.status,
        };
      } catch {
        return {
          data: null,
          error: { message: response.body },
          status: response.status,
        };
      }
    }
    try {
      const error = JSON.parse(response.body) as unknown;
      if (Array.isArray(error) && response.status === 404) {
        return { data: [], error: null, status: 200 };
      }
      return {
        data: null,
        error: error as Result["error"],
        status: response.status,
      };
    } catch {
      if (response.status === 404 && response.body === "") {
        return { data: null, error: null, status: 204 };
      }
      return {
        data: null,
        error: { message: response.body },
        status: response.status,
      };
    }
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export function createPostgrestClient(options: {
  url: string;
  anonKey: string;
  http: HttpClient;
}): SupabaseClient {
  const base = options.url.replace(/\/+$/, "");
  const headers = {
    apikey: options.anonKey,
    Authorization: `Bearer ${options.anonKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      return new Builder(
        options.http,
        `${base}/rest/v1/rpc/${encodeURIComponent(name)}`,
        "POST",
        JSON.stringify(args),
        headers,
      );
    },
    from(table: string) {
      const url = `${base}/rest/v1/${encodeURIComponent(table)}`;
      return {
        select: (columns: string) =>
          new Builder(options.http, url, "GET", null, headers).select(columns),
      };
    },
  };
  return client as unknown as SupabaseClient;
}
