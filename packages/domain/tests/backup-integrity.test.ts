import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BACKUP_FORMAT,
  CURRENT_SCHEMA_VERSION,
  STORAGE_KEYS,
  canonicalJson,
  computeBackupDigest,
  createBackup,
  createMemoryStorage,
  createUserDataRepository,
  createUserDataStore,
  decodeUserData,
  parseBackup,
  serializeBackup,
  sha256Hex,
  type UserData,
} from "../src";
import { fullDocument } from "./fixtures";
import { sequentialIds } from "./helpers";

const EXPORTED_AT = "2026-09-24T03:00:00.000Z";

/** The document as schema version 2 wrote it (before month/compensation). */
function asSchemaV2(data: UserData): Record<string, unknown> {
  const copy: Record<string, unknown> = JSON.parse(JSON.stringify(data));
  delete copy.attendanceMonths;
  delete copy.compensationSnapshots;
  copy.schemaVersion = 2;
  return copy;
}

/** A format-1 backup exactly as the previous release wrote it. */
function formatV1(data: unknown, schemaVersion: number): string {
  return `${JSON.stringify(
    {
      format: BACKUP_FORMAT,
      formatVersion: 1,
      exportedAt: EXPORTED_AT,
      schemaVersion,
      data,
    },
    null,
    2,
  )}\n`;
}

function newStore(storage = createMemoryStorage()) {
  const createId = sequentialIds("rt");
  return {
    storage,
    store: createUserDataStore({
      repository: createUserDataRepository(storage, {
        now: () => "2026-09-24T04:00:00.000Z",
        createId,
      }),
      now: () => new Date("2026-09-24T04:00:00.000Z"),
      createId,
    }),
  };
}

describe("integrity primitives", () => {
  it("computes standard SHA-256 over UTF-8", () => {
    for (const text of [
      "",
      "abc",
      "휴가 기록 ✓",
      "x".repeat(55),
      "y".repeat(64),
    ]) {
      expect(sha256Hex(text)).toBe(
        createHash("sha256").update(text, "utf8").digest("hex"),
      );
    }
  });

  it("serializes canonically regardless of key order", () => {
    expect(
      canonicalJson({ b: 1, a: [true, null, "한"], c: { z: 0, y: undefined } }),
    ).toBe('{"a":[true,null,"한"],"b":1,"c":{"z":0}}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });

  it("produces the same digest for the same document every time", () => {
    const data = fullDocument();
    const first = createBackup(data, EXPORTED_AT);
    const second = createBackup(structuredClone(data), EXPORTED_AT);
    expect(first.integrity).toEqual(second.integrity);
    expect(first.integrity).toMatchObject({
      algorithm: "SHA-256",
      canonicalization: "JCS",
    });
    // Pretty-printing or key order in the file does not matter.
    const reordered = JSON.stringify({
      data: first.data,
      integrity: first.integrity,
      schemaVersion: first.schemaVersion,
      exportedAt: first.exportedAt,
      formatVersion: first.formatVersion,
      format: first.format,
    });
    expect(parseBackup(reordered)).toMatchObject({ ok: true });
  });
});

describe("full-document backup round trip", () => {
  it("preserves every collection through serialize → parse", () => {
    const data = fullDocument();
    // The fixture really covers every collection and both import states.
    expect(data.profile).not.toBeNull();
    expect(data.events.some((event) => event.deletedAt !== null)).toBe(true);
    expect(data.events.some((event) => event.source.kind === "IMPORT")).toBe(
      true,
    );
    expect(data.leaveAdjustments.map((item) => item.kind).sort()).toEqual([
      "CORRECTION",
      "GRANT_CONFIRMATION",
    ]);
    expect(data.leaveSnapshots.length).toBeGreaterThanOrEqual(2);
    expect(data.imports.map((item) => item.status).sort()).toEqual([
      "ACTIVE",
      "ROLLED_BACK",
    ]);
    expect(data.attendanceMonths).toHaveLength(1);
    expect(data.compensationSnapshots).toHaveLength(1);

    const parsed = parseBackup(
      serializeBackup(createBackup(data, EXPORTED_AT)),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data).toEqual(data);
    expect(parsed.info).toEqual({
      formatVersion: 2,
      exportedAt: EXPORTED_AT,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      migratedFrom: null,
      migrationIssues: [],
      integrity: "VERIFIED",
    });
  });

  it("survives backup → replace into an empty store → reload", async () => {
    const data = fullDocument();
    const text = serializeBackup(createBackup(data, EXPORTED_AT));
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);

    const { store, storage } = newStore();
    await store.load();
    const snapshot = store.getSnapshot();
    if (snapshot.phase !== "READY") throw new Error("not ready");
    const restored = await store.restore(parsed.data, {
      mode: "REPLACE",
      expectedDocumentRevision: snapshot.data.documentRevision,
    });
    expect(restored.ok).toBe(true);

    // A brand-new store instance reads it back from storage.
    const reloaded = newStore(storage).store;
    await reloaded.load();
    const after = reloaded.getSnapshot();
    if (after.phase !== "READY") throw new Error("not ready");
    const { deviceId, documentRevision, savedAt } = after.data;
    // Intentionally regenerated: the restoring device keeps its own device
    // id, and the storage write counter/timestamp belong to this device.
    // Everything else must be identical.
    expect({
      ...after.data,
      deviceId: "",
      documentRevision: 0,
      savedAt: null,
    }).toEqual({
      ...data,
      deviceId: "",
      documentRevision: 0,
      savedAt: null,
    });
    expect(deviceId).not.toBe(data.deviceId);
    expect(documentRevision).toBe(1);
    expect(savedAt).toBe("2026-09-24T04:00:00.000Z");
    // Record-level provenance is untouched.
    expect(after.data.events.map((event) => event.deviceId)).toEqual(
      data.events.map((event) => event.deviceId),
    );
  });
});

describe("rejecting bad files, each with its own reason", () => {
  const good = () => serializeBackup(createBackup(fullDocument(), EXPORTED_AT));

  it("malformed JSON", () => {
    expect(parseBackup("not json")).toMatchObject({
      ok: false,
      kind: "MALFORMED_JSON",
    });
  });

  it("foreign JSON", () => {
    expect(parseBackup(JSON.stringify({ hello: "world" }))).toMatchObject({
      ok: false,
      kind: "FOREIGN_FILE",
    });
    expect(parseBackup("[1,2]")).toMatchObject({
      ok: false,
      kind: "FOREIGN_FILE",
    });
  });

  it("truncated download", () => {
    const text = good();
    for (const cut of [0.3, 0.9, 0.999]) {
      expect(
        parseBackup(text.slice(0, Math.floor(text.length * cut))),
      ).toMatchObject({
        ok: false,
        kind: "TRUNCATED",
      });
    }
  });

  it("checksum mismatch after a content edit", () => {
    const file = JSON.parse(good());
    file.data.events[0].note = "몰래 고친 메모";
    const result = parseBackup(JSON.stringify(file));
    expect(result).toMatchObject({ ok: false, kind: "INTEGRITY_MISMATCH" });
    // The message must not claim authentication or signing.
    if (!result.ok) expect(result.error).not.toMatch(/서명|인증|암호/);
  });

  it("checksum mismatch after a header edit", () => {
    const file = JSON.parse(good());
    file.exportedAt = "2020-01-01T00:00:00.000Z";
    expect(parseBackup(JSON.stringify(file))).toMatchObject({
      ok: false,
      kind: "INTEGRITY_MISMATCH",
    });
  });

  it("missing or malformed integrity block in a format-2 file", () => {
    const file = JSON.parse(good());
    delete file.integrity;
    expect(parseBackup(JSON.stringify(file))).toMatchObject({
      ok: false,
      kind: "INVALID_STRUCTURE",
    });
    file.integrity = { algorithm: "MD5", canonicalization: "JCS", digest: "x" };
    expect(parseBackup(JSON.stringify(file))).toMatchObject({
      ok: false,
      kind: "INVALID_STRUCTURE",
    });
  });

  it("structurally invalid document with a valid checksum", () => {
    const data = fullDocument();
    const broken = JSON.parse(JSON.stringify(data));
    broken.events[0].timing = { kind: "ALL_DAY", dayCount: 0.5 };
    const file = {
      format: BACKUP_FORMAT,
      formatVersion: 2,
      exportedAt: EXPORTED_AT,
      schemaVersion: 3,
      integrity: {
        algorithm: "SHA-256",
        canonicalization: "JCS",
        digest: computeBackupDigest({
          exportedAt: EXPORTED_AT,
          schemaVersion: 3,
          data: broken,
        }),
      },
      data: broken,
    };
    expect(parseBackup(JSON.stringify(file))).toMatchObject({
      ok: false,
      kind: "INVALID_STRUCTURE",
    });
  });

  it("newer schema inside an otherwise valid file", () => {
    const data = {
      ...JSON.parse(JSON.stringify(fullDocument())),
      schemaVersion: 4,
      futureField: [1],
    };
    const file = {
      format: BACKUP_FORMAT,
      formatVersion: 2,
      exportedAt: EXPORTED_AT,
      schemaVersion: 4,
      integrity: {
        algorithm: "SHA-256",
        canonicalization: "JCS",
        digest: computeBackupDigest({
          exportedAt: EXPORTED_AT,
          schemaVersion: 4,
          data,
        }),
      },
      data,
    };
    expect(parseBackup(JSON.stringify(file))).toMatchObject({
      ok: false,
      kind: "NEWER_SCHEMA",
    });
  });

  it("newer backup envelope", () => {
    const file = JSON.parse(good());
    file.formatVersion = 3;
    expect(parseBackup(JSON.stringify(file))).toMatchObject({
      ok: false,
      kind: "UNSUPPORTED_FORMAT_VERSION",
    });
  });

  it("header and body schema versions that disagree", () => {
    const data = JSON.parse(JSON.stringify(fullDocument()));
    const file = {
      format: BACKUP_FORMAT,
      formatVersion: 2,
      exportedAt: EXPORTED_AT,
      schemaVersion: 2,
      integrity: {
        algorithm: "SHA-256",
        canonicalization: "JCS",
        digest: computeBackupDigest({
          exportedAt: EXPORTED_AT,
          schemaVersion: 2,
          data,
        }),
      },
      data,
    };
    expect(parseBackup(JSON.stringify(file))).toMatchObject({
      ok: false,
      kind: "INVALID_STRUCTURE",
    });
  });
});

describe("compatibility with earlier backups and schemas", () => {
  it("reads a format-1 backup of the current schema (no checksum)", () => {
    const data = fullDocument();
    const parsed = parseBackup(formatV1(data, 3));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data).toEqual(data);
    expect(parsed.info).toMatchObject({
      formatVersion: 1,
      integrity: "NOT_PRESENT",
      migratedFrom: null,
    });
  });

  it("migrates a format-1 backup of schema 2 deterministically", () => {
    const data = fullDocument();
    const text = formatV1(asSchemaV2(data), 2);
    const first = parseBackup(text);
    const second = parseBackup(text);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.data).toEqual(second.data);
    expect(first.info).toMatchObject({ schemaVersion: 2, migratedFrom: 2 });
    expect(first.data.schemaVersion).toBe(3);
    expect(first.data.attendanceMonths).toEqual([]);
    expect(first.data.compensationSnapshots).toEqual([]);
    expect(first.data.events).toEqual(data.events);
  });

  it("migrates a stored schema-2 document once and keeps the original as the previous generation", async () => {
    const v2 = JSON.stringify(asSchemaV2(fullDocument()));
    const storage = createMemoryStorage({ [STORAGE_KEYS.current]: v2 });
    const { store } = newStore(storage);
    await store.load();
    const snapshot = store.getSnapshot();
    expect(snapshot.phase === "READY" && snapshot.notice?.kind).toBe(
      "MIGRATED",
    );
    expect(
      JSON.parse(storage.dump()[STORAGE_KEYS.current]!).schemaVersion,
    ).toBe(3);
    expect(storage.dump()[STORAGE_KEYS.previous]).toBe(v2);
    // Decoding the same stored text twice gives the same document.
    expect(decodeUserData(JSON.parse(v2))).toEqual(
      decodeUserData(JSON.parse(v2)),
    );
  });

  it("never rewrites or downgrades a newer-schema stored document", async () => {
    const future = JSON.stringify({
      schemaVersion: 4,
      somethingNew: { keep: true },
    });
    const storage = createMemoryStorage({ [STORAGE_KEYS.current]: future });
    const { store } = newStore(storage);
    await store.load();
    const restored = await store.restore(fullDocument(), {
      mode: "REPLACE",
      expectedDocumentRevision: 0,
      confirmDestructive: true,
    });
    expect(restored).toMatchObject({ ok: false, code: "READ_ONLY" });
    expect(storage.dump()).toEqual({ [STORAGE_KEYS.current]: future });
  });

  it("rejects a schema version no migration can reach", () => {
    expect(decodeUserData({ schemaVersion: 1 })).toMatchObject({
      kind: "INVALID",
    });
    expect(decodeUserData({ schemaVersion: 0 })).toMatchObject({
      kind: "INVALID",
    });
  });
});
