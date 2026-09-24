import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  SyncTransportError,
  type CloudBackupInfo,
  type PushResponse,
  type RemoteAccount,
  type SyncTransport,
  type TransportErrorCategory,
} from "@super-gongik/domain";

/**
 * `SyncTransport` over the Supabase RPCs in
 * `supabase/migrations/*_cloud_sync.sql`. The account is always the session's
 * user (`auth.uid()` on the server); nothing here sends a user id.
 *
 * Responses are validated here (shape only); record payloads stay `unknown`
 * until the domain validates them. Errors are reduced to a category and a
 * short code — request and response bodies are never put in an error.
 */

const REQUEST_TIMEOUT_MS = 20_000;

const accountSchema = z
  .object({
    generation: z.number().int().positive(),
    last_seq: z.number().int().nonnegative(),
    profile_id: z.string().nullable(),
    reset_at: z.string().nullable(),
  })
  .transform((value): RemoteAccount => ({
    generation: value.generation,
    lastSeq: value.last_seq,
    profileId: value.profile_id,
    resetAt: value.reset_at,
  }));

const mismatchSchema = z.object({
  kind: z.enum(["GENERATION_MISMATCH", "PROFILE_MISMATCH"]),
  account: accountSchema,
});

const generationMismatchSchema = z.object({
  kind: z.literal("GENERATION_MISMATCH"),
  account: accountSchema,
});

const pullSchema = z.union([
  z.object({
    kind: z.literal("OK"),
    account: accountSchema,
    rows: z.array(
      z.object({
        collection: z.string(),
        record_id: z.string(),
        seq: z.number().int(),
        schema_version: z.number().int(),
        payload: z.unknown(),
      }),
    ),
    has_more: z.boolean(),
  }),
  mismatchSchema,
]);

const pushSchema = z.union([
  z.object({
    kind: z.literal("OK"),
    account: accountSchema,
    results: z.array(
      z.object({
        collection: z.string(),
        record_id: z.string(),
        status: z.enum(["APPLIED", "UNCHANGED", "STALE"]),
        seq: z.number().int().nullable(),
      }),
    ),
  }),
  mismatchSchema,
]);

const resetSchema = z.union([
  z.object({ kind: z.literal("OK"), account: accountSchema }),
  generationMismatchSchema,
]);

const backupInfoSchema = z
  .object({
    id: z.string(),
    created_at: z.string(),
    exported_at: z.string(),
    generation: z.number().int(),
    schema_version: z.number().int(),
    format_version: z.number().int(),
    byte_size: z.number().int(),
    digest: z.string().nullable(),
  })
  .transform((value): CloudBackupInfo => ({
    id: value.id,
    createdAt: value.created_at,
    exportedAt: value.exported_at,
    generation: value.generation,
    schemaVersion: value.schema_version,
    formatVersion: value.format_version,
    byteSize: value.byte_size,
    digest: value.digest,
  }));

const backupCreateSchema = z.union([
  z.object({ kind: z.literal("OK"), backup: backupInfoSchema }),
  generationMismatchSchema,
]);

type PostgrestLikeError = {
  code?: string;
  message?: string;
} | null;

/** Map a Supabase/PostgREST failure to a sanitized category. */
export function categorize(
  status: number,
  error: PostgrestLikeError,
): TransportErrorCategory {
  const code = error?.code ?? "";
  if (status === 0) return "NETWORK";
  if (
    status === 401 ||
    code === "28000" ||
    code === "PGRST301" ||
    code === "PGRST302"
  ) {
    return "AUTH";
  }
  // No session: the request ran as `anon`, which may do nothing here.
  if (status === 403 || code === "42501") return "AUTH";
  if (status === 429) return "RATE_LIMITED";
  if (code === "PGRST116") return "NOT_FOUND";
  return "SERVER";
}

function fail(status: number, error: PostgrestLikeError): never {
  const category = categorize(status, error);
  // Code only: PostgREST messages can echo request fragments.
  throw new SyncTransportError(
    category,
    `${category}${error?.code ? ` (${error.code})` : ""}`,
  );
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new SyncTransportError("INVALID_RESPONSE", "INVALID_RESPONSE");
  }
  return parsed.data;
}

export function createSupabaseTransport(
  client: SupabaseClient,
  options: { timeoutMs?: number } = {},
): SyncTransport {
  const timeout = () =>
    AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);

  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error, status } = await client
      .rpc(name, args)
      .abortSignal(timeout());
    if (error) fail(status, error);
    return data as unknown;
  }

  return {
    async ensureAccount() {
      return parse(accountSchema, await rpc("sync_ensure_account", {}));
    },

    async pull(request) {
      const result = parse(
        pullSchema,
        await rpc("sync_pull", {
          p_generation: request.generation,
          p_after_seq: request.afterSeq,
          p_limit: request.limit,
        }),
      );
      if (result.kind !== "OK") {
        if (result.kind === "PROFILE_MISMATCH") {
          throw new SyncTransportError("INVALID_RESPONSE");
        }
        return { kind: "GENERATION_MISMATCH", account: result.account };
      }
      return {
        kind: "OK",
        account: result.account,
        hasMore: result.has_more,
        rows: result.rows.map((row) => ({
          collection: row.collection,
          recordId: row.record_id,
          seq: row.seq,
          schemaVersion: row.schema_version,
          payload: row.payload,
        })),
      };
    },

    async push(request): Promise<PushResponse> {
      const result = parse(
        pushSchema,
        await rpc("sync_push", {
          p_generation: request.generation,
          p_device_id: request.deviceId,
          p_items: request.items.map((item) => ({
            collection: item.collection,
            record_id: item.recordId,
            base_seq: item.baseSeq,
            schema_version: item.schemaVersion,
            payload: item.payload,
          })),
        }),
      );
      if (result.kind !== "OK") return result;
      return {
        kind: "OK",
        account: result.account,
        results: result.results.map((item) => ({
          collection: item.collection,
          recordId: item.record_id,
          status: item.status,
          seq: item.seq,
        })),
      };
    },

    async resetCloud({ expectedGeneration }) {
      return parse(
        resetSchema,
        await rpc("sync_reset", { p_expected_generation: expectedGeneration }),
      );
    },

    async listBackups() {
      const { data, error, status } = await client
        .from("cloud_backups")
        .select(
          "id, created_at, exported_at, generation, schema_version, format_version, byte_size, digest",
        )
        .order("created_at", { ascending: false })
        .abortSignal(timeout());
      if (error) fail(status, error);
      return parse(z.array(backupInfoSchema), data);
    },

    async uploadBackup(request) {
      return parse(
        backupCreateSchema,
        await rpc("backup_create", {
          p_generation: request.generation,
          p_content: request.text,
          p_exported_at: request.exportedAt,
          p_schema_version: request.schemaVersion,
          p_format_version: request.formatVersion,
          p_digest: request.digest,
        }),
      );
    },

    async downloadBackup(id) {
      const { data, error, status } = await client
        .from("cloud_backups")
        .select("content")
        .eq("id", id)
        .abortSignal(timeout())
        .single();
      if (error) fail(status, error);
      return parse(z.object({ content: z.string() }), data).content;
    },

    async deleteBackup(id) {
      await rpc("backup_delete", { p_id: id });
    },
  };
}
